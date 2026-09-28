"use server";

import { after } from "next/server";
import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { chatTag, saveChatAgent } from "@/server/chat-agent";
import { addDocumentFromForm, deleteDocument, refreshSiteKnowledge } from "@/server/knowledge";
import type { UploadResult } from "@/server/media";
import { uploadToLibrary } from "@/server/media-library";

/** The store's chat agent (D81): who it is and how it works. */
export async function saveChatAgentAction(storeSlug: string, json: string) {
  const { account, store } = await requireMember(storeSlug);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false as const, problems: ["The agent could not be read. Reload the page and try again."] };
  }
  const result = await saveChatAgent(account, store.id, raw);
  if (!result.ok) return result;
  updateTag(chatTag(store.id));
  after(() => refreshSiteKnowledge(store.id));
  refresh();
  return result;
}

/** The agent's picture, shrunk by the browser. */
export async function uploadChatAvatarAction(storeSlug: string, formData: FormData): Promise<UploadResult> {
  const { account, store } = await requireMember(storeSlug);
  return uploadToLibrary({ storeId: store.id, accountId: account.id }, formData);
}

/** A document for the knowledge base, pasted or from a file. */
export async function addDocumentAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const { account, store } = await requireMember(storeSlug);
  const result = await addDocumentFromForm(account, store.id, formData);
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => refreshSiteKnowledge(store.id));
  refresh();
  return { status: "ok", messages: ["Added. The agent can use it now."] };
}

export async function deleteDocumentAction(storeSlug: string, id: string) {
  const { account, store } = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false as const, problems: ["No such document."] };
  await deleteDocument(account, store.id, id);
  refresh();
  return { ok: true as const };
}
