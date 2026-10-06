import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { AUTO_ARCHIVE_BATCH } from "@/lib/order-limits";
import { archiveBlock, autoArchiveCutoff, isAutoArchiveDays, UNARCHIVE_RETURN_NOTE, type ArchiveFacts, type ArchiveReason } from "@/lib/order-archive";
import { ORDER_AUDIT_ACTIONS, ORDER_OPS_EVENTS } from "@/lib/order-ops-events";

import { audit } from "./auth";
import { SYSTEM_ACTOR, writeOrderEvent, type OrderActor } from "./order-actor";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * Archiving (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.3 and 4.3): `orders.archived_at`, a visibility state and nothing else. It changes no amount, number, stock,
 * document or figure; `order_number_audit()` and `periodTotals()` read the same before and after. The only writer of `archived_at` (a scan test holds it; the store copy writes
 * copies unarchived). One rule decides whether an order may be archived: `archiveBlock()` (pure), asked by the single action, the bulk action and the automatic job. Copied
 * history (D129) can be archived: the database lets exactly this column and three event types through. Every function takes the store id.
 */

export type ArchiveRefusal = ArchiveReason | "not_found";
export type ArchiveResult = { ok: true; number: string } | { ok: false; reason: ArchiveRefusal; number: string | null };
export type UnarchiveResult = { ok: true; number: string; changed: boolean } | { ok: false; reason: "not_found" | "not_archived"; number: string | null };

/** What `archiveBlock()` needs of each order, read in one statement for a set of orders (the number comes with it, for the refusals). */
export async function archiveFactsFor(runner: Pick<Db, "execute">, storeId: string, orderIds: readonly string[]): Promise<Map<string, ArchiveFacts & { number: string }>> {
  const out = new Map<string, ArchiveFacts & { number: string }>();
  if (orderIds.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select o.id, o.number, o.status, o.copied_from is not null as copied, o.archived_at is not null as archived,
      exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured') as paid,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as physical,
      exists (select 1 from commerce.returns r where r.store_id = o.store_id and r.order_id = o.id and r.status not in ('closed', 'declined', 'cancelled')) as open_return
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(orderIds)})
  `);
  for (const row of rows) {
    out.set(String(row.id), {
      number: String(row.number),
      status: row.status as ArchiveFacts["status"],
      paid: Boolean(row.paid),
      physical: Boolean(row.physical),
      copied: Boolean(row.copied),
      archived: Boolean(row.archived),
      openReturn: Boolean(row.open_return),
    });
  }
  return out;
}

/** Archives one order inside a transaction the caller holds (the order row is locked first). Returns the refusal, or the order's number. */
async function archiveInTx(tx: Db, storeId: string, orderId: string, actor: OrderActor, note?: string): Promise<ArchiveResult> {
  const [locked] = await tx.execute<Row>(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update`);
  if (!locked) return { ok: false, reason: "not_found", number: null };
  const facts = (await archiveFactsFor(tx, storeId, [orderId])).get(orderId);
  if (!facts) return { ok: false, reason: "not_found", number: null };
  const blocked = archiveBlock(facts);
  if (blocked) return { ok: false, reason: blocked, number: facts.number };
  await tx.execute(sql`update commerce.orders set archived_at = now() where store_id = ${storeId}::uuid and id = ${orderId}::uuid and archived_at is null`);
  await writeOrderEvent(tx, storeId, orderId, ORDER_OPS_EVENTS.archived, note ? { note } : {}, actor.kind);
  return { ok: true, number: facts.number };
}

/** Archives one order (staff). The refusal is a code with the order's number; nothing is written for one. */
export async function archiveOrder(storeId: string, orderId: string, actor: OrderActor, options: { audit?: boolean } = {}): Promise<ArchiveResult> {
  const result = await db().transaction((tx) => archiveInTx(tx, storeId, orderId, actor));
  if (result.ok && options.audit !== false) await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.archived, {}, { target: { type: "order", id: orderId } });
  return result;
}

/**
 * Brings an archived order back into the list, inside the caller's transaction: a return or a confirmed withdrawal on an archived order starts work again (the
 * return code's one call, `UNARCHIVE_RETURN_NOTE`), and staff may unarchive any archived order. An order that is not archived is left as it is (`changed` false).
 */
