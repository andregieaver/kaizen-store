import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  approveReturn as approveSchema,
  cancelReturn as cancelSchema,
  closeReturn as closeSchema,
  declineReturn as declineSchema,
  declineReturnLine as declineLineSchema,
  inspectReturn as inspectSchema,
  refundReturn as refundSchema,
  returnInstructions as instructionsSchema,
  returnNote as noteSchema,
  returnStep as stepSchema,
  type ReturnQueueFilter,
} from "@/lib/return-input";
import { adjustmentOf } from "@/lib/credit-allocation";
import { refundFor, refundableAfter, reviewOverride, shippingPaidMinor, type Refund, type RefundLine, type WorkingRow } from "@/lib/return-refund";
import {
  actionsFor,
  canMove,
  closeWithoutRefundNeedsConfirm,
  isEnded,
  timeline,
  type ReturnAction,
  type ReturnKind,
  type ReturnStatus,
  type StepState,
} from "@/lib/return-status";
import { noonOf } from "@/lib/work-dates";
import { refundDeadline, refundDue, sendBackDay, type RefundDue, type ReturnAddress, type ReturnSettings } from "@/lib/withdrawal";

import { getOrderAdmin, refundOrder, COPIED_ORDER_MESSAGE, type OrderAdmin } from "./order-admin";
import { guarded, refusal, type Refused } from "./return-errors";
import { NOTHING_SENT_SQL, OVERDUE_SQL, SETTLED_SQL } from "./return-sql";
import { loadFacts, writeEvent, type OrderFacts } from "./return-facts";
import { getReturnSettings } from "./return-settings";
import { sendReturnApproved, sendReturnDeclined, sendReturnReceived, sendReturnRefunded } from "./return-emails";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * The store's side of returns (D153, `docs/returns.md`): the queue, a return's detail, and every step the store takes
 * with one. Every query takes the store id; every step locks the return, checks the lifecycle (`canMove()`, the same table
 * the database enforces), and writes `order_events` with the documented types. A refund goes through the one
 * `refundOrder()` (Stripe on the store's account, stock, host commission), with the amount worked out by `refundFor()`
 * from the stored facts, bounded and logged when staff adjust it. Nothing is refunded automatically.
 *
 * The action layer calls `requirePermission()` first and passes the account; these functions never trust a caller's store.
 */

export type Done<T extends object = object> = ({ ok: true } & T) | Refused;

const gone = (): Refused => refusal("not_found", "That return no longer exists.");
const invalid = (error: z.ZodError): Refused => refusal("invalid", error.issues[0]?.message ?? "Check the details and try again.");

// ---------------------------------------------------------------------------
// Reading a return
// ---------------------------------------------------------------------------

type Ret = {
  id: string;
  number: string;
  kind: ReturnKind;
  status: ReturnStatus;
  orderId: string;
  withdrawalRequestId: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  inspectedAt: Date | null;
  closedAt: Date | null;
  outcome: string | null;
  reason: string | null;
  reasonNote: string | null;
  instructions: string | null;
  labelUrl: string | null;
  returnAddress: ReturnAddress | null;
  decisionNote: string | null;
  staffNote: string | null;
  publicToken: string;
  refundDeadline: Date | null;
  refundId: string | null;
  refundComputedMinor: number | null;
  refundMinor: number | null;
  refundNote: string | null;
  refundedAt: Date | null;
  refundOutside: boolean;
  returnShippingMinor: number;
  /** The delivery this return's refund gave back (Art. 13(1)). */
  shippingRefundMinor: number;
  /** Made before the goods were sent: nothing to send back, so nothing to hold a refund against. */
  nothingSent: boolean;
};

const date = (value: unknown) => (value ? new Date(String(value)) : null);
const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function toRet(r: Row): Ret {
  const address = r.return_address as Partial<ReturnAddress> | null;
  return {
    id: String(r.id),
    number: String(r.number),
    kind: r.kind === "withdrawal" ? "withdrawal" : "return",
    status: String(r.status) as ReturnStatus,
    orderId: String(r.order_id),
    withdrawalRequestId: r.withdrawal_request_id ? String(r.withdrawal_request_id) : null,
    createdAt: new Date(String(r.created_at)),
    approvedAt: date(r.approved_at),
    shippedAt: date(r.shipped_at),
    receivedAt: date(r.received_at),
    inspectedAt: date(r.inspected_at),
    closedAt: date(r.closed_at),
    outcome: r.outcome ? String(r.outcome) : null,
    reason: r.reason ? String(r.reason) : null,
    reasonNote: r.reason_note ? String(r.reason_note) : null,
    instructions: r.instructions ? String(r.instructions) : null,
    labelUrl: r.label_url ? String(r.label_url) : null,
    returnAddress: address && address.street ? ({ name: "", postalCode: "", city: "", country: "", ...address } as ReturnAddress) : null,
    decisionNote: r.decision_note ? String(r.decision_note) : null,
    staffNote: r.staff_note ? String(r.staff_note) : null,
    publicToken: String(r.public_token),
    refundDeadline: date(r.refund_deadline),
    refundId: r.refund_id ? String(r.refund_id) : null,
    refundComputedMinor: number(r.refund_computed_minor),
    refundMinor: number(r.refund_minor),
    refundNote: r.refund_note ? String(r.refund_note) : null,
    refundedAt: date(r.refunded_at),
    refundOutside: Boolean(r.refund_outside),
    returnShippingMinor: Number(r.return_shipping_minor ?? 0),
    shippingRefundMinor: Number(r.shipping_refund_minor ?? 0),
    nothingSent: Boolean(r.nothing_sent),
  };
}

async function loadRet(storeId: string, returnId: string, tx: Tx | ReturnType<typeof db> = db(), lock = false): Promise<Ret | null> {
  if (!z.uuid().safeParse(returnId).success) return null;
  const [row] = await tx.execute<Row>(
    lock
      ? sql`select r.*, ${NOTHING_SENT_SQL} as nothing_sent from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid for update of r`
      : sql`select r.*, ${NOTHING_SENT_SQL} as nothing_sent from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid`,
  );
  return row ? toRet(row) : null;
}

export type DetailLine = {
  lineId: string;
  title: string;
  sku: string;
  /** Units bought on the order line, and what this return holds of them. */
  orderedQuantity: number;
  quantity: number;
  decision: "accept" | "decline";
  declineReason: string | null;
  condition: "as_new" | "opened" | "used" | "damaged" | null;
  restock: boolean;
  deductionMinor: number;
  deductionNote: string | null;
  reason: string | null;
  unitPriceMinor: number;
  totalMinor: number;
  delivery: string;
  withdrawalExclusion: string;
  /** What the units are worth to the refund, from the working (cumulative rule); null when no working. */
  valueMinor: number | null;
};

async function loadLines(storeId: string, returnId: string): Promise<DetailLine[]> {
  const rows = await db().execute<Row>(sql`
    select rl.order_line_id, ol.title, ol.sku, ol.quantity as ordered, rl.quantity, rl.decision, rl.decline_reason, rl.condition,
      rl.restock, rl.deduction_minor, rl.deduction_note, rl.reason, ol.unit_price_minor, ol.total_minor, ol.delivery, ol.withdrawal_exclusion
    from commerce.return_lines rl
    join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
    where rl.store_id = ${storeId}::uuid and rl.return_id = ${returnId}::uuid
    order by ol.title, ol.id
  `);
  return rows.map((l) => ({
    lineId: String(l.order_line_id),
    title: String(l.title),
    sku: String(l.sku),
    orderedQuantity: Number(l.ordered),
    quantity: Number(l.quantity),
    decision: l.decision === "decline" ? "decline" : "accept",
    declineReason: l.decline_reason ? String(l.decline_reason) : null,
    condition: l.condition ? (String(l.condition) as DetailLine["condition"]) : null,
    restock: Boolean(l.restock),
    deductionMinor: Number(l.deduction_minor),
    deductionNote: l.deduction_note ? String(l.deduction_note) : null,
    reason: l.reason ? String(l.reason) : null,
    unitPriceMinor: Number(l.unit_price_minor),
    totalMinor: Number(l.total_minor),
    delivery: String(l.delivery),
    withdrawalExclusion: String(l.withdrawal_exclusion),
    valueMinor: null,
  }));
}

// ---------------------------------------------------------------------------
// The refund's working
// ---------------------------------------------------------------------------

/**
 * The cheapest standard delivery the store offered for the order, in its currency (CRD Art. 13(1)); null counts all that was
 * paid. It is what the order kept when it was placed (`orders.standard_shipping_minor`: the market's flat rate as shown, free
 * over its limit judged on the basket before discounts). An order placed before that was kept with a carrier's service the
 * shopper chose falls back to the flat rate of its own currency, judged on the basket before discounts; with another currency
 * and no record the rate cannot be known and all that was paid counts.
 */
async function standardShipping(storeId: string, facts: OrderFacts): Promise<number | null> {
  if (facts.standardShippingMinor !== null) return facts.standardShippingMinor;
  // A carrier's service the shopper chose may cost more than the standard one: the flat rate is the standard offer.
  if (!facts.chosenDelivery) return null;
  const [rate] = await db().execute<Row>(sql`
    select amount_minor, free_over_minor, currency from commerce.shipping_rates
    where store_id = ${storeId}::uuid and market_code = ${facts.marketCode}
  `);
  if (!rate || String(rate.currency).trim() !== facts.currency) return null;
  const basket = facts.lines.filter((line) => !line.gift).reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  if (rate.free_over_minor !== null && rate.free_over_minor !== undefined && basket >= Number(rate.free_over_minor)) return 0;
  return Number(rate.amount_minor);
}

type Working = {
  refund: Refund;
  /** What may be refunded at most: what is left through Stripe, or what the returns of an outside order may still take. */
  refundableMinor: number;
  canRefund: boolean;
  admin: OrderAdmin;
  facts: OrderFacts;
};

/**
 * The sum a return refunds, worked out from what is stored: the lines' paid value by the cumulative rule (units on earlier
 * returns of the order are counted first, so any split adds up to the line's total), deductions from the inspection, the
 * original standard delivery only when this return completes a whole-order withdrawal (with the order's other withdrawals
 * whose goods are settled) and only what no other return refunded of it, and return shipping when the shopper pays it. The
 * same function the staff screen shows before the button and the refund then uses.
 */
async function workOut(storeId: string, ret: Ret, lines: DetailLine[], returnShippingMinor: number): Promise<Working | null> {
  const [facts, admin] = await Promise.all([loadFacts(storeId, ret.orderId), getOrderAdmin(storeId, ret.orderId)]);
  if (!facts || !admin) return null;
  const [priors, settled, others] = await Promise.all([
    db().execute<Row>(sql`
      select rl.order_line_id, sum(rl.quantity)::int as q from commerce.return_lines rl
      join commerce.returns r on r.store_id = rl.store_id and r.id = rl.return_id
      where rl.store_id = ${storeId}::uuid and r.order_id = ${ret.orderId}::uuid and rl.decision = 'accept'
        and r.status::text not in ('declined', 'cancelled') and r.id <> ${ret.id}::uuid
        and (r.created_at, r.id) < (
          select r0.created_at, r0.id from commerce.returns r0 where r0.store_id = ${storeId}::uuid and r0.id = ${ret.id}::uuid
        )
      group by 1
    `),
    // The order's other withdrawals, earlier or later, whose goods are back, refunded or never sent: what completes the order.
    db().execute<Row>(sql`
      select rl.order_line_id, sum(rl.quantity)::int as q from commerce.return_lines rl
      join commerce.returns r on r.store_id = rl.store_id and r.id = rl.return_id
      where rl.store_id = ${storeId}::uuid and r.order_id = ${ret.orderId}::uuid and rl.decision = 'accept' and r.kind = 'withdrawal'
        and r.status::text not in ('declined', 'cancelled') and r.id <> ${ret.id}::uuid and ${SETTLED_SQL}
      group by 1
    `),
    db().execute<Row>(sql`
      select coalesce(sum(refund_minor), 0)::bigint as n, coalesce(sum(shipping_refund_minor), 0)::bigint as shipping from commerce.returns
      where store_id = ${storeId}::uuid and order_id = ${ret.orderId}::uuid and id <> ${ret.id}::uuid
    `),
  ]);
  const prior = new Map(priors.map((p) => [String(p.order_line_id), Number(p.q)]));
  const done = new Map(settled.map((p) => [String(p.order_line_id), Number(p.q)]));
  const own = new Map(lines.filter((l) => l.decision === "accept").map((l) => [l.lineId, l]));
  const refundLines: RefundLine[] = facts.lines.map((line) => {
    const mine = own.get(line.id);
    return {
      lineId: line.id,
      quantity: line.quantity,
      totalMinor: line.totalMinor,
      priorQuantity: prior.get(line.id) ?? 0,
      completedByOthers: done.get(line.id) ?? 0,
      returnQuantity: mine?.quantity ?? 0,
      deductionMinor: mine?.deductionMinor ?? 0,
    };
  });
  const paid = admin.paidMinor > 0 ? admin.paidMinor : facts.totalMinor;
  const byReturns = refundableAfter(paid, Number(others[0]?.n ?? 0));
  const refundableMinor = admin.canRefund ? Math.min(admin.refundableMinor, byReturns) : byReturns;
  const refund = refundFor({
    kind: ret.kind,
    lines: refundLines,
    shippingPaidMinor: shippingPaidMinor(facts.totalMinor, facts.lines.map((l) => l.totalMinor)),
    standardShippingMinor: await standardShipping(storeId, facts),
    shippingRefundedMinor: Number(others[0]?.shipping ?? 0),
    whoPaysReturn: facts.whoPaysReturn,
    returnShippingMinor,
    refundableMinor,
  });
  return { refund, refundableMinor, canRefund: admin.canRefund, admin, facts };
}

export type RefundPreview = {
  refund: Refund;
  refundableMinor: number;
  /** Refunded through Kaizen's Stripe; false records the refund as made outside. */
  canRefund: boolean;
  currency: string;
};

/** The working for the refund button: what the return refunds now, with the rows to show. */
export async function previewRefund(storeId: string, returnId: string, returnShippingMinor?: number): Promise<RefundPreview | null> {
  const ret = await loadRet(storeId, returnId);
  if (!ret) return null;
  const lines = await loadLines(storeId, returnId);
  const working = await workOut(storeId, ret, lines, returnShippingMinor ?? ret.returnShippingMinor);
  return working ? { refund: working.refund, refundableMinor: working.refundableMinor, canRefund: working.canRefund, currency: working.facts.currency } : null;
}

// ---------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------

export type TimelineEvent = { type: string; at: string; actor: string; data: Record<string, unknown> };

export type ReturnDetail = {
  id: string;
  number: string;
  kind: ReturnKind;
  status: ReturnStatus;
  orderId: string;
  orderNumber: string;
  orderEmail: string;
  currency: string;
  createdAt: string;
  approvedAt: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  inspectedAt: string | null;
  closedAt: string | null;
  outcome: string | null;
  reason: string | null;
  reasonNote: string | null;
  instructions: string | null;
  labelUrl: string | null;
  returnAddress: ReturnAddress | null;
  decisionNote: string | null;
  staffNote: string | null;
  publicToken: string;
  refundDeadline: string | null;
  refund: {
    recorded: boolean;
    amountMinor: number | null;
    computedMinor: number | null;
    note: string | null;
    at: string | null;
    outside: boolean;
    refundId: string | null;
    returnShippingMinor: number;
  };
  /** The shopper's statement and its acknowledgement; null for a voluntary return. */
  request: {
    id: string;
    name: string;
    email: string;
    submittedAt: string;
    confirmedAt: string | null;
    acknowledgedAt: string | null;
    acknowledgementReference: string | null;
    /** `not_sent` is shown to staff with a *Send again*. */
    acknowledgement: "sent" | "not_sent";
  } | null;
  lines: DetailLine[];
  steps: { step: string; state: StepState }[];
  events: TimelineEvent[];
  actions: ReturnAction[];
  due: RefundDue;
  /** The refund as it would be made now; null once the return has ended or there is nothing to refund. */
  working: Refund | null;
  /** Made before the goods were sent: nothing to send back and no refund held for the goods. */
  nothingSent: boolean;
  /** Who pays for sending the goods back, as the store's setting stood when the order was placed (never the setting as it is now). */
  whoPaysReturn: "shopper" | "store";
  order: {
    status: string;
    canRefund: boolean;
    paidMinor: number;
    refundedMinor: number;
    refundableMinor: number;
    /** A subscription's order: the withdrawal is recorded, the subscription itself is ended separately (a banner). */
    subscription: boolean;
    business: boolean;
  };
  settings: ReturnSettings;
};

/** One return of the store with everything its screen shows; null when it is not this store's. */
export async function getReturn(storeId: string, returnId: string, now = new Date()): Promise<ReturnDetail | null> {
  const ret = await loadRet(storeId, returnId);
  if (!ret) return null;
  const [lines, facts, settings, events, requestRows] = await Promise.all([
    loadLines(storeId, returnId),
    loadFacts(storeId, ret.orderId),
    getReturnSettings(storeId),
    db().execute<Row>(sql`
      select type, data, actor, created_at from commerce.order_events
      where store_id = ${storeId}::uuid and order_id = ${ret.orderId}::uuid and type like 'return.%' and data ->> 'returnId' = ${ret.id}
      order by id
    `),
    ret.withdrawalRequestId
      ? db().execute<Row>(sql`
          select id, name, email, submitted_at, confirmed_at, acknowledged_at, acknowledgement_reference
          from commerce.withdrawal_requests where store_id = ${storeId}::uuid and id = ${ret.withdrawalRequestId}::uuid
        `)
      : Promise.resolve([] as Row[]),
  ]);
  if (!facts) return null;
  const working = isEnded(ret.status) || lines.every((l) => l.decision !== "accept") ? null : await workOut(storeId, ret, lines, ret.returnShippingMinor);
  const byLine = new Map(working?.refund.lines.map((l) => [l.lineId, l.valueMinor]) ?? []);
  const request = requestRows[0];
  const confirmedAt = request?.confirmed_at ? new Date(String(request.confirmed_at)) : null;
  const refunded = ret.refundMinor !== null;
  const acknowledgementPending = Boolean(request && confirmedAt && !request.acknowledged_at);
  const admin = working?.admin ?? (await getOrderAdmin(storeId, ret.orderId));
  return {
    id: ret.id,
    number: ret.number,
    kind: ret.kind,
    status: ret.status,
    orderId: ret.orderId,
    orderNumber: facts.number,
    orderEmail: facts.email,
    currency: facts.currency,
    createdAt: ret.createdAt.toISOString(),
    approvedAt: ret.approvedAt?.toISOString() ?? null,
    shippedAt: ret.shippedAt?.toISOString() ?? null,
    receivedAt: ret.receivedAt?.toISOString() ?? null,
    inspectedAt: ret.inspectedAt?.toISOString() ?? null,
    closedAt: ret.closedAt?.toISOString() ?? null,
    outcome: ret.outcome,
    reason: ret.reason,
    reasonNote: ret.reasonNote,
    instructions: ret.instructions,
    labelUrl: ret.labelUrl,
    returnAddress: ret.returnAddress,
    decisionNote: ret.decisionNote,
    staffNote: ret.staffNote,
    publicToken: ret.publicToken,
    refundDeadline: ret.refundDeadline?.toISOString() ?? null,
    refund: {
      recorded: refunded,
      amountMinor: ret.refundMinor,
      computedMinor: ret.refundComputedMinor,
      note: ret.refundNote,
      at: ret.refundedAt?.toISOString() ?? null,
      outside: ret.refundOutside,
      refundId: ret.refundId,
      returnShippingMinor: ret.returnShippingMinor,
    },
    request: request
      ? {
          id: String(request.id),
          name: String(request.name),
          email: String(request.email),
          submittedAt: new Date(String(request.submitted_at)).toISOString(),
          confirmedAt: confirmedAt?.toISOString() ?? null,
          acknowledgedAt: request.acknowledged_at ? new Date(String(request.acknowledged_at)).toISOString() : null,
          acknowledgementReference: request.acknowledgement_reference ? String(request.acknowledgement_reference) : null,
          acknowledgement: request.acknowledged_at ? "sent" : "not_sent",
        }
      : null,
    lines: lines.map((l) => ({ ...l, valueMinor: byLine.get(l.lineId) ?? null })),
    steps: timeline(ret.kind, ret.status),
    events: events.map((e) => ({
      type: String(e.type),
      at: new Date(String(e.created_at)).toISOString(),
      actor: String(e.actor),
      data: (e.data ?? {}) as Record<string, unknown>,
    })),
    actions: actionsFor({
      kind: ret.kind,
      status: ret.status,
      refunded,
      refundWhen: settings.refundWhen,
      acknowledgementPending,
      refundOutside: admin ? !admin.canRefund : false,
      nothingToSendBack: ret.nothingSent,
    }),
    due: refundDue(
      {
        kind: ret.kind,
        status: ret.status,
        confirmedAt,
        refundDeadline: ret.refundDeadline,
        shippedAt: ret.shippedAt,
        receivedAt: ret.receivedAt,
        refunded,
        nothingToSendBack: ret.nothingSent,
      },
      settings,
      facts.timeZone,
      now,
    ),
    working: working?.refund ?? null,
    nothingSent: ret.nothingSent,
    whoPaysReturn: facts.whoPaysReturn,
    order: {
      status: facts.status,
      canRefund: admin?.canRefund ?? false,
      paidMinor: admin?.paidMinor ?? 0,
      refundedMinor: admin?.refundedMinor ?? 0,
      refundableMinor: admin?.refundableMinor ?? 0,
      subscription: Boolean(facts.order.subscription),
      business: facts.order.business,
    },
    settings,
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type QueueRow = {
  id: string;
  number: string;
  kind: ReturnKind;
  status: ReturnStatus;
  orderId: string;
  orderNumber: string;
  email: string;
  name: string | null;
  currency: string;
  units: number;
  createdAt: string;
  refundMinor: number | null;
  due: RefundDue;
  /** Past the legal deadline for the refund (a withdrawal's): the queue's *Overdue* mark. */
  overdue: boolean;
  /** The acknowledgement of a confirmed withdrawal was not sent. */
  acknowledgementPending: boolean;
};

export type Queue = { rows: QueueRow[]; total: number; page: number; pageSize: number };

const OPEN = ["requested", "approved", "in_transit", "received", "inspected"];

/**
 * The queue, oldest first: filtered by status (`open` by default) and kind, searched by return number, order number, name
 * or email, with the *Overdue* mark, paged. Every row carries when its refund is due.
 */
export async function listReturns(
  storeId: string,
  filter: Partial<ReturnQueueFilter> = {},
  { page = 1, pageSize = 25, now = new Date() }: { page?: number; pageSize?: number; now?: Date } = {},
): Promise<Queue> {
  const status = filter.status ?? "open";
  const kind = filter.kind ?? "all";
  const q = (filter.q ?? "").trim();
  const conditions: SQL[] = [sql`r.store_id = ${storeId}::uuid`];
  if (status === "open") conditions.push(sql`r.status::text in (${sql.join(OPEN.map((s) => sql`${s}`), sql`, `)})`);
  else if (status !== "all") conditions.push(sql`r.status::text = ${status}`);
  if (kind !== "all") conditions.push(sql`r.kind = ${kind}`);
  if (filter.overdue) conditions.push(OVERDUE_SQL);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(r.number ilike ${like} or o.number ilike ${like} or o.email ilike ${like} or w.email ilike ${like} or w.name ilike ${like})`);
  }
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize)));
  const at = Math.max(1, Math.trunc(page));
  const [rows, settings, zone] = await Promise.all([
    db().execute<Row>(sql`
      select r.id, r.number, r.kind, r.status, r.order_id, r.created_at, r.refund_deadline, r.refund_minor, r.shipped_at, r.received_at,
        ${NOTHING_SENT_SQL} as nothing_sent,
        o.number as order_number, o.email as order_email, o.currency, w.name, w.email as request_email, w.confirmed_at, w.acknowledged_at,
        (select coalesce(sum(rl.quantity) filter (where rl.decision = 'accept'), 0)::int
           from commerce.return_lines rl where rl.store_id = r.store_id and rl.return_id = r.id) as units,
        count(*) over ()::int as total
      from commerce.returns r
      join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      left join commerce.withdrawal_requests w on w.store_id = r.store_id and w.id = r.withdrawal_request_id
      where ${sql.join(conditions, sql` and `)}
      order by r.created_at asc, r.id asc
      limit ${size} offset ${(at - 1) * size}
    `),
    getReturnSettings(storeId),
    db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`),
  ]);
  const timeZone = String(zone[0]?.time_zone ?? "Europe/Oslo");
  return {
    rows: rows.map((r) => {
      const refunded = r.refund_minor !== null && r.refund_minor !== undefined;
      const due = refundDue(
        {
          kind: r.kind === "withdrawal" ? "withdrawal" : "return",
          status: String(r.status),
          confirmedAt: date(r.confirmed_at),
          refundDeadline: date(r.refund_deadline),
          shippedAt: date(r.shipped_at),
          receivedAt: date(r.received_at),
          refunded,
          nothingToSendBack: Boolean(r.nothing_sent),
        },
        settings,
        timeZone,
        now,
      );
      return {
        id: String(r.id),
        number: String(r.number),
        kind: r.kind === "withdrawal" ? "withdrawal" : "return",
        status: String(r.status) as ReturnStatus,
        orderId: String(r.order_id),
        orderNumber: String(r.order_number),
        email: String(r.request_email ?? r.order_email ?? ""),
        name: r.name ? String(r.name) : null,
        currency: String(r.currency).trim(),
        units: Number(r.units),
        createdAt: new Date(String(r.created_at)).toISOString(),
        refundMinor: number(r.refund_minor),
        due,
        overdue: due.state === "overdue" || due.state === "waiting_late",
        acknowledgementPending: Boolean(r.confirmed_at && !r.acknowledged_at),
      } satisfies QueueRow;
    }),
    total: Number(rows[0]?.total ?? 0),
    page: at,
    pageSize: size,
  };
}

