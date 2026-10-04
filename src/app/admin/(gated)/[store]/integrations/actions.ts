"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { isProvider } from "@/lib/integrations";
import { type Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { removeIntegration, saveIntegration, sendTest } from "@/server/integrations";
import { SLACK_COOKIE, SLACK_COOKIE_PATH, slackStart } from "@/server/slack";

/** Integrations send shoppers' details to another company, so only an owner connects or changes them (D41). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? "Only an owner can change integrations.";
}

export async function saveIntegrationAction(
  storeSlug: string,
  provider: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { status: "error", messages: [owner] };
  if (!isProvider(provider)) return { status: "error", messages: ["Unknown integration."] };
  const result = await saveIntegration(owner, provider, {
    url: String(formData.get("url") ?? ""),
    events: formData.getAll("events").map(String),
    enabled: formData.get("enabled") === "on",
  });
  return result.ok ? { status: "ok", messages: ["Saved."] } : { status: "error", messages: result.problems };
}

export type TestResult = { ok: boolean; message: string };

export async function sendTestAction(storeSlug: string, provider: string): Promise<TestResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  if (!isProvider(provider)) return { ok: false, message: "Unknown integration." };
  const outcome = await sendTest(owner, provider);
  if (outcome.ok) return { ok: true, message: "Test sent. It should show in the service in a moment." };
  return {
    ok: false,
    message: outcome.status
      ? `The service answered ${outcome.status}${outcome.error ? `: ${outcome.error}` : ""}. ${
          provider === "slack" ? "Check the address, and that the channel and the app still exist." : "Check the address and that the Zap or scenario is listening."
        }`
      : (outcome.error ?? "The test could not be sent."),
  };
}

export async function removeIntegrationAction(storeSlug: string, provider: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  if (!isProvider(provider)) return { ok: false, problems: ["Unknown integration."] };
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
