"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { AUTOMATION_KINDS, FOLLOW_UP_POSITIONS, LIFECYCLE_KINDS, type FollowUpPosition } from "@/lib/automations";
import { marketingProblem } from "@/lib/marketing-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { deleteFollowUp, saveAutomation, saveFollowUp, sendTestAutomation, sendTestFollowUp, switchAutomation } from "@/server/automations";
import { checkPermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

/**
 * Automations (D298, docs/wave-5-marketing.md 6): every action here changes one or sends a test, so each asks `marketing:write`. The store is the
 * bound first argument; the kind is checked before anything is read.
 */

type Problem = { ok: false; problem: string };

async function writer(storeSlug: string) {
  const member = await checkPermission(storeSlug, "marketing:write", "email_automation");
  if (!member) return null;
  const store = await storeById(member.store.id);
  return store ? { member, store, w: adminText(adminLangOf(member.account.adminLocale), "marketing").problems } : null;
}

/** A refusal before a member is known, in the request's language (D312 A6). */
const noAccess = async (): Promise<Problem> => ({ ok: false, problem: adminText(await actionAdminLang(), "marketing").problems.noAccess });

/** The server's English answer in the account's language. */
const said = (result: Problem | { ok: true }, w: Parameters<typeof marketingProblem>[1]): Problem | { ok: true } =>
  result.ok ? result : { ok: false, problem: marketingProblem(result.problem, w) };

export async function saveAutomationAction(storeSlug: string, kind: string, input: unknown): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const lifecycle = z.enum(LIFECYCLE_KINDS).safeParse(kind);
  if (!lifecycle.success) return { ok: false, problem: who.w.unknownAutomation };
  const result = await saveAutomation(who.store, who.member.account.id, lifecycle.data, input);
  if (result.ok) refresh();
  return said(result, who.w);
}

export async function switchAutomationAction(storeSlug: string, kind: string, on: boolean): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const parsed = z.enum(AUTOMATION_KINDS).safeParse(kind);
  if (!parsed.success || typeof on !== "boolean") return { ok: false, problem: who.w.unknownAutomation };
  const result = await switchAutomation(who.store, who.member.account.id, parsed.data, on);
  if (result.ok) refresh();
  return said(result, who.w);
}

export async function testAutomationAction(storeSlug: string, kind: string, locale: string): Promise<Problem | { ok: true; to: string }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const lifecycle = z.enum(LIFECYCLE_KINDS).safeParse(kind);
  if (!lifecycle.success) return { ok: false, problem: who.w.unknownAutomation };
  if (!who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: who.w.storeLanguage };
  const outcome = await sendTestAutomation(who.store.id, who.member.account.email, lifecycle.data, locale);
  if (outcome === "empty") return { ok: false, problem: who.w.saveFirst };
  if (outcome === "failed") return { ok: false, problem: who.w.testFailed };
  return { ok: true, to: who.member.account.email };
}

/**
 * A follow-up (D653) is named `{kind}` plus its position, as `{kind}:2`, or `{kind}:new` for one not yet saved, so the editor's save and test
 * take it as they take a kind.
 */
function followUpOf(name: string): { kind: (typeof LIFECYCLE_KINDS)[number]; position: FollowUpPosition | null } | null {
  const [kind, at] = name.split(":");
  const lifecycle = z.enum(LIFECYCLE_KINDS).safeParse(kind);
  if (!lifecycle.success) return null;
  if (at === "new") return { kind: lifecycle.data, position: null };
  const position = FOLLOW_UP_POSITIONS.find((p) => String(p) === at);
  return position ? { kind: lifecycle.data, position } : null;
}

export async function saveFollowUpAction(storeSlug: string, name: string, input: unknown): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const followUp = followUpOf(name);
  if (!followUp) return { ok: false, problem: who.w.unknownAutomation };
  const result = await saveFollowUp(who.store, who.member.account.id, followUp.kind, followUp.position, input);
  if (!result.ok) return said(result, who.w);
  // A new one is kept: its page from now on, so a second save changes it rather than adding another.
  if (followUp.position === null) redirect(`/admin/${who.member.store.slug}/automations/${followUp.kind}/follow-ups/${result.position}`);
  refresh();
  return { ok: true };
}

export async function deleteFollowUpAction(storeSlug: string, name: string): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const followUp = followUpOf(name);
  if (!followUp?.position) return { ok: false, problem: who.w.unknownAutomation };
  const result = await deleteFollowUp(who.store, who.member.account.id, followUp.kind, followUp.position);
  if (!result.ok) return said(result, who.w);
  redirect(`/admin/${who.member.store.slug}/automations/${followUp.kind}`);
}

export async function testFollowUpAction(storeSlug: string, name: string, locale: string): Promise<Problem | { ok: true; to: string }> {
  const who = await writer(storeSlug);
  if (!who) return noAccess();
  const followUp = followUpOf(name);
  if (!followUp) return { ok: false, problem: who.w.unknownAutomation };
  if (!followUp.position) return { ok: false, problem: who.w.saveFirst };
  if (!who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: who.w.storeLanguage };
  const outcome = await sendTestFollowUp(who.store.id, who.member.account.email, followUp.kind, followUp.position, locale);
  if (outcome === "empty") return { ok: false, problem: who.w.saveFirst };
  if (outcome === "failed") return { ok: false, problem: who.w.testFailed };
  return { ok: true, to: who.member.account.email };
}
