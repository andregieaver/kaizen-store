import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { convertMinor } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";
import {
  allIn,
  documentState,
  purchaseOrderInput,
  receiptInput,
  receiptPlan,
  unitCostMinor,
  type DocumentState,
  type PurchaseOrderStatus,
} from "@/lib/stock-documents";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { withStockContext } from "./stock-context";
import { variantsBySku, type DocumentResult } from "./stock-transfers";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Purchase orders (wave 11 unit D, D383), the only writer of `purchase_orders` and their lines. A draft names a supplier, the currency it
 * bills in, where the stock arrives and each line's units and unit cost; ordering it fixes them; receiving counts units in at its location
 * (reason `received`, source `purchase_order`, the order as `job_id`), in parts, never more than ordered, and sets each received variant's
 * cost to the order's unit cost converted into the store's main currency at the store's rates (kept in `variant_cost_history` by the
 * database's trigger with the order, its currency and its own figure); a currency with no rate leaves the cost as it was and says so.
 * Cancelling closes it; what was received stays. `products:write` to change, `products:read` to read.
 */

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

export async function createPurchaseOrder(member: Membership, raw: unknown): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = purchaseOrderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const input = parsed.data;
  const costs = input.lines.map((l) => unitCostMinor(l.unitCost, input.currency));
  const unread = input.lines.filter((_, i) => costs[i] === null).map((l) => l.sku);
  if (unread.length) return { ok: false, problems: [`Write what one unit of ${unread.join(", ")} costs as an amount.`] };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult> => {
    const place = await typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.inventory_locations where store_id = ${storeId}::uuid and id = ${input.location}::uuid and active`,
      tx,
    );
    if (!place) return { ok: false, problems: ["Choose one of the store's active locations."] };
    const { found, missing } = await variantsBySku(tx, storeId, input.lines.map((l) => l.sku));
    if (missing.length) return { ok: false, problems: [`No shipped goods with the SKU ${missing.join(", ")} in this store.`] };
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.purchase_orders (store_id, supplier, reference, currency, location_id, expected_on, note, created_by)
      values (${storeId}::uuid, ${input.supplier}, ${input.reference}, ${input.currency}, ${input.location}::uuid, ${input.expectedOn}::date, ${input.note},
        ${member.account.id}::uuid)
      returning id
    `);
    for (const [i, line] of input.lines.entries()) {
      await tx.execute(sql`
        insert into commerce.purchase_order_lines (store_id, purchase_order_id, variant_id, quantity, unit_cost_minor)
        values (${storeId}::uuid, ${row.id}::uuid, ${found.get(line.sku.trim().toLowerCase())!}::uuid, ${line.quantity}, ${costs[i]!})
      `);
    }
    return { ok: true, id: String(row.id) };
  });
  if (result.ok) await finish(member, result.id, "products.purchase_order_created", { lines: input.lines.length }, false);
  return result;
}

const HEAD_ROW = z.object({ id: col.uuid, status: col.text, location_id: col.uuid, currency: col.currency });
const LINE_ROW = z.object({ variant_id: col.uuid, quantity: col.int, received: col.int, unit_cost_minor: col.minor });

async function lockOrder(tx: Executor, storeId: string, id: string) {
  const head = await typedRow(HEAD_ROW, sql`select id, status, location_id, currency from commerce.purchase_orders where store_id = ${storeId}::uuid and id = ${id}::uuid for update`, tx);
  if (!head) return null;
  const lines = await typedRows(
    LINE_ROW,
    sql`select variant_id, quantity, received, unit_cost_minor from commerce.purchase_order_lines where store_id = ${storeId}::uuid and purchase_order_id = ${id}::uuid order by variant_id`,
    tx,
  );
  return { ...head, lines };
}

