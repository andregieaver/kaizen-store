import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { readKeepMonths } from "@/lib/assistant-keep";

import { audit, type Membership } from "./auth";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The AI manager's conversations kept for a period (wave 11 unit L, D391, `docs/dpia-ai.md` R6). The owner's choice per store is written
 * only by `saveAssistantKeep()`; the daily `runRetention()` step `assistant_conversations` calls `pruneAssistantConversations()`.
 *
 * What goes: every message older than its store's period (or the rule's, for Kaizena Flow's own conversations and stores that chose none),
 * decided approvals as old (their arguments can name a customer), and then a conversation left with no message, as long as nothing still
 * works in it: an autopilot plan (its conversation is its record) or a follow-up still waiting.
 */

/** The owner's choice for a store: null is the default period. */
export async function assistantKeepOf(storeId: string): Promise<number | null> {
  const row = await typedRow(z.object({ months: col.int.nullable() }), sql`select assistant_keep_months as months from commerce.stores where id = ${storeId}::uuid`);
  return row?.months ?? null;
}

/** Saves the owner's choice (the caller checks that they are an owner), audited with before and after. */
export async function saveAssistantKeep(owner: Pick<Membership, "account" | "store">, raw: unknown): Promise<{ ok: true; months: number | null } | { ok: false }> {
  const read = readKeepMonths(raw);
  if (!read.ok) return read;
  const before = await assistantKeepOf(owner.store.id);
  if (before === read.months) return read;
  await db().execute(sql`update commerce.stores set assistant_keep_months = ${read.months} where id = ${owner.store.id}::uuid`);
  refreshTag(storeTag(owner.store.slug));
  await audit(owner.account.id, owner.store.id, "store.assistant_keep", { before, after: read.months }, { area: "settings" });
  return read;
}

const IDS = z.object({ id: col.uuid });

/**
 * One round of the retention step: at most `batch` messages, approvals and conversations each, for a run that repeats it while a round
 * is full. `ruleMonths` is the rule's period (`retentionRule("assistant_conversations")`).
 */
export async function pruneAssistantConversations(now: Date, ruleMonths: number, batch: number): Promise<number> {
  const at = now.toISOString();
  // A store's own period, else the rule's; months are whole, so `make_interval` keeps the calendar's lengths.
  const cutoff = (store: ReturnType<typeof sql>) =>
    sql`${at}::timestamptz - make_interval(months => coalesce((select s.assistant_keep_months from commerce.stores s where s.id = ${store}), ${ruleMonths}))`;
  const messages = await typedRows(IDS, sql`
    delete from commerce.assistant_messages where id in (
      select m.id from commerce.assistant_messages m where m.created_at < ${cutoff(sql`m.store_id`)} order by m.created_at limit ${batch})
    returning id`);
  const approvals = await typedRows(IDS, sql`
    delete from commerce.assistant_approvals where id in (
      select a.id from commerce.assistant_approvals a
       where a.status <> 'pending' and coalesce(a.decided_at, a.created_at) < ${cutoff(sql`a.store_id`)}
       order by a.created_at limit ${batch})
    returning id`);
  const conversations = await typedRows(IDS, sql`
    delete from commerce.assistant_conversations where id in (
      select c.id from commerce.assistant_conversations c
       where c.updated_at < ${cutoff(sql`c.store_id`)}
         and not exists (select 1 from commerce.assistant_messages m where m.conversation_id = c.id)
         and not exists (select 1 from commerce.assistant_plans p where p.conversation_id = c.id)
         and not exists (select 1 from commerce.assistant_follow_ups f where f.conversation_id = c.id and f.status = 'waiting')
         and not exists (select 1 from commerce.assistant_approvals a where a.conversation_id = c.id and a.status = 'pending')
       order by c.updated_at limit ${batch})
    returning id`);
  return messages.length + approvals.length + conversations.length;
}
