import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { allIn, documentState, receiptInput, receiptPlan, transferInput, type DocumentState, type TransferStatus } from "@/lib/stock-documents";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { withStockContext } from "./stock-context";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Stock moved between a store's locations (wave 11 unit D, D383), the only writer of `stock_transfers`, their lines and the stock they
 * move. A draft is made from SKUs and units; sending it takes each line's units off the origin (`transfer_out`, never what checkouts hold
 * there: a line short of free units refuses the whole send and names it), receiving puts what was counted in at the destination
 * (`transfer_in`, in parts, never more than was sent), and cancelling a sent transfer puts what was not received back at the origin. Every
 * movement names the transfer by `job_id`. Units on their way are shown at the destination as incoming and are never sold. `products:write`
 * to change, `products:read` to read; each change audited without a SKU list.
 */

export type DocumentResult = { ok: true; id: string } | { ok: false; problems: string[] };

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

const VARIANT_ROW = z.object({ id: col.uuid, sku: col.text });

/** The store's own shipped goods variants by SKU (case-insensitive); the SKUs it does not have are named. */
export async function variantsBySku(runner: Executor, storeId: string, skus: readonly string[]): Promise<{ found: Map<string, string>; missing: string[] }> {
  const keys = [...new Set(skus.map((s) => s.trim().toLowerCase()))];
  if (keys.length === 0) return { found: new Map(), missing: [] };
  const rows = await typedRows(
    VARIANT_ROW,
    sql`
      select v.id, lower(v.sku) as sku from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${storeId}::uuid and lower(v.sku) = any(${`{${keys.map((k) => `"${k.replace(/["\\]/g, "\\$&")}"`).join(",")}}`}::text[])
        and v.delivery = 'physical' and p.kind = 'goods'
    `,
    runner,
  );
  const found = new Map(rows.map((r) => [r.sku, r.id]));
  return { found, missing: skus.filter((s) => !found.has(s.trim().toLowerCase())) };
}

async function storeLocations(runner: Executor, storeId: string, ids: readonly string[]): Promise<Set<string>> {
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.inventory_locations where store_id = ${storeId}::uuid and active and id = any(${`{${ids.join(",")}}`}::uuid[])`,
    runner,
  );
  return new Set(rows.map((r) => r.id));
}

/** Makes a draft transfer: two of the store's active locations and its own goods by SKU. */
export async function createTransfer(member: Membership, raw: unknown): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = transferInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const input = parsed.data;
  const storeId = member.store.id;
  return db().transaction(async (tx): Promise<DocumentResult> => {
    const places = await storeLocations(tx, storeId, [input.origin, input.destination]);
    if (!places.has(input.origin) || !places.has(input.destination)) return { ok: false, problems: ["Choose two of the store's active locations."] };
    const { found, missing } = await variantsBySku(tx, storeId, input.lines.map((l) => l.sku));
    if (missing.length) return { ok: false, problems: [`No shipped goods with the SKU ${missing.join(", ")} in this store.`] };
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.stock_transfers (store_id, origin_id, destination_id, note, created_by)
      values (${storeId}::uuid, ${input.origin}::uuid, ${input.destination}::uuid, ${input.note}, ${member.account.id}::uuid)
      returning id
    `);
    for (const line of input.lines) {
      await tx.execute(sql`
        insert into commerce.stock_transfer_lines (store_id, transfer_id, variant_id, quantity)
        values (${storeId}::uuid, ${row.id}::uuid, ${found.get(line.sku.trim().toLowerCase())!}::uuid, ${line.quantity})
      `);
    }
    return { ok: true, id: String(row.id) };
  }).then(async (result) => {
    if (result.ok) await audit(member.account.id, storeId, "products.transfer_created", { lines: input.lines.length }, { area: "products", target: { type: "stock_transfer", id: result.id } });
    return result;
  });
}

