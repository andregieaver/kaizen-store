"use server";

import { updateTag } from "next/cache";
import { after } from "next/server";

import { requirePlatformAdmin } from "@/server/auth";
import {
  assistantAbilities,
  decideApproval,
  deleteConversation,
  getConversation,
  listConversations,
  rateAnswer,
  type Approval,
  type Conversation,
  type Principal,
} from "@/server/owner-assistant";
import { hearOwner } from "@/server/page-ai";
import { readRecording, unreadable } from "@/server/page-studio-input";

/** Kaizen's AI manager's actions (D103): for platform admins only. */
async function principal(): Promise<Principal> {
  return { account: await requirePlatformAdmin(), store: null };
}

/** What the panel needs when it first opens. */
export async function startPlatformAssistantAction() {
  const p = await principal();
  const [abilities, conversations] = await Promise.all([assistantAbilities(null), listConversations(p)]);
  return { abilities, conversations };
}

export async function loadPlatformConversationAction(conversationId: string): Promise<Conversation | null> {
  return getConversation(await principal(), String(conversationId));
}

export async function decidePlatformApprovalAction(approvalId: string, approve: boolean): Promise<Approval | null> {
  return decideApproval(await principal(), String(approvalId), approve === true, (tag) => updateTag(tag));
}

export async function deletePlatformConversationAction(conversationId: string): Promise<boolean> {
  return deleteConversation(await principal(), String(conversationId));
}

export async function ratePlatformAnswerAction(messageId: string, value: 1 | -1 | null): Promise<boolean> {
  const thumb = value === 1 || value === -1 ? value : null;
  return rateAnswer(await principal(), String(messageId), thumb, null, (task) => after(task));
}

export async function platformHearAction(form: FormData) {
  await principal();
  const audio = readRecording(form);
  return audio ? hearOwner(null, audio) : unreadable;
}

