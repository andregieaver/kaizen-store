"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { isProvider } from "@/lib/integrations";
import { requirePlatformAdmin } from "@/server/auth";
import { removePlatformIntegration, savePlatformIntegration, sendPlatformTest } from "@/server/platform-integrations";

/** Kaizena Flow's own integrations (D465): only a platform admin connects, changes, tests or disconnects one. */
const wordsOf = (locale: string | null | undefined) => {
  const lang = adminLangOf(locale);
  return { lang, shared: adminText(lang, "notifications"), own: adminText(lang, "platform").integrations };
};

export async function savePlatformIntegrationAction(provider: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const { shared, own } = wordsOf(admin.adminLocale);
  if (!isProvider(provider)) return { status: "error", messages: [shared.integrations.answers.unknown] };
  const result = await savePlatformIntegration(admin, provider, {
    url: String(formData.get("url") ?? ""),
    events: formData.getAll("events").map(String),
    enabled: formData.get("enabled") === "on",
  });
  return result.ok ? { status: "ok", messages: [shared.common.saved] } : { status: "error", messages: [own.problems[result.problem]] };
}

export async function sendPlatformTestAction(provider: string): Promise<{ ok: boolean; message: string }> {
  const admin = await requirePlatformAdmin();
  const { shared, own } = wordsOf(admin.adminLocale);
  const w = shared.integrations.answers;
  if (!isProvider(provider)) return { ok: false, message: w.unknown };
  const outcome = await sendPlatformTest(admin, provider);
  if (outcome.ok) return { ok: true, message: w.testSent };
  if (outcome.status === null && outcome.error === null) return { ok: false, message: own.saveFirst };
  return {
    ok: false,
    message: outcome.status
      ? fillWords(w.answered, { status: outcome.status, error: outcome.error ? `: ${outcome.error}` : "", advice: provider === "slack" ? w.slackAdvice : w.hookAdvice })
      : (outcome.error ?? w.notSent),
  };
}

export async function removePlatformIntegrationAction(provider: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  if (!isProvider(provider)) return { ok: false, problems: [wordsOf(admin.adminLocale).shared.integrations.answers.unknown] };
  await removePlatformIntegration(admin, provider);
  redirect("/admin/platform/integrations");
}
