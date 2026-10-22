"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { parseTagList, tagKey, type Tag } from "@/lib/order-tags";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { staffActor } from "@/server/order-actor";
import { archiveOrder, unarchiveOrder } from "@/server/order-archive";
import { changeOrderTags } from "@/server/order-tags";

/** What the tags card and the archive button read back. */
export type TagsActionState = { ok: boolean; message: string | null; tags: Tag[] | null };
export type ArchiveActionState = { ok: boolean; message: string | null; archived: boolean | null };

/** The tags' and archive's words in the account's language (D312 A4); without a member, the request's. */
const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "orders");
const noAccess = async () => adminText(await actionAdminLang(), "orders").saved.noAccess;

/**
 * Adds tags to an order (typed, separated by commas) or removes one (wave 3, D173, `docs/wave-3-orders.md` 2.3). Copied history (D129) is taggable like any order: this is
 * not `orderFor()` of the other order actions, which refuse it. Adding a tag the order has and removing one it does not are not errors. `orders:write`.
 */
export async function changeTagsAction(storeSlug: string, orderId: string, change: { add?: string; remove?: string }): Promise<TagsActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess(), tags: null };
  const w = wordsOf(member).ops;
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: w.gone, tags: null };

  const add = typeof change.add === "string" ? parseTagList(change.add) : null;
  if (add && add.problems.length > 0) return { ok: false, message: `“${add.problems[0].input}”: ${w.tagProblems[add.problems[0].problem]}`, tags: null };
  const key = typeof change.remove === "string" ? tagKey(change.remove) : null;
  if (!add?.tags.length && !key) return { ok: false, message: w.writeTag, tags: null };

  const done = await changeOrderTags(
    member.store.id,
    orderId,
    { add: add?.tags, remove: key ? [{ key, label: change.remove as string }] : undefined },
    staffActor(member.account.id),
  );
  if (!done.ok) return { ok: false, message: w.gone, tags: null };
  refresh();
  const { change: result } = done;
  const notes: string[] = [];
  const labels = (tags: { label: string }[]) => tags.map((t) => t.label).join(", ");
  if (result.added.length > 0) notes.push(fillWords(w.added, { tags: labels(result.added) }));
  if (result.removed.length > 0) notes.push(fillWords(w.removed, { tags: labels(result.removed) }));
  if (result.alreadyHad.length > 0) notes.push(fillWords(w.alreadyHad, { already: w.tagChange.alreadyHad, tags: labels(result.alreadyHad) }));
  if (result.refused.length > 0) notes.push(fillWords(w.refused, { limit: w.tagChange.limit, tags: labels(result.refused) }));
  return { ok: result.refused.length === 0, message: notes.join(" ") || null, tags: done.tags };
}

/** Archives an order: out of the default list and every queue but Archived, nothing else changes. Refused, with the reason in words, for an order that still needs work. `orders:write`. */
export async function archiveOrderAction(storeSlug: string, orderId: string): Promise<ArchiveActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess(), archived: null };
  const w = wordsOf(member).ops;
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: w.gone, archived: null };
  const done = await archiveOrder(member.store.id, orderId, staffActor(member.account.id));
  if (!done.ok) return { ok: false, message: done.reason === "not_found" ? w.gone : w.archiveReasons[done.reason], archived: done.reason === "already_archived" ? true : null };
  refresh();
  return { ok: true, message: w.archived, archived: true };
}

/** Puts an archived order back in the list. `orders:write`. */
export async function unarchiveOrderAction(storeSlug: string, orderId: string): Promise<ArchiveActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess(), archived: null };
  const w = wordsOf(member).ops;
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: w.gone, archived: null };
  const done = await unarchiveOrder(member.store.id, orderId, staffActor(member.account.id));
  if (!done.ok) return { ok: false, message: done.reason === "not_found" ? w.gone : w.notArchived, archived: done.reason === "not_archived" ? false : null };
  refresh();
  return { ok: true, message: w.unarchived, archived: false };
}
