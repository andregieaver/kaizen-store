import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";

import { hashPayToken } from "./draft-orders";
import { settleOrderSessions } from "./draft-sessions";
import { recordTermsForOrder, type TermsRecordResult } from "./checkout-terms";
import type { PlacedOrder } from "./checkout";
import { getCheckoutInfo, getOrder, type OrderView } from "./orders";
import { openPaymentSession, paymentConnection } from "./payment-session";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The pay link of a draft order (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1 and 4.5): `/s/{store}/{market}/account/pay/{token}`. The token is a bearer secret kept only as its SHA-256 (`draft_orders.pay_token_hash`):
 * this module looks the draft up by that hash within the store, so an unknown, malformed or replaced token is the same "not found" (no difference between never existed and wrong). The page it serves shows the
 * buyer's own order and nothing else; the press of the button records the terms acceptance first (`recordTermsForOrder()`, as the checkout does) and then opens Stripe's HOSTED page (`openPaymentSession()`, a
 * new session each press, the earlier ones closed), so no Stripe.js and no new script origin touches the page. Nothing is set in the browser: no cookie, no storage.
 */

export type PayShop = { store: Store; market: Market };

/** What the pay page draws, by state. `not_found` is the 404. */
export type PayPage =
  | { state: "not_found" }
  | {
      /** `ready`: the buyer may pay; `paid`: this order is paid; `expired`: the link no longer works (expired, cancelled or replaced: one sentence, the store's contact address); `payments_off`: the store cannot take payments now. */
      state: "ready" | "paid" | "expired" | "payments_off";
      /** The buyer's own order: lines, totals, VAT, the staff discount under the name staff gave it, shipping. A custom price is the price agreed: no "was" price. */
      order: OrderView | null;
      draft: { number: string; noteToBuyer: string | null; expiresAt: string };
      /** The store's terms at checkout: `link`, `checkbox` (the tick must be ticked to pay) or `off`. */
      terms: Store["termsAtCheckout"];
    };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The draft behind a token, within this store: null for any token that is not the current one of one of its drafts. */