/** Marks a draft as ordered: its supplier, currency, place and lines are fixed from here. */
export async function placePurchaseOrder(member: Membership, id: string): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult> => {
    const order = await lockOrder(tx, storeId, id);
    if (!order) return { ok: false, problems: ["This purchase order is not in this store."] };
    if (order.status !== "draft") return { ok: false, problems: ["Only a draft is ordered."] };
    await tx.execute(sql`update commerce.purchase_orders set status = 'ordered', ordered_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return { ok: true, id };
  });
  if (result.ok) await finish(member, id, "products.purchase_order_ordered", {}, false);
  return result;
}

/**
 * Counts units in at the order's location, in parts, and sets each received variant's cost from the order. `costsKept` names how many
 * variants kept their cost because the order's currency has no rate to the main one.
 */
export async function receivePurchaseOrder(member: Membership, id: string, raw: unknown): Promise<DocumentResult & { received?: number; costsKept?: number }> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = receiptInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const store = member.store;
  const main = mainCurrency(store);
  const result = await db().transaction(async (tx): Promise<DocumentResult & { received?: number; costsKept?: number }> => {
    const order = await lockOrder(tx, store.id, id);
    if (!order) return { ok: false, problems: ["This purchase order is not in this store."] };
    if (order.status !== "ordered") return { ok: false, problems: ["Only an ordered purchase order is received."] };
    const plan = receiptPlan(order.lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity, received: l.received })), parsed.data.lines);
    if (plan.length === 0) return { ok: false, problems: ["Count at least one unit in."] };
    let costsKept = 0;
    await withStockContext(tx, { reason: "received", source: "purchase_order", accountId: member.account.id, jobId: id }, async () => {
      for (const take of [...plan].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        await tx.execute(sql`
          insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
          values (${store.id}::uuid, ${take.variantId}::uuid, ${order.location_id}::uuid, ${take.quantity})
          on conflict (variant_id, location_id) do update set on_hand = commerce.inventory_levels.on_hand + excluded.on_hand, updated_at = now()
        `);
        await tx.execute(sql`
          update commerce.purchase_order_lines set received = received + ${take.quantity}
          where store_id = ${store.id}::uuid and purchase_order_id = ${id}::uuid and variant_id = ${take.variantId}::uuid
        `);
        const line = order.lines.find((l) => l.variant_id === take.variantId)!;
        const cost = convertMinor(line.unit_cost_minor, order.currency, main, store.localization.rates);
        if (cost === null) {
          costsKept += 1;
          continue;
        }
        const source = JSON.stringify({ source: "purchase_order", order: id, currency: order.currency, cost: line.unit_cost_minor, account: member.account.id });
        await tx.execute(sql`select set_config('kaizen.cost_source', ${source}, true)`);
        await tx.execute(sql`update commerce.product_variants set cost_minor = ${cost} where store_id = ${store.id}::uuid and id = ${take.variantId}::uuid`);
        await tx.execute(sql`select set_config('kaizen.cost_source', '', true)`);
      }
    });
    const after = order.lines.map((l) => ({ quantity: l.quantity, received: l.received + (plan.find((p) => p.variantId === l.variant_id)?.quantity ?? 0) }));
    if (allIn(after)) await tx.execute(sql`update commerce.purchase_orders set status = 'received', received_at = now() where store_id = ${store.id}::uuid and id = ${id}::uuid`);
    return { ok: true, id, received: plan.reduce((sum, p) => sum + p.quantity, 0), costsKept };
  });
  if (result.ok) await finish(member, id, "products.purchase_order_received", { units: result.received ?? 0, costsKept: result.costsKept ?? 0 }, true);
  return result;
}

/** Cancels a draft or an ordered purchase order; what was received stays. */
export async function cancelPurchaseOrder(member: Membership, id: string): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult> => {
    const order = await lockOrder(tx, storeId, id);
    if (!order) return { ok: false, problems: ["This purchase order is not in this store."] };
    if (order.status !== "draft" && order.status !== "ordered") return { ok: false, problems: ["This purchase order is already closed."] };
    await tx.execute(sql`update commerce.purchase_orders set status = 'cancelled', cancelled_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return { ok: true, id };
  });
  if (result.ok) await finish(member, id, "products.purchase_order_cancelled", {}, false);
  return result;
}

async function finish(member: Membership, id: string, action: string, details: Record<string, unknown>, stockMoved: boolean) {
  await audit(member.account.id, member.store.id, action, details, { area: "products", target: { type: "purchase_order", id } }).catch((error) =>
    log("warn", "purchase_orders.audit_failed", { storeId: member.store.id }, error),
  );
  if (stockMoved) refreshTag(catalogTag(member.store.id));
}

export type PurchaseOrderSummary = {
  id: string;
  status: PurchaseOrderStatus;
  state: DocumentState;
  supplier: string;
  reference: string | null;
  currency: string;
  location: string;
  expectedOn: string | null;
  lines: number;
  units: number;
  received: number;
  /** What the order costs in its own currency: units times unit cost, summed in code. */
  totalMinor: number;
  createdAt: string;
};

export type PurchaseOrderView = PurchaseOrderSummary & {
  locationId: string;
  note: string | null;
  items: { variantId: string; sku: string; title: string; quantity: number; received: number; unitCostMinor: number }[];
};

