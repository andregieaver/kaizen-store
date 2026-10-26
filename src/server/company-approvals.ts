import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { APPROVAL_DAYS } from "@/lib/company-locations";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";

import { cancelUnpaidOrder, confirmOnTerms } from "./checkout";
import { recordTermsForOrder } from "./checkout-terms";
import { placedOrderOf } from "./draft-pay";
import { settleOrderSessions } from "./draft-sessions";
import { log } from "./log";
import { getOrder } from "./orders";
import { openPaymentSession, paymentConnection } from "./payment-session";
import { sendApprovalDecided, sendApprovalWaiting } from "./shopper-emails";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Company approvals (wave 6 unit C2, D321, `docs/wave-6-catalogue.md` C.2): an orderer's order over the company's limit is placed by `placeOrder()`
 * with `orders.approval = 'waiting'` and its stock held for `APPROVAL_DAYS`; no payment is started. Only an approver at the order's location (the
 * company's main account at every location) decides it, here: approved, it is confirmed on the company's payment terms when it was placed on them,
 * else the buyer pays it on Stripe's hosted page from Your company; declined or left too long, it is cancelled through `cancel_unpaid_order()`, which
 * lets its stock go. Never a consumer's order, never an approver's own.
 */

const WAITING_ROW = z.object({
  id: col.uuid,
  number: col.text,
  placed_at: col.text,
  total_minor: col.minor,
  currency: col.currency,
  po_number: col.text.nullable(),
  location: col.text.nullable(),
  buyer_name: col.text,
  buyer_email: col.text,
  approval: z.enum(["waiting", "approved", "declined"]),
});

export type ApprovalOrder = {
  id: string;
  number: string;
  placedAt: string;
  totalMinor: number;
  currency: string;
  poNumber: string | null;
  location: string | null;
  buyer: string;
  approval: "waiting" | "approved" | "declined";
};

const toOrder = (r: z.output<typeof WAITING_ROW>): ApprovalOrder => ({
  id: r.id,
  number: r.number,
  placedAt: new Date(r.placed_at).toISOString(),
  totalMinor: r.total_minor,
  currency: r.currency,
  poNumber: r.po_number,
  location: r.location,
  buyer: r.buyer_name || r.buyer_email,
  approval: r.approval,
});

/** Where a customer approves: the condition on an order `o` whose location the customer may decide for (the main account: any of its company's). */
const approverOf = (customerId: string) => sql`(
  exists (
    select 1 from commerce.customers me
    join commerce.company_locations l on l.store_id = me.store_id and l.company_id = me.company_id and l.id = o.company_location_id
    join commerce.customer_companies co on co.store_id = me.store_id and co.id = me.company_id and co.active
    where me.store_id = o.store_id and me.id = ${customerId}::uuid
      and (me.company_role = 'owner'
           or exists (select 1 from commerce.company_location_buyers b
                      where b.store_id = me.store_id and b.location_id = l.id and b.customer_id = me.id and b.role = 'approver'))
  )
)`;

const listQuery = (storeId: string, where: ReturnType<typeof sql>) => sql`
  select o.id, o.number, o.placed_at::text as placed_at, o.total_minor, o.currency, o.po_number, o.approval,
         l.name as location, coalesce(c.name, '') as buyer_name, coalesce(c.email, o.email, '') as buyer_email
  from commerce.orders o
  left join commerce.company_locations l on l.store_id = o.store_id and l.id = o.company_location_id
  left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
  where o.store_id = ${storeId}::uuid and o.copied_from is null and o.status = 'pending_payment' and ${where}
  order by o.placed_at
  limit 100
`;

/** The orders waiting for this customer's approval: at locations they approve for, never their own. */
export async function ordersToApprove(storeId: string, customerId: string): Promise<ApprovalOrder[]> {
  const rows = await typedRows(WAITING_ROW, listQuery(storeId, sql`o.approval = 'waiting' and o.customer_id is distinct from ${customerId}::uuid and ${approverOf(customerId)}`));
  return rows.map(toOrder);
}

/** The customer's own orders waiting for approval, or approved and waiting for them to pay. */
export async function myApprovalOrders(storeId: string, customerId: string): Promise<ApprovalOrder[]> {
  const rows = await typedRows(WAITING_ROW, listQuery(storeId, sql`o.approval in ('waiting', 'approved') and o.customer_id = ${customerId}::uuid`));
  return rows.map(toOrder);
}

export type DecideResult = { ok: true } | { ok: false; problem: "not_found" | "decided" };

/**
 * An approver's yes or no, once, under the order's lock: the approver's right is read again inside it. A yes on an order placed on payment terms
 * confirms it there at once (it is paid as a shop status, its invoice issued); any other yes waits for the buyer to pay. A no cancels it.
 */
