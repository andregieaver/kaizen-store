import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { CART_TTL_DAYS, settleQuantity } from "@/lib/cart";
import { nextQuantity, quantityProblem } from "@/lib/quantity-rules";
import { API_CART_LINES_MAX, API_CART_PREFIX, looksLikeApiCartKey } from "@/lib/storefront-api";
import { HANDOFF_MINUTES, HANDOFF_PREFIX, type CartLineInput } from "@/lib/wordpress-cart";
import { hashSecret } from "@/lib/wordpress";
import { marketUrl } from "@/lib/paths";

import { sellableQuantity, type Shop } from "./cart";
import { log } from "./log";
import { offeredMarketIn } from "./shop";
import type { StorefrontCaller } from "./storefront-api";
import { col, typedRows } from "./typed-rows";
import { quoteCart } from "./wordpress-shop";

/**
 * Carts kept through the storefront API (wave 12 unit D, D398): a real cart of the store (`carts.source = 'api'`) in the token's market, found
 * only by its key (`kfc_…`), which the token holder keeps and the database keeps as a hash (`carts.api_hash`). Every line is put in with the
 * store's own checks (`sellableQuantity()`: sold in the market, goods only, stock or the line's most for a variant that keeps selling, the
 * variant's quantity rule), so the API never prices or stocks anything itself: a read is `quoteCart()` over the cart's lines, with each line's
 * price, `available` and status. The checkout is the store's own page: `apiCartCheckout()` turns the same cart into a one-time hand-over link
 * (D170) and clears the key, so the key never opens it again. Nothing is held: stock is held only once checkout starts, as for any cart.
 */

export type ApiCartChange = { ok: true } | { ok: false; reason: "not_found" | "unavailable" | "quantity" | "too_many_lines" };

const shopOf = (caller: StorefrontCaller): Shop | null => {
  const market = offeredMarketIn(caller.store, caller.market);
  return market ? { storeId: caller.store.id, market } : null;
};

/** The cart a key opens in the token's store and market, open and not run out, or null. */
async function cartOf(runner: Pick<ReturnType<typeof db>, "execute">, shop: Shop, key: string, lock = false): Promise<string | null> {
  if (!looksLikeApiCartKey(key)) return null;
  const [row] = await runner.execute<{ id: string }>(sql`
    select id from commerce.carts
    where api_hash = ${hashSecret(key)} and store_id = ${shop.storeId}::uuid and market_code = ${shop.market.code}
      and status = 'open' and expires_at > now() and source = 'api'
    ${lock ? sql`for update` : sql``}
  `);
  return row ? String(row.id) : null;
}

async function linesOf(cartId: string): Promise<CartLineInput[]> {
  const rows = await typedRows(
    z.object({ variant_id: col.uuid, quantity: col.int }),
    sql`select variant_id, quantity from commerce.cart_lines where cart_id = ${cartId}::uuid and selling_plan_id is null order by id`,
  );
  return rows.map((r) => ({ variantId: r.variant_id, quantity: r.quantity }));
}

/** Puts a variant in the cart as the store's own cart does: `add` more, or `set` exactly (0 removes the line). */
async function putLine(tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0], shop: Shop, cartId: string, line: CartLineInput, mode: "add" | "set"): Promise<ApiCartChange> {
  if (mode === "set" && line.quantity <= 0) {
    await tx.execute(sql`delete from commerce.cart_lines where store_id = ${shop.storeId}::uuid and cart_id = ${cartId}::uuid and variant_id = ${line.variantId}::uuid and selling_plan_id is null`);
    return { ok: true };
  }
  const sellable = await sellableQuantity(tx, shop, line.variantId, null, null, 1);
  if (!sellable || sellable.kind !== "goods" || sellable.giftCard || sellable.available <= 0) return { ok: false, reason: "unavailable" };
  const [current] = await tx.execute<{ quantity: number }>(sql`
    select quantity from commerce.cart_lines where cart_id = ${cartId}::uuid and variant_id = ${line.variantId}::uuid and selling_plan_id is null
  `);
  const had = Number(current?.quantity ?? 0);
  if (!current) {
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.cart_lines where cart_id = ${cartId}::uuid`);
    if (Number(count?.n ?? 0) >= API_CART_LINES_MAX) return { ok: false, reason: "too_many_lines" };
  }
  // A quantity set below the rule's minimum or between its steps is refused, the line kept as it is (D323), as the store's cart does.
  if (mode === "set") {
    const problem = quantityProblem(line.quantity, sellable.rule);
    if (problem && problem.kind !== "max") return { ok: false, reason: "quantity" };
  }
  const wanted = mode === "add" ? nextQuantity(had, line.quantity, sellable.rule) : line.quantity;
  const settled = settleQuantity(wanted, sellable.available, sellable.rule);
  if (settled.quantity === 0) return { ok: false, reason: "unavailable" };
  await tx.execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    values (${shop.storeId}::uuid, ${cartId}::uuid, ${line.variantId}::uuid, ${settled.quantity})
    on conflict on constraint cart_lines_cart_variant_plan_key do update set quantity = excluded.quantity
  `);
  await tx.execute(sql`update commerce.carts set updated_at = now(), expires_at = now() + make_interval(days => ${CART_TTL_DAYS}) where id = ${cartId}::uuid`);
  return { ok: true };
}