export type ReturnCounts = {
  /** Returns still being worked. */
  open: number;
  /** Voluntary returns waiting for the store to approve or decline. */
  requested: number;
  /** Withdrawals past their legal deadline for the refund and not refunded. */
  overdue: number;
  /** Confirmed withdrawals whose acknowledgement was not sent. */
  acknowledgementPending: number;
};

/** The numbers the Orders section, the store Home alerts and the control center count. */
export async function returnCounts(storeId: string): Promise<ReturnCounts> {
  const [row] = await db().execute<Row>(sql`
    select
      count(*) filter (where r.status::text in ('requested', 'approved', 'in_transit', 'received', 'inspected'))::int as open,
      count(*) filter (where r.status::text = 'requested')::int as requested,
      count(*) filter (where ${OVERDUE_SQL})::int as overdue,
      count(*) filter (where w.confirmed_at is not null and w.acknowledged_at is null)::int as ack
    from commerce.returns r left join commerce.withdrawal_requests w on w.store_id = r.store_id and w.id = r.withdrawal_request_id
    where r.store_id = ${storeId}::uuid
  `);
  return { open: Number(row?.open ?? 0), requested: Number(row?.requested ?? 0), overdue: Number(row?.overdue ?? 0), acknowledgementPending: Number(row?.ack ?? 0) };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const actor = (accountId: string | null) => ({ by: accountId });

/** Stops a step the return's lifecycle does not allow from where it is. */
function mustMove(ret: Ret, to: ReturnStatus): Refused | null {
  if (canMove(ret.kind, ret.status, to)) return null;
  if (isEnded(ret.status)) return refusal("ended", "This return has ended, so it cannot be changed.");
  if (to === "declined" && ret.kind === "withdrawal") {
    return refusal("withdrawal_not_declinable", "The right of withdrawal is not the store's to refuse. A line the law excludes is declined as a line.");
  }
  if (to === "cancelled" && ret.kind === "withdrawal") {
    return refusal(
      "withdrawal_not_cancellable",
      "A withdrawal is effective on the customer's statement, so it is closed, not cancelled. If the goods never come back, close it without a refund.",
    );
  }
  return refusal("lifecycle", `A return that is ${ret.status.replace("_", " ")} cannot be moved to ${to.replace("_", " ")}.`);
}

async function inTransition<T extends object>(
  storeId: string,
  returnId: string,
  work: (tx: Tx, ret: Ret) => Promise<Done<T>>,
): Promise<Done<T>> {
  if (!z.uuid().safeParse(returnId).success) return gone();
  return guarded(() =>
    db().transaction(async (tx) => {
      const ret = await loadRet(storeId, returnId, tx, true);
      if (!ret) return gone();
      return work(tx, ret);
    }),
  ) as Promise<Done<T>>;
}

const eventData = (ret: Ret, accountId: string | null, more: Record<string, unknown> = {}) => ({
  returnId: ret.id,
  number: ret.number,
  ...actor(accountId),
  ...more,
});

/**
 * Approves a voluntary return (a withdrawal return starts approved): with the instructions, the return address and, if
 * the store pastes one, a label address (https only). The shopper is emailed how to send the goods back.
 */
export async function approveReturn(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "approved" }>> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const done = await inTransition<{ status: "approved" }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "approved");
    if (stop) return stop;
    await tx.execute(sql`
      update commerce.returns set status = 'approved',
        instructions = coalesce(${data.instructions}, instructions), label_url = ${data.labelUrl},
        return_address = coalesce(${data.returnAddress ? JSON.stringify(data.returnAddress) : null}::jsonb, return_address),
        decision_note = ${data.note}
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.approved", eventData(ret, accountId), "staff");
    return { ok: true, status: "approved" };
  });
  if (done.ok) await sendReturnApproved(storeId, data.returnId);
  return done;
}

/** Declines a voluntary return with the reason the shopper is emailed. A withdrawal is never declined. */
export async function declineReturn(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "declined" }>> {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const done = await inTransition<{ status: "declined" }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "declined");
    if (stop) return stop;
    await tx.execute(sql`
      update commerce.returns set status = 'declined', decision_note = ${data.reason}
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.declined", eventData(ret, accountId, { reason: data.reason }), "staff");
    return { ok: true, status: "declined" };
  });
  if (done.ok) await sendReturnDeclined(storeId, data.returnId);
  return done;
}

