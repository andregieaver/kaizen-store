import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { minChargeMinor } from "@/lib/bonus";
import { EXCHANGE_PAY_PRESSES_PER_HOUR, EXCHANGE_PAY_PRESSES_PER_HOUR_STORE } from "@/lib/exchange-limits";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";

import type { PlacedOrder } from "./checkout";
import { snapshotTermsShown } from "./checkout-terms";
import { settleOrderSessions } from "./draft-sessions";
import { creditOf, exchangeIdForToken, exchangeView, paymentsOnFor, type ExchangeCredit, type ExchangeView } from "./exchanges";
import { writeOrderEvent } from "./order-actor";
import { getShopperReturn, type ShopperReturn } from "./returns";
import { openPaymentSession, paymentConnection } from "./payment-session";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The exchange page (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): `/s/{store}/{market}/account/exchange/{token}`, a no-extras path (`isExchangeLinkPath()`).
 * The token is a bearer secret kept only as its SHA-256 (`return_exchanges.token_hash`): the exchange is looked up by that hash within the store, so an unknown,
 * malformed, replaced or other store's token is the same "not found"; the page is valid only under the original order's own country. The customer's press of
 * *Confirm the exchange* is the express agreement CRD Art. 13(1) asks before the refund goes another way than the payment came (a timestamped record, with the
 * terms the page showed); *No thanks* ends the proposal. The pay step opens Stripe's HOSTED page for the difference (one line, quantity 1, no coupon, one
 * idempotency key per press, earlier sessions closed first). Nothing is set in the browser: no cookie, no storage; nothing is charged by a confirmation.
 */

export type ExchangeShop = { store: Store; market: Market };

export type ExchangePageState =
  /** Waiting for the customer: *Confirm the exchange* or *No thanks*. */
  | "proposed"
  /** Confirmed, waiting for the return to be processed. */
  | "confirmed"
  /** Processed, the difference to pay (the pay step). */
  | "to_pay"
  /** Processed with a difference below the card minimum: staff are told to record it otherwise. */
  | "too_small"
  /** Processed, waiting for the return to be settled by staff (Δ ≤ 0 whose refund did not go through yet). */
  | "processing"
  | "done"
  | "expired"
  | "cancelled"
  /** Staff refunded the return instead. */
  | "refunded"
  | "declined"
  /** The pay step cannot take card payments now (or the shop is off). */
  | "payments_off";

export type ExchangePage =
  | { state: "not_found" }
  | {
      state: ExchangePageState;
      exchange: ExchangeView;
      /** The credit's working as the refund would show it (`refundFor()`'s rows), at processing once processed. */
      credit: ExchangeCredit | null;
      /** The return, as its status page shows it (its token, its lines). */
      ret: ShopperReturn | null;
      terms: Store["termsAtCheckout"];
      /**
       * Whether the page may tell the customer they can withdraw from the new purchase (D174's rule, review finding): never to a business buyer (the
       * original order has a company: no statutory right), and never when a replacement is goods the law excludes (sealed hygiene or media, made to order,
       * …). Otherwise the page points to the store's own information only.
       */
      withdrawalRight: boolean;
    };

/** The page's state. A link whose end has passed reads `expired` without waiting for the job. */
export async function exchangePageFor(shop: ExchangeShop, token: string, now: Date = new Date()): Promise<ExchangePage> {
  const storeId = shop.store.id;
  const id = await exchangeIdForToken(storeId, token);
  if (!id) return { state: "not_found" };
  const exchange = await exchangeView(storeId, id);
  if (!exchange) return { state: "not_found" };
  const [order] = await db().execute<Row>(sql`select market_code, status::text as status, company_name from commerce.orders where store_id = ${storeId}::uuid and id = ${exchange.orderId}::uuid`);
  // The original order's own country only (the language and currency of the view may differ).
  if (!order || String(order.market_code).trim().toUpperCase() !== shop.market.code.toUpperCase()) return { state: "not_found" };
  const [r] = await db().execute<Row>(sql`select public_token from commerce.returns where store_id = ${storeId}::uuid and id = ${exchange.returnId}::uuid`);
  const ret = r ? await getShopperReturn(storeId, String(r.public_token)) : null;
  const credit = exchange.status === "proposed" || exchange.status === "confirmed" ? await creditOf(storeId, exchange.returnId) : null;
  const business = Boolean(order.company_name && String(order.company_name).trim());
  const [excluded] = await db().execute<Row>(sql`
    select coalesce(bool_or(p.withdrawal_exclusion::text <> 'none'), false) as any from commerce.return_exchange_lines l
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where l.store_id = ${storeId}::uuid and l.exchange_id = ${exchange.id}::uuid
  `);
  const withdrawalRight = !business && excluded?.any !== true;
  const base = { exchange, credit, ret, terms: shop.store.termsAtCheckout, withdrawalRight };
  const passed = exchange.expiresAt !== null && new Date(exchange.expiresAt).getTime() <= now.getTime();
  switch (exchange.status) {
    case "settled":
      return { state: "done", ...base };
    case "superseded":
      return { state: "refunded", ...base };
    case "declined_by_customer":
      return { state: "declined", ...base };
    case "cancelled":
    case "draft":
      return exchange.status === "draft" ? { state: "not_found" } : { state: "cancelled", ...base };
    case "expired":
      return { state: "expired", ...base };
    case "proposed":
      return { state: passed ? "expired" : "proposed", ...base };
    case "confirmed":
      return { state: passed ? "expired" : "confirmed", ...base };
    case "processed": {
      if (exchange.outcome.toPayMinor <= 0) return { state: "processing", ...base };
      if (passed) return { state: "expired", ...base };
      if (exchange.outcome.toPayMinor < minChargeMinor(exchange.currency)) return { state: "too_small", ...base };
      if (!(await paymentsOnFor(storeId, String(order.market_code)))) return { state: "payments_off", ...base };
      return { state: "to_pay", ...base };
    }
  }
}