export async function decideOrder(shop: { store: Pick<Store, "id">; market: Market }, approverId: string, orderId: string, approve: boolean): Promise<DecideResult> {
  const storeId = shop.store.id;
  const decided = await db().transaction(async (tx) => {
    const order = await typedRow(z.object({ id: col.uuid, terms: col.bool }), sql`
      select o.id, exists (select 1 from commerce.order_payment_terms t where t.store_id = o.store_id and t.order_id = o.id) as terms
      from commerce.orders o
      where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.copied_from is null and o.status = 'pending_payment'
        and o.approval = 'waiting' and o.customer_id is distinct from ${approverId}::uuid and ${approverOf(approverId)}
      for update of o
    `, tx);
    if (!order) return null;
    await tx.execute(sql`
      update commerce.orders set approval = ${approve ? "approved" : "declined"}, approval_decided_by = ${approverId}::uuid, approval_decided_at = now()
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, ${approve ? "order.approved" : "order.declined"}, '{}'::jsonb, 'shopper')
    `);
    return order;
  });
  if (!decided) {
    const [known] = await db().execute(sql`
      select 1 from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.approval is not null and ${approverOf(approverId)}
    `);
    return { ok: false, problem: known ? "decided" : "not_found" };
  }
  if (!approve) {
    await cancelUnpaidOrder(orderId, "declined by the company");
  } else if (decided.terms) {
    const order = await getOrder(storeId, orderId);
    if (order) await confirmOnTerms(storeId, { orderId, balanceMinor: order.balanceMinor, currency: order.currency });
  }
  const notify = () => sendApprovalDecided(storeId, orderId, approve ? (decided.terms ? "terms" : "pay") : "declined");
  try {
    after(notify);
  } catch {
    // Not in a request (scripts, tests).
    await notify();
  }
  return { ok: true };
}

/** Tells the approvers of a waiting order's location, once each: the main account and those with the approver role there, never the buyer. */
export async function notifyApprovers(storeId: string, orderId: string): Promise<number> {
  const approvers = await typedRows(z.object({ email: col.text, name: col.text }), sql`
    select distinct c.email, c.name
    from commerce.orders o
    join commerce.company_locations l on l.store_id = o.store_id and l.id = o.company_location_id
    join commerce.customers c on c.store_id = o.store_id and c.company_id = l.company_id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.approval = 'waiting' and c.id is distinct from o.customer_id
      and (c.company_role = 'owner'
           or exists (select 1 from commerce.company_location_buyers b where b.store_id = c.store_id and b.location_id = l.id and b.customer_id = c.id and b.role = 'approver'))
  `);
  let sent = 0;
  for (const approver of approvers) if (await sendApprovalWaiting(storeId, orderId, approver.email)) sent++;
  return sent;
}

export type ApprovedPayResult = { ok: true; url: string } | { ok: false; problem: "not_found" | "paid" | "processing" | "payments_off" | "payment_error" | "terms" };

/**
 * The buyer of an approved order pays it: the store's terms of sale recorded first (as the checkout records them), then one Stripe-hosted session for
 * the order's own amounts, the earlier ones closed (one found paid settles it). Only the buyer, only while it is approved and waiting for payment.
 */
export async function startApprovedPayment(shop: { store: Store; market: Market }, customerId: string, orderId: string, origin: string, termsTicked: boolean): Promise<ApprovedPayResult> {
  const { store, market } = shop;
  const mine = await typedRow(z.object({ id: col.uuid }), sql`
    select id from commerce.orders
    where store_id = ${store.id}::uuid and id = ${orderId}::uuid and customer_id = ${customerId}::uuid and approval = 'approved' and status = 'pending_payment'
      and copied_from is null and market_code = ${market.code}
  `);
  if (!mine) return { ok: false, problem: "not_found" };
  const order = await getOrder(store.id, orderId);
  if (!order) return { ok: false, problem: "not_found" };
  if (store.termsAtCheckout === "checkbox" && !termsTicked) return { ok: false, problem: "terms" };
  const recorded = await recordTermsForOrder(store, market, orderId);
  if (!recorded.ok && store.termsAtCheckout === "checkbox") return { ok: false, problem: "terms" };
  const connected = await paymentConnection(store.id);
  if (!connected) return { ok: false, problem: "payments_off" };
  const settled = await settleOrderSessions(store.id, orderId);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  const [earlier] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.payments where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid and provider = 'stripe'`);
  const base = `${storeOrigin(store.slug) ?? origin}${marketPath(store.slug, market.slug)}`;
  const opened = await openPaymentSession({ storeId: store.id, storeSlug: store.slug, market }, placedOrderOf(order), origin, t(market.lang).shipping, {
    ...connected,
    ui: "hosted",
    exactAmounts: true,
    idempotencyKey: `approved-pay-${orderId}-${Number(earlier?.n ?? 0)}`,
    allowedCountry: order.marketCode.trim().toUpperCase(),
    expiresInSeconds: 24 * 60 * 60 - 60,
    cancelUrl: `${base}/account/company`,
    ...(order.email ? { customerEmail: order.email } : {}),
  });
  if (!opened.ok) return { ok: false, problem: "payment_error" };
  return { ok: true, url: opened.url };
}

/** Cancels the orders that waited for approval, or for payment after it, longer than `APPROVAL_DAYS`: their stock and anything held go back. */
export async function expireApprovals({ limit = 100 }: { limit?: number } = {}): Promise<number> {
  const rows = await typedRows(z.object({ id: col.uuid }), sql`
    select id from commerce.orders
    where status = 'pending_payment' and approval in ('waiting', 'approved') and copied_from is null
      and placed_at < now() - make_interval(days => ${APPROVAL_DAYS})
    order by placed_at
    limit ${limit}
  `);
  let cancelled = 0;
  for (const row of rows) {
    try {
      if (await cancelUnpaidOrder(row.id, "the company's approval or payment took too long")) cancelled++;
    } catch (error) {
      log("error", "approvals.expire_failed", { orderId: row.id }, error);
    }
  }
  return cancelled;
}
