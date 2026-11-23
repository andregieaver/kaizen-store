"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { unsubscribeByStaff } from "@/server/marketing-subscribers";
import { archiveTopic, moveTopic, saveTopic } from "@/server/marketing-topics";
import type { TopicChange } from "@/components/admin/topics-card";
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

/**
 * Every change to the store's topics (email plan M4.2, D882) in one action, so the topics add one server reference: a save (`id` null adds
 * one), an archive or bringing back, a move up or down.
 */
export async function topicAction(storeSlug: string, change: TopicChange): Promise<Problem | { ok: true }> {
  const { member, w } = await topicWriter(storeSlug);
  if (change.op === "archive") {
    await archiveTopic(member.store.id, member.account.id, String(change.id), change.archived === true);
  } else if (change.op === "move") {
    await moveTopic(member.store.id, member.account.id, String(change.id), change.by < 0 ? -1 : 1);
  } else {
    const result = await saveTopic(member.store.id, member.account.id, change.id ?? null, change.input);
    if (!result.ok)
      return { ok: false, problem: result.problem === "full" ? w.full : result.problem === "input" ? (result.message === "Give the topic a name." || !result.message ? w.needsName : result.message) : w.gone };
  }
  refresh();
  return { ok: true };
}
