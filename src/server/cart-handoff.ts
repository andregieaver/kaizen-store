import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CART_TTL_DAYS, settleQuantity, type LineOutcome } from "@/lib/cart";
import { HANDOFF_MINUTES, HANDOFF_PREFIX, type CartLineInput } from "@/lib/wordpress-cart";
import { hashSecret } from "@/lib/wordpress";

import { sellableQuantity, setCartCookie, type Shop } from "./cart";

type Row = Record<string, unknown>;

/**
 * A cart made on another site and opened here (D170): the WordPress plugin sends the variants and quantities its shopper chose, and the shopper
 * is sent to a one-time link that makes it their cart in the store. The lines are checked as if the shopper had added them here (`sellableQuantity()`:
 * an active variant with a price in the market, goods only, never a subscription-only or business-only product, stock for the quantity), and a
 * quantity above the stock is cut to it. The link is a secret kept only as a hash, works once and for fifteen minutes; until it is used the
 * cart is no one's, holds no stock, and runs out with the link.
 */
export type HandoffResult =
  | { ok: true; token: string; lines: { variantId: string; quantity: number; outcome: LineOutcome | "unavailable" }[] }
  | { ok: false; reason: "nothing_to_buy" };

class NothingToBuy extends Error {}

export async function createHandoffCart(shop: Shop, lines: CartLineInput[], to: "cart" | "checkout"): Promise<HandoffResult> {
  const token = `${HANDOFF_PREFIX}${randomBytes(32).toString("base64url")}`;
  try {
    return await db().transaction(async (tx) => {
      const [cart] = await tx.execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at, handoff_hash, handoff_expires_at, handoff_to)
        values (${shop.storeId}::uuid, ${shop.market.code}, ${shop.market.currency}, ${shop.market.locale},
                now() + make_interval(mins => ${HANDOFF_MINUTES}), ${hashSecret(token)},
                now() + make_interval(mins => ${HANDOFF_MINUTES}), ${to})
        returning id
      `);
      const cartId = String(cart.id);
      const kept: { variantId: string; quantity: number; outcome: LineOutcome | "unavailable" }[] = [];
      for (const line of lines) {
        const sellable = await sellableQuantity(tx, shop, line.variantId, null, null, 1);
        if (!sellable || sellable.kind !== "goods" || sellable.available <= 0) {
          kept.push({ variantId: line.variantId, quantity: 0, outcome: "unavailable" });
          continue;
        }
        const settled = settleQuantity(line.quantity, sellable.available);
        await tx.execute(sql`
          insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
          values (${shop.storeId}::uuid, ${cartId}::uuid, ${line.variantId}::uuid, ${settled.quantity})
        `);
        kept.push({ variantId: line.variantId, quantity: settled.quantity, outcome: settled.outcome });
      }
      // Nothing could be bought: no cart is made (the transaction is undone).
      if (!kept.some((line) => line.quantity > 0)) throw new NothingToBuy();
      return { ok: true as const, token, lines: kept };
    });
  } catch (error) {
    if (error instanceof NothingToBuy) return { ok: false, reason: "nothing_to_buy" };
    throw error;
  }
}

/**
 * Opens a hand-over link: once, within its minutes, in the store and market it was made for. The cart becomes this browser's cart (its cookie
 * is set) and lives as long as any cart does; the link is then used up. Null for a link that is wrong, used or run out.
 */
export async function resumeHandoff(shop: Shop, token: string): Promise<{ cartId: string; to: "cart" | "checkout" } | null> {
  if (!new RegExp(`^${HANDOFF_PREFIX}[A-Za-z0-9_-]{40,60}$`).test(token)) return null;
  const hash = hashSecret(token);
  const [found] = await db().execute<Row>(sql`
    select handoff_to from commerce.carts
    where handoff_hash = ${hash} and handoff_expires_at > now() and store_id = ${shop.storeId}::uuid
      and market_code = ${shop.market.code} and status = 'open'
  `);
  if (!found) return null;
  // The claim: of two openings of one link only one gets the cart.
  const [claimed] = await db().execute<Row>(sql`
    update commerce.carts
    set handoff_hash = null, handoff_expires_at = null, handoff_to = null, updated_at = now(),
        expires_at = now() + make_interval(days => ${CART_TTL_DAYS})
    where handoff_hash = ${hash} and handoff_expires_at > now() and store_id = ${shop.storeId}::uuid and market_code = ${shop.market.code}
    returning id
  `);
  if (!claimed) return null;
  await setCartCookie(shop, String(claimed.id));
  return { cartId: String(claimed.id), to: found.handoff_to === "cart" ? "cart" : "checkout" };
}