export type ConfirmResult = { ok: true; state: ExchangePageState } | { ok: false; problem: "not_found" | "ended" | "terms" | "credit_changed" };

/**
 * *Confirm the exchange*: the customer's own act. In `checkbox` mode the page's tick must be ticked. The terms the page showed are kept (immutable snapshots,
 * tied to the exchange order when it is made). Confirming twice returns the first result; a proposal that ended answers its state. A credit that fell since
 * the proposal so the customer would pay more than shown is not confirmed (`credit_changed`: the store proposes again). Nothing is charged here.
 */
export async function confirmExchange(shop: ExchangeShop, token: string, options: { termsTicked: boolean }): Promise<ConfirmResult> {
  const page = await exchangePageFor(shop, token);
  if (page.state === "not_found") return { ok: false, problem: "not_found" };
  if (page.state === "confirmed" || page.state === "to_pay" || page.state === "processing" || page.state === "done") return { ok: true, state: page.state };
  if (page.state !== "proposed") return { ok: false, problem: "ended" };
  if (page.terms === "checkbox" && !options.termsTicked) return { ok: false, problem: "terms" };
  const x = page.exchange;
  if (page.credit && page.credit.amountMinor < x.creditMinor) return { ok: false, problem: "credit_changed" };
  const shown = await snapshotTermsShown(shop.store, shop.market).catch(() => null);
  const terms = shown ? shown.snapshots.map((s) => ({ ...s, mode: shown.mode, locale: shown.locale })) : null;
  const rows = await db().transaction(async (tx) => {
    const done = await tx.execute<Row>(sql`
      update commerce.return_exchanges set status = 'confirmed', confirmed_by = 'customer', confirmed_channel = 'web',
        terms = ${terms ? JSON.stringify(terms) : null}::jsonb
      where store_id = ${shop.store.id}::uuid and id = ${x.id}::uuid and status = 'proposed' and expires_at > now()
      returning id
    `);
    if (done.length > 0) await writeOrderEvent(tx, shop.store.id, x.orderId, "return.exchange_confirmed", { returnId: x.returnId, exchange: x.id, confirmedBy: "customer", channel: "web" }, "customer");
    return done;
  });
  if (rows.length === 0) {
    const again = await exchangePageFor(shop, token);
    return again.state === "confirmed" ? { ok: true, state: "confirmed" } : { ok: false, problem: "ended" };
  }
  return { ok: true, state: "confirmed" };
}

/** *No thanks, refund me instead*: the proposal ends (`declined_by_customer`); nothing is emailed, and the return is refunded as usual. */
export async function declineExchange(shop: ExchangeShop, token: string): Promise<{ ok: true } | { ok: false; problem: "not_found" | "ended" }> {
  const page = await exchangePageFor(shop, token);
  if (page.state === "not_found") return { ok: false, problem: "not_found" };
  if (page.state === "declined") return { ok: true };
  if (page.state !== "proposed") return { ok: false, problem: "ended" };
  const x = page.exchange;
  const rows = await db().transaction(async (tx) => {
    const done = await tx.execute<Row>(sql`
      update commerce.return_exchanges set status = 'declined_by_customer' where store_id = ${shop.store.id}::uuid and id = ${x.id}::uuid and status = 'proposed' returning id
    `);
    if (done.length > 0) await writeOrderEvent(tx, shop.store.id, x.orderId, "return.exchange_declined", { returnId: x.returnId, exchange: x.id }, "customer");
    return done;
  });
  return rows.length > 0 ? { ok: true } : { ok: false, problem: "ended" };
}

export type StartExchangePaymentResult =
  | { ok: true; url: string }
  | { ok: false; problem: "not_found" | "ended" | "paid" | "payments_off" | "too_small" | "processing" | "payment_error" | "limit" };

async function takeBucket(storeId: string, bucket: string, limit: number): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= limit;
}

/** One press: the exchange's own counter first (`exchange:pay:{id}`), and only a press it allows counts against the store's (`exchange:pay`). */
async function takePress(storeId: string, exchangeId: string): Promise<boolean> {
  if (!(await takeBucket(storeId, `exchange:pay:${exchangeId}`, EXCHANGE_PAY_PRESSES_PER_HOUR))) return false;
  return takeBucket(storeId, "exchange:pay", EXCHANGE_PAY_PRESSES_PER_HOUR_STORE);
}

