import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  END_AFTER_MINUTES,
  MESSAGE_MAX,
  TRANSCRIPT_DAYS_DEFAULT,
  TRANSCRIPT_DAYS_OFF,
  type ConversationStatus,
  type Handler,
  type MessageAuthor,
  type SupportMode,
} from "@/lib/support-rules";
import { REFUSALS, type Refusal, type SupportEvent } from "@/lib/support-state";
import type { ConversationRef, VisitorMessage, VisitorMessageData, VisitorState } from "@/lib/support-visitor";

import type { Desk } from "./support-desk";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Executor = Pick<Tx, "execute">;

/**
 * Support conversations (D216, `docs/support.md` 5.2): a desk's settings, its conversations and their messages. Every function takes
 * a `Desk` (`support-desk.ts`), so the caller's check was made, and every query names the desk's store. Messages are written only
 * through `commerce.support_add_message()` and a conversation's state only through `commerce.support_transition()`; their refusals
 * come back as `SupportError` with the code of 4.2.
 */

export class SupportError extends Error {
  constructor(readonly code: Refusal) {
    super(code);
    this.name = "SupportError";
  }
}

/** The database's refusal code in an error (Drizzle wraps the driver's error, so the chain of causes is walked), or null. */
export function supportCode(error: unknown): Refusal | null {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") {
      const code = REFUSALS.find((r) => message === r || message.startsWith(`${r}\n`) || message.endsWith(`: ${r}`));
      if (code) return code;
    }
  }
  return null;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = supportCode(error);
    if (code) throw new SupportError(code);
    throw error;
  }
}

const deskIs = (desk: Desk, column: SQL) => (desk.storeId ? sql`${column} = ${desk.storeId}::uuid` : sql`${column} is null`);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString());

// The desk -----------------------------------------------------------------------------------------------------------------------

export type DeskSettings = {
  mode: SupportMode;
  transcriptDays: number;
  endAfterMinutes: number;
  emailFollowup: boolean;
  channelKey: string;
};

/** The desk's settings, made on its first conversation with support off (S5): the chat agent alone, as before. */
export async function ensureDesk(desk: Desk): Promise<DeskSettings> {
  await db().execute(sql`
    insert into commerce.support_settings (store_id) values (${desk.storeId}::uuid)
    on conflict on constraint support_settings_store_key do nothing
  `);
  return (await deskSettings(desk))!;
}

/** The desk's settings, or null before its first conversation. */
export async function deskSettings(desk: Desk): Promise<DeskSettings | null> {
  const [row] = await db().execute<Row>(sql`
    select mode, transcript_days, end_after_minutes, email_followup, channel_key from commerce.support_settings where ${deskIs(desk, sql`store_id`)}
  `);
  if (!row) return null;
  return {
    mode: String(row.mode) as SupportMode,
    transcriptDays: Number(row.transcript_days),
    endAfterMinutes: Number(row.end_after_minutes),
    emailFollowup: Boolean(row.email_followup),
    channelKey: String(row.channel_key),
  };
}

// Conversations ------------------------------------------------------------------------------------------------------------------

export type Conversation = {
  id: string;
  storeId: string | null;
  status: ConversationStatus;
  handler: Handler;
  customerId: string | null;
  messageSeq: number;
  endedAt: string | null;
  channelKey: string;
  locale: string;
};

function toConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    storeId: row.store_id ? String(row.store_id) : null,
    status: String(row.status) as ConversationStatus,
    handler: String(row.handler) as Handler,
    customerId: row.customer_id ? String(row.customer_id) : null,
    messageSeq: Number(row.message_seq),
    endedAt: row.ended_at ? iso(row.ended_at) : null,
    channelKey: String(row.channel_key),
    locale: String(row.locale),
  };
}

const CONVERSATION_COLUMNS = sql`id, store_id, status, handler, customer_id, message_seq, ended_at, channel_key, locale`;

