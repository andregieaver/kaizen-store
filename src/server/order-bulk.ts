import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  bulkMaxFor,
  checkBulkRequest,
  dedupeIds,
  isBulkAction,
  markSentBlock,
  type BulkReason,
  type BulkRefusal,
  type BulkRequest,
  type BulkRequestProblem,
  type BulkResult,
  type MarkSentFacts,
} from "@/lib/order-bulk";
import { ORDER_AUDIT_ACTIONS } from "@/lib/order-ops-events";
import { tagsOf } from "@/lib/order-tags";

import { audit } from "./auth";
import { archiveOrder, unarchiveOrder } from "./order-archive";
import { fulfilmentOf } from "./fulfilment";
import { markSent } from "./order-admin";
import { loadOrderListContext, selectAllMatching } from "./order-list";
import { type OrderActor } from "./order-actor";
import { changeOrderTags } from "./order-tags";
import { packingSlipData } from "./packing-slips";
import { pickListData } from "./pick-list";
import { sendShipped } from "./shopper-emails";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * Bulk actions on orders (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.5): add and remove tags, archive, unarchive, mark as sent, print packing slips. A request names at most 250
 * orders (100 to print); duplicates collapse; "all matching" is the list's own query run again here (`selectAllMatching()`), never a list from the browser. Each order is handled
 * in its OWN transaction, one after another, so a refusal or a failure on one never undoes the others; the answer is `{ requested, applied, refused: [{ id, number, reason }] }`. An id that is
 * not this store's is `not_found` and nothing about it is revealed (no number). A request that cannot be run at all (an unknown action, nothing chosen, too many, an invalid tag) is refused
 * before anything runs. One audit entry per batch with counts, never the order numbers or the tags; each order's own history gets its own event from the function that did the work.
 * The batch never charges a card and never refunds. *Mark as sent* needs an open store and tells the customers only when asked (`notify`, off by default).
 */

export type BulkOutcome = { ok: true; result: BulkResult } | { ok: false; problem: BulkRequestProblem };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What `markSentBlock()` needs of each order, read in two statements: the orders, and their lines with what is left to send (`fulfilmentOf()`, D174). A partly sent
 * order is sendable (its remainder goes as one parcel); its backordered units count only while they are still to send; a change waiting for payment refuses it.
 */
async function markSentFactsFor(storeId: string, ids: readonly string[]): Promise<Map<string, MarkSentFacts & { number: string }>> {
  const out = new Map<string, MarkSentFacts & { number: string }>();
  if (ids.length === 0) return out;
  const [rows, fulfilment] = await Promise.all([
    db().execute<Row>(sql`
      select o.id, o.number, o.status, o.copied_from is not null as copied,
        exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured') as paid,
        exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as physical,
        exists (select 1 from commerce.standing_deliveries sd where sd.store_id = o.store_id and sd.order_id = o.id) as weekly_box
      from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(ids)})
    `),
    fulfilmentOf(db(), storeId, ids),
  ]);
  for (const row of rows) {
    const state = fulfilment.get(String(row.id));
    const id = String(row.id);
    const status = row.status as MarkSentFacts["status"];
    const box = Boolean(row.weekly_box);
    // A weekly box (D102) waits for its charge while the order is pending payment: it is the *box* that is not paid, not an unfinished checkout, so the reason says so.
    const waitingForCharge = box && status === "pending_payment";
    const physical = Boolean(row.physical);
    out.set(id, {
      number: String(row.number),
      status: waitingForCharge ? "paid" : status,
      paid: Boolean(row.paid),
      physical,
      copied: Boolean(row.copied),
      withdrawnInFull: physical && (status === "paid" || waitingForCharge) ? state?.state === "withdrawn" : false,
      // Owed units still to send (D172, 4.7): a backordered unit already in a parcel is not waited for.
      backorderUnits: status === "paid" ? (state?.lines ?? []).reduce((sum, l) => sum + Math.min(l.backordered, l.toSend), 0) : 0,
      deliveryUnpaid: waitingForCharge,
      editPending: Boolean(state?.editPending),
    });
  }
  return out;
}

const refusal = (id: string, number: string | null, reason: BulkReason): BulkRefusal => ({ id, number, reason });