/**
 * A line decision, not a status: declines one line of a return. On a withdrawal only a line the law excludes from the
 * right can be declined; on a voluntary return any line. The units go back to what is left of the order line.
 */
export async function declineReturnLine(storeId: string, input: unknown, accountId: string | null): Promise<Done> {
  const parsed = declineLineSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition(storeId, data.returnId, async (tx, ret) => {
    if (isEnded(ret.status)) return refusal("ended", "This return has ended, so it cannot be changed.");
    const [line] = await tx.execute<Row>(sql`
      select rl.decision, ol.withdrawal_exclusion, ol.sku from commerce.return_lines rl
      join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
      where rl.store_id = ${storeId}::uuid and rl.return_id = ${ret.id}::uuid and rl.order_line_id = ${data.lineId}::uuid
    `);
    if (!line) return refusal("not_found", "That line is not on this return.");
    if (line.decision === "decline") return refusal("already", "That line is already declined.");
    if (ret.kind === "withdrawal" && line.withdrawal_exclusion === "none") {
      return refusal("withdrawal_line", "A line with the right of withdrawal is not declined.");
    }
    await tx.execute(sql`
      update commerce.return_lines set decision = 'decline', decline_reason = ${data.reason}, restock = false, deduction_minor = 0
      where store_id = ${storeId}::uuid and return_id = ${ret.id}::uuid and order_line_id = ${data.lineId}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.declined", eventData(ret, accountId, { scope: "line", lineId: data.lineId, sku: line.sku, reason: data.reason }), "staff");
    return { ok: true };
  });
}

/** Instructions, return address and label address for a return that is waiting or approved; until the goods arrive. */
export async function setReturnInstructions(storeId: string, input: unknown, accountId: string | null): Promise<Done> {
  const parsed = instructionsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition(storeId, data.returnId, async (tx, ret) => {
    if (!["requested", "approved", "in_transit"].includes(ret.status)) {
      return refusal("lifecycle", isEnded(ret.status) ? "This return has ended, so it cannot be changed." : "The goods have arrived, so the instructions are no longer changed.");
    }
    await tx.execute(sql`
      update commerce.returns set instructions = ${data.instructions}, label_url = ${data.labelUrl},
        return_address = ${data.returnAddress ? JSON.stringify(data.returnAddress) : null}::jsonb
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    void accountId;
    return { ok: true };
  });
}

/** The day a step happened, as a time: noon of the store's day, never in the future and never before `floor`. */
async function stepTime(storeId: string, on: string | null, floor: Date | null): Promise<Date | null> {
  if (!on) return null;
  const [zone] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  let at = noonOf(on, String(zone?.time_zone ?? "Europe/Oslo"));
  const now = new Date();
  if (at.getTime() > now.getTime()) at = now;
  if (floor && at.getTime() < floor.getTime()) at = floor;
  return at;
}

/** *Mark in transit*: the shopper's proof of sending (or staff's), on a day, else now. */
export async function markInTransit(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "in_transit" }>> {
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition<{ status: "in_transit" }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "in_transit");
    if (stop) return stop;
    const at = await stepTime(storeId, data.on, ret.approvedAt);
    await tx.execute(sql`
      update commerce.returns set status = 'in_transit', shipped_at = ${at?.toISOString() ?? null}::timestamptz
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.in_transit", eventData(ret, accountId), "staff");
    return { ok: true, status: "in_transit" };
  });
}

/** *Mark received*: the goods are here, on a day, else now. The shopper is emailed. */
export async function markReceived(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "received" }>> {
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const done = await inTransition<{ status: "received" }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "received");
    if (stop) return stop;
    const floorAt = [ret.approvedAt, ret.shippedAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const at = await stepTime(storeId, data.on, floorAt);
    await tx.execute(sql`
      update commerce.returns set status = 'received', received_at = ${at?.toISOString() ?? null}::timestamptz
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.received", eventData(ret, accountId), "staff");
    return { ok: true, status: "received" };
  });
  if (done.ok) await sendReturnReceived(storeId, data.returnId);
  return done;
}