/** A new conversation on the visitor's site, started as the desk's mode says; its token is given once and kept only as a hash. */
export async function openConversation(
  desk: Desk,
  input: { mode: SupportMode; locale: string; market: string | null; pagePath: string | null; customerId: string | null },
): Promise<{ conversation: Conversation; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const [row] = await guarded(() =>
    db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, token_hash, customer_id, market, locale, page_path)
      values (${desk.storeId}::uuid, 'site', ${input.mode === "people" ? "queue" : "ai"}, ${sha256(token)}, ${desk.storeId ? input.customerId : null}::uuid,
        ${input.market}, ${input.locale.slice(0, 16)}, ${input.pagePath?.slice(0, 300) ?? null})
      returning ${CONVERSATION_COLUMNS}
    `),
  );
  return { conversation: toConversation(row), token };
}

/** The visitor's conversation on this desk when the token is its own, else null (another site's, a wrong token, or one that is gone). */
export async function visitorConversation(desk: Desk, ref: ConversationRef): Promise<Conversation | null> {
  const [row] = await db().execute<Row>(sql`
    select ${CONVERSATION_COLUMNS} from commerce.support_conversations
    where id = ${ref.id}::uuid and ${deskIs(desk, sql`store_id`)} and token_hash = ${sha256(ref.token)} and anonymised_at is null
  `);
  return row ? toConversation(row) : null;
}

/** Ties a conversation to the customer who signed in since it started (a store's desk only; never moves it to another customer). */
export async function claimForCustomer(desk: Desk, conversationId: string, customerId: string): Promise<void> {
  if (!desk.storeId) return;
  await db().execute(sql`
    update commerce.support_conversations set customer_id = ${customerId}::uuid
    where id = ${conversationId}::uuid and store_id = ${desk.storeId}::uuid and customer_id is null and anonymised_at is null
  `);
}

/** Writes a message (`support_add_message()`); null when the database dropped it (an answer from the AI after a person took over). */
export async function addMessage(
  desk: Desk,
  conversationId: string,
  author: MessageAuthor,
  accountId: string | null,
  body: string,
  extra: { kind?: string; data?: unknown } = {},
): Promise<{ id: string; seq: number } | null> {
  await assertOnDesk(desk, conversationId);
  const words = author === "system" ? "" : body.slice(0, MESSAGE_MAX[author]);
  const [row] = await guarded(() =>
    db().execute<Row>(sql`
      select * from commerce.support_add_message(${conversationId}::uuid, ${author}, ${accountId}::uuid, ${words}, ${extra.kind ?? null},
        ${extra.data === undefined ? null : JSON.stringify(extra.data)}::jsonb)
    `),
  );
  return row?.id ? { id: String(row.id), seq: Number(row.seq) } : null;
}

export type TransitionActor = { kind: "customer" | "ai" | "system" } | { kind: "agent"; id: string; name: string };

/** A change of who answers (`support_transition()`), returning the new handler. */
export async function transition(desk: Desk, conversationId: string, event: SupportEvent, actor: TransitionActor, extra: { target?: string | null; reason?: string | null } = {}): Promise<Handler> {
  await assertOnDesk(desk, conversationId);
  const [row] = await guarded(() =>
    db().execute<Row>(sql`
      select commerce.support_transition(${conversationId}::uuid, ${event}, ${actor.kind}, ${actor.kind === "agent" ? actor.id : null}::uuid,
        ${extra.target ?? null}::uuid, ${extra.reason ?? null}, ${actor.kind === "agent" ? actor.name : null}) as handler
    `),
  );
  return String(row.handler) as Handler;
}

async function assertOnDesk(desk: Desk, conversationId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`select 1 from commerce.support_conversations where id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)}`);
  if (!row) throw new SupportError("support_gone");
}

// What the visitor sees -----------------------------------------------------------------------------------------------------------

/** The messages after `after` that the visitor may see: never a note or the partner's help (a scan test holds the condition). */
export async function visitorFeed(desk: Desk, conversationId: string, after: number, limit = 100): Promise<VisitorMessage[]> {
  const rows = await db().execute<Row>(sql`
    select seq, author, body, kind, data, created_at from commerce.support_messages
    where conversation_id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)} and seq > ${after}
      and author in ('customer', 'ai', 'agent', 'system')
    order by seq limit ${limit}
  `);
  return rows.map((r) => ({
    seq: Number(r.seq),
    author: String(r.author) as VisitorMessage["author"],
    body: String(r.body),
    ...(r.kind ? { kind: String(r.kind) } : {}),
    ...(r.data ? { data: r.data as VisitorMessageData } : {}),
    at: iso(r.created_at),
  }));
}

/** The visitor has looked at the conversation now (shown to staff later, and for the email follow-up). */
export async function markSeen(desk: Desk, conversationId: string): Promise<void> {
  await db().execute(sql`update commerce.support_conversations set visitor_seen_at = now() where id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)}`);
}

/** The conversation's state as the visitor's widget draws it. */
export function visitorState(conversation: Pick<Conversation, "status" | "handler">, settings: DeskSettings, signedIn: boolean): VisitorState {
  return {
    status: conversation.status,
    handler: conversation.handler,
    mode: settings.mode,
    agent: null,
    queue: null,
    available: true,
    emailLeft: 0,
    signedIn,
    emailFollowup: settings.mode !== "off" && settings.emailFollowup,
  };
}

export const channelOf = (conversation: Pick<Conversation, "channelKey">) => `sc:${conversation.channelKey}`;

/** What the AI is given of the conversation: the last messages of the customer, the AI and people, oldest first (never notes or system lines). */
export async function historyForAi(desk: Desk, conversationId: string, limit: number): Promise<{ author: "customer" | "ai" | "agent"; body: string }[]> {
  const rows = await db().execute<Row>(sql`
    select author, body from commerce.support_messages
    where conversation_id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)} and author in ('customer', 'ai', 'agent')
    order by seq desc limit ${limit}
  `);
  return rows.reverse().map((r) => ({ author: String(r.author) as "customer" | "ai" | "agent", body: String(r.body) }));
}

// Ending, anonymising and deleting -------------------------------------------------------------------------------------------------

/**
 * Ends conversations with the AI that nobody has written in for the desk's `end_after_minutes` (30 by default; the five-minute
 * dispatcher). Conversations with a person or in the queue end by their own rules (steps 4 and 5).
 */
export async function endIdleConversations(now: Date = new Date(), limit = 500): Promise<number> {
  const rows = await db().execute<Row>(sql`
    select c.id from commerce.support_conversations c
    left join commerce.support_settings s on s.store_id is not distinct from c.store_id
    where c.status = 'open' and c.handler = 'ai' and c.anonymised_at is null
      and c.last_message_at < ${now.toISOString()}::timestamptz - make_interval(mins => coalesce(s.end_after_minutes, ${END_AFTER_MINUTES.default}))
    order by c.last_message_at limit ${limit}
  `);
  let ended = 0;
  for (const row of rows) {
    try {
      await db().execute(sql`select commerce.support_transition(${String(row.id)}::uuid, 'end', 'system', null, null, 'timeout', null)`);
      ended++;
    } catch (error) {
      // Someone else ended or took it in the meantime: nothing to do.
      if (!supportCode(error)) throw error;
    }
  }
  return ended;
}

/**
 * Anonymises conversations (3.5): an open one is ended first; its messages and actions are deleted (application code, the D162 rule);
 * the personal fields are cleared and `anonymised_at` set. Kept: the dates, the source, the handler, the tone number, the outcome,
 * the topics, the rating and the counts. The retention step and the erasure share it.
 */
export async function anonymiseConversations(executor: Executor, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const open = await executor.execute<Row>(sql`select id from commerce.support_conversations where id = any(${list}) and status = 'open' and anonymised_at is null`);
  for (const row of open) {
    await executor.execute(sql`select commerce.support_transition(${String(row.id)}::uuid, 'end', 'system', null, null, 'system', null)`);
  }
  await executor.execute(sql`delete from commerce.support_messages where conversation_id = any(${list})`);
  await executor.execute(sql`delete from commerce.support_actions where conversation_id = any(${list})`);
  const done = await executor.execute<Row>(sql`
    update commerce.support_conversations set
      contact_name = null, contact_email = null, page_path = null, ai_reason = null, rating_comment = null, brief = null,
      summary = case when summary is null then null else summary - 'text' - 'followUp' end,
      customer_id = null, requester_id = null, about_store_id = null, token_hash = null, email_token_hash = null,
      anonymised_at = now()
    where id = any(${list}) and anonymised_at is null
    returning id
  `);
  return done.length;
}

/**
 * Conversations whose transcript has passed its period, oldest first: the desk's own (support off: one day; else its 30, 60 or 90
 * days) or the retention rule's (`support_transcripts`), whichever ends first.
 */
export async function transcriptsDue(now: Date, ruleCutoff: Date, limit: number): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select c.id from commerce.support_conversations c
    left join commerce.support_settings s on s.store_id is not distinct from c.store_id
    where c.status = 'ended' and c.anonymised_at is null
      and (c.ended_at < ${ruleCutoff.toISOString()}::timestamptz
        or c.ended_at < ${now.toISOString()}::timestamptz - make_interval(days =>
          case when coalesce(s.mode, 'off') = 'off' then ${TRANSCRIPT_DAYS_OFF}::int else coalesce(s.transcript_days, ${TRANSCRIPT_DAYS_DEFAULT}::int) end))
    order by c.ended_at limit ${limit}
  `);
  return rows.map((r) => String(r.id));
}

/** Deletes anonymised conversations that ended before the records' cutoff (`support_records`, 24 months by default). */
export async function deleteOldRecords(cutoff: Date, limit = 5000): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.support_conversations where id in (
      select id from commerce.support_conversations
      where anonymised_at is not null and coalesce(ended_at, anonymised_at) < ${cutoff.toISOString()}::timestamptz
      limit ${limit})
    returning id
  `);
  return rows.length;
}
