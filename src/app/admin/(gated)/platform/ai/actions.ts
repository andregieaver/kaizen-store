"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { AiEvalResult, AiImageTestResult, AiTestResult, AiVisionCheckResult } from "@/components/admin/ai-provider-form";
import { aiFormValues } from "@/lib/ai-provider";
import { AI_TAG, ownConnection, removeAiSettings, saveAiSettings, testAi } from "@/server/ai";
import { testPicture } from "@/server/ai-pictures";
import { checkVisionFor } from "@/server/ai-vision";
import { requirePlatformAdmin } from "@/server/auth";
import { runUnderstandingEval } from "@/server/query-understanding";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { Account } from "@/server/auth";

const wordsOf = (account: Account) => adminText(adminLangOf(account.adminLocale), "platformTools").aiActions;

/** Kaizen's AI provider and models (D73): the default for every store. */
export async function savePlatformAiAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const result = await saveAiSettings(account.id, null, aiFormValues(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(AI_TAG);
  refresh();
  return { status: "ok", messages: [wordsOf(account).saved] };
}

export async function testPlatformAiAction(): Promise<AiTestResult> {
  const account = await requirePlatformAdmin();
  const connection = await ownConnection(null);
  return connection ? testAi(connection) : { error: wordsOf(account).saveFirst };
}

export async function removePlatformAiAction(): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const account = await requirePlatformAdmin();
  await removeAiSettings(account.id, null);
  updateTag(AI_TAG);
  refresh();
  return { ok: true };
}

/** The query-understanding eval (D75) against Kaizen's saved text model. */
export async function evalPlatformAiAction(): Promise<AiEvalResult> {
  const account = await requirePlatformAdmin();
  const connection = await ownConnection(null);
  if (!connection?.textModel) return { error: wordsOf(account).textFirst };
  return runUnderstandingEval(connection);
}

/** One test picture from Kaizen's saved picture model (D92), not kept. */
export async function testPlatformImageAction(): Promise<AiImageTestResult> {
  const account = await requirePlatformAdmin();
  const connection = await ownConnection(null);
  return connection ? testPicture(connection) : { ok: false, message: wordsOf(account).saveFirst };
}

/** Whether a model (typed in the form, or the saved one) looks at pictures, tried with Kaizen's saved provider and key (D163). */
export async function checkPlatformVisionAction(model: string): Promise<AiVisionCheckResult> {
  await requirePlatformAdmin();
  return checkVisionFor(await ownConnection(null), model);
}
