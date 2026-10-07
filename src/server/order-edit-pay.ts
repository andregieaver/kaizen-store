import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { minChargeMinor } from "@/lib/bonus";
import { EDIT_PAY_PRESSES_PER_HOUR, EDIT_PAY_PRESSES_PER_HOUR_STORE } from "@/lib/fulfilment-limits";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";

import type { PlacedOrder } from "./checkout";
import { getOrderEdit, hashEditToken, type OrderEditView } from "./order-edits";
import { settleOrderSessions } from "./draft-sessions";
import { getCheckoutInfo, getOrder, type OrderView } from "./orders";
import { openPaymentSession, paymentConnection } from "./payment-session";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The change pay page (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4): `/s/{store}/{market}/account/change/{token}`, built like D173's draft pay page. The
 * token is a bearer secret kept only as its SHA-256 (`order_edits.pay_token_hash`, base64url): the change is looked up by that hash within the store, so an
 * unknown, malformed or replaced token is the same "not found". The page shows what the change does to the customer's own order, what was already paid and what
 * is to pay now; the press opens Stripe's HOSTED page for ONE line of the difference (no Stripe.js, no new script origin), one idempotency key per press,
 * earlier sessions closed first. Nothing is set in the browser: no cookie, no storage. Valid only under the order's own country.
 */

export type ChangeShop = { store: Store; market: Market };

