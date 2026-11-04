import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  GUIDE_ANSWER_MAX,
  GUIDE_CONVERSATION_MAX,
  GUIDE_MESSAGE_MAX,
  isGuideLang,
  type GuideConversationRef,
  type GuideLang,
  type GuideMessage,
  type GuideMessageData,
} from "@/lib/docs-guide-shape";
import { REOPEN_HOURS } from "@/lib/support-rules";

import { guideKeeping } from "./docs-guide-settings";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The docs guide's conversations (wave 14 unit E5, D444): the only reader and writer of `commerce.docs_guide_conversations` and
 * `docs_guide_messages`. A reader of the docs is known only by their tab's token (kept as a hash), so a conversation is the tab's alone.
 *
 * Kept as the platform chat's are (D216, `docs/support.md` 3.5): a conversation nobody wrote in for Kaizena Flow's desk's time ends
 * (`endIdleGuideConversations()`, the five-minute dispatcher), a message within `REOPEN_HOURS` of its end opens it again, and after that a
 * new one starts; its transcript (the messages, the token and the page) is deleted after the desk's period, a day while the desk has support
 * off, or sooner when the retention rule `support_transcripts` says so (`guideTranscriptsDue()`, `anonymiseGuideConversations()`), and the
 * anonymised record (dates and counts) goes after `support_records` (`deleteOldGuideRecords()`), both in the daily retention run.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export type GuideConversation = { id: string; lang: GuideLang; messageSeq: number; endedAt: string | null };

const CONVERSATION = z.object({ id: col.uuid, lang: col.text, message_seq: col.int, ended_at: col.timestampOrNull });

function toConversation(row: z.output<typeof CONVERSATION>): GuideConversation {
  return { id: row.id, lang: isGuideLang(row.lang) ? row.lang : "en", messageSeq: row.message_seq, endedAt: row.ended_at };
}

/** A new conversation, and the token only the reader's tab will hold. */
export async function openGuideConversation(input: { lang: GuideLang; page: string | null }): Promise<{ conversation: GuideConversation; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const row = await typedRow(
    CONVERSATION,
    sql`
      insert into commerce.docs_guide_conversations (token_hash, lang, page_path)
      values (${sha256(token)}, ${input.lang}, ${input.page ? input.page.slice(0, 300) : null})
      returning id, lang, message_seq, ended_at
    `,
  );
  return { conversation: toConversation(row!), token };
}

/**
 * The reader's conversation when the token is its own and it can go on: not anonymised, not full, and ended (if at all) within
 * `REOPEN_HOURS`. Null otherwise (a wrong token, another tab's, one that is gone or too old), and the reader starts a new one.
 */
export async function guideConversation(ref: GuideConversationRef): Promise<GuideConversation | null> {
  const row = await typedRow(
    CONVERSATION,
    sql`
      select id, lang, message_seq, ended_at from commerce.docs_guide_conversations
      where id = ${ref.id}::uuid and token_hash = ${sha256(ref.token)} and anonymised_at is null
        and message_seq < ${GUIDE_CONVERSATION_MAX}
        and (ended_at is null or ended_at > now() - make_interval(hours => ${REOPEN_HOURS}))
    `,
  );
  return row ? toConversation(row) : null;
}

/**
 * Adds a message, numbered after the last, and keeps the conversation open (an ended one opens again). Null when the conversation is gone
 * (anonymised in the meantime) or full. A reader's words are cut to `GUIDE_MESSAGE_MAX`, the guide's to `GUIDE_ANSWER_MAX`.
 */
export async function addGuideMessage(conversationId: string, author: "reader" | "ai", body: string, data: GuideMessageData | null = null): Promise<{ seq: number } | null> {
  const text = body.trim().slice(0, author === "reader" ? GUIDE_MESSAGE_MAX : GUIDE_ANSWER_MAX);
  if (!text) return null;
  return typedRow(
    z.object({ seq: col.int }),
    sql`
      with c as (
        update commerce.docs_guide_conversations
        set message_seq = message_seq + 1, last_message_at = now(), ended_at = null,
          unanswered = unanswered + ${author === "ai" && data?.support ? 1 : 0}
        where id = ${conversationId}::uuid and anonymised_at is null and message_seq < ${GUIDE_CONVERSATION_MAX}
        returning message_seq
      )
      insert into commerce.docs_guide_messages (conversation_id, seq, author, body, data)
      select ${conversationId}::uuid, c.message_seq, ${author}, ${text}, ${data ? JSON.stringify(data) : null}::jsonb from c
      returning seq
    `,
  );
}

const MESSAGE = z.object({ seq: col.int, author: z.enum(["reader", "ai"]), body: col.text, data: z.unknown(), created_at: col.timestamp });

