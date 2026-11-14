"use server";

import { updateTag } from "next/cache";
import { after } from "next/server";

import { type Membership } from "@/server/auth";
import { requireOwnerRole } from "@/server/permissions";
import type { Approval, Conversation } from "@/server/owner-assistant";
import { deleteSkill, saveSkill } from "@/server/assistant-saved-skills";
import { hearOwner } from "@/server/page-ai";
import { readRecording, unreadable } from "@/server/page-studio-input";

/** The AI manager's server side, loaded when an owner first uses the panel, not with every admin page (bloat review step 0.5). */
const assistant = () => import("@/server/owner-assistant");

/** The store's AI manager's actions (D94, D103): for the store's owners only. */
async function requireOwner(storeSlug: string): Promise<Membership> {
  return requireOwnerRole(storeSlug);
}

/** What the panel needs when it first opens. */
export async function startAssistantAction(storeSlug: string) {
  const member = await requireOwner(storeSlug);
  const { assistantAbilities, listConversations } = await assistant();
  const [abilities, conversations] = await Promise.all([assistantAbilities(member.store.id), listConversations(member)]);
  return { abilities, conversations };
}

export async function loadConversationAction(storeSlug: string, conversationId: string): Promise<Conversation | null> {
  const member = await requireOwner(storeSlug);
  const { getConversation } = await assistant();
  return getConversation(member, String(conversationId));
}

export async function decideApprovalAction(storeSlug: string, approvalId: string, approve: boolean): Promise<Approval | null> {
  const member = await requireOwner(storeSlug);
  const { decideApproval } = await assistant();
  return decideApproval(member, String(approvalId), approve === true, (tag) => updateTag(tag));
}

export async function deleteConversationAction(storeSlug: string, conversationId: string): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  const { deleteConversation } = await assistant();
  return deleteConversation(member, String(conversationId));
}

export async function rateAnswerAction(storeSlug: string, messageId: string, value: 1 | -1 | null): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  const thumb = value === 1 || value === -1 ? value : null;
  const { rateAnswer } = await assistant();
  return rateAnswer(member, String(messageId), thumb, null, (task) => after(task));
}

export async function assistantHearAction(storeSlug: string, form: FormData) {
  const member = await requireOwner(storeSlug);
  const audio = readRecording(form);
  return audio ? hearOwner(member.store.id, audio) : unreadable;
}

/**
 * The name of the admin page the owner is on, for the chat's first suggestion: the admin map stays on the server (bloat review step 0.11).
 * It reads no store data and writes nothing; a path that does not start with /admin is refused. A Norwegian account gets the page's Norwegian title.
 */
export async function pageHereAction(storeSlug: string, pathname: string): Promise<string | null> {
  const member = await requireOwner(storeSlug);
  if (typeof pathname !== "string" || pathname.length > 300 || !pathname.startsWith("/admin")) return null;
  const [{ matchPath }, { PAGES_NB }, { adminLangOf }] = await Promise.all([
    import("@/lib/admin-map"),
    import("@/lib/admin-messages/pages.nb"),
    import("@/lib/admin-lang"),
  ]);
  const here = matchPath(pathname);
  const page =
    here && here.page.id !== "assistant" && (here.page.area === "store" || here.page.area === "account") ? here.page : null;
  if (!page) return null;
  return adminLangOf(member.account.adminLocale) === "nb" ? (PAGES_NB[`${page.area}:${page.id}`]?.title ?? page.title) : page.title;
}

/** A skill the owner saves, changes or shares (D350), from the Skills tab or *Save as skill*. */
export async function saveSkillAction(storeSlug: string, input: { id?: string; title: string; when: string; steps: string; share?: boolean }) {
  const member = await requireOwner(storeSlug);
  return saveSkill(
    { accountId: member.account.id, storeId: member.store.id, owner: true },
    { id: typeof input.id === "string" ? input.id : undefined, title: String(input.title ?? ""), when: String(input.when ?? ""), steps: String(input.steps ?? ""), share: input.share === true },
  );
}

export async function deleteSkillAction(storeSlug: string, id: string): Promise<boolean> {
  const member = await requireOwner(storeSlug);
  return deleteSkill({ accountId: member.account.id, storeId: member.store.id, owner: true }, { id: String(id) });
}
