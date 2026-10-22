"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { isProvider } from "@/lib/integrations";
import { actionAdminLang } from "@/server/admin-request-lang";
import { type Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { removeIntegration, saveIntegration, sendTest } from "@/server/integrations";
import { SLACK_COOKIE, SLACK_COOKIE_PATH, slackStart } from "@/server/slack";

/** Integrations send shoppers' details to another company, so only an owner connects or changes them (D41). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? (await wordsOf(null)).ownerOnly;
}

/** The answers in a member's language, or in the request's before a member is known. */
const wordsOf = async (member: Membership | null) => adminText(member ? adminLangOf(member.account.adminLocale) : await actionAdminLang(), "notifications").integrations.answers;

export async function saveIntegrationAction(
  storeSlug: string,
  provider: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { status: "error", messages: [owner] };
  const w = await wordsOf(owner);
  if (!isProvider(provider)) return { status: "error", messages: [w.unknown] };
  const result = await saveIntegration(owner, provider, {
    url: String(formData.get("url") ?? ""),
    events: formData.getAll("events").map(String),
    enabled: formData.get("enabled") === "on",
  });
  return result.ok ? { status: "ok", messages: [adminText(adminLangOf(owner.account.adminLocale), "notifications").common.saved] } : { status: "error", messages: result.problems.map((p) => w.save[p] ?? p) };
}

export type TestResult = { ok: boolean; message: string };

export async function sendTestAction(storeSlug: string, provider: string): Promise<TestResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const w = await wordsOf(owner);
  if (!isProvider(provider)) return { ok: false, message: w.unknown };
  const outcome = await sendTest(owner, provider);
  if (outcome.ok) return { ok: true, message: w.testSent };
  return {
    ok: false,
    message: outcome.status
      ? fillWords(w.answered, { status: outcome.status, error: outcome.error ? `: ${outcome.error}` : "", advice: provider === "slack" ? w.slackAdvice : w.hookAdvice })
      : (outcome.error ?? w.notSent),
  };
}

export async function removeIntegrationAction(storeSlug: string, provider: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  if (!isProvider(provider)) return { ok: false, problems: [(await wordsOf(owner)).unknown] };
  await removeIntegration(owner, provider);
  redirect(`/admin/${storeSlug}/integrations`);
}

/** "Add to Slack" (D101): off to Slack to pick a channel, back to `/api/integrations/slack/callback`. Owners only. */
export async function connectSlackAction(storeSlug: string): Promise<void> {
  const owner = await asOwner(storeSlug);
  const start = typeof owner === "string" ? null : slackStart(owner.store.slug, owner.account.id);
  if (!start) redirect(`/admin/${storeSlug}/integrations/slack`);
  (await cookies()).set(SLACK_COOKIE, start.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: SLACK_COOKIE_PATH,
    maxAge: 600,
  });
  redirect(start.url);
}
