"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { marketingProblem } from "@/lib/marketing-words";
import { SEGMENT_STARTERS, type SegmentCount } from "@/lib/segments";
import { segmentRulesSchema } from "@/lib/segments-schema";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission, requirePermission } from "@/server/permissions";
import { deleteSegment, evaluateSegment, saveSegment } from "@/server/segments";

export type PreviewResult = ({ ok: true } & SegmentCount & { capped: boolean; rfmReady: boolean }) | { ok: false; problem: string };

/** The refusals in the account's language (D312 A6); before a member is known, the request's. */
const wordsOf = (adminLocale: string | null | undefined) => MARKETING_WORDS[adminLangOf(adminLocale)].problems;
const noAccess = async () => MARKETING_WORDS[await actionAdminLang()].problems.noAccess;

/** Counts a rule set before it is saved (D296), for staff who may save one: the numbers only, never people. */
export async function previewSegmentAction(storeSlug: string, rules: unknown): Promise<PreviewResult> {
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return { ok: false, problem: await noAccess() };
  const w = wordsOf(member.account.adminLocale);
  const parsed = segmentRulesSchema.safeParse(rules);
  if (!parsed.success) return { ok: false, problem: marketingProblem(parsed.error.issues[0]?.message ?? w.incomplete, w) };
  const result = await evaluateSegment(member.store, parsed.data);
  return { ok: true, people: result.people, subscribed: result.subscribed, moneyUnknown: result.moneyUnknown, capped: result.capped, rfmReady: result.rfmReady };
}

/** Saves a segment (`marketing:write`) and opens it. */
export async function saveSegmentAction(storeSlug: string, id: string | null, input: unknown): Promise<{ ok: false; problem: string } | void> {
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return { ok: false, problem: await noAccess() };
  const w = wordsOf(member.account.adminLocale);
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problem: w.unknownSegment };
  const result = await saveSegment(member.store.id, member.account.id, id, input);
  if (!result.ok) return { ok: false, problem: marketingProblem(result.problem, w) };
  redirect(`/admin/${member.store.slug}/segments/${result.id}`);
}

export async function deleteSegmentAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  if (!z.uuid().safeParse(id).success) return;
  const deleted = await deleteSegment(member.store.id, member.account.id, id);
  // A code or campaign is limited to it (D380): the page says which.
  if (deleted === "in_use") redirect(`/admin/${member.store.slug}/segments/${id}?inUse=1`);
  refresh();
  redirect(`/admin/${member.store.slug}/segments`);
}

/** Keeps one of the ready segments as the store's own (round 8, D626): named in the account's language, then opened. */
export async function keepStarterAction(storeSlug: string, key: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write", "email_automation");
  const starter = SEGMENT_STARTERS.find((s) => s.key === key);
  if (!starter) return;
  const words = MARKETING_WORDS[adminLangOf(member.account.adminLocale)].segments.starters[key];
  const result = await saveSegment(member.store.id, member.account.id, null, { name: words?.name ?? starter.name, rules: starter.rules });
  if (!result.ok) redirect(`/admin/${member.store.slug}/segments/new`);
  refresh();
  redirect(`/admin/${member.store.slug}/segments/${result.id}`);
}
