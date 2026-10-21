import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { GIFT_CARDS_PER_CART, looksLikeGiftCode } from "@/lib/gift-cards";

import { readCartId, type Shop } from "./cart";
import { hashGiftCode } from "./gift-card-codes";
import { storePaymentMode } from "./host-payments";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Gift cards on a cart (D300 F3, `docs/wave-5-marketing.md` 8.3). A card is found by its code (`findGiftCard()`, by hash, the store's own) and
 * kept on the cart by its id alone (`cart_gift_cards`), at most three, in the order added; the code itself is never kept. What each card pays is
 * worked out again whenever the cart is read (`cartGiftCards()` with `giftCardsPay()`), and nothing is held until the order is placed. A wrong
 * code says only that the card can't be used, never whether it exists; tries are counted per cart and per client, like VIES checks.
 */

/** Tries a cart may make in an hour, and a client (a keyed hash of its address for the day, as `viesClientKey()` makes it). */
export const GIFT_CARD_TRIES_PER_CART_PER_HOUR = 10;
export const GIFT_CARD_TRIES_PER_CLIENT_PER_HOUR = 20;

/** Why a card cannot pay for this basket: it cannot be used at all (`unusable`, whatever the reason), or it is in another currency than the one shown. */
export type GiftCardProblem = "unusable" | "currency";

/** A card on the cart as the cart shows it: never its code, only its last four. */
export type CartGiftCard = {
  id: string;
  last4: string;
  currency: string;
  balanceMinor: number;
  expiresAt: string | null;
  problem: GiftCardProblem | null;
};

/** What became of a code typed at the cart or checkout. */
export type AddGiftCardOutcome =
  | { ok: true; cardId: string }
  | { ok: false; problem: "unusable" | "limit" | "full" | "none" }
  | { ok: false; problem: "currency"; currency: string };

/** The store's mode now, as a test card must match (a test card is spent only in test mode, and a real one only for real). */
async function testModeNow(storeId: string): Promise<boolean> {
  return (await storePaymentMode(storeId)) === "test";
}

/** One try from a bucket's count for this clock hour, atomically (the counters VIES's limits use, `commerce.chat_usage`). */
async function takeTry(storeId: string, bucket: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0);
}

/**
 * A card that can pay in this store now: found by its code's hash, active, with its code delivered, not expired, of the store's mode and with a
 * balance; or why not. Another currency than the one shown is said (the shopper can change the view); anything else is `unusable`.
 */
export async function findGiftCard(
  runner: Runner,
  storeId: string,
  typed: string,
  view: { currency: string; testMode: boolean },
): Promise<{ ok: true; id: string } | { ok: false; problem: "unusable" } | { ok: false; problem: "currency"; currency: string }> {
  if (!looksLikeGiftCode(typed)) return { ok: false, problem: "unusable" };
  const hash = hashGiftCode(typed);
  if (!hash) return { ok: false, problem: "unusable" };
  const [card] = await runner.execute<Row>(sql`
    select g.id, g.currency, commerce.gift_card_balance(g.id) as balance,
      g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > now()) and g.test_mode = ${view.testMode} as usable
    from commerce.gift_cards g
    where g.store_id = ${storeId}::uuid and g.code_hash = ${hash}
  `);
  if (!card || !card.usable || Number(card.balance) <= 0) return { ok: false, problem: "unusable" };
  if (String(card.currency).trim() !== view.currency.toUpperCase()) return { ok: false, problem: "currency", currency: String(card.currency).trim() };
  return { ok: true, id: String(card.id) };
}

/** Puts a card on the cart by its code: counted against the cart's and the client's tries first, a fourth refused. */
export async function addCartGiftCard(shop: Shop, typed: string, options: { clientKey: string | null }): Promise<AddGiftCardOutcome> {
  const cartId = await readCartId(shop);
  if (!cartId || !typed.trim()) return { ok: false, problem: "none" };
  if (options.clientKey && (await takeTry(shop.storeId, `giftcard:c:${options.clientKey}`)) > GIFT_CARD_TRIES_PER_CLIENT_PER_HOUR) return { ok: false, problem: "limit" };
  if ((await takeTry(shop.storeId, `giftcard:k:${cartId}`)) > GIFT_CARD_TRIES_PER_CART_PER_HOUR) return { ok: false, problem: "limit" };
  const found = await findGiftCard(db(), shop.storeId, typed, { currency: shop.market.currency, testMode: await testModeNow(shop.storeId) });
  if (!found.ok) return found;
  return db().transaction(async (tx) => {
    const [cart] = await tx.execute<Row>(sql`
      select id from commerce.carts where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open' for update
    `);
    if (!cart) return { ok: false, problem: "none" } as const;
    const held = await tx.execute<Row>(sql`
      select card_id from commerce.cart_gift_cards where store_id = ${shop.storeId}::uuid and cart_id = ${cartId}::uuid
    `);
    if (held.some((r) => String(r.card_id) === found.id)) return { ok: true, cardId: found.id } as const;
    if (held.length >= GIFT_CARDS_PER_CART) return { ok: false, problem: "full" } as const;
    await tx.execute(sql`
      insert into commerce.cart_gift_cards (store_id, cart_id, card_id) values (${shop.storeId}::uuid, ${cartId}::uuid, ${found.id}::uuid)
    `);
    await tx.execute(sql`update commerce.carts set updated_at = now() where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid`);
    return { ok: true, cardId: found.id } as const;
  });
}

