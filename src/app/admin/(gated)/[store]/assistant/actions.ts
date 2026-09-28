"use server";

import { notFound } from "next/navigation";
import { updateTag } from "next/cache";

import { requireMember, type Membership } from "@/server/auth";
import { decideApproval, deleteConversation, type Approval } from "@/server/owner-assistant";
import { hearOwner, speakToOwner } from "@/server/page-ai";
import { readRecording, unreadable } from "@/server/page-studio-input";

/** The owner assistant's actions (D94): for the store's owners only. */
async function requireOwner(storeSlug: string): Promise<Membership> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") notFound();
  return member;
}

export async function decideApprovalAction(storeSlug: string, approvalId: string, approve: boolean): Promise<Approval | null> {
  const member = await requireOwner(storeSlug);
  return decideApproval(member, String(approvalId), approve === true, (tag) => updateTag(tag));
}

export async function deleteConversationAction(storeSlug: string, conversationId: string): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  return deleteConversation(member, String(conversationId));
}

export async function assistantHearAction(storeSlug: string, form: FormData) {
  const member = await requireOwner(storeSlug);
  const audio = readRecording(form);
  return audio ? hearOwner(member.store.id, audio) : unreadable;
}

export async function assistantSpeakAction(storeSlug: string, text: string) {
  const member = await requireOwner(storeSlug);
  return typeof text === "string" && text.trim() ? speakToOwner(member.store.id, text) : unreadable;
}
