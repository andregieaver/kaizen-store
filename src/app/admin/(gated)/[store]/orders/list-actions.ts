"use server";

import { refresh } from "next/cache";

import { BULK_REQUEST_TEXT, isBulkAction, type BulkAction, type BulkResult } from "@/lib/order-bulk";
import { normaliseViewTitle, VIEW_TITLE_PROBLEM_TEXT } from "@/lib/order-list";
import { checkPermission } from "@/server/permissions";
import { runBulk } from "@/server/order-bulk";
import { resolveOrderList } from "@/server/order-list";
import { staffActor } from "@/server/order-actor";
import { deleteOrderView, reorderOrderViews, saveOrderView, updateOrderView, VIEW_PROBLEM_TEXT } from "@/server/order-views";

/** What a bulk action answers the table: the result to show, or one sentence for a request that could not be run at all. */
export type BulkActionResponse = { ok: true; result: BulkResult } | { ok: false; message: string };
export type ViewActionResponse = { ok: true; message: string } | { ok: false; message: string };

const NO_ACCESS = "You do not have access to do this.";

/**
 * A bulk action on ticked orders, or on every order the list's own query matches (wave 3, D173, `docs/wave-3-orders.md` 2.2.5). `orders:write`; printing is a link to the
 * packing slips page, not an action. "All matching" sends the list's QUERY, never ids: the server reads it through the one parser and runs the same statement again, so a
 * browser cannot name orders it was not shown. Each order is handled in its own transaction and every refusal is returned; the batch makes one audit entry with counts.
 */
export async function bulkOrdersAction(
  storeSlug: string,
  request: { action: string; ids?: string[]; matchingQuery?: string; tags?: string[]; notify?: boolean },
): Promise<BulkActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isBulkAction(request.action) || request.action === "print_slips") return { ok: false, message: BULK_REQUEST_TEXT.unknown_action };
  const action: BulkAction = request.action;
  const tags = Array.isArray(request.tags) ? request.tags.filter((t): t is string => typeof t === "string").slice(0, 200) : undefined;
  const actor = staffActor(member.account.id);

  let outcome;
  if (typeof request.matchingQuery === "string") {
    // The query is parsed again here, against this store's own markets and saved views.
    const resolved = await resolveOrderList(member.store.id, new URLSearchParams(request.matchingQuery.slice(0, 2000)));
    outcome = await runBulk(member.store.id, actor, { action, selection: { kind: "matching", params: { ...resolved.params, after: null } }, tags, notify: request.notify === true });
  } else {
    const ids = Array.isArray(request.ids) ? request.ids.filter((id): id is string => typeof id === "string").slice(0, 1000) : [];
    outcome = await runBulk(member.store.id, actor, { action, selection: { kind: "ids", ids }, tags, notify: request.notify === true });
  }
  refresh();
  return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, message: BULK_REQUEST_TEXT[outcome.problem] };
}

/**
 * Saves the list's current state as a view of the store, or replaces the state of one that exists. The state arrives as the list's query and is read by the one parser again;
 * what is kept is what the parser kept. Needs `orders:write` (anyone who can read orders may open a view).
 */
export async function saveOrderViewAction(storeSlug: string, request: { title: string; query: string; replaceId?: string | null }): Promise<ViewActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const resolved = await resolveOrderList(member.store.id, new URLSearchParams(String(request.query ?? "").slice(0, 2000)));
  const params = { ...resolved.params, after: null, view: null };
  const actor = staffActor(member.account.id);
  const saved = request.replaceId
    ? await updateOrderView(member.store.id, actor, request.replaceId, { title: String(request.title ?? "").trim() === "" ? undefined : request.title, params })
    : await saveOrderView(member.store.id, actor, { title: String(request.title ?? ""), params });
  if (!saved.ok) return { ok: false, message: VIEW_PROBLEM_TEXT[saved.problem] };
  refresh();
  return { ok: true, message: request.replaceId ? `Updated the view “${saved.view.title}”.` : `Saved the view “${saved.view.title}”.` };
}

/** Renames a saved view, and/or replaces its state with the list's current one. */
export async function updateOrderViewAction(storeSlug: string, viewId: string, request: { title?: string; query?: string }): Promise<ViewActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (request.title !== undefined) {
    const title = normaliseViewTitle(request.title);
    if (!title.ok) return { ok: false, message: VIEW_TITLE_PROBLEM_TEXT[title.problem] };
  }
  let params;
  if (typeof request.query === "string") {
    const resolved = await resolveOrderList(member.store.id, new URLSearchParams(request.query.slice(0, 2000)));
    params = { ...resolved.params, after: null, view: null };
  }
  const saved = await updateOrderView(member.store.id, staffActor(member.account.id), viewId, { title: request.title, params });
  if (!saved.ok) return { ok: false, message: VIEW_PROBLEM_TEXT[saved.problem] };
  refresh();
  return { ok: true, message: `Updated the view “${saved.view.title}”.` };
}

/** Deletes a saved view. */
export async function deleteOrderViewAction(storeSlug: string, viewId: string): Promise<ViewActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const done = await deleteOrderView(member.store.id, staffActor(member.account.id), viewId);
  if (!done.ok) return { ok: false, message: VIEW_PROBLEM_TEXT[done.problem] };
  refresh();
  return { ok: true, message: "Deleted the view." };
}

/** Puts the store's saved views in the given order. */
export async function reorderOrderViewsAction(storeSlug: string, ids: string[]): Promise<ViewActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  await reorderOrderViews(member.store.id, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 100) : []);
  refresh();
  return { ok: true, message: "Moved." };
}