/** Takes a card off the cart, by its id (the cart's forms never carry a code). */
export async function removeCartGiftCard(shop: Shop, cardId: string): Promise<boolean> {
  const cartId = await readCartId(shop);
  if (!cartId || !/^[0-9a-f-]{36}$/i.test(cardId)) return false;
  const removed = await db().execute(sql`
    delete from commerce.cart_gift_cards where store_id = ${shop.storeId}::uuid and cart_id = ${cartId}::uuid and card_id = ${cardId}::uuid returning 1
  `);
  return removed.length > 0;
}

/**
 * The cards on a cart, in the order added, each with what it holds now and why it cannot pay (it was spent, expired or deactivated since it was
 * added, or the view's currency changed). With `lock` (inside `placeOrder()`'s transaction) every card is locked in id order first, so two
 * checkouts spending the same card never wait on each other in a circle and the balances read are the ones held against.
 */
export async function cartGiftCards(
  runner: Runner,
  storeId: string,
  cartId: string,
  view: { currency: string; testMode?: boolean; lock?: boolean },
): Promise<CartGiftCard[]> {
  const testMode = view.testMode ?? (await testModeNow(storeId));
  if (view.lock) {
    await runner.execute(sql`
      select g.id from commerce.gift_cards g
      where g.store_id = ${storeId}::uuid and g.id in (select c.card_id from commerce.cart_gift_cards c where c.store_id = ${storeId}::uuid and c.cart_id = ${cartId}::uuid)
      order by g.id for update
    `);
  }
  const rows = await runner.execute<Row>(sql`
    select g.id, g.last4, g.currency, g.expires_at, commerce.gift_card_balance(g.id) as balance,
      g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > now()) and g.test_mode = ${testMode} as usable
    from commerce.cart_gift_cards c
    join commerce.gift_cards g on g.store_id = c.store_id and g.id = c.card_id
    where c.store_id = ${storeId}::uuid and c.cart_id = ${cartId}::uuid
    order by c.added_at, g.id
  `);
  return rows.map((row) => {
    const currency = String(row.currency).trim();
    const balance = Number(row.balance);
    return {
      id: String(row.id),
      last4: String(row.last4 ?? ""),
      currency,
      balanceMinor: balance,
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      problem: !row.usable || balance <= 0 ? "unusable" : currency !== view.currency.toUpperCase() ? "currency" : null,
    };
  });
}

/**
 * The cart's cards as the checkout shows them, against the order waiting for payment: what the order holds on each (its pending `gift_card`
 * payments), what is left on it, and why one the order does not hold cannot pay. The checkout never works out what a card pays itself: the order
 * holds it, as `placeOrder()` took it.
 */
export async function checkoutGiftCards(
  storeId: string,
  cartId: string,
  orderId: string,
  currency: string,
): Promise<{ id: string; last4: string; currency: string; amountMinor: number; afterMinor: number; problem: GiftCardProblem | "subscription" | "host" | null }[]> {
  const cards = await cartGiftCards(db(), storeId, cartId, { currency });
  if (cards.length === 0) return [];
  const held = await db().execute<Row>(sql`
    select p.gift_card_id, sum(p.amount_minor) as amount from commerce.payments p
    where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.provider = 'gift_card' and p.status in ('pending', 'captured')
    group by p.gift_card_id
  `);
  const [order] = await db().execute<Row>(sql`
    select o.host_id is not null as host, o.subscription_id is not null as subscription from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  const holds = new Map(held.map((row) => [String(row.gift_card_id), Number(row.amount)]));
  return cards.map((card) => {
    const amount = holds.get(card.id) ?? 0;
    return {
      id: card.id,
      last4: card.last4,
      currency: card.currency,
      amountMinor: amount,
      afterMinor: card.balanceMinor,
      problem: amount > 0 ? null : order?.subscription ? "subscription" : order?.host ? "host" : card.problem,
    };
  });
}
