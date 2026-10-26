"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { AiEvalResult, AiImageTestResult, AiTestResult, AiVisionCheckResult } from "@/components/admin/ai-provider-form";
import { aiFormValues } from "@/lib/ai-provider";
import { AI_TAG, AiError, ownConnection, removeAiSettings, saveAiSettings, testAi } from "@/server/ai";
import type { AgentEvalOutcome } from "@/components/admin/agent-eval-button";
import { evalPrincipal, runAgentEval } from "@/server/agent-eval";
import { testPicture } from "@/server/ai-pictures";
import { checkVisionFor } from "@/server/ai-vision";
import { requirePlatformAdmin } from "@/server/auth";
import { runUnderstandingEval } from "@/server/query-understanding";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { Account } from "@/server/auth";
import { OwnerToolError } from "@/server/owner-tool-error";
import { saveSearchSettings } from "@/server/web-search-settings";

/** Kaizena Flow's web search service for the AI's research (D329). */
export async function saveWebSearchAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  try {
    await saveSearchSettings(account, { provider: String(formData.get("provider") ?? ""), apiKey: String(formData.get("api_key") ?? ""), enabled: formData.get("enabled") === "on" });
  } catch (error) {
    if (error instanceof OwnerToolError) return { status: "error", messages: [error.message] };
    throw error;
  }
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(account.adminLocale), "platformTools").ai.webSearchSaved] };
}

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

/**
 * The agents' safety eval (PSI 2026-10-24, AST-09) against Kaizena Flow's saved text model: the shopper chat and the AI manager with
 * their real prompts and tools, every tool answered from a script, played on the template store. The run is kept per model.
 */
export async function evalPlatformAgentsAction(): Promise<AgentEvalOutcome> {
  const account = await requirePlatformAdmin();
  const connection = await ownConnection(null);
  if (!connection?.textModel) return { error: wordsOf(account).textFirst };
  const principal = await evalPrincipal(account);
  if (!principal) return { error: wordsOf(account).noTemplate };
  try {
    const result = await runAgentEval({ ...connection, usage: { storeId: null, feature: "ai_test", accountId: account.id } }, principal);
    refresh();
    return result;
  } catch (error) {
    if (error instanceof AiError) return { error: error.message };
    throw error;
  }
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
