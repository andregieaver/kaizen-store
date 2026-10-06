import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { VIEWS_MAX } from "@/lib/order-limits";
import { ORDER_AUDIT_ACTIONS } from "@/lib/order-ops-events";
import { normaliseViewTitle, viewRecordOf, type OrderColumn, type OrderListParams, ORDER_COLUMNS } from "@/lib/order-list";

import { audit } from "./auth";
import type { OrderActor } from "./order-actor";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * Saved views of the order list (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.4): a name, the address's parameters and the columns, the store's own and shared by everyone
 * who can read orders; creating, renaming, updating, reordering and deleting need `orders:write` (the action layer asks; these functions take the store id on every statement and the
 * actor for the audit entry). At most 30 a store (a trigger), a title unique ignoring case (a unique index). The parameters are kept as the flat record of strings the one parser reads
 * again (`viewRecordOf()`), so what is stored can never mean more than the address could; the cursor, the view's own id and the columns are not among them (the columns are their own
 * field). The audit entries name the title and how many parameters it holds, never the search text (a saved search may name a person).
 */

export type StoredOrderView = {
  id: string;
  title: string;
  /** The stored record: flat strings, keys of the address only. */
  params: Record<string, string>;
  /** The visible columns, in the list's fixed order; null is the default set. */
  columns: OrderColumn[] | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ViewProblem = "title_empty" | "title_too_long" | "title_taken" | "limit" | "not_found";

/** What staff read for each refusal. */
export const VIEW_PROBLEM_TEXT: Record<ViewProblem, string> = {
  title_empty: "Give the view a name.",
  title_too_long: "A view's name is at most 40 characters.",
  title_taken: "A view with that name already exists.",
  limit: `A store has at most ${VIEWS_MAX} saved views. Delete one first.`,
  not_found: "That view no longer exists.",
};

export type ViewResult = { ok: true; view: StoredOrderView } | { ok: false; problem: ViewProblem };

const columnsOf = (value: unknown): OrderColumn[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const chosen = value.map(String);
  return ORDER_COLUMNS.filter((c) => chosen.includes(c));
};

const toView = (row: Row): StoredOrderView => ({
  id: String(row.id),
  title: String(row.title),
  params: (row.params ?? {}) as Record<string, string>,
  columns: columnsOf(row.columns),
  position: Number(row.position),
  createdAt: new Date(String(row.created_at)).toISOString(),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
});

/** The record a view stores for a list state: the parameters without the cursor, the view id and the columns. */
function recordFor(params: OrderListParams): Record<string, string> {
  const record = viewRecordOf({ ...params, cols: null });
  delete record.cols;
  return record;
}

/** The store's views in their order. */
export async function listOrderViews(storeId: string): Promise<StoredOrderView[]> {
  const rows = await db().execute<Row>(sql`
    select id, title, params, columns, position, created_at, updated_at from commerce.order_views
    where store_id = ${storeId}::uuid order by position, lower(title)
  `);
  return rows.map(toView);
}

/** One of the store's views by id; null for an id that is not this store's (a view of another store is never found). */
export async function getOrderView(storeId: string, viewId: string): Promise<StoredOrderView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(viewId)) return null;
  const [row] = await db().execute<Row>(sql`
    select id, title, params, columns, position, created_at, updated_at from commerce.order_views
    where store_id = ${storeId}::uuid and id = ${viewId}::uuid
  `);
  return row ? toView(row) : null;
}