async function draftByToken(storeId: string, token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select id, number, status, order_id, note_to_buyer, expires_at from commerce.draft_orders
    where store_id = ${storeId}::uuid and pay_token_hash = ${hashPayToken(token)}
  `);
  return row ?? null;
}

/** The page's state. A passed expiry is expired without waiting for the job (`expireDrafts()`). */
export async function payPageFor(shop: PayShop, token: string): Promise<PayPage> {
  const storeId = shop.store.id;
  const draft = await draftByToken(storeId, token);
  if (!draft || !draft.order_id) return { state: "not_found" };
  const order = await getOrder(storeId, String(draft.order_id));
  if (!order) return { state: "not_found" };
  // The order belongs to one market: its VAT, its currency, its legal pages and the countries Stripe may ask an address in were decided for it. The same link under another country's address is not found
  // (the language and the currency of the view may differ: `no-en-eur` is Norway's too).
  if (order.marketCode.trim().toUpperCase() !== shop.market.code.toUpperCase()) return { state: "not_found" };
  const expiresAt = new Date(String(draft.expires_at)).toISOString();
  const base = { draft: { number: String(draft.number), noteToBuyer: draft.note_to_buyer ? String(draft.note_to_buyer) : null, expiresAt }, terms: shop.store.termsAtCheckout };
  if (draft.status === "paid" || order.status === "paid" || order.status === "fulfilled" || order.status === "closed") return { state: "paid", order, ...base };
  if (draft.status !== "sent" || order.status !== "pending_payment" || new Date(expiresAt).getTime() <= Date.now()) return { state: "expired", order: null, ...base };
  const info = await getCheckoutInfo(storeId, order.marketCode);
  if (!info.paymentsOn) return { state: "payments_off", order, ...base };
  return { state: "ready", order, ...base };
}

/** What the order's own amounts are to Stripe: each line at what is due, quantity 1 (`exactAmounts`), the shipping as its own option. */
function placedOrderOf(order: OrderView): PlacedOrder {
  return {
    orderId: order.id,
    number: order.number,
    currency: order.currency,
    lines: order.lines.map((line) => ({ title: line.title, unitPriceMinor: line.unitPriceMinor, quantity: line.quantity, recurring: false, dueNowMinor: line.totalMinor, deposit: false })),
    ships: order.ships,
    subscription: null,
    shippingMinor: order.shippingMinor,
    shippingDiscountMinor: 0,
    deliveryLabel: null,
    creditMinor: 0,
    referralMinor: 0,
    taxMinor: order.taxMinor,
    vatKind: order.vatKind,
    vatReliefMinor: order.vatReliefMinor,
    shippingReliefMinor: order.shippingReliefMinor,
    treatment: null,
    totalMinor: order.totalMinor,
    dueNowMinor: order.totalMinor,
    balanceMinor: 0,
    company: order.company,
    discount: null,
    hostId: null,
  };
}

export type StartPaymentResult =
  | { ok: true; url: string }
  | { ok: false; problem: "not_found" | "expired" | "paid" | "payments_off" | "terms" | "processing" | "payment_error" | "limit" };

/** The presses of the pay button one draft's link takes in an hour (a link in a loop would make a Stripe session each time). */
export const PAY_PRESSES_PER_DRAFT_HOUR = 20;
/** The presses a store takes in an hour in all: a backstop only, so one link's loop never uses it up (a link's own limit comes first and its refused presses do not count here). */
export const PAY_PRESSES_PER_STORE_HOUR = 600;

async function takeBucket(storeId: string, bucket: string, limit: number): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= limit;
}

/** One press: the draft's own counter first, and only a press it allows counts against the store's. */
async function takePress(storeId: string, draftId: string): Promise<boolean> {
  if (!(await takeBucket(storeId, `draft:pay:${draftId}`, PAY_PRESSES_PER_DRAFT_HOUR))) return false;
  return takeBucket(storeId, "draft:pay", PAY_PRESSES_PER_STORE_HOUR);
}

/**
 * The buyer pressed *Pay now*. In `checkbox` mode the tick must be ticked (the page's own tick, `termsTicked`); the acceptance is recorded before anything is sent to Stripe, in both modes, as the checkout records it
 * (`recordTermsForOrder()`, once per order). The sessions the link opened before are closed first: if one turns out paid the order is paid (`paid`), if its payment is still processing nothing new is started
 * (`processing`). Then ONE new Stripe-hosted session is opened for the order's own amounts. A Stripe failure leaves the order as it was (`payment_error`): the buyer stays on the page and may try again.
 */
export async function startDraftPayment(shop: PayShop, token: string, options: { termsTicked: boolean; origin: string }): Promise<StartPaymentResult> {
  const page = await payPageFor(shop, token);
  if (page.state === "not_found") return { ok: false, problem: "not_found" };
  if (page.state === "paid") return { ok: false, problem: "paid" };
  if (page.state === "expired") return { ok: false, problem: "expired" };
  if (page.state === "payments_off" || !page.order) return { ok: false, problem: "payments_off" };
  const { store, market } = shop;
  const order = page.order;
  if (page.terms === "checkbox" && !options.termsTicked) return { ok: false, problem: "terms" };
  const draftRow = await draftByToken(store.id, token);
  if (!draftRow) return { ok: false, problem: "not_found" };
  const draftId = String(draftRow.id);
  if (!(await takePress(store.id, draftId))) return { ok: false, problem: "limit" };
  // The acceptance is recorded first. `link` mode goes on when it cannot be recorded (the order simply has no record); `checkbox` mode does not start the payment.
  const recorded: TermsRecordResult = await recordTermsForOrder(store, market, order.id);
  if (!recorded.ok && page.terms === "checkbox") return { ok: false, problem: "terms" };

  const connected = await paymentConnection(store.id);
  if (!connected) return { ok: false, problem: "payments_off" };
  const settled = await settleOrderSessions(store.id, order.id);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };

  const base = `${storeOrigin(store.slug) ?? options.origin}${marketPath(store.slug, market.slug)}`;
  const remaining = Math.floor((new Date(page.draft.expiresAt).getTime() - Date.now()) / 1000);
  const [draft] = await db().execute<Row>(sql`select email from commerce.draft_orders where store_id = ${store.id}::uuid and order_id = ${order.id}::uuid`);
  // One Stripe idempotency key per press: the order is the same for every press of the link, so a key of the order alone would be refused (other parameters) or give back the earlier, closed session. The count of the
  // order's earlier sessions makes it new each time and equal for two presses at the same moment (Stripe then answers one of them with the same session or refuses it: never two payable sessions for one moment).
  const [earlier] = await db().execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${order.id}::uuid and provider = 'stripe'`);
  const opened = await openPaymentSession({ storeId: store.id, storeSlug: store.slug, market }, placedOrderOf(order), options.origin, t(market.lang).shipping, {
    ...connected,
    ui: "hosted",
    exactAmounts: true,
    idempotencyKey: `draft-pay-${order.id}-${Number(earlier?.n ?? 0)}`,
    allowedCountry: order.marketCode.trim().toUpperCase(),
    // Stripe's own limits: at least 30 minutes, at most 24 hours; the draft's expiry closes the session earlier if it comes first.
    expiresInSeconds: Math.min(24 * 60 * 60 - 60, Math.max(30 * 60 + 60, remaining)),
    cancelUrl: `${base}/account/pay/${token}`,
    ...(draft?.email ? { customerEmail: String(draft.email) } : {}),
  });
  if (!opened.ok) return { ok: false, problem: "payment_error" };
  // Staff may have recorded the money outside Kaizen, reopened or let the draft expire while the session was being made (their step looks for open sessions, this one for the order): the order is read
  // under its row lock, so whichever of the two commits second sees the other. A session for an order that is no longer waiting is closed before the buyer is sent to it.
  const still = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select o.status as order_status, d.status as draft_status
      from commerce.orders o left join commerce.draft_orders d on d.store_id = o.store_id and d.order_id = o.id
      where o.store_id = ${store.id}::uuid and o.id = ${order.id}::uuid for update of o
    `);
    return row ?? null;
  });
  if (!still || still.order_status !== "pending_payment" || still.draft_status !== "sent") {
    await closeOpenedSession(connected.stripe, store.id, order.id, opened.sessionId);
    const paid = still && (still.order_status === "paid" || still.order_status === "fulfilled" || still.order_status === "closed");
    return { ok: false, problem: paid ? "paid" : "expired" };
  }
  return { ok: true, url: opened.url };
}

/** Closes the one session this press opened (its payment row is cancelled), after the order turned out no longer to be waiting. */
async function closeOpenedSession(stripe: NonNullable<Awaited<ReturnType<typeof paymentConnection>>>["stripe"], storeId: string, orderId: string, sessionId: string): Promise<void> {
  try {
    const [row] = await db().execute<Row>(sql`
      select provider_account from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and provider_reference = ${sessionId}
    `);
    if (row) await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: String(row.provider_account) });
  } catch (error) {
    // Only a session that is gone is cancelled here. Any other failure leaves its row pending, so the next settle of the order (`settleOrderSessions()`) tries again and nothing is acted on while it may be payable.
    const e = error as { code?: string; statusCode?: number } | null;
    if (e?.code !== "resource_missing" && e?.statusCode !== 404) return;
  }
  await db().execute(sql`
    update commerce.payments set status = 'cancelled', updated_at = now()
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and provider_reference = ${sessionId} and status = 'pending'
  `);
}
