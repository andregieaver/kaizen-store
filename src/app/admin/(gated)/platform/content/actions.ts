"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { contentProblem } from "@/lib/content-admin";
import { PLATFORM_PAGE_LOCALES } from "@/lib/platform-lang";
import { requirePlatformAdmin, type Account } from "@/server/auth";
import { deleteEntry, moveEntry, publishEntry, saveEntry, unpublishEntry, type EntryContext } from "@/server/content-entries";
import { contentTag, deleteContentType, saveContentType } from "@/server/content-types";
import type { SaveResult } from "@/server/settings";

/**
 * Kaizena Flow's own content types and entries (wave 6 unit H4, D326): the store's actions with no store, for platform admins only. Its
 * entries are written in the site's languages (English first) and keep no money or file fields (`saveContentType()` refuses them).
 */

const BASE = "/admin/platform/content";

function inWords<T extends SaveResult>(account: Account, result: T): T {
  if (result.ok) return result;
  const words = adminText(adminLangOf(account.adminLocale), "content").problems;
  return { ...result, problems: result.problems.map((problem) => contentProblem(problem, words)) };
}

const actorOf = (account: Account) => ({ accountId: account.id, owner: null });
const entryContext = (account: Account): EntryContext => ({ ...actorOf(account), locales: [...PLATFORM_PAGE_LOCALES], main: "en", currencies: [] });

export async function savePlatformContentTypeAction(input: unknown): Promise<SaveResult & { id?: string }> {
  const account = await requirePlatformAdmin();
  const result = await saveContentType(actorOf(account), input);
  if (result.ok) updateTag(contentTag(null));
  return inWords(account, result);
}

export async function deletePlatformContentTypeAction(id: string): Promise<SaveResult> {
  const account = await requirePlatformAdmin();
  const result = await deleteContentType(actorOf(account), id);
  if (!result.ok) return inWords(account, result);
  updateTag(contentTag(null));
  redirect(BASE);
}

export async function savePlatformEntryAction(input: unknown): Promise<SaveResult & { id?: string }> {
  const account = await requirePlatformAdmin();
  const result = await saveEntry(entryContext(account), input);
  if (result.ok) updateTag(contentTag(null));
  return inWords(account, result);
}

export async function publishPlatformEntryAction(id: string): Promise<SaveResult> {
  const account = await requirePlatformAdmin();
  const result = await publishEntry(entryContext(account), id);
  if (result.ok) updateTag(contentTag(null));
  return inWords(account, result);
}

export async function unpublishPlatformEntryAction(id: string): Promise<SaveResult> {
  const account = await requirePlatformAdmin();
  const result = await unpublishEntry(actorOf(account), id);
  if (result.ok) updateTag(contentTag(null));
  return inWords(account, result);
}

export async function deletePlatformEntryAction(typeId: string, id: string): Promise<SaveResult> {
  const account = await requirePlatformAdmin();
  const result = await deleteEntry(actorOf(account), id);
  if (!result.ok) return inWords(account, result);
  updateTag(contentTag(null));
  redirect(`${BASE}/${typeId}`);
}

export async function movePlatformEntryAction(id: string, direction: "earlier" | "later"): Promise<void> {
  const account = await requirePlatformAdmin();
  const result = await moveEntry(actorOf(account), id, direction === "earlier" ? "earlier" : "later");
  if (result.ok) {
    updateTag(contentTag(null));
    refresh();
  }
}