/** Which refusal a database error is: a taken title (the unique index) or the limit (the trigger). Anything else is not ours to hide. */
function problemOf(error: unknown): ViewProblem | null {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string; code?: string } }).cause?.message ?? ""} ${(error as { cause?: { code?: string } }).cause?.code ?? ""}` : "";
  if (/order_views_title_key|23505/.test(text)) return "title_taken";
  if (/order_views\.limit/.test(text)) return "limit";
  return null;
}

/** Saves the list state under a name. */
export async function saveOrderView(storeId: string, actor: OrderActor, input: { title: string; params: OrderListParams }): Promise<ViewResult> {
  const title = normaliseViewTitle(input.title);
  if (!title.ok) return { ok: false, problem: title.problem === "empty" ? "title_empty" : "title_too_long" };
  const record = recordFor(input.params);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.order_views (store_id, title, params, columns, position, created_by)
      values (${storeId}::uuid, ${title.title}, ${JSON.stringify(record)}::jsonb, ${input.params.cols && input.params.cols.length > 0 ? sql`${`{${input.params.cols.join(",")}}`}::text[]` : sql`null`},
        coalesce((select max(position) + 1 from commerce.order_views where store_id = ${storeId}::uuid), 0), ${actor.accountId}::uuid)
      returning id, title, params, columns, position, created_at, updated_at
    `);
    await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.viewSaved, { title: title.title, parameters: Object.keys(record).length }, { target: { type: "order_view", id: String(row.id) } });
    return { ok: true, view: toView(row) };
  } catch (error) {
    const problem = problemOf(error);
    if (problem) return { ok: false, problem };
    throw error;
  }
}

/** Renames a view, and/or replaces its parameters and columns with a list state ("Update view"). Only what is given changes. */
export async function updateOrderView(
  storeId: string,
  actor: OrderActor,
  viewId: string,
  input: { title?: string; params?: OrderListParams },
): Promise<ViewResult> {
  const existing = await getOrderView(storeId, viewId);
  if (!existing) return { ok: false, problem: "not_found" };
  let title = existing.title;
  if (input.title !== undefined) {
    const normalised = normaliseViewTitle(input.title);
    if (!normalised.ok) return { ok: false, problem: normalised.problem === "empty" ? "title_empty" : "title_too_long" };
    title = normalised.title;
  }
  const record = input.params ? recordFor(input.params) : existing.params;
  const columns = input.params ? (input.params.cols && input.params.cols.length > 0 ? input.params.cols : null) : existing.columns;
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.order_views set title = ${title}, params = ${JSON.stringify(record)}::jsonb,
        columns = ${columns ? sql`${`{${columns.join(",")}}`}::text[]` : sql`null`}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${viewId}::uuid
      returning id, title, params, columns, position, created_at, updated_at
    `);
    if (!row) return { ok: false, problem: "not_found" };
    await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.viewSaved, { title, parameters: Object.keys(record).length }, { target: { type: "order_view", id: viewId } });
    return { ok: true, view: toView(row) };
  } catch (error) {
    const problem = problemOf(error);
    if (problem) return { ok: false, problem };
    throw error;
  }
}

/** Deletes a view. A view of another store is not found. */
export async function deleteOrderView(storeId: string, actor: OrderActor, viewId: string): Promise<{ ok: true } | { ok: false; problem: "not_found" }> {
  const existing = await getOrderView(storeId, viewId);
  if (!existing) return { ok: false, problem: "not_found" };
  const rows = await db().execute<Row>(sql`delete from commerce.order_views where store_id = ${storeId}::uuid and id = ${viewId}::uuid returning id`);
  if (rows.length === 0) return { ok: false, problem: "not_found" };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.viewDeleted, { title: existing.title }, { target: { type: "order_view", id: viewId } });
  return { ok: true };
}

/** Puts the store's views in the given order (ids not named keep their relative order after those that are). Ids that are not this store's are ignored. */
export async function reorderOrderViews(storeId: string, ids: readonly string[]): Promise<StoredOrderView[]> {
  const current = await listOrderViews(storeId);
  const known = new Set(current.map((v) => v.id));
  const named = [...new Set(ids)].filter((id) => known.has(id));
  const ordered = [...named, ...current.map((v) => v.id).filter((id) => !named.includes(id))];
  if (ordered.length > 0) {
    await db().execute(sql`
      update commerce.order_views v set position = o.ord - 1, updated_at = now()
      from unnest(${uuidList(ordered)}) with ordinality as o(id, ord)
      where v.store_id = ${storeId}::uuid and v.id = o.id
    `);
  }
  return listOrderViews(storeId);
}