const HEAD_ROW = z.object({ id: col.uuid, status: col.text, origin_id: col.uuid, destination_id: col.uuid });
const LINE_ROW = z.object({ variant_id: col.uuid, quantity: col.int, received: col.int, sku: col.text });

async function lockTransfer(tx: Executor, storeId: string, id: string) {
  const head = await typedRow(HEAD_ROW, sql`select id, status, origin_id, destination_id from commerce.stock_transfers where store_id = ${storeId}::uuid and id = ${id}::uuid for update`, tx);
  if (!head) return null;
  const lines = await typedRows(
    LINE_ROW,
    sql`
      select l.variant_id, l.quantity, l.received, v.sku from commerce.stock_transfer_lines l
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      where l.store_id = ${storeId}::uuid and l.transfer_id = ${id}::uuid order by l.variant_id
    `,
    tx,
  );
  return { ...head, lines };
}

/** Adds units to a level (a receipt, a return to the origin), the level made when the location had none. */
async function addUnits(tx: Executor, storeId: string, variantId: string, locationId: string, units: number) {
  await tx.execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
    values (${storeId}::uuid, ${variantId}::uuid, ${locationId}::uuid, ${units})
    on conflict (variant_id, location_id) do update set on_hand = commerce.inventory_levels.on_hand + excluded.on_hand, updated_at = now()
  `);
}

/**
 * Sends a draft: each line's units leave the origin, all or none. A line needs the units free there (on hand less what live checkouts hold);
 * one that is short refuses the send and says how many are free.
 */
export async function sendTransfer(member: Membership, id: string): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult> => {
    const transfer = await lockTransfer(tx, storeId, id);
    if (!transfer) return { ok: false, problems: ["This transfer is not in this store."] };
    if (transfer.status !== "draft") return { ok: false, problems: ["Only a draft is sent."] };
    // Levels are locked in (variant, location) order, the order every writer of a level takes.
    const free = await typedRows(
      z.object({ variant_id: col.uuid, on_hand: col.int, free: col.int }),
      sql`
        select l.variant_id, l.on_hand,
          l.on_hand - coalesce((select sum(r.quantity) from commerce.inventory_reservations r
            where r.store_id = l.store_id and r.variant_id = l.variant_id and r.location_id = l.location_id and r.released_at is null and r.expires_at > now()), 0)::int as free
        from commerce.inventory_levels l
        where l.store_id = ${storeId}::uuid and l.location_id = ${transfer.origin_id}::uuid
          and l.variant_id = any(${`{${transfer.lines.map((x) => x.variant_id).join(",")}}`}::uuid[])
        order by l.variant_id
        for update of l
      `,
      tx,
    );
    const freeOf = new Map(free.map((f) => [f.variant_id, Math.min(f.free, f.on_hand)]));
    const short = transfer.lines.filter((l) => (freeOf.get(l.variant_id) ?? 0) < l.quantity);
    if (short.length) return { ok: false, problems: short.map((l) => `${l.sku}: ${Math.max(0, freeOf.get(l.variant_id) ?? 0)} free at the origin, ${l.quantity} to send.`) };
    await withStockContext(tx, { reason: "transfer_out", source: "transfer", accountId: member.account.id, jobId: id }, async () => {
      for (const line of transfer.lines) {
        await tx.execute(sql`
          update commerce.inventory_levels set on_hand = on_hand - ${line.quantity}, updated_at = now()
          where store_id = ${storeId}::uuid and variant_id = ${line.variant_id}::uuid and location_id = ${transfer.origin_id}::uuid
        `);
      }
    });
    await tx.execute(sql`update commerce.stock_transfers set status = 'sent', sent_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return { ok: true, id };
  });
  if (result.ok) await finish(member, id, "products.transfer_sent", {});
  return result;
}