async function isOpen(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) as open`);
  return Boolean(row?.open);
}

/** Runs a bulk request for one store. Permission (`orders:write`, `orders:read` for printing) is the caller's; every statement here names the store. */
export async function runBulk(storeId: string, actor: OrderActor, request: BulkRequest): Promise<BulkOutcome> {
  if (!isBulkAction(request.action)) return { ok: false, problem: "unknown_action" };
  const action = request.action;

  // The tags are checked once, before anything runs: a tag that is invalid would be refused for every order.
  const parsedTags = request.tags ? tagsOf(request.tags) : null;
  const early = checkBulkRequest({
    action,
    ids: request.selection.kind === "ids" ? request.selection.ids : undefined,
    tags: parsedTags ? [...parsedTags.tags, ...parsedTags.problems] : request.tags,
    invalidTags: parsedTags?.problems.length ?? 0,
  });
  if (early) return { ok: false, problem: early };

  let ids: string[];
  if (request.selection.kind === "ids") {
    ids = dedupeIds(request.selection.ids);
  } else {
    const context = await loadOrderListContext(storeId);
    const matching = await selectAllMatching(storeId, request.selection.params, context, bulkMaxFor(action));
    if (matching.over) return { ok: false, problem: "too_many" };
    ids = matching.ids;
    if (ids.length === 0) return { ok: false, problem: "empty" };
  }

  const refused: BulkRefusal[] = [];
  let applied = 0;
  let emailed: number | undefined;

  // Which of the ids are this store's, with their numbers: anything else is `not_found`, and nothing about it is told.
  const known = new Map<string, string>();
  const valid = ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase());
  if (valid.length > 0) {
    const rows = await db().execute<Row>(sql`select id, number from commerce.orders where store_id = ${storeId}::uuid and id = any(${uuidList(valid)})`);
    for (const row of rows) known.set(String(row.id), String(row.number));
  }
  const mine: string[] = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    if (known.has(key)) mine.push(key);
    else refused.push(refusal(id, null, "not_found"));
  }

  if (action === "print_pick_list") {
    // The pick list is printed by its own page (`/orders/pick-list?ids=`); here it is counted as the slips are: the orders on it, and why any is not.
    const list = mine.length > 0 ? await pickListData(storeId, mine) : null;
    if (list && !list.ok) return { ok: false, problem: list.problem };
    applied = list?.list.orderCount ?? 0;
    for (const skip of list?.list.skipped ?? []) {
      refused.push(refusal(skip.orderId, skip.number, skip.reason));
    }
  } else if (action === "print_slips") {
    // Nothing of this store's was named: the answer is the refusals (a print of nothing is not a request problem).
    const set = mine.length > 0 ? await packingSlipData(storeId, mine) : null;
    if (set && !set.ok) return { ok: false, problem: set.problem };
    applied = set?.slips.length ?? 0;
    refused.push(...(set?.skipped ?? []));
  } else if (action === "mark_sent") {
    emailed = 0;
    const open = await isOpen(storeId);
    const facts = open ? await markSentFactsFor(storeId, mine) : new Map<string, MarkSentFacts & { number: string }>();
    for (const id of mine) {
      const number = known.get(id) ?? null;
      if (!open) {
        refused.push(refusal(id, number, "store_closed"));
        continue;
      }
      try {
        const f = facts.get(id);
        const block = f ? markSentBlock(f) : "not_found";
        if (block) {
          refused.push(refusal(id, number, block));
          continue;
        }
        // Everything still to send, as one parcel (a partly sent order's remainder).
        const sent = await markSent(storeId, id, { carrier: "other", trackingNumber: "", trackingUrl: null }, actor.accountId);
        if (!sent.ok) {
          // It moved while the batch ran (cancelled, sent by someone else, withdrawn in full, a change waiting for payment).
          const moved: Record<string, BulkReason> = { edit_pending: "edit_pending", withdrawn_in_full: "withdrawn_in_full", nothing_to_send: "nothing_to_send", copied: "copied", not_found: "not_found" };
          refused.push(refusal(id, number, moved[sent.reason] ?? "changed"));
          continue;
        }
        applied += 1;
        if (request.notify) {
          const outcome = await sendShipped(storeId, id, sent.shipment).catch(() => null);
          if (outcome === "sent" || outcome === "logged") emailed += 1;
        }
      } catch (error) {
        console.error("[orders] bulk mark as sent failed for an order", id, error);
        refused.push(refusal(id, number, "failed"));
      }
    }
  } else {
    for (const id of mine) {
      const number = known.get(id) ?? null;
      try {
        if (action === "add_tags" || action === "remove_tags") {
          const tags = parsedTags?.tags ?? [];
          const done = await changeOrderTags(storeId, id, action === "add_tags" ? { add: tags } : { remove: tags }, actor, { audit: false });
          if (!done.ok) refused.push(refusal(id, number, "not_found"));
          else if (done.change.refused.length > 0) refused.push(refusal(id, number, "tag_limit"));
          else applied += 1;
        } else if (action === "archive") {
          const done = await archiveOrder(storeId, id, actor, { audit: false });
          if (done.ok) applied += 1;
          else refused.push(refusal(id, done.number ?? number, done.reason));
        } else {
          const done = await unarchiveOrder(storeId, id, actor, { audit: false });
          if (done.ok) applied += 1;
          else refused.push(refusal(id, done.number ?? number, done.reason));
        }
      } catch (error) {
        console.error("[orders] bulk action failed for an order", action, id, error);
        refused.push(refusal(id, number, "failed"));
      }
    }
  }

  const result: BulkResult = { action, requested: ids.length, applied, refused, ...(emailed !== undefined ? { emailed } : {}) };
  // One entry for the batch, with counts only: never the order numbers, never the tags.
  const auditAction =
    action === "add_tags" || action === "remove_tags"
      ? ORDER_AUDIT_ACTIONS.bulkTagged
      : action === "archive"
        ? ORDER_AUDIT_ACTIONS.bulkArchived
        : action === "unarchive"
          ? ORDER_AUDIT_ACTIONS.bulkUnarchived
          : action === "mark_sent"
            ? ORDER_AUDIT_ACTIONS.bulkSent
            : null;
  if (auditAction) {
    await audit(actor.accountId, storeId, auditAction, {
      action,
      requested: result.requested,
      applied: result.applied,
      refused: result.refused.length,
      ...(emailed !== undefined ? { emailed } : {}),
      ...(parsedTags ? { tags: parsedTags.tags.length } : {}),
    });
  }
  return { ok: true, result };
}
