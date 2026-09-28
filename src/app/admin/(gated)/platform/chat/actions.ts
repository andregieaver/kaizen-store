"use server";

import { after } from "next/server";
import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { chatTag, saveChatAgent } from "@/server/chat-agent";
import { addDocumentFromForm, deleteDocument, refreshSiteKnowledge } from "@/server/knowledge";

/** Kaizen's own chat agent (D81), on Kaizen's pages. */
export async function savePlatformChatAgentAction(json: string) {
  const account = await requirePlatformAdmin();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false as const, problems: ["The agent could not be read. Reload the page and try again."] };
  }
  const result = await saveChatAgent(account, null, raw);
  if (!result.ok) return result;
  updateTag(chatTag(null));
  after(() => refreshSiteKnowledge(null));
  refresh();
  return result;
}

export async function addPlatformDocumentAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const result = await addDocumentFromForm(account, null, formData);
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => refreshSiteKnowledge(null));
  refresh();
  return { status: "ok", messages: ["Added. The agent can use it now."] };
}

export async function deletePlatformDocumentAction(id: string) {
  const account = await requirePlatformAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false as const, problems: ["No such document."] };
  await deleteDocument(account, null, id);
  refresh();
  return { ok: true as const };
}