export async function unarchiveInTx(tx: Db, storeId: string, orderId: string, actor: OrderActor, note?: string): Promise<UnarchiveResult> {
  const [row] = await tx.execute<Row>(sql`
    select number, archived_at is not null as archived from commerce.orders
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
  `);
  if (!row) return { ok: false, reason: "not_found", number: null };
  if (!row.archived) return { ok: true, number: String(row.number), changed: false };
  await tx.execute(sql`update commerce.orders set archived_at = null where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  await writeOrderEvent(tx, storeId, orderId, ORDER_OPS_EVENTS.unarchived, note ? { note } : {}, actor.kind);
  return { ok: true, number: String(row.number), changed: true };
}

/** Unarchives one order (staff); refuses an order that is not archived. */
export async function unarchiveOrder(storeId: string, orderId: string, actor: OrderActor, options: { audit?: boolean } = {}): Promise<UnarchiveResult> {
  const result = await db().transaction(async (tx) => {
    const done = await unarchiveInTx(tx, storeId, orderId, actor);
    if (done.ok && !done.changed) return { ok: false, reason: "not_archived", number: done.number } as const;
    return done;
  });
  if (result.ok && options.audit !== false) await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.unarchived, {}, { target: { type: "order", id: orderId } });
  return result;
}

/** A return or a confirmed withdrawal began: the order is back in the list. Runs inside the return's own transaction. */
export const unarchiveForReturn = (tx: Db, storeId: string, orderId: string) => unarchiveInTx(tx, storeId, orderId, SYSTEM_ACTOR, UNARCHIVE_RETURN_NOTE);

// ---------------------------------------------------------------------------------------------------------------------
// Automatic archiving
// ---------------------------------------------------------------------------------------------------------------------

export type AutoArchiveRun = { stores: number; archived: number };

/**
 * The five-minute job's automatic archiving (the owner's option, off by default): for each OPEN store with `auto_archive_days` set, up to 200 orders that
 * need no more work (`archiveBlock()`) and whose last event is older than that many days. Copied history is never archived automatically (the owner chose to see it).
 * Idempotent (an archived order is not a candidate), never throws (one store's failure does not stop the others), and writes one audit entry per store
 * and run that archived something (a count, never numbers). The candidate query excludes what `archiveBlock()` would refuse, so orders that need sending cannot crowd the batch out.
 */
export async function archiveFinishedOrders(now: Date = new Date(), options: { storeId?: string } = {}): Promise<AutoArchiveRun> {
  const stores = await db().execute<Row>(sql`
    select s.id, os.auto_archive_days
    from commerce.order_settings os
    join commerce.stores s on s.id = os.store_id
    where os.auto_archive_days is not null and commerce.store_is_active(s.id)
      ${options.storeId ? sql`and s.id = ${options.storeId}::uuid` : sql``}
  `);
  const run: AutoArchiveRun = { stores: 0, archived: 0 };
  for (const store of stores) {
    const days = Number(store.auto_archive_days);
    if (!isAutoArchiveDays(days)) continue;
    const storeId = String(store.id);
    try {
      const cutoff = autoArchiveCutoff(now, days).toISOString();
      const candidates = await db().execute<Row>(sql`
        select o.id from commerce.orders o
        where o.store_id = ${storeId}::uuid and o.archived_at is null and o.copied_from is null and o.placed_at < ${cutoff}::timestamptz
          and (o.status in ('fulfilled', 'closed')
               or (o.status = 'cancelled' and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured'))
               or (o.status = 'paid' and not exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical')))
          and not exists (select 1 from commerce.returns r where r.store_id = o.store_id and r.order_id = o.id and r.status not in ('closed', 'declined', 'cancelled'))
          and coalesce((select max(e.created_at) from commerce.order_events e where e.store_id = o.store_id and e.order_id = o.id), o.placed_at) < ${cutoff}::timestamptz
        order by o.placed_at
        limit ${AUTO_ARCHIVE_BATCH}
      `);
      let archived = 0;
      for (const candidate of candidates) {
        const result = await db().transaction((tx) => archiveInTx(tx, storeId, String(candidate.id), SYSTEM_ACTOR));
        if (result.ok) archived += 1;
      }
      if (archived > 0) {
        run.stores += 1;
        run.archived += archived;
        await audit(null, storeId, ORDER_AUDIT_ACTIONS.bulkArchived, { count: archived, automatic: true, days });
      }
    } catch (error) {
      console.error("[orders] automatic archiving failed for a store", storeId, error);
    }
  }
  return run;
}
