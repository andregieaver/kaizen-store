"use server";

import { updateTag } from "next/cache";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { getStore } from "@/server/stores";
import { discardDraft, draftStore, openDraft, publishDraft, type DraftView } from "@/server/store-drafts";

/**
 * *Start from a description* and the *Your drafts* card (D351): a member who may change the website drafts the store from one description,
 * reads the drafts and publishes them with one press (their yes for each part), or lets them go.
 */

type Result = { ok: true; draft: DraftView | null; notes?: string[] } | { ok: false; problem: string };

async function member(storeSlug: string) {
  const found = await checkPermission(storeSlug, "website:write");
  const store = found ? await getStore(found.store.slug) : null;
  return found && store ? { account: found.account, store } : null;
}

export async function startDraftAction(storeSlug: string, description: string, pages: string[]): Promise<Result> {
  const who = await member(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const w = adminText(adminLangOf(who.account.adminLocale), "home").drafts;
  const titles = (Array.isArray(pages) ? pages : []).map((title) => String(title).trim()).filter(Boolean).slice(0, 3);
  const said = String(description ?? "").trim();
  const result = await draftStore(who, {
    description: said,
    front: { purpose: said },
    pages: titles.map((title) => ({ title, purpose: `${title}: ${w.pagePurpose} ${said}`.slice(0, 1000) })),
  });
  if (!result.ok) return result;
  return { ok: true, draft: await openDraft(who.store.id) };
}

export async function draftStateAction(storeSlug: string): Promise<Result> {
  const who = await member(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  return { ok: true, draft: await openDraft(who.store.id) };
}

export async function publishDraftAction(storeSlug: string, draftId: string): Promise<Result> {
  const who = await member(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const result = await publishDraft(who, String(draftId), (tag) => updateTag(tag));
  if (!result.ok) return result;
  return { ok: true, draft: null, notes: result.notes };
}

export async function discardDraftAction(storeSlug: string, draftId: string): Promise<Result> {
  const who = await member(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  await discardDraft(who, String(draftId));
  return { ok: true, draft: null };
}
