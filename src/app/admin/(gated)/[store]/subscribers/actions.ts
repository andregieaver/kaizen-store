"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { unsubscribeByStaff } from "@/server/marketing-subscribers";
import { archiveTopic, moveTopic, saveTopic } from "@/server/marketing-topics";
import { requirePermission } from "@/server/permissions";

/** Staff unsubscribing a person who asked by other means (D295): `marketing:write`, audited with the id only. */
export async function unsubscribeAction(storeSlug: string, subscriberId: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!z.uuid().safeParse(subscriberId).success) return;
  await unsubscribeByStaff(member.store.id, member.account.id, subscriberId);
  refresh();
}

type Problem = { ok: false; problem: string };

/** The topic problems in the account's language. */
async function topicWriter(storeSlug: string) {
  const member = await requirePermission(storeSlug, "marketing:write");
  return { member, w: MARKETING_WORDS[adminLangOf(member.account.adminLocale)].topics };
}

/** Adds a topic (`id` null) or renames one (email plan M4.2, D882). */
export async function saveTopicAction(storeSlug: string, id: string | null, input: unknown): Promise<Problem | { ok: true }> {
  const { member, w } = await topicWriter(storeSlug);
  const result = await saveTopic(member.store.id, member.account.id, id, input);
  if (result.ok) {
    refresh();
    return { ok: true };
  }
  return { ok: false, problem: result.problem === "full" ? w.full : result.problem === "input" && result.message === "Give the topic a name." ? w.needsName : result.problem === "input" ? (result.message ?? w.needsName) : w.gone };
}

/** Archives a topic or brings it back. */
export async function archiveTopicAction(storeSlug: string, id: string, archived: boolean): Promise<void> {
  const { member } = await topicWriter(storeSlug);
  await archiveTopic(member.store.id, member.account.id, id, archived);
  refresh();
}

/** Moves a topic one place up or down. */
export async function moveTopicAction(storeSlug: string, id: string, by: number): Promise<void> {
  const { member } = await topicWriter(storeSlug);
  await moveTopic(member.store.id, member.account.id, id, by < 0 ? -1 : 1);
  refresh();
}
