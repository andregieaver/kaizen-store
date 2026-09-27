"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { AiEvalResult, AiTestResult } from "@/components/admin/ai-provider-form";
import { aiFormValues } from "@/lib/ai-provider";
import { ownConnection, removeAiSettings, saveAiSettings, testAi } from "@/server/ai";
import { requireMember, type Membership } from "@/server/auth";
import { runUnderstandingEval } from "@/server/query-understanding";

/** A store's own AI sends its products and shoppers' searches to another company, so only an owner chooses it (D73). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  const member = await requireMember(storeSlug);
  return member.role === "owner" ? member : "Only an owner can change the store's AI.";
}

export async function saveStoreAiAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { status: "error", messages: [owner] };
  const result = await saveAiSettings(owner.account.id, owner.store.id, aiFormValues(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved. The store uses its own AI now."] };
}

export async function testStoreAiAction(storeSlug: string): Promise<AiTestResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { error: owner };
  const connection = await ownConnection(owner.store.id);
  return connection ? testAi(connection) : { error: "Save a provider and key first." };
}

export async function removeStoreAiAction(storeSlug: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, problems: [owner] };
  await removeAiSettings(owner.account.id, owner.store.id);
  refresh();
  return { ok: true };
}

/** The query-understanding eval (D75) against the store's own saved text model. */
export async function evalStoreAiAction(storeSlug: string): Promise<AiEvalResult> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { error: owner };
  const connection = await ownConnection(owner.store.id);
  if (!connection?.textModel) return { error: "Save a provider with a text model first." };
  return runUnderstandingEval(connection);
}