/**
 * *Inspect*: per line the condition the goods came back in, whether they go back into stock, and a deduction for
 * diminished value (CRD Art. 14(2)) never above the units' value. Every accepted line needs a condition before the return
 * moves to inspected. Can be corrected until the refund is recorded.
 */
export async function inspectReturn(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "inspected" }>> {
  const parsed = inspectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition<{ status: "inspected" }>(storeId, data.returnId, async (tx, ret) => {
    if (ret.status !== "received" && ret.status !== "inspected") {
      return isEnded(ret.status)
        ? refusal("ended", "This return has ended, so it cannot be changed.")
        : refusal("lifecycle", "Mark the goods as received before inspecting them.");
    }
    if (ret.refundMinor !== null) return refusal("refunded", "The refund is already made, so the inspection is not changed.");
    const lines = await loadLines(storeId, ret.id);
    const accepted = new Map(lines.filter((l) => l.decision === "accept").map((l) => [l.lineId, l]));
    const seen = new Set<string>();
    for (const item of data.lines) {
      const line = accepted.get(item.lineId);
      if (!line) return refusal("not_found", "A line you inspected is not on this return.");
      if (seen.has(item.lineId)) return refusal("duplicate", "Each line is inspected once.");
      seen.add(item.lineId);
    }
    const facts = await loadFacts(storeId, ret.orderId);
    if (!facts) return gone();
    const working = await workOut(storeId, ret, lines, 0);
    for (const item of data.lines) {
      const line = accepted.get(item.lineId)!;
      const value = working?.refund.lines.find((l) => l.lineId === item.lineId)?.valueMinor ?? 0;
      if (item.deductionMinor > value) {
        return refusal("deduction", `The deduction for ${line.title} is more than the value of the goods returned.`);
      }
    }
    for (const item of data.lines) {
      await tx.execute(sql`
        update commerce.return_lines set condition = ${item.condition}, restock = ${item.restock},
          deduction_minor = ${item.deductionMinor}, deduction_note = ${item.deductionMinor > 0 ? item.deductionNote : null}
        where store_id = ${storeId}::uuid and return_id = ${ret.id}::uuid and order_line_id = ${item.lineId}::uuid
      `);
    }
    const after = await tx.execute<Row>(sql`
      select count(*)::int as missing from commerce.return_lines
      where store_id = ${storeId}::uuid and return_id = ${ret.id}::uuid and decision = 'accept' and condition is null
    `);
    if (Number(after[0]?.missing ?? 0) > 0) throw new InspectionIncomplete();
    if (ret.status === "received") {
      await tx.execute(sql`update commerce.returns set status = 'inspected' where store_id = ${storeId}::uuid and id = ${ret.id}::uuid`);
    }
    await writeEvent(
      tx,
      storeId,
      ret.orderId,
      "return.inspected",
      eventData(ret, accountId, {
        lines: data.lines.map((l) => ({ lineId: l.lineId, condition: l.condition, restock: l.restock, deductionMinor: l.deductionMinor })),
      }),
      "staff",
    );
    return { ok: true, status: "inspected" };
  }).catch((error) => {
    if (error instanceof InspectionIncomplete) return refusal("incomplete", "Inspect every line that was returned.");
    throw error;
  });
}

