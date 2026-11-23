"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { BROADCAST_AUDIENCES, type BroadcastSuggestion, type CampaignFact, type ProductFact } from "@/lib/broadcasts";
import { marketingProblem } from "@/lib/marketing-words";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { actionAdminLang } from "@/server/admin-request-lang";
import { campaignFacts, emailMarket, findProductFacts } from "@/server/broadcast-facts";
import { deleteOwnTemplate, saveAsTemplate } from "@/server/broadcast-templates";
import { HTML_BLOCK_MAX, type SavedBlock } from "@/lib/broadcasts";
import { cleanEmailHtml } from "@/server/email-html";
import { deleteSavedBlock, listSavedBlocks, saveBlock } from "@/server/email-saved-blocks";
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
  suggestSubjects,
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
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return null;
  const store = await storeById(member.store.id);
  return store ? { member, store, w: MARKETING_WORDS[adminLangOf(member.account.adminLocale)].problems } : null;
}

/** A refusal before a member is known, in the request's language (D312 A6). */
const noAccess = async (): Promise<Problem> => ({ ok: false, problem: MARKETING_WORDS[await actionAdminLang()].problems.noAccess });

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
export async function audienceCountAction(storeSlug: string, audience: string, segmentId: string | null, topicId: string | null = null): Promise<Problem | { ok: true; people: number }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const kind = z.enum(BROADCAST_AUDIENCES).safeParse(audience);
  if (!kind.success || (segmentId !== null && !uuid.safeParse(segmentId).success)) return { ok: false, problem: who.w.chooseAudience };
  if (kind.data === "segment" && !segmentId) return { ok: false, problem: who.w.chooseSegment };
  if (topicId !== null && !uuid.safeParse(topicId).success) return { ok: false, problem: who.w.topicGone };
  return said(await audienceCount(who.store, kind.data, kind.data === "segment" ? segmentId : null, topicId), who.w);
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
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  if (!uuid.safeParse(id).success) return;
  await unscheduleBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function stopBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  if (!uuid.safeParse(id).success) return;
  await stopBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function deleteBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
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

/**
 * Three subject lines for a split test's version B (email plan M2.5 slice 3, M3.7's writer), from the email's words in one language as
 * the editor holds them; nothing is saved: the owner presses one to make it subject B.
 */
export async function suggestTestSubjectsAction(
  storeSlug: string,
  locale: string,
  subject: string,
  words: string[],
  segmentId: string | null,
): Promise<Problem | { ok: true; subjects: string[] }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  if (typeof locale !== "string" || !who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: who.w.storeLanguage };
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 3000) : "");
  const said_ = Array.isArray(words) ? words.slice(0, 40).map(text) : [];
  const audience = typeof segmentId === "string" && uuid.safeParse(segmentId).success ? "It goes to a segment of the shop's list." : "It goes to everyone on the shop's list.";
  return said(await suggestSubjects(who.store, who.member.account.id, { subject: text(subject), words: said_ }, locale, audience), who.w);
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
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return noAccess();
  return uploadToLibrary({ storeId: member.store.id, accountId: member.account.id }, data);
}

/** Saves a broadcast's words as one of the store's own templates (D368), then opens a new broadcast from it. */
export async function saveAsTemplateAction(storeSlug: string, id: string, form: FormData): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  if (!uuid.safeParse(id).success) return;
  const saved = await saveAsTemplate(member.store.id, member.account.id, id, String(form.get("title") ?? ""));
  if (saved.ok) redirect(`/admin/${member.store.slug}/broadcasts/new?from=${saved.id}`);
  refresh();
}

/** Saves one block of an email by name (M4.1), answering with the store's saved blocks as they now are. */
export async function saveBlockAction(storeSlug: string, name: string, block: unknown): Promise<Problem | { ok: true; saved: SavedBlock[] }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const result = await saveBlock(who.store.id, who.member.account.id, name, block);
  if (!result.ok) return { ok: false, problem: MARKETING_WORDS[adminLangOf(who.member.account.adminLocale)].email.keptBlockProblems[result.problem] };
  return { ok: true, saved: await listSavedBlocks(who.store.id) };
}

/** An own HTML block as it would be sent (M4.1), for the editor's preview: the server's cleaning, nothing kept. */
export async function cleanHtmlAction(storeSlug: string, html: string): Promise<Problem | { ok: true; html: string }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  return { ok: true, html: cleanEmailHtml(String(html).slice(0, HTML_BLOCK_MAX)).html };
}

/** Deletes one of the store's saved blocks (M4.1). */
export async function deleteSavedBlockAction(storeSlug: string, id: string): Promise<Problem | { ok: true; saved: SavedBlock[] }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  await deleteSavedBlock(who.store.id, who.member.account.id, id);
  return { ok: true, saved: await listSavedBlocks(who.store.id) };
}

/** Deletes one of the store's own templates (D368). */
export async function deleteTemplateAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  await deleteOwnTemplate(member.store.id, member.account.id, id);
  refresh();
}