/** Counts units in at the destination, in parts; when every line is in the transfer is received. */
export async function receiveTransfer(member: Membership, id: string, raw: unknown): Promise<DocumentResult & { received?: number }> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = receiptInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult & { received?: number }> => {
    const transfer = await lockTransfer(tx, storeId, id);
    if (!transfer) return { ok: false, problems: ["This transfer is not in this store."] };
    if (transfer.status !== "sent") return { ok: false, problems: ["Only a sent transfer is received."] };
    const plan = receiptPlan(transfer.lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity, received: l.received })), parsed.data.lines);
    if (plan.length === 0) return { ok: false, problems: ["Count at least one unit in."] };
    await withStockContext(tx, { reason: "transfer_in", source: "transfer", accountId: member.account.id, jobId: id }, async () => {
      for (const take of [...plan].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        await addUnits(tx, storeId, take.variantId, transfer.destination_id, take.quantity);
        await tx.execute(sql`
          update commerce.stock_transfer_lines set received = received + ${take.quantity}
          where store_id = ${storeId}::uuid and transfer_id = ${id}::uuid and variant_id = ${take.variantId}::uuid
        `);
      }
    });
    const after = transfer.lines.map((l) => ({ quantity: l.quantity, received: l.received + (plan.find((p) => p.variantId === l.variant_id)?.quantity ?? 0) }));
    if (allIn(after)) await tx.execute(sql`update commerce.stock_transfers set status = 'received', received_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return { ok: true, id, received: plan.reduce((sum, p) => sum + p.quantity, 0) };
  });
  if (result.ok) await finish(member, id, "products.transfer_received", { units: result.received ?? 0 });
  return result;
}

/** Cancels a draft, or a sent transfer: what was sent and not received goes back to the origin. */
export async function cancelTransfer(member: Membership, id: string): Promise<DocumentResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const storeId = member.store.id;
  const result = await db().transaction(async (tx): Promise<DocumentResult> => {
    const transfer = await lockTransfer(tx, storeId, id);
    if (!transfer) return { ok: false, problems: ["This transfer is not in this store."] };
    if (transfer.status !== "draft" && transfer.status !== "sent") return { ok: false, problems: ["This transfer is already closed."] };
    if (transfer.status === "sent") {
      await withStockContext(tx, { reason: "transfer_in", source: "transfer", accountId: member.account.id, jobId: id, note: "Transfer cancelled: back at the origin" }, async () => {
        for (const line of transfer.lines) {
          const back = line.quantity - line.received;
          if (back > 0) await addUnits(tx, storeId, line.variant_id, transfer.origin_id, back);
        }
      });
    }
    await tx.execute(sql`update commerce.stock_transfers set status = 'cancelled', cancelled_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`);
    return { ok: true, id };
  });
  if (result.ok) await finish(member, id, "products.transfer_cancelled", {});
  return result;
}

async function finish(member: Membership, id: string, action: string, details: Record<string, unknown>) {
  await audit(member.account.id, member.store.id, action, details, { area: "products", target: { type: "stock_transfer", id } }).catch((error) =>
    log("warn", "stock_transfers.audit_failed", { storeId: member.store.id }, error),
  );
  refreshTag(catalogTag(member.store.id));
}

export type TransferSummary = {
  id: string;
  status: TransferStatus;
  state: DocumentState;
  origin: string;
  destination: string;
  lines: number;
  units: number;
  received: number;
  createdAt: string;
  sentAt: string | null;
};

export type TransferView = TransferSummary & {
  originId: string;
  destinationId: string;
  note: string | null;
  items: { variantId: string; sku: string; title: string; quantity: number; received: number }[];
};

const SUMMARY_ROW = z.object({
  id: col.uuid,
  status: col.text,
  origin: col.text,
  destination: col.text,
  origin_id: col.uuid,
  destination_id: col.uuid,
  note: col.text.nullable(),
  lines: col.int,
  units: col.int,
  received: col.int,
  created_at: col.timestamp,
  sent_at: col.timestamp.nullable(),
});

const summaryOf = (r: z.infer<typeof SUMMARY_ROW>): TransferSummary => ({
  id: r.id,
  status: r.status as TransferStatus,
  state: documentState(r.status as TransferStatus, r.units > 0 ? [{ quantity: r.units, received: r.received }] : []),
  origin: r.origin,
  destination: r.destination,
  lines: r.lines,
  units: r.units,
  received: r.received,
  createdAt: r.created_at,
  sentAt: r.sent_at,
});

const summarySql = (storeId: string) => sql`
  select t.id, t.status, o.name as origin, d.name as destination, t.origin_id, t.destination_id, t.note,
    (select count(*) from commerce.stock_transfer_lines l where l.store_id = t.store_id and l.transfer_id = t.id)::int as lines,
    (select coalesce(sum(l.quantity), 0) from commerce.stock_transfer_lines l where l.store_id = t.store_id and l.transfer_id = t.id)::int as units,
    (select coalesce(sum(l.received), 0) from commerce.stock_transfer_lines l where l.store_id = t.store_id and l.transfer_id = t.id)::int as received,
    t.created_at, t.sent_at
  from commerce.stock_transfers t
  join commerce.inventory_locations o on o.store_id = t.store_id and o.id = t.origin_id
  join commerce.inventory_locations d on d.store_id = t.store_id and d.id = t.destination_id
  where t.store_id = ${storeId}::uuid
`;

/** The store's transfers, newest first; the open ones (draft or on their way) first when `open` is asked. */
export async function listTransfers(storeId: string, filter: { open?: boolean; limit?: number } = {}): Promise<TransferSummary[]> {
  const rows = await typedRows(
    SUMMARY_ROW,
    sql`${summarySql(storeId)} ${filter.open ? sql`and t.status in ('draft', 'sent')` : sql``} order by t.created_at desc limit ${Math.min(filter.limit ?? 100, 200)}`,
  );
  return rows.map(summaryOf);
}

export async function getTransfer(storeId: string, id: string): Promise<TransferView | null> {
  const head = await typedRow(SUMMARY_ROW, sql`${summarySql(storeId)} and t.id = ${id}::uuid`);
  if (!head) return null;
  const items = await typedRows(
    z.object({ variant_id: col.uuid, sku: col.text, title: col.text, quantity: col.int, received: col.int }),
    sql`
      select l.variant_id, v.sku, coalesce(pt.title, v.sku) as title, l.quantity, l.received
      from commerce.stock_transfer_lines l
      join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
      left join lateral (
        select t.title from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1
      ) pt on true
      where l.store_id = ${storeId}::uuid and l.transfer_id = ${id}::uuid
      order by v.sku
    `,
  );
  return {
    ...summaryOf(head),
    originId: head.origin_id,
    destinationId: head.destination_id,
    note: head.note,
    items: items.map((i) => ({ variantId: i.variant_id, sku: i.sku, title: i.title, quantity: i.quantity, received: i.received })),
  };
}

/** Units on their way to each location, per variant: sent transfers and ordered purchase orders not yet received. Never sold. */
export async function incomingStock(storeId: string): Promise<Map<string, number>> {
  const rows = await typedRows(
    z.object({ variant_id: col.uuid, location_id: col.uuid, units: col.int }),
    sql`
      select variant_id, location_id, sum(units)::int as units from (
        select l.variant_id, t.destination_id as location_id, l.quantity - l.received as units
        from commerce.stock_transfer_lines l join commerce.stock_transfers t on t.store_id = l.store_id and t.id = l.transfer_id
        where l.store_id = ${storeId}::uuid and t.status = 'sent'
        union all
        select l.variant_id, p.location_id, l.quantity - l.received
        from commerce.purchase_order_lines l join commerce.purchase_orders p on p.store_id = l.store_id and p.id = l.purchase_order_id
        where l.store_id = ${storeId}::uuid and p.status = 'ordered'
      ) x where units > 0
      group by variant_id, location_id
    `,
  );
  return new Map(rows.map((r) => [`${r.variant_id}:${r.location_id}`, r.units]));
}