class InspectionIncomplete extends Error {}

// ---------------------------------------------------------------------------
// The refund
// ---------------------------------------------------------------------------

export type RefundDone = {
  ok: true;
  amountMinor: number;
  computedMinor: number;
  /** Refunded through Kaizen's Stripe; false when it is recorded as made outside. */
  outside: boolean;
  refundId: string | null;
  adjusted: boolean;
};

/**
 * *Refund*: the amount worked out by `refundFor()` from what is stored, which a withdrawal's staff can raise but not lower
 * (what takes from a withdrawal is the inspection's deductions, each with its note, and the return shipping the shopper pays,
 * both in the working) and a voluntary return's staff can set anywhere between 0 and what is left, with a reason (logged
 * as `return.refund_overridden`). Through Stripe on the store's account when the order was paid that way (the one
 * `refundOrder()`: Kaizen's fee on the refunded part goes back, stock, host commission), else recorded as refunded outside.
 * The return's own record of the refund is written in the same transaction as Stripe's refund row. Restocked units are the
 * ones asked for, else the lines inspected as going back to stock. The shopper is emailed once.
 *
 * With *refund when received* the store may hold the refund only until the goods are back or the shopper has shown proof of
 * sending, whichever is earlier (Art. 13(3)): so it is made from *in transit* on, and at once for a withdrawal made before
 * anything was sent. The refund is claimed on the return before Stripe is called, so two members refunding at once cannot
 * both pay it, and Stripe's idempotency key is the return's alone (the amount and the order's other refunds are not in it),
 * so a retry after a failure replays the refund that was made and a different amount cannot make a second one.
 */