const SUMMARY_ROW = z.object({
  id: col.uuid,
  status: col.text,
  supplier: col.text,
  reference: col.textOrNull,
  currency: col.currency,
  location: col.text,
  location_id: col.uuid,
  expected_on: col.textOrNull,
  note: col.textOrNull,
  lines: col.int,
  units: col.int,
  received: col.int,
  total_minor: col.minor,
  created_at: col.timestamp,
});

const summaryOf = (r: z.infer<typeof SUMMARY_ROW>): PurchaseOrderSummary => ({
  id: r.id,
  status: r.status as PurchaseOrderStatus,
  state: documentState(r.status as PurchaseOrderStatus, r.units > 0 ? [{ quantity: r.units, received: r.received }] : []),
  supplier: r.supplier,
  reference: r.reference,
  currency: r.currency,
  location: r.location,
  expectedOn: r.expected_on,
  lines: r.lines,
  units: r.units,
  received: r.received,
  totalMinor: r.total_minor,
  createdAt: r.created_at,
});

const summarySql = (storeId: string) => sql`
  select p.id, p.status, p.supplier, p.reference, p.currency, loc.name as location, p.location_id, p.expected_on::text as expected_on, p.note,
    (select count(*) from commerce.purchase_order_lines l where l.store_id = p.store_id and l.purchase_order_id = p.id)::int as lines,
    (select coalesce(sum(l.quantity), 0) from commerce.purchase_order_lines l where l.store_id = p.store_id and l.purchase_order_id = p.id)::int as units,
    (select coalesce(sum(l.received), 0) from commerce.purchase_order_lines l where l.store_id = p.store_id and l.purchase_order_id = p.id)::int as received,
    (select coalesce(sum(l.quantity::bigint * l.unit_cost_minor), 0) from commerce.purchase_order_lines l where l.store_id = p.store_id and l.purchase_order_id = p.id) as total_minor,
    p.created_at
  from commerce.purchase_orders p
  join commerce.inventory_locations loc on loc.store_id = p.store_id and loc.id = p.location_id
  where p.store_id = ${storeId}::uuid
`;

export async function listPurchaseOrders(storeId: string, filter: { open?: boolean; limit?: number } = {}): Promise<PurchaseOrderSummary[]> {
  const rows = await typedRows(
    SUMMARY_ROW,
    sql`${summarySql(storeId)} ${filter.open ? sql`and p.status in ('draft', 'ordered')` : sql``} order by p.created_at desc limit ${Math.min(filter.limit ?? 100, 200)}`,
  );
  return rows.map(summaryOf);
}

export async function getPurchaseOrder(storeId: string, id: string): Promise<PurchaseOrderView | null> {
  const head = await typedRow(SUMMARY_ROW, sql`${summarySql(storeId)} and p.id = ${id}::uuid`);
  if (!head) return null;
  const items = await typedRows(
    z.object({ variant_id: col.uuid, sku: col.text, title: col.text, quantity: col.int, received: col.int, unit_cost_minor: col.minor }),
    sql`
      select l.variant_id, v.sku, coalesce(pt.title, v.sku) as title, l.quantity, l.received, l.unit_cost_minor
      from commerce.purchase_order_lines l
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      left join lateral (
        select t.title from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1
      ) pt on true
      where l.store_id = ${storeId}::uuid and l.purchase_order_id = ${id}::uuid
      order by v.sku
    `,
  );
  return {
    ...summaryOf(head),
    locationId: head.location_id,
    note: head.note,
    items: items.map((i) => ({ variantId: i.variant_id, sku: i.sku, title: i.title, quantity: i.quantity, received: i.received, unitCostMinor: i.unit_cost_minor })),
  };
}

/** A variant's cost changes, newest first: each in the main currency, with the purchase order and its own figure where one set it. */
export async function costHistory(storeId: string, variantId: string, limit = 20) {
  return typedRows(
    z.object({
      cost_minor: col.minorOrNull,
      source: col.text,
      purchase_order_id: col.uuid.nullable(),
      source_currency: col.textOrNull,
      source_cost_minor: col.minorOrNull,
      created_at: col.timestamp,
    }),
    sql`
      select cost_minor, source, purchase_order_id, trim(source_currency) as source_currency, source_cost_minor, created_at
      from commerce.variant_cost_history where store_id = ${storeId}::uuid and variant_id = ${variantId}::uuid
      order by id desc limit ${Math.min(limit, 100)}
    `,
  );
}
