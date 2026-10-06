import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { ORDER_AUDIT_ACTIONS, ORDER_OPS_EVENTS } from "@/lib/order-ops-events";
import { TAG_SUGGESTIONS } from "@/lib/order-limits";
import { tagChange, tagChangeNote, type Tag, type TagChange } from "@/lib/order-tags";

import { audit } from "./auth";
import { writeOrderEvent, type OrderActor } from "./order-actor";
import { textList, uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * An order's tags (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.3 and 4.2). The only writer of `commerce.order_tags` (a scan test holds it). Every statement
 * names the store. A change to one order is one transaction that locks the order row first (two staff, a bulk run and the AI manager cannot interleave on one
 * order), reads the tags it has, works the change out with `tagChange()` (pure: the same arithmetic the screens show), writes the rows and ONE history event,
 * `order.tags_changed`, whose `data.note` says it in words and nothing else (so the erasure of D162 covers it). Copied history (D129) takes tags like any order:
 * the copied-order guards are not installed on `order_tags`, and the guard on the order's history lets this event through.
 */

export type TagChangeResult =
  | { ok: true; change: TagChange; tags: Tag[] }
  | { ok: false; problem: "not_found" };

const tagOf = (row: Row): Tag => ({ key: String(row.key), label: String(row.label) });

/** An order's tags, oldest first. Empty for an order that is not this store's. */
export async function getOrderTags(storeId: string, orderId: string, runner: Pick<Db, "execute"> = db()): Promise<Tag[]> {
  const rows = await runner.execute<Row>(sql`
    select key, label from commerce.order_tags
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
    order by created_at, key
  `);
  return rows.map(tagOf);
}

/** The tags of several orders at once (the list's column), by order id; an order with none is absent. */
export async function tagsForOrders(storeId: string, orderIds: readonly string[], runner: Pick<Db, "execute"> = db()): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>();
  if (orderIds.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select order_id, key, label from commerce.order_tags
    where store_id = ${storeId}::uuid and order_id = any(${uuidList(orderIds)})
    order by order_id, label, key
  `);
  for (const row of rows) {
    const id = String(row.order_id);
    out.set(id, [...(out.get(id) ?? []), tagOf(row)]);
  }
  return out;
}

export type TagSuggestion = { key: string; label: string; orders: number };

/** The store's tags in use with how many orders each is on (the filter and the type-ahead): the most used first, at most `limit`. */
export async function tagSuggestions(storeId: string, limit = TAG_SUGGESTIONS): Promise<TagSuggestion[]> {
  const rows = await db().execute<Row>(sql`select key, label, orders from commerce.order_tag_counts(${storeId}::uuid, ${limit})`);
  return rows.map((row) => ({ key: String(row.key), label: String(row.label), orders: Number(row.orders) }));
}

/** The check violation the trigger raises when an order has 250 tags (a writer that got past the count under the order lock cannot, but the backstop is read). */
const isLimitViolation = (error: unknown): boolean => error instanceof Error && /order_tags\.limit/.test(`${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}`);

/**
 * Adds and removes tags on one order. Idempotent: adding a tag the order has and removing one it does not are not errors (the result says which). An add beyond 250 is
 * refused for that tag (`change.refused`) and does not stop the others. Nothing is written, and no event, when nothing changed.
 */
export async function changeOrderTags(
  storeId: string,
  orderId: string,
  change: { add?: readonly Tag[]; remove?: readonly Tag[] },
  actor: OrderActor,
  options: { runner?: Db; audit?: boolean } = {},
): Promise<TagChangeResult> {
  const work = async (tx: Db): Promise<TagChangeResult> => {
    const [order] = await tx.execute<Row>(sql`
      select id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order) return { ok: false, problem: "not_found" };
    const current = await getOrderTags(storeId, orderId, tx);
    const result = tagChange(current, change);
    if (result.removed.length > 0) {
      await tx.execute(sql`
        delete from commerce.order_tags
        where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and key = any(${textList(result.removed.map((t) => t.key))}::text[])
      `);
    }
    for (const tag of result.added) {
      await tx.execute(sql`
        insert into commerce.order_tags (store_id, order_id, key, label, created_by)
        values (${storeId}::uuid, ${orderId}::uuid, ${tag.key}, ${tag.label}, ${actor.accountId}::uuid)
        on conflict (order_id, key) do nothing
      `);
    }
    if (result.changed) {
      await writeOrderEvent(tx, storeId, orderId, ORDER_OPS_EVENTS.tagsChanged, { note: tagChangeNote(result) }, actor.kind);
    }
    return { ok: true, change: result, tags: result.next };
  };
  let result: TagChangeResult;
  try {
    result = options.runner ? await work(options.runner) : await db().transaction(work);
  } catch (error) {
    // Two writers that both passed the count (the order lock makes this a backstop): the whole change is undone, and the order is reported full for the tags it could not take.
    if (!isLimitViolation(error)) throw error;
    const current = await getOrderTags(storeId, orderId);
    return { ok: true, change: { ...tagChange(current, {}), refused: [...(change.add ?? [])] }, tags: current };
  }
  if (result.ok && result.change.changed && options.audit !== false) {
    await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.tagsChanged, { added: result.change.added.length, removed: result.change.removed.length }, { target: { type: "order", id: orderId } });
  }
  return result;
}

/** Deletes the tags of orders whose person was erased and whose order is anonymised (D162): the daily clean-up's, application code (the SQL anonymising function holds no delete). Returns how many tags went. */
export async function pruneAnonymisedOrderTags(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.order_tags t
    using commerce.orders o
    where o.store_id = t.store_id and o.id = t.order_id and o.anonymised_at is not null
    returning t.order_id
  `);
  return rows.length;
}