export async function refundReturn(storeId: string, input: unknown, accountId: string | null): Promise<Done<Omit<RefundDone, "ok">>> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const ret = await loadRet(storeId, data.returnId);
  if (!ret) return gone();
  if (ret.refundMinor !== null) return refusal("refunded", "This return is already refunded.");
  if (isEnded(ret.status)) return refusal("ended", "This return has ended, so it cannot be refunded.");
  if (ret.status === "requested") return refusal("lifecycle", "Approve the return before refunding it.");
  const settings = await getReturnSettings(storeId);
  const holds = settings.refundWhen === "received" && !ret.nothingSent;
  if (holds && !["in_transit", "received", "inspected"].includes(ret.status)) {
    return refusal("not_received", "The store refunds when the goods are back or on their way. Mark them as on their way (the customer's proof of sending) or received first.");
  }
  const lines = await loadLines(storeId, ret.id);
  if (!lines.some((l) => l.decision === "accept")) return refusal("no_lines", "No line of this return is accepted, so there is nothing to refund.");
  const working = await workOut(storeId, ret, lines, data.returnShippingMinor);
  if (!working) return gone();
  const { refund, admin } = working;
  const outside = !working.canRefund;

  const override = reviewOverride({
    computedMinor: refund.amountMinor,
    requestedMinor: data.amountMinor,
    refundableMinor: working.refundableMinor,
    reason: data.reason ?? "",
    kind: ret.kind,
  });
  if (!override.ok) {
    const words = {
      not_whole_number: "The amount is a whole number of minor units.",
      negative: "The amount cannot be negative.",
      over_refundable: "The amount is more than is left to refund.",
      reason_needed: "Say why the amount differs from what was worked out.",
      reason_too_long: "Keep the reason under 500 characters.",
      below_working: "A withdrawal is refunded in full. A deduction for diminished value is made when the goods are inspected, with its note; the return shipping the customer pays is in the working.",
    } as const;
    return refusal(override.problem, words[override.problem]);
  }
  const amount = override.amountMinor;

  // Units that go back in stock: the ones asked for, else the lines inspected as going back; never more than was returned
  // or than is left to put back (a refund tried twice does not stock twice).
  const mine = new Map(lines.filter((l) => l.decision === "accept").map((l) => [l.lineId, l]));
  const asked: { lineId: string; quantity: number; locationId?: string | null }[] =
    data.restock.length > 0 ? data.restock : lines.filter((l) => l.decision === "accept" && l.restock).map((l) => ({ lineId: l.lineId, quantity: l.quantity }));
  const restock: { lineId: string; quantity: number; locationId?: string | null }[] = [];
  for (const item of asked) {
    const line = mine.get(item.lineId);
    if (!line) return refusal("not_found", "A line to put back in stock is not on this return.");
    if (item.quantity > line.quantity) return refusal("restock", `Only ${line.quantity} of ${line.title} was returned.`);
    const orderLine = admin.lines.find((l) => l.id === item.lineId);
    const room = orderLine ? orderLine.restockable : 0;
    const quantity = Math.min(item.quantity, room);
    if (quantity > 0) restock.push({ lineId: item.lineId, quantity, locationId: item.locationId ?? null });
  }

  const returnShipping = refund.returnShippingMinor;
  const reason = data.reason ?? `Return ${ret.number}`;
  const adjusted = override.changed;
  // The delivery given back is part of what is refunded (it may be less than computed when a voluntary return's amount is set lower).
  const shippingRefunded = Math.min(refund.shippingRefundMinor, amount);
  let linked = false;
  let recordedRefundId: string | null = null;

  /** Written in the same transaction as the refund (or on its own when no money or stock moves). */
  const record = async (tx: Tx, refundId: string) => {
    // The working the credit note reads (D159): each line returned at its own rate, the deductions, the delivery given back, the
    // return shipping the shopper pays and what staff added or took (the difference to the amount). Written with the refund, once.
    const working = {
      lines: refund.lines.filter((l) => l.returnQuantity > 0).map((l) => ({ lineId: l.lineId, quantity: l.returnQuantity, valueMinor: l.valueMinor, deductionMinor: l.deductionMinor })),
      deliveryMinor: shippingRefunded,
      returnShippingMinor: returnShipping,
      amountMinor: amount,
      outside,
    };
    const refundWorking = { ...working, adjustmentMinor: adjustmentOf(working) };
    await tx.execute(sql`
      update commerce.returns set refund_id = ${refundId || null}::uuid, refund_minor = ${amount}, refund_computed_minor = ${refund.amountMinor},
        refund_note = ${adjusted ? reason : null}, refund_outside = ${outside}, return_shipping_minor = ${returnShipping},
        shipping_refund_minor = ${shippingRefunded}, refund_working = ${JSON.stringify(refundWorking)}::jsonb, refund_claimed_at = null
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    const more = {
      amountMinor: amount,
      computedMinor: refund.amountMinor,
      outside,
      refundId: refundId || null,
      restock,
      returnShippingMinor: returnShipping,
      shippingRefundMinor: shippingRefunded,
    };
    if (adjusted) {
      await writeEvent(tx, storeId, ret.orderId, "return.refund_overridden", eventData(ret, accountId, { computedMinor: refund.amountMinor, requestedMinor: amount, reason }), "staff");
    }
    await writeEvent(tx, storeId, ret.orderId, "return.refunded", eventData(ret, accountId, more), "staff");
    linked = true;
    recordedRefundId = refundId || null;
  };

  // The refund is claimed on the return first: of two members pressing Refund at once, one pays it.
  const claimed = await db().execute<Row>(sql`
    update commerce.returns set refund_claimed_at = now()
    where store_id = ${storeId}::uuid and id = ${ret.id}::uuid and refund_minor is null
      and status::text in ('approved', 'in_transit', 'received', 'inspected')
      and (refund_claimed_at is null or refund_claimed_at < now() - interval '2 minutes')
    returning id
  `);
  if (claimed.length === 0) {
    const again = await loadRet(storeId, ret.id);
    return again?.refundMinor !== null && again ? refusal("refunded", "This return is already refunded.") : refusal("refund_busy", "A refund of this return is being made right now. Reload the page in a moment.");
  }
  const release = () =>
    db().execute(sql`
      update commerce.returns set refund_claimed_at = null
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid and refund_minor is null and refund_claimed_at is not null
    `);

  // Stripe's key is the return's own, with the number of refunds of it Stripe reported as failed (a failed refund is replayed
  // by its key, so a new attempt needs a new one). It carries neither the amount nor the order's other refunds: a retry after
  // Stripe took the refund and the database did not replays the same refund, and a second member's different amount is refused by Stripe.
  const [failedBefore] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.order_events
    where store_id = ${storeId}::uuid and order_id = ${ret.orderId}::uuid and type = 'order.refunded'
      and data ->> 'returnId' = ${ret.id} and data ->> 'status' = 'failed'
  `);
  const key = `return-refund:${ret.id}:${Number(failedBefore?.n ?? 0)}`;
  let result: Done;
  try {
    result = await guarded(async () => {
      if (!outside && (amount > 0 || restock.length > 0)) {
        const sent = await refundOrder(storeId, ret.orderId, { amountMinor: amount, reason, restock }, accountId, {
          idempotencyKey: key,
          returnId: ret.id,
          eventData: { returnId: ret.id, returnNumber: ret.number },
          inTransaction: async (tx, outcome) => {
            if (outcome.status === "failed") return;
            await record(tx, outcome.refundId);
          },
        });
        if (!sent.ok) return refusal("refund", sent.problem);
        if (!linked) return refusal("stripe_failed", "Stripe reported the refund as failed, so it was not recorded on the return. Try again.");
        return { ok: true as const };
      }
      if (outside && restock.length > 0) {
        const sent = await refundOrder(storeId, ret.orderId, { amountMinor: 0, reason, restock }, accountId, {
          outside: true,
          returnId: ret.id,
          eventData: { returnId: ret.id, returnNumber: ret.number, outside: true, outsideAmountMinor: amount },
          inTransaction: async (tx) => record(tx, ""),
        });
        if (!sent.ok) return refusal("refund", sent.problem);
        return { ok: true as const };
      }
      // Nothing to send and nothing to put back: only the record.
      await db().transaction(async (tx) => {
        const locked = await loadRet(storeId, ret.id, tx, true);
        if (!locked || locked.refundMinor !== null) throw new RefundAlready();
        await record(tx, "");
      });
      return { ok: true as const };
    });
  } catch (error) {
    await release().catch(() => undefined);
    if (error instanceof RefundAlready) return refusal("refunded", "This return is already refunded.");
    throw error;
  }
  if (!result.ok) {
    await release().catch(() => undefined);
    return result;
  }

  // The shopper is emailed the refund once, with the working when it adds up to what was refunded.
  const mail: WorkingRow[] = refund.working;
  if (amount > 0) await sendReturnRefunded(storeId, ret.id, mail);
  return { ok: true, amountMinor: amount, computedMinor: refund.amountMinor, outside, refundId: recordedRefundId, adjusted };
}

