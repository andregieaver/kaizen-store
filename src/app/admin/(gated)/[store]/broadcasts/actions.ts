"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { BROADCAST_AUDIENCES, type BroadcastSuggestion, type CampaignFact, type ProductFact } from "@/lib/broadcasts";
import { marketingProblem } from "@/lib/marketing-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { campaignFacts, emailMarket, findProductFacts } from "@/server/broadcast-facts";
import {
  audienceCount,
  deleteBroadcast,
  runBroadcasts,
  saveBroadcast,
  scheduleBroadcast,
  sendTestBroadcast,
  startBroadcast,
  stopBroadcast,
  suggestBroadcast,
  unscheduleBroadcast,
} from "@/server/broadcasts";
import type { UploadResult } from "@/server/media";
import { uploadToLibrary } from "@/server/media-library";
import { checkPermission, requirePermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

/**
 * Broadcasts (D297, docs/wave-5-marketing.md 5): every action here changes or sends one, so each asks `marketing:write`. The store is the bound
 * first argument; ids are checked before anything is read.
 */

type Problem = { ok: false; problem: string };
const uuid = z.uuid();

async function writer(storeSlug: string) {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return null;
  const store = await storeById(member.store.id);
  return store ? { member, store, w: adminText(adminLangOf(member.account.adminLocale), "marketing").problems } : null;
}

/** A refusal before a member is known, in the request's language (D312 A6). */
const noAccess = async (): Promise<Problem> => ({ ok: false, problem: adminText(await actionAdminLang(), "marketing").problems.noAccess });

/** The server's English answer in the account's language. */
function said<T extends { ok: boolean }>(result: T | Problem, w: Parameters<typeof marketingProblem>[1]): T | Problem {
  return "problem" in result && !result.ok ? { ok: false, problem: marketingProblem(result.problem, w) } : result;
}

/** Saves a draft (a new one opens on its own page). */
export async function saveBroadcastAction(storeSlug: string, id: string | null, input: unknown): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  if (id !== null && !uuid.safeParse(id).success) return { ok: false, problem: who.w.unknownBroadcast };
  const result = await saveBroadcast(who.store, who.member.account.id, id, input);
  if (!result.ok) return said(result, who.w);
  if (id === null) redirect(`/admin/${who.member.store.slug}/broadcasts/${result.id}`);
  refresh();
  return { ok: true };
}

/** How many it would go to now: numbers only. */
export async function audienceCountAction(storeSlug: string, audience: string, segmentId: string | null): Promise<Problem | { ok: true; people: number }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const kind = z.enum(BROADCAST_AUDIENCES).safeParse(audience);
  if (!kind.success || (segmentId !== null && !uuid.safeParse(segmentId).success)) return { ok: false, problem: who.w.chooseAudience };
  if (kind.data === "segment" && !segmentId) return { ok: false, problem: who.w.chooseSegment };
  return said(await audienceCount(who.store, kind.data, kind.data === "segment" ? segmentId : null), who.w);
}

export async function sendTestAction(storeSlug: string, id: string, locale: string): Promise<Problem | { ok: true; to: string }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return noAccess();
  if (!who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: who.w.storeLanguage };
  const outcome = await sendTestBroadcast(who.store.id, who.member.account.email, id, locale);
  if (outcome === "empty") return { ok: false, problem: who.w.saveFirst };
  if (outcome === "failed") return { ok: false, problem: who.w.testFailed };
  return { ok: true, to: who.member.account.email };
}

export async function startBroadcastAction(storeSlug: string, id: string): Promise<Problem | { ok: true; recipients: number }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return noAccess();
  const result = await startBroadcast(who.store.id, who.member.account.id, id);
  if (!result.ok) return said(result, who.w);
  // The first batches go at once; the every-minute job carries on with the rest.
  after(() => runBroadcasts({ only: id }).then(() => undefined));
  refresh();
  return result;
}

export async function scheduleBroadcastAction(storeSlug: string, id: string, when: string): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return noAccess();
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: who.w.chooseTime };
  const result = await scheduleBroadcast(who.store.id, who.member.account.id, id, at);
  if (!result.ok) return said(result, who.w);
  refresh();
  return { ok: true };
}

export async function unscheduleBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await unscheduleBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function stopBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await stopBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function deleteBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await deleteBroadcast(member.store.id, member.account.id, id);
  redirect(`/admin/${member.store.slug}/broadcasts`);
}

/** A suggestion from the AI for the editor; nothing is saved. The segment chosen (the store's own) shapes the words (D352). */
export async function suggestBroadcastAction(storeSlug: string, brief: string, locale: string, segmentId?: string | null): Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  if (typeof brief !== "string" || typeof locale !== "string" || !who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: who.w.storeLanguage };
  const segment = typeof segmentId === "string" && uuid.safeParse(segmentId).success ? segmentId : null;
  return said(await suggestBroadcast(who.store, who.member.account.id, brief, locale, { segmentId: segment }), who.w);
}

/** The editor's finder (D352): the store's products by words and its running campaigns, read in its own country; nothing is saved. */
export async function findBroadcastFactsAction(storeSlug: string, words: string): Promise<Problem | { ok: true; products: ProductFact[]; campaigns: CampaignFact[] }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const market = emailMarket(who.store, null, who.store.localization.locales[0] ?? "");
  if (!market) return { ok: true, products: [], campaigns: [] };
  const query = typeof words === "string" ? words : "";
  const [products, campaigns] = await Promise.all([findProductFacts(who.store, market, query), campaignFacts(who.store, market)]);
  return { ok: true, products, campaigns };
}

/** A picture for an email, kept in the store's media library (D88); the browser sends a JPEG. */
export async function uploadBroadcastPictureAction(storeSlug: string, data: FormData): Promise<UploadResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  return uploadToLibrary({ storeId: member.store.id, accountId: member.account.id }, data);
}
