import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { featureOn } from "@/lib/store-features";
import { looksLikeStorefrontToken, STOREFRONT_TOKEN_PREFIX, STOREFRONT_TOKENS_MAX, type CartBody, type ProductsQuery } from "@/lib/storefront-api";
import { viewQuery } from "@/lib/wordpress";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { offeredMarketIn } from "./shop";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { termsOf, viewOf } from "./wordpress";
import { handoffCart, productPageOf, quoteCart } from "./wordpress-shop";
import type { Store } from "./stores";

/**
 * The storefront API (wave 9 unit I, D362, `docs/wave-9-platform.md` section 3, I): the only writer of `commerce.storefront_tokens`. A token
 * is made by an owner for one of the store's markets (Settings → Apps and API) and is public by design (a site's own code holds it), so it
 * opens only what any visitor of that market sees: the products as the market lists them, a product's page, the categories, a cart's quote
 * and the hand-over to the store's checkout, each through the storefront's own reads (`viewOf()`, `productPageOf()`, `termsOf()`,
 * `quoteCart()`, `handoffCart()`, the WordPress plugin's, D169 and D170). Nothing is ordered or paid here; a store that is not open, has the
 * shop off or is private answers nothing.
 */

export type StorefrontToken = { id: string; name: string; token: string; market: string; lastUsedAt: string | null; createdAt: string };

const tokenRow = z.object({ id: col.uuid, name: col.text, token: col.text, market: col.text, last_used_at: col.timestampOrNull, created_at: col.timestamp });

/** The store's tokens in use, newest first. */
export async function listStorefrontTokens(storeId: string): Promise<StorefrontToken[]> {
  const rows = await typedRows(
    tokenRow,
    sql`select id, name, token, market, last_used_at, created_at from commerce.storefront_tokens where store_id = ${storeId}::uuid and revoked_at is null order by created_at desc, id`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, token: r.token, market: r.market, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

export type MakeStorefrontOutcome = { ok: true; token: string } | { ok: false; problem: "name" | "market" | "limit" };

/** Makes a token for one of the store's offered markets (owners only, checked by the caller). */
export async function makeStorefrontToken(owner: Membership, input: { name: string; market: string }): Promise<MakeStorefrontOutcome> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, problem: "name" };
  const market = offeredMarketIn(owner.store, input.market || null);
  if (!market) return { ok: false, problem: "market" };
  const [count] = await db().execute<{ n: number }>(sql`
    select count(*)::int as n from commerce.storefront_tokens where store_id = ${owner.store.id}::uuid and revoked_at is null
  `);
  if (Number(count?.n ?? 0) >= STOREFRONT_TOKENS_MAX) return { ok: false, problem: "limit" };
  const token = `${STOREFRONT_TOKEN_PREFIX}${randomBytes(30).toString("base64url")}`;
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.storefront_tokens (store_id, name, token, market, created_by)
    values (${owner.store.id}::uuid, ${name}, ${token}, ${market.slug}, ${owner.account.id}::uuid) returning id
  `);
  await audit(owner.account.id, owner.store.id, "integration.storefront_token_made", { name, market: market.slug }, { area: "settings", target: { type: "storefront_token", id: String(row.id) } });
  return { ok: true, token };
}

/** Revokes a token of the store's; it answers nothing from then on. */
export async function revokeStorefrontToken(owner: Membership, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const done = await db().execute<{ name: string }>(sql`
    update commerce.storefront_tokens set revoked_at = now() where id = ${id}::uuid and store_id = ${owner.store.id}::uuid and revoked_at is null returning name
  `);
  if (done.length === 0) return false;
  await audit(owner.account.id, owner.store.id, "integration.storefront_token_revoked", { name: done[0].name }, { area: "settings", target: { type: "storefront_token", id } });
  return true;
}

/** Why a store's storefront API answers nothing, or null: open, a real store, the shop on, not private. */
export function storefrontProblem(store: Store): "closed" | "no_shop" | "private" | null {
  if (store.status !== "active" || store.isTemplate || store.starter) return "closed";
  if (!featureOn(store, "shop")) return "no_shop";
  if (store.privateMode) return "private";
  return null;
}

export type StorefrontCaller = { tokenId: string; store: Store; market: string };

/** Who calls: the token in use for the store the address names, and that store as it is now. Null for anything else (a 401 that never says which). */
export async function storefrontCaller(slug: string, token: string | null): Promise<StorefrontCaller | null> {
  if (!token || !looksLikeStorefrontToken(token) || !/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const row = await typedRow(
    z.object({ id: col.uuid, store_id: col.uuid, market: col.text, stale: col.bool }),
    sql`
      select t.id, t.store_id, t.market, (t.last_used_at is null or t.last_used_at < now() - interval '1 minute') as stale
      from commerce.storefront_tokens t join commerce.stores s on s.id = t.store_id
      where t.token = ${token} and t.revoked_at is null and s.slug = ${slug}
    `,
  );
  if (!row) return null;
  const store = await getStore(slug);
  if (!store || store.id !== row.store_id) return null;
  if (row.stale) await db().execute(sql`update commerce.storefront_tokens set last_used_at = now() where id = ${row.id}::uuid`);
  return { tokenId: row.id, store, market: row.market };
}

/** Products as the token's market lists them. Null when the market is no longer offered. */
export async function storefrontProducts(caller: StorefrontCaller, query: ProductsQuery) {
  const source = query.category ? "category" : query.tag ? "tag" : "all";
  const view = viewQuery.parse({
    source,
    ...(query.category && { categories: query.category }),
    ...(query.tag && { tags: query.tag }),
    sort: query.sort,
    limit: String(query.limit),
    market: caller.market,
  });
  const answer = await viewOf(caller.store, view);
  log("info", "storefront_api.products", { storeId: caller.store.id, products: answer?.products.length ?? 0 });
  return answer;
}

/** A product's page as the token's market shows it, or null. */
export const storefrontProduct = (caller: StorefrontCaller, handle: string) => productPageOf(caller.store, caller.market, handle);

/** The store's product categories and tags. */
export const storefrontCategories = (caller: StorefrontCaller) => termsOf(caller.store);

/** What a cart held on the site costs now (a subtotal: shipping and discounts are the checkout's, with the address). */
export const storefrontCart = (caller: StorefrontCaller, body: CartBody) => quoteCart(caller.store, caller.market, body.lines);

/** Makes the cart in the store and answers the one-time address of its checkout. */
export async function storefrontCheckout(caller: StorefrontCaller, body: CartBody) {
  const made = await handoffCart(caller.store, caller.market, body.lines, "checkout");
  log("info", "storefront_api.checkout", { storeId: caller.store.id, ok: made.ok });
  return made;
}