/** What a message's `data` may show the reader: the pages it used, a page it opened and the support it offered (never the prompt's version). */
function shown(data: unknown): Pick<GuideMessage, "links" | "action" | "support"> {
  if (!data || typeof data !== "object") return {};
  const d = data as GuideMessageData;
  return {
    ...(Array.isArray(d.links) && d.links.length > 0 && { links: d.links }),
    ...(d.action && { action: d.action }),
    ...(d.support && { support: d.support }),
  };
}

/** The conversation's messages after `after`, as the reader's panel draws them. */
export async function guideFeed(conversationId: string, after: number, executor: Executor = db()): Promise<GuideMessage[]> {
  const rows = await typedRows(
    MESSAGE,
    sql`select seq, author, body, data, created_at from commerce.docs_guide_messages where conversation_id = ${conversationId}::uuid and seq > ${after} order by seq`,
    executor,
  );
  return rows.map((r) => ({ seq: r.seq, author: r.author, body: r.body, at: r.created_at, ...shown(r.data) }));
}

/** The newest messages of a conversation, oldest first, for the model: the reader's as the user's, the guide's as the assistant's. */
export async function guideHistory(conversationId: string, limit: number): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await typedRows(
    z.object({ author: z.enum(["reader", "ai"]), body: col.text }),
    sql`
      select author, body from (
        select seq, author, body from commerce.docs_guide_messages where conversation_id = ${conversationId}::uuid order by seq desc limit ${limit}
      ) m order by seq
    `,
  );
  return rows.map((r) => ({ role: r.author === "reader" ? "user" : "assistant", content: r.body }));
}

// Keeping ---------------------------------------------------------------------------------------------------------------------------

/** Ends the conversations nobody wrote in for Kaizena Flow's desk's time (the platform chat's AI conversations' rule), so their period begins. */
export async function endIdleGuideConversations(now: Date = new Date(), limit = 1000): Promise<number> {
  const { endAfterMinutes } = await guideKeeping(db());
  const rows = await db().execute(sql`
    update commerce.docs_guide_conversations set ended_at = last_message_at + make_interval(mins => ${endAfterMinutes})
    where id in (
      select id from commerce.docs_guide_conversations
      where ended_at is null and anonymised_at is null
        and last_message_at < ${now.toISOString()}::timestamptz - make_interval(mins => ${endAfterMinutes})
      order by last_message_at limit ${limit}
    )
    returning 1
  `);
  return rows.length;
}

/**
 * Conversations whose transcript is due (`support_transcripts`, as the platform chat's): ended before the rule's cutoff, or longer ago than
 * Kaizena Flow's desk keeps its conversations (a day while it has support off).
 */
export async function guideTranscriptsDue(now: Date, ruleCutoff: Date, limit: number): Promise<string[]> {
  const { transcriptDays } = await guideKeeping(db());
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select id from commerce.docs_guide_conversations
      where ended_at is not null and anonymised_at is null
        and (ended_at < ${ruleCutoff.toISOString()}::timestamptz
          or ended_at < ${now.toISOString()}::timestamptz - make_interval(days => ${transcriptDays}))
      order by ended_at limit ${limit}
    `,
  );
  return rows.map((r) => r.id);
}

/**
 * Deletes the conversations' messages and clears their token and page (application code, the D162 rule); the dates and counts stay for
 * `support_records`. The number anonymised.
 */
export async function anonymiseGuideConversations(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = sql`${`{${ids.join(",")}}`}::uuid[]`;
  return db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.docs_guide_messages where conversation_id = any(${list})`);
    const rows = await tx.execute(sql`
      update commerce.docs_guide_conversations set token_hash = null, page_path = null, anonymised_at = now(), ended_at = coalesce(ended_at, now())
      where id = any(${list}) and anonymised_at is null
      returning 1
    `);
    return rows.length;
  });
}

/** The transcripts due, anonymised in batches: the retention run's share for the guide in `support_transcripts`. */
export async function pruneGuideTranscripts(now: Date, ruleCutoff: Date, batch: number, rounds = 20): Promise<number> {
  let count = 0;
  for (let round = 0; round < rounds; round++) {
    const ids = await guideTranscriptsDue(now, ruleCutoff, batch);
    if (ids.length === 0) break;
    count += await anonymiseGuideConversations(ids);
    if (ids.length < batch) break;
  }
  return count;
}

/** Deletes anonymised conversations that ended before the records' cutoff (`support_records`, 24 months by default). */
export async function deleteOldGuideRecords(cutoff: Date, limit = 5000): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.docs_guide_conversations where id in (
      select id from commerce.docs_guide_conversations
      where anonymised_at is not null and coalesce(ended_at, anonymised_at) < ${cutoff.toISOString()}::timestamptz
      limit ${limit})
    returning 1
  `);
  return rows.length;
}
