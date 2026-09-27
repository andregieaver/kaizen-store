"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { startExperiment, stopExperiment } from "@/server/search-experiment";

/** Starts a search test (D77) with the share of searches given keyword search alone. */
export async function startSearchTestAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const percent = Number(formData.get("keywordPercent"));
  const result = await startExperiment(account.id, percent / 100);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["Started. Every search from now on is part of the test."] };
}

export async function stopSearchTestAction(): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const account = await requirePlatformAdmin();
  await stopExperiment(account.id);
  refresh();
  return { ok: true };
}
