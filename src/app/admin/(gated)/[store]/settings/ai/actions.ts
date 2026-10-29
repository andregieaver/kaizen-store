"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { AiEvalResult, AiImageTestResult, AiTestResult, AiVisionCheckResult } from "@/components/admin/ai-provider-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { aiFormValues } from "@/lib/ai-provider";
import { ASSISTANT_KEEP, ASSISTANT_KEEP_MONTHS } from "@/lib/assistant-keep";
import { actionAdminLang } from "@/server/admin-request-lang";
import { AI_TAG, ownConnection, removeAiSettings, saveAiSettings, testAi } from "@/server/ai";
import { testPicture } from "@/server/ai-pictures";
import { saveAssistantKeep } from "@/server/assistant-retention";
import { checkVisionFor } from "@/server/ai-vision";
import { type Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { runUnderstandingEval } from "@/server/query-understanding";

/** A store's own AI sends its products and shoppers' searches to another company, so only an owner chooses it (D73). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? adminText(await actionAdminLang(), "settings").ai.actions.onlyOwner;
}

/** The page's answers in the owner's language (D312 A8). */
const wordsOf = (owner: Membership) => adminText(adminLangOf(owner.account.adminLocale), "settings").ai.actions;

export async function saveStoreAiAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { status: "error", messages: [owner] };
  const result = await saveAiSettings(owner.account.id, owner.store.id, aiFormValues(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(AI_TAG);
  refresh();
  return { status: "ok", messages: [wordsOf(owner).saved] };
}

export async function testStoreAiAction(storeSlug: string): Promise<AiTestResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { error: owner };
  const connection = await ownConnection(owner.store.id);
  return connection ? testAi(connection) : { error: wordsOf(owner).saveFirst };
}

export async function removeStoreAiAction(storeSlug: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  await removeAiSettings(owner.account.id, owner.store.id);
  updateTag(AI_TAG);
  refresh();
  return { ok: true };
}

/** The query-understanding eval (D75) against the store's own saved text model. */
export async function evalStoreAiAction(storeSlug: string): Promise<AiEvalResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { error: owner };
  const connection = await ownConnection(owner.store.id);
  if (!connection?.textModel) return { error: wordsOf(owner).textFirst };
  return runUnderstandingEval(connection);
}

/** One test picture from the store's own saved picture model (D92), not kept. */
export async function testStoreImageAction(storeSlug: string): Promise<AiImageTestResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const connection = await ownConnection(owner.store.id);
  return connection ? testPicture(connection) : { ok: false, message: wordsOf(owner).saveFirst };
}

/** Whether a model (typed in the form, or the saved one) looks at pictures, tried with the store's own saved provider and key (D163). */
export async function checkStoreVisionAction(storeSlug: string, model: string): Promise<AiVisionCheckResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, model, message: owner };
  return checkVisionFor(await ownConnection(owner.store.id), model);
}

/** How long the AI manager's conversations are kept (D391): the owner's choice, an empty field the default. */
export async function saveAssistantKeepAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { status: "error", messages: [owner] };
  const w = adminText(adminLangOf(owner.account.adminLocale), "settings").ai.keep;
  const result = await saveAssistantKeep(owner, formData.get("months"));
  if (!result.ok) return { status: "error", messages: [fillWords(w.invalid, ASSISTANT_KEEP)] };
  refresh();
  return { status: "ok", messages: [fillWords(w.saved, { months: result.months ?? ASSISTANT_KEEP_MONTHS })] };
}
