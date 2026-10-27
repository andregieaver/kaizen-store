"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { contentProblem } from "@/lib/content-admin";
import { moneyCurrencies } from "@/lib/field-money";
import { deleteEntry, moveEntry, publishEntry, saveEntry, unpublishEntry, type EntryContext } from "@/server/content-entries";
import { contentTag, deleteContentType, saveContentType } from "@/server/content-types";
import type { Membership } from "@/server/auth";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import type { SaveResult } from "@/server/settings";

/** A writer's answer with its refusals in the member's admin language (D312). */
function inWords<T extends SaveResult>(member: Membership, result: T): T {
  if (result.ok) return result;
  const words = adminText(adminLangOf(member.account.adminLocale), "content").problems;
  return { ...result, problems: result.problems.map((problem) => contentProblem(problem, words)) };
}

const actorOf = (member: Membership) => ({ accountId: member.account.id, owner: member.store.id });

/** What an entry is written in: the store's languages (its main one first) and the currencies its money fields may use (D120). */
const entryContext = (member: Membership): EntryContext => ({
  ...actorOf(member),
  locales: member.store.localization.locales,
  main: member.store.localization.locales[0],
  currencies: moneyCurrencies(member.store),
});

/** Creates a content type (no id) or changes one (D326); the server checks all of it again. */
export async function saveContentTypeAction(storeSlug: string, input: unknown): Promise<SaveResult & { id?: string }> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await saveContentType(actorOf(member), input);
  if (result.ok) updateTag(contentTag(member.store.id));
  return inWords(member, result);
}

/** Deletes a content type and its entries, then goes back to Content. */
export async function deleteContentTypeAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await deleteContentType(actorOf(member), id);
  if (!result.ok) return inWords(member, result);
  updateTag(contentTag(member.store.id));
  redirect(`/admin/${member.store.slug}/content`);
}

/** Saves an entry's draft (a new entry when it has no id). */
export async function saveEntryAction(storeSlug: string, input: unknown): Promise<SaveResult & { id?: string }> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await saveEntry(entryContext(member), input);
  if (result.ok) updateTag(contentTag(member.store.id));
  return inWords(member, result);
}

/** Publishes an entry's draft. */
export async function publishEntryAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await publishEntry(entryContext(member), id);
  if (result.ok) updateTag(contentTag(member.store.id));
  return inWords(member, result);
}

/** Takes an entry off the site. */
export async function unpublishEntryAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await unpublishEntry(actorOf(member), id);
  if (result.ok) updateTag(contentTag(member.store.id));
  return inWords(member, result);
}

/** Deletes an entry, then goes back to its type's entries. */
export async function deleteEntryAction(storeSlug: string, typeId: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await deleteEntry(actorOf(member), id);
  if (!result.ok) return inWords(member, result);
  updateTag(contentTag(member.store.id));
  redirect(`/admin/${member.store.slug}/content/${typeId}`);
}

/** Moves an entry one place earlier or later in its type's order. */
export async function moveEntryAction(storeSlug: string, id: string, direction: "earlier" | "later"): Promise<void> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return;
  const result = await moveEntry(actorOf(member), id, direction === "earlier" ? "earlier" : "later");
  if (result.ok) {
    updateTag(contentTag(member.store.id));
    refresh();
  }
}