export type ChangePage =
  | { state: "not_found" }
  | {
      /** `ready`: may pay; `paid`: the change is applied; `ended`: cancelled or expired (one sentence and the store's contact); `payments_off`; `too_small`: below the card minimum. */
      state: "ready" | "paid" | "ended" | "payments_off" | "too_small";
      edit: OrderEditView;
      order: OrderView;
      /** What the customer has paid for the order so far (captured, less refunds), in the order's currency. */
      alreadyPaidMinor: number;
      /** The difference to pay now. */
      toPayMinor: number;
      /** Added units that will be sold on backorder (D172), by title, with the days the customer is told. */
      backorders: { title: string; units: number; days: number | null }[];
    };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function editByToken(storeId: string, token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select id, order_id, status from commerce.order_edits where store_id = ${storeId}::uuid and pay_token_hash = ${hashEditToken(token)}
  `);
  return row ?? null;
}

/** The page's state. A link whose end has passed reads `ended` without waiting for the job. */
export async function changePageFor(shop: ChangeShop, token: string): Promise<ChangePage> {
  const storeId = shop.store.id;
  const row = await editByToken(storeId, token);
  if (!row) return { state: "not_found" };
  const [edit, order] = await Promise.all([getOrderEdit(storeId, String(row.id)), getOrder(storeId, String(row.order_id))]);
  if (!edit || !order) return { state: "not_found" };
  // The order's own country only (the language and currency of the view may differ: `no-en-eur` is Norway's too).
  if (order.marketCode.trim().toUpperCase() !== shop.market.code.toUpperCase()) return { state: "not_found" };
  const [paid] = await db().execute<Row>(sql`
    select (select coalesce(sum(p.amount_minor), 0) from commerce.payments p
              where p.store_id = ${storeId}::uuid and p.order_id = ${order.id}::uuid and p.status = 'captured' and (p.order_edit_id is null or p.order_edit_id <> ${edit.id}::uuid))
         - (select coalesce(sum(r.amount_minor), 0) from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
              where p.store_id = ${storeId}::uuid and p.order_id = ${order.id}::uuid and r.status::text <> 'failed') as paid
  `);
  const backorders = await addedBackorders(storeId, edit.id);
  const base = { edit, order, alreadyPaidMinor: Number(paid?.paid ?? 0), toPayMinor: edit.differenceMinor, backorders };
  if (edit.status === "applied") return { state: "paid", ...base };
  if (edit.status !== "awaiting_payment" || !edit.expiresAt || new Date(edit.expiresAt).getTime() <= Date.now()) return { state: "ended", ...base };
  if (edit.differenceMinor < minChargeMinor(edit.currency)) return { state: "too_small", ...base };
  const info = await getCheckoutInfo(storeId, order.marketCode);
  if (!info.paymentsOn) return { state: "payments_off", ...base };
  return { state: "ready", ...base };
}

/** Added units the held stock does not cover (sold on backorder, D172), as the hold was made. */
async function addedBackorders(storeId: string, editId: string): Promise<{ title: string; units: number; days: number | null }[]> {
  const rows = await db().execute<Row>(sql`
    select l.title, coalesce(sum(r.backorder_quantity), 0)::int as units, v.backorder_days
    from commerce.order_edit_lines l
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    left join commerce.inventory_reservations r on r.store_id = l.store_id and r.order_edit_id = l.order_edit_id and r.variant_id = l.variant_id
    where l.store_id = ${storeId}::uuid and l.order_edit_id = ${editId}::uuid and l.kind = 'add'
    group by l.title, v.backorder_days
  `);
  return rows.filter((r) => Number(r.units) > 0).map((r) => ({ title: String(r.title), units: Number(r.units), days: r.backorder_days === null ? null : Number(r.backorder_days) }));
}

export type StartChangePaymentResult =
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

/** One press: the change's own counter first (`edit:pay:{id}`), and only a press it allows counts against the store's (`edit:pay`). */
async function takePress(storeId: string, editId: string): Promise<boolean> {
  if (!(await takeBucket(storeId, `edit:pay:${editId}`, EDIT_PAY_PRESSES_PER_HOUR))) return false;
  return takeBucket(storeId, "edit:pay", EDIT_PAY_PRESSES_PER_HOUR_STORE);
}

/** The difference as Stripe sees it: one line "Change to order {number}" of the difference, quantity 1, nothing shipped, no coupon. */
function changeOrderOf(order: OrderView, edit: OrderEditView, title: string): PlacedOrder {
  return {
    orderId: order.id,
    number: order.number,
    currency: order.currency,
    lines: [{ title, unitPriceMinor: edit.differenceMinor, quantity: 1, recurring: false, dueNowMinor: edit.differenceMinor, deposit: false }],
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
    totalMinor: edit.differenceMinor,
    dueNowMinor: edit.differenceMinor,
    balanceMinor: 0,
    company: null,
    discount: null,
    hostId: null,
  };
}

/** The words of the one Stripe line, in the order's language (English for others). */
const CHANGE_LINE: Record<string, (number: string) => string> = {
  nb: (n) => `Endring av bestilling ${n}`,
  sv: (n) => `Ändring av beställning ${n}`,
  da: (n) => `Ændring af bestilling ${n}`,
  en: (n) => `Change to order ${n}`,
};

/**
 * The customer pressed the pay button. The change's earlier sessions are closed first (one found paid applies the change: `paid`; one still processing:
 * `processing`). Then ONE new Stripe-hosted session for the difference opens on the store's connected account (`openPaymentSession()`: Kaizen's fee on the
 * extra sale as the application fee, metadata naming the change, never the token), its payment row naming the change; the idempotency key is new per press.
 * After paying, Stripe returns the customer to the order page.
 */
export async function startEditPayment(shop: ChangeShop, token: string, options: { origin: string }): Promise<StartChangePaymentResult> {
  const page = await changePageFor(shop, token);
  if (page.state === "not_found") return { ok: false, problem: "not_found" };
  if (page.state === "paid") return { ok: false, problem: "paid" };
  if (page.state === "ended") return { ok: false, problem: "ended" };
  if (page.state === "too_small") return { ok: false, problem: "too_small" };
  if (page.state === "payments_off") return { ok: false, problem: "payments_off" };
  const { store, market } = shop;
  const { edit, order } = page;
  if (!(await takePress(store.id, edit.id))) return { ok: false, problem: "limit" };
  const connected = await paymentConnection(store.id);
  if (!connected) return { ok: false, problem: "payments_off" };
  const settled = await settleOrderSessions(store.id, order.id);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  const base = `${storeOrigin(store.slug) ?? options.origin}${marketPath(store.slug, market.slug)}`;
  const remaining = Math.floor((new Date(edit.expiresAt as string).getTime() - Date.now()) / 1000);
  const [earlier] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${order.id}::uuid and order_edit_id = ${edit.id}::uuid
  `);
  const lang = order.locale.split("-")[0];
  const opened = await openPaymentSession(
    { storeId: store.id, storeSlug: store.slug, market },
    changeOrderOf(order, edit, (CHANGE_LINE[lang] ?? CHANGE_LINE.en)(order.number)),
    options.origin,
    t(market.lang).shipping,
    {
      ...connected,
      ui: "hosted",
      exactAmounts: true,
      idempotencyKey: `order-edit-pay-${edit.id}-${Number(earlier?.n ?? 0)}`,
      allowedCountry: order.marketCode.trim().toUpperCase(),
      expiresInSeconds: Math.min(24 * 60 * 60 - 60, Math.max(30 * 60 + 60, remaining)),
      cancelUrl: `${base}/account/change/${token}`,
      orderEditId: edit.id,
      ...(order.email ? { customerEmail: order.email } : {}),
    },
  );
  if (!opened.ok) return { ok: false, problem: "payment_error" };
  // Staff may have cancelled the change, or recorded it as paid, while the session was made: read under the order's lock; a session for a change no longer
  // waiting is closed before the customer is sent to it.
  const still = await db().transaction(async (tx) => {
    await tx.execute(sql`select id from commerce.orders where store_id = ${store.id}::uuid and id = ${order.id}::uuid for update`);
    const [row] = await tx.execute<Row>(sql`select status from commerce.order_edits where store_id = ${store.id}::uuid and id = ${edit.id}::uuid`);
    return row ? String(row.status) : null;
  });
  if (still !== "awaiting_payment") {
    await settleOrderSessions(store.id, order.id).catch(() => null);
    return { ok: false, problem: still === "applied" ? "paid" : "ended" };
  }
  return { ok: true, url: opened.url };
}