/** The words of the one Stripe line, in the order's language (English for others). */
const EXCHANGE_LINE: Record<string, (number: string) => string> = {
  nb: (n) => `Bytte for retur ${n}`,
  sv: (n) => `Byte för retur ${n}`,
  da: (n) => `Ombytning for retur ${n}`,
  en: (n) => `Exchange for return ${n}`,
};

/** The difference as Stripe sees it: one line of the difference, quantity 1, nothing shipped (the order is already priced), no coupon. */
function differenceOrderOf(x: ExchangeView, orderNumber: string, title: string): PlacedOrder {
  const amount = x.outcome.toPayMinor;
  return {
    orderId: x.exchangeOrderId!,
    number: orderNumber,
    currency: x.currency,
    lines: [{ title, unitPriceMinor: amount, quantity: 1, recurring: false, dueNowMinor: amount, deposit: false }],
    ships: false,
    subscription: null,
    shippingMinor: 0,
    shippingDiscountMinor: 0,
    deliveryLabel: null,
    creditMinor: 0,
    referralMinor: 0,
    taxMinor: 0,
    vatKind: "standard",
    vatReliefMinor: 0,
    shippingReliefMinor: 0,
    treatment: null,
    totalMinor: amount,
    dueNowMinor: amount,
    balanceMinor: 0,
    company: null,
    discount: null,
    hostId: null,
  };
}

/**
 * The customer pressed *Pay {Δ}*. The exchange order's earlier sessions are closed first (one found paid settles the exchange: `paid`; one still processing:
 * `processing`). Then ONE new Stripe-hosted session for the difference opens on the store's connected account (`openPaymentSession()`: Kaizen's fee on what is
 * charged now, metadata naming the order, never the token), its payment row naming the exchange; the idempotency key is new per press. After paying, Stripe
 * returns the customer to the exchange order's page.
 */
export async function startExchangePayment(shop: ExchangeShop, token: string, options: { origin: string }): Promise<StartExchangePaymentResult> {
  const page = await exchangePageFor(shop, token);
  if (page.state === "not_found") return { ok: false, problem: "not_found" };
  if (page.state === "done") return { ok: false, problem: "paid" };
  if (page.state === "too_small") return { ok: false, problem: "too_small" };
  if (page.state === "payments_off") return { ok: false, problem: "payments_off" };
  if (page.state !== "to_pay") return { ok: false, problem: "ended" };
  const { store, market } = shop;
  const x = page.exchange;
  if (!(await takePress(store.id, x.id))) return { ok: false, problem: "limit" };
  const connected = await paymentConnection(store.id);
  if (!connected) return { ok: false, problem: "payments_off" };
  const settled = await settleOrderSessions(store.id, x.exchangeOrderId!);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  const [order] = await db().execute<Row>(sql`select number, locale, email, market_code from commerce.orders where store_id = ${store.id}::uuid and id = ${x.exchangeOrderId!}::uuid`);
  if (!order) return { ok: false, problem: "not_found" };
  const base = `${storeOrigin(store.slug) ?? options.origin}${marketPath(store.slug, market.slug)}`;
  const remaining = Math.floor((new Date(x.expiresAt as string).getTime() - Date.now()) / 1000);
  const [earlier] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${x.exchangeOrderId!}::uuid and exchange_id = ${x.id}::uuid and provider = 'stripe'
  `);
  const lang = String(order.locale).split("-")[0];
  const opened = await openPaymentSession(
    { storeId: store.id, storeSlug: store.slug, market },
    differenceOrderOf(x, String(order.number), (EXCHANGE_LINE[lang] ?? EXCHANGE_LINE.en)(x.returnNumber)),
    options.origin,
    t(market.lang).shipping,
    {
      ...connected,
      ui: "hosted",
      exactAmounts: true,
      idempotencyKey: `exchange-pay-${x.id}-${Number(earlier?.n ?? 0)}`,
      allowedCountry: String(order.market_code).trim().toUpperCase(),
      expiresInSeconds: Math.min(24 * 60 * 60 - 60, Math.max(30 * 60 + 60, remaining)),
      cancelUrl: `${base}/account/exchange/${token}`,
      exchangeId: x.id,
      ...(order.email ? { customerEmail: String(order.email) } : {}),
    },
  );
  if (!opened.ok) return { ok: false, problem: "payment_error" };
  // Staff may have cancelled the exchange, or recorded it as paid, while the session was made: a session for an exchange no longer waiting is closed first.
  const [still] = await db().execute<Row>(sql`select status from commerce.return_exchanges where store_id = ${store.id}::uuid and id = ${x.id}::uuid`);
  if (still?.status !== "processed") {
    await settleOrderSessions(store.id, x.exchangeOrderId!).catch(() => null);
    return { ok: false, problem: still?.status === "settled" ? "paid" : "ended" };
  }
  return { ok: true, url: opened.url };
}
