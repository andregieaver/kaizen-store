"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { AiTestResult } from "@/components/admin/ai-provider-form";
import { aiFormValues } from "@/lib/ai-provider";
import { ownConnection, removeAiSettings, saveAiSettings, testAi } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";

/** Kaizen's AI provider and models (D73): the default for every store. */
export async function savePlatformAiAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const result = await saveAiSettings(account.id, null, aiFormValues(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved. Stores without their own provider use it now."] };
}

export async function testPlatformAiAction(): Promise<AiTestResult> {
  await requirePlatformAdmin();
  const connection = await ownConnection(null);
  return connection ? testAi(connection) : { error: "Save a provider and key first." };
}

export async function removePlatformAiAction(): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const account = await requirePlatformAdmin();
  await removeAiSettings(account.id, null);
  refresh();
  return { ok: true };
}
