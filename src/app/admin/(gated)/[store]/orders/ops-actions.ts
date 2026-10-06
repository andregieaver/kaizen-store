"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ARCHIVE_REASON_TEXT } from "@/lib/order-archive";
import { parseTagList, tagKey, TAG_CHANGE_TEXT, TAG_PROBLEM_TEXT, type Tag } from "@/lib/order-tags";
import { checkPermission } from "@/server/permissions";
import { staffActor } from "@/server/order-actor";
import { archiveOrder, unarchiveOrder } from "@/server/order-archive";
import { changeOrderTags } from "@/server/order-tags";

/** What the tags card and the archive button read back. */
export type TagsActionState = { ok: boolean; message: string | null; tags: Tag[] | null };
export type ArchiveActionState = { ok: boolean; message: string | null; archived: boolean | null };

const NO_ACCESS = "You do not have access to do this.";
const GONE = "This order no longer exists.";

/**
 * Adds tags to an order (typed, separated by commas) or removes one (wave 3, D173, `docs/wave-3-orders.md` 2.3). Copied history (D129) is taggable like any order: this is
 * not `orderFor()` of the other order actions, which refuse it. Adding a tag the order has and removing one it does not are not errors. `orders:write`.
 */
export async function changeTagsAction(storeSlug: string, orderId: string, change: { add?: string; remove?: string }): Promise<TagsActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS, tags: null };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: GONE, tags: null };

  const add = typeof change.add === "string" ? parseTagList(change.add) : null;
  if (add && add.problems.length > 0) return { ok: false, message: `“${add.problems[0].input}”: ${TAG_PROBLEM_TEXT[add.problems[0].problem]}`, tags: null };
  const key = typeof change.remove === "string" ? tagKey(change.remove) : null;
  if (!add?.tags.length && !key) return { ok: false, message: "Write a tag first.", tags: null };

  const done = await changeOrderTags(
    member.store.id,
    orderId,
    { add: add?.tags, remove: key ? [{ key, label: change.remove as string }] : undefined },
    staffActor(member.account.id),
  );
  if (!done.ok) return { ok: false, message: GONE, tags: null };
  refresh();
  const { change: result } = done;
  const notes: string[] = [];
  if (result.added.length > 0) notes.push(`Added ${result.added.map((t) => t.label).join(", ")}.`);
  if (result.removed.length > 0) notes.push(`Removed ${result.removed.map((t) => t.label).join(", ")}.`);
  if (result.alreadyHad.length > 0) notes.push(`The order ${TAG_CHANGE_TEXT.alreadyHad} ${result.alreadyHad.map((t) => t.label).join(", ")}.`);
  if (result.refused.length > 0) notes.push(`The order ${TAG_CHANGE_TEXT.limit}, so ${result.refused.map((t) => t.label).join(", ")} was not added.`);
  return { ok: result.refused.length === 0, message: notes.join(" ") || null, tags: done.tags };
}

/** Archives an order: out of the default list and every queue but Archived, nothing else changes. Refused, with the reason in words, for an order that still needs work. `orders:write`. */
export async function archiveOrderAction(storeSlug: string, orderId: string): Promise<ArchiveActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS, archived: null };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: GONE, archived: null };
  const done = await archiveOrder(member.store.id, orderId, staffActor(member.account.id));
  if (!done.ok) return { ok: false, message: done.reason === "not_found" ? GONE : ARCHIVE_REASON_TEXT[done.reason], archived: done.reason === "already_archived" ? true : null };
  refresh();
  return { ok: true, message: "Archived.", archived: true };
}

/** Puts an archived order back in the list. `orders:write`. */
export async function unarchiveOrderAction(storeSlug: string, orderId: string): Promise<ArchiveActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS, archived: null };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: GONE, archived: null };
  const done = await unarchiveOrder(member.store.id, orderId, staffActor(member.account.id));
  if (!done.ok) return { ok: false, message: done.reason === "not_found" ? GONE : "It is not archived.", archived: done.reason === "not_archived" ? false : null };
  refresh();
  return { ok: true, message: "Unarchived.", archived: false };
}