/** Makes a cart in the token's market with the lines given (each put in as the store's cart would; one that cannot be is left out). */
export async function makeApiCart(caller: StorefrontCaller, lines: CartLineInput[]): Promise<{ key: string; cartId: string } | null> {
  const shop = shopOf(caller);
  if (!shop) return null;
  const key = `${API_CART_PREFIX}${randomBytes(32).toString("base64url")}`;
  const cartId = await db().transaction(async (tx) => {
    const [cart] = await tx.execute<{ id: string }>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at, api_hash, source)
      values (${shop.storeId}::uuid, ${shop.market.code}, ${shop.market.currency}, ${shop.market.locale},
              now() + make_interval(days => ${CART_TTL_DAYS}), ${hashSecret(key)}, 'api')
      returning id
    `);
    const id = String(cart.id);
    for (const line of lines) await putLine(tx, shop, id, line, "add");
    return id;
  });
  log("info", "storefront_api.cart_made", { storeId: shop.storeId, lines: lines.length });
  return { key, cartId };
}

/** What the cart holds and costs now (`quoteCart()` over its lines), or null for a key that opens nothing here. */
export async function readApiCart(caller: StorefrontCaller, key: string) {
  const shop = shopOf(caller);
  if (!shop) return null;
  const cartId = await cartOf(db(), shop, key);
  if (!cartId) return null;
  const quote = await quoteCart(caller.store, caller.market, await linesOf(cartId));
  return quote ? { ...quote, cart: key } : null;
}

/** Adds to, sets or removes a line of the cart, under the cart's lock. */
export async function changeApiCart(caller: StorefrontCaller, key: string, line: CartLineInput, mode: "add" | "set"): Promise<ApiCartChange> {
  const shop = shopOf(caller);
  if (!shop) return { ok: false, reason: "not_found" };
  return db().transaction(async (tx) => {
    const cartId = await cartOf(tx, shop, key, true);
    if (!cartId) return { ok: false, reason: "not_found" } as const;
    return putLine(tx, shop, cartId, line, mode);
  });
}

export type ApiCheckout = { ok: true; url: string } | { ok: false; reason: "not_found" | "nothing_to_buy" };

/**
 * Hands the cart over to the store's checkout: a one-time link (D170, fifteen minutes) that makes it the shopper's cart there. The key is
 * cleared in the same statement, so after this the cart is the browser's alone and the API can neither read nor change it.
 */
export async function apiCartCheckout(caller: StorefrontCaller, key: string): Promise<ApiCheckout> {
  const shop = shopOf(caller);
  if (!shop) return { ok: false, reason: "not_found" };
  const token = `${HANDOFF_PREFIX}${randomBytes(32).toString("base64url")}`;
  const outcome = await db().transaction(async (tx): Promise<ApiCheckout> => {
    const cartId = await cartOf(tx, shop, key, true);
    if (!cartId) return { ok: false, reason: "not_found" };
    const [lines] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.cart_lines where cart_id = ${cartId}::uuid`);
    if (Number(lines?.n ?? 0) === 0) return { ok: false, reason: "nothing_to_buy" };
    await tx.execute(sql`
      update commerce.carts
      set api_hash = null, handoff_hash = ${hashSecret(token)}, handoff_expires_at = now() + make_interval(mins => ${HANDOFF_MINUTES}),
          handoff_to = 'checkout', updated_at = now()
      where id = ${cartId}::uuid
    `);
    return { ok: true, url: `${marketUrl(caller.store.slug, shop.market.slug, "/cart/resume")}?t=${encodeURIComponent(token)}` };
  });
  log("info", "storefront_api.cart_checkout", { storeId: shop.storeId, ok: outcome.ok });
  return outcome;
}