class RefundAlready extends Error {}

/**
 * *Close*: the return is done, refunded or with nothing to refund. Closing a withdrawal that was not refunded needs the
 * caller to say so (`confirmNoRefund`), as the screen asks.
 */
export async function closeReturn(
  storeId: string,
  input: unknown,
  accountId: string | null,
  { confirmNoRefund = false }: { confirmNoRefund?: boolean } = {},
): Promise<Done<{ status: "closed"; outcome: string }>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition<{ status: "closed"; outcome: string }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "closed");
    if (stop) return stop;
    const refunded = ret.refundMinor !== null;
    if (closeWithoutRefundNeedsConfirm(ret.kind, refunded) && !confirmNoRefund) {
      return refusal("confirm_no_refund", "This withdrawal has not been refunded. Confirm that you want to close it without a refund.");
    }
    await tx.execute(sql`
      update commerce.returns set status = 'closed',
        staff_note = case when ${data.note}::text is null then staff_note else concat_ws(E'\\n', staff_note, ${data.note}::text) end
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    const [after] = await tx.execute<Row>(sql`select outcome from commerce.returns where store_id = ${storeId}::uuid and id = ${ret.id}::uuid`);
    await writeEvent(tx, storeId, ret.orderId, "return.closed", eventData(ret, accountId, { outcome: after?.outcome ?? null }), "staff");
    return { ok: true, status: "closed", outcome: String(after?.outcome ?? "") };
  });
}

/** *Cancel*: the physical return does not go ahead (a withdrawal that was made stays recorded). Not once it is refunded. */
export async function cancelReturn(storeId: string, input: unknown, accountId: string | null): Promise<Done<{ status: "cancelled" }>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition<{ status: "cancelled" }>(storeId, data.returnId, async (tx, ret) => {
    const stop = mustMove(ret, "cancelled");
    if (stop) return stop;
    if (ret.refundMinor !== null) return refusal("refunded", "A refunded return is closed, not cancelled.");
    await tx.execute(sql`
      update commerce.returns set status = 'cancelled',
        staff_note = case when ${data.note}::text is null then staff_note else concat_ws(E'\\n', staff_note, ${data.note}::text) end
      where store_id = ${storeId}::uuid and id = ${ret.id}::uuid
    `);
    await writeEvent(tx, storeId, ret.orderId, "return.cancelled", eventData(ret, accountId), "staff");
    return { ok: true, status: "cancelled" };
  });
}

/** The store's own note on a return (never shown to the shopper), also after it has ended. */
export async function setReturnNote(storeId: string, input: unknown): Promise<Done> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return inTransition(storeId, data.returnId, async (tx, ret) => {
    await tx.execute(sql`update commerce.returns set staff_note = ${data.note} where store_id = ${storeId}::uuid and id = ${ret.id}::uuid`);
    return { ok: true };
  });
}

export { COPIED_ORDER_MESSAGE };

// ---------------------------------------------------------------------------
// The shopper's view
// ---------------------------------------------------------------------------

export type ShopperReturn = {
  number: string;
  kind: ReturnKind;
  status: ReturnStatus;
  orderNumber: string;
  orderId: string;
  currency: string;
  steps: { step: string; state: StepState }[];
  lines: { title: string; quantity: number; decision: "accept" | "decline"; declineReason: string | null }[];
  /** What the store asks the shopper to do, and where to send the goods (never anyone's email or home address). */
  instructions: string | null;
  returnAddress: ReturnAddress | null;
  labelUrl: string | null;
  whoPaysReturn: "shopper" | "store";
  /** Withdrawn before the goods were sent: there is nothing to send back. */
  nothingSent: boolean;
  /** Why a voluntary return was declined. */
  decisionNote: string | null;
  outcome: string | null;
  refundMinor: number | null;
  refundedAt: string | null;
  /** A withdrawal's dates: when the store was informed, the last day to send the goods back, the latest refund day. */
  confirmedAt: string | null;
  sendBackBy: string | null;
  refundBy: string | null;
  acknowledgementReference: string | null;
  createdAt: string;
  timeZone: string;
};

/**
 * A return by its secret address (`/returns/{token}`), for the shopper's status page. It shows and changes nothing but
 * what the shopper may see: no email, no address of the shopper. Null for another store's token.
 */
export async function getShopperReturn(storeId: string, token: string): Promise<ShopperReturn | null> {
  if (!/^[0-9a-f]{32,128}$/.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select id from commerce.returns where store_id = ${storeId}::uuid and public_token = ${token}
  `);
  if (!row) return null;
  const ret = await loadRet(storeId, String(row.id));
  if (!ret) return null;
  const [lines, facts, request] = await Promise.all([
    loadLines(storeId, ret.id),
    loadFacts(storeId, ret.orderId),
    ret.withdrawalRequestId
      ? db().execute<Row>(sql`
          select confirmed_at, acknowledgement_reference from commerce.withdrawal_requests
          where store_id = ${storeId}::uuid and id = ${ret.withdrawalRequestId}::uuid
        `)
      : Promise.resolve([] as Row[]),
  ]);
  if (!facts) return null;
  const confirmedAt = request[0]?.confirmed_at ? new Date(String(request[0].confirmed_at)) : null;
  return {
    number: ret.number,
    kind: ret.kind,
    status: ret.status,
    orderNumber: facts.number,
    orderId: ret.orderId,
    currency: facts.currency,
    steps: timeline(ret.kind, ret.status),
    lines: lines.map((l) => ({ title: l.title, quantity: l.quantity, decision: l.decision, declineReason: l.declineReason })),
    instructions: ret.instructions,
    returnAddress: ret.returnAddress,
    labelUrl: ret.labelUrl,
    whoPaysReturn: facts.whoPaysReturn,
    nothingSent: ret.nothingSent,
    decisionNote: ret.decisionNote,
    outcome: ret.outcome,
    refundMinor: ret.refundMinor,
    refundedAt: ret.refundedAt?.toISOString() ?? null,
    confirmedAt: confirmedAt?.toISOString() ?? null,
    sendBackBy: confirmedAt ? sendBackDay(confirmedAt, facts.timeZone) : null,
    refundBy: confirmedAt ? (ret.refundDeadline ?? refundDeadline(confirmedAt)).toISOString() : null,
    acknowledgementReference: request[0]?.acknowledgement_reference ? ret.number : null,
    createdAt: ret.createdAt.toISOString(),
    timeZone: facts.timeZone,
  };
}

export type OrderReturnRow = { id: string; number: string; kind: ReturnKind; status: ReturnStatus; token: string; createdAt: string };

/** The returns of one order, for its order page and My account (the caller has checked the order is the shopper's). */
export async function listOrderReturns(storeId: string, orderId: string): Promise<OrderReturnRow[]> {
  const rows = await db().execute<Row>(sql`
    select id, number, kind, status, public_token, created_at from commerce.returns
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by created_at, id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    kind: r.kind === "withdrawal" ? "withdrawal" : "return",
    status: String(r.status) as ReturnStatus,
    token: String(r.public_token),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}
