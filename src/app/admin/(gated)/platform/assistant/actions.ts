"use server";

import { updateTag } from "next/cache";
import { after } from "next/server";

import { requirePlatformAdmin } from "@/server/auth";
import type { Approval, Conversation, Principal } from "@/server/owner-assistant";
import { deleteSkill, saveSkill } from "@/server/assistant-saved-skills";
import { hearOwner } from "@/server/page-ai";
import { readRecording, unreadable } from "@/server/page-studio-input";

/** The AI manager's server side, loaded when an admin first uses the panel, not with every admin page (bloat review step 0.5). */
const assistant = () => import("@/server/owner-assistant");

/** Kaizen's AI manager's actions (D103): for platform admins only. */
async function principal(): Promise<Principal> {
  return { account: await requirePlatformAdmin(), store: null };
}

/** What the panel needs when it first opens. */
export async function startPlatformAssistantAction() {
  const p = await principal();
  const { assistantAbilities, listConversations } = await assistant();
  const [abilities, conversations] = await Promise.all([assistantAbilities(null), listConversations(p)]);
  return { abilities, conversations };
}

export async function loadPlatformConversationAction(conversationId: string): Promise<Conversation | null> {
  const p = await principal();
  const { getConversation } = await assistant();
  return getConversation(p, String(conversationId));
}

export async function decidePlatformApprovalAction(approvalId: string, approve: boolean): Promise<Approval | null> {
  const p = await principal();
  const { decideApproval } = await assistant();
  return decideApproval(p, String(approvalId), approve === true, (tag) => updateTag(tag));
}

export async function deletePlatformConversationAction(conversationId: string): Promise<boolean> {
  const p = await principal();
  const { deleteConversation } = await assistant();
  return deleteConversation(p, String(conversationId));
}

export async function ratePlatformAnswerAction(messageId: string, value: 1 | -1 | null): Promise<boolean> {
  const thumb = value === 1 || value === -1 ? value : null;
  const p = await principal();
  const { rateAnswer } = await assistant();
  return rateAnswer(p, String(messageId), thumb, null, (task) => after(task));
}

export async function platformHearAction(form: FormData) {
  await principal();
  const audio = readRecording(form);
  return audio ? hearOwner(null, audio) : unreadable;
}

/**
 * The name of the admin page the owner is on, for the chat's first suggestion: the admin map stays on the server (bloat review step 0.11).
 * It reads no store data and writes nothing; a path that does not start with /admin is refused. A Norwegian account gets the page's Norwegian title.
 */
export async function pagePlatformHereAction(pathname: string): Promise<string | null> {
  const p = await principal();
  if (typeof pathname !== "string" || pathname.length > 300 || !pathname.startsWith("/admin")) return null;
  const [{ matchPath }, { PAGES_NB }, { adminLangOf }] = await Promise.all([
    import("@/lib/admin-map"),
    import("@/lib/admin-messages/pages.nb"),
    import("@/lib/admin-lang"),
  ]);
  const here = matchPath(pathname);
  const page =
    here && here.page.id !== "assistant" && (here.page.area === "platform" || here.page.area === "account") ? here.page : null;
  if (!page) return null;
  return adminLangOf(p.account.adminLocale) === "nb" ? (PAGES_NB[`${page.area}:${page.id}`]?.title ?? page.title) : page.title;
}

/** A skill a platform admin saves or changes for Kaizena Flow's own AI manager (D350); theirs alone, never shared. */
export async function savePlatformSkillAction(input: { id?: string; title: string; when: string; steps: string }) {
  const p = await principal();
  return saveSkill(
    { accountId: p.account.id, storeId: null, owner: false },
    { id: typeof input.id === "string" ? input.id : undefined, title: String(input.title ?? ""), when: String(input.when ?? ""), steps: String(input.steps ?? "") },
  );
}

export async function deletePlatformSkillAction(id: string): Promise<boolean> {
  const p = await principal();
  return deleteSkill({ accountId: p.account.id, storeId: null, owner: false }, { id: String(id) });
}
