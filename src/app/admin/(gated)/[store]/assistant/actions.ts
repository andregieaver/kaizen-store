"use server";

import { updateTag } from "next/cache";
import { after } from "next/server";

import { type Membership } from "@/server/auth";
import { requireOwnerRole } from "@/server/permissions";
import {
  assistantAbilities,
  decideApproval,
  deleteConversation,
  getConversation,
  listConversations,
  rateAnswer,
  type Approval,
  type Conversation,
} from "@/server/owner-assistant";
import { hearOwner } from "@/server/page-ai";
import { readRecording, unreadable } from "@/server/page-studio-input";

/** The store's AI manager's actions (D94, D103): for the store's owners only. */
async function requireOwner(storeSlug: string): Promise<Membership> {
  return requireOwnerRole(storeSlug);
}

/** What the panel needs when it first opens. */
export async function startAssistantAction(storeSlug: string) {
  const member = await requireOwner(storeSlug);
  const [abilities, conversations] = await Promise.all([assistantAbilities(member.store.id), listConversations(member)]);
  return { abilities, conversations };
}

export async function loadConversationAction(storeSlug: string, conversationId: string): Promise<Conversation | null> {
  const member = await requireOwner(storeSlug);
  return getConversation(member, String(conversationId));
}

export async function decideApprovalAction(storeSlug: string, approvalId: string, approve: boolean): Promise<Approval | null> {
  const member = await requireOwner(storeSlug);
  return decideApproval(member, String(approvalId), approve === true, (tag) => updateTag(tag));
}

export async function deleteConversationAction(storeSlug: string, conversationId: string): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  return deleteConversation(member, String(conversationId));
}

export async function rateAnswerAction(storeSlug: string, messageId: string, value: 1 | -1 | null): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  const thumb = value === 1 || value === -1 ? value : null;
  return rateAnswer(member, String(messageId), thumb, null, (task) => after(task));
}

export async function assistantHearAction(storeSlug: string, form: FormData) {
  const member = await requireOwner(storeSlug);
  const audio = readRecording(form);
  return audio ? hearOwner(member.store.id, audio) : unreadable;
}

