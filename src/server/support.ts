import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import type { OpeningHours } from "@/lib/opening-hours";
import { parseOpeningHours } from "@/lib/opening-hours-schema";
import { deskAvailability, type AgentPresence, type Availability } from "@/lib/support-hours";
import {
  AI_REASON_MAX,
  CONTACT_CHANGES_MAX,
  EMAILS_MAX,
  END_AFTER_MINUTES,
  HUMAN_IDLE_END_HOURS,
  MESSAGE_MAX,
  NOTIFY_AFTER_MINUTES,
  ONLINE_SECONDS,
  QUEUE_GIVE_UP_DAYS,
  TRANSCRIPT_DAYS_DEFAULT,
  TRANSCRIPT_DAYS_OFF,
  type ConversationStatus,
  type Handler,
  type MessageAuthor,
  type SupportMode,
} from "@/lib/support-rules";
import { REFUSALS, type Refusal, type SupportEvent } from "@/lib/support-state";
import type { ToneBand } from "@/lib/support-tone";
import type { ConversationRef, VisitorMessage, VisitorMessageData, VisitorState } from "@/lib/support-visitor";

import { avatarPictureUrl } from "@/lib/avatar";

import type { Desk } from "./support-desk";

/** Kaizen's own desk keeps Norway's time (its company's). */
export const KAIZEN_TIME_ZONE = "Europe/Oslo";

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
  /** How a person is named to customers: their first name, or the desk's name (D216, 2.10). */
  agentNaming: "first_name" | "desk";
  /** When people answer, in the desk's time zone; null: whenever someone is online (2.3). */
  hours: OpeningHours | null;
  /** Email the desk's people after a conversation has waited this long (2.9). */
  notifyAfterMinutes: number;
  /** Customers' messages are scored for tone (2.6), and the lines of the alert and of the hand-over to a person (the AI first), or null for off. */
  toneOn: boolean;
  toneAlert: number | null;
  toneHandoff: number | null;
};

/** The desk's settings, made on its first conversation with support off (S5): the chat agent alone, as before. */
export async function ensureDesk(desk: Desk): Promise<DeskSettings> {
  await db().execute(sql`
    insert into commerce.support_settings (store_id) values (${desk.storeId}::uuid)
    on conflict on constraint support_settings_store_key do nothing
  `);
  return (await deskSettings(desk))!;
}

/** A settings row as the code reads it (also from the cached read in `chat-agent.ts`). */
export function settingsOf(row: Row): DeskSettings {
  return {
    mode: String(row.mode) as SupportMode,
    transcriptDays: Number(row.transcript_days),
    endAfterMinutes: Number(row.end_after_minutes),
    emailFollowup: Boolean(row.email_followup),
    channelKey: String(row.channel_key),
    agentNaming: row.agent_naming === "desk" ? "desk" : "first_name",
    hours: row.hours ? parseOpeningHours(row.hours) : null,
    notifyAfterMinutes: Number(row.notify_after_minutes ?? NOTIFY_AFTER_MINUTES.default),
    toneOn: row.tone_on === undefined ? true : Boolean(row.tone_on),
    toneAlert: row.tone_alert === null || row.tone_alert === undefined ? null : Number(row.tone_alert),
    toneHandoff: row.tone_handoff === null || row.tone_handoff === undefined ? null : Number(row.tone_handoff),
  };
}

/** The desk's settings, or null before its first conversation. */
export async function deskSettings(desk: Desk): Promise<DeskSettings | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.support_settings where ${deskIs(desk, sql`store_id`)}`);
  return row ? settingsOf(row) : null;
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
  assigneeId: string | null;
  /** In the queue since (for the place in line). */
  queuedAt: string | null;
  /** The email the visitor left for answers (typed, never proof), and how often they changed it. */
  contactEmail: string | null;
  contactChanges: number;
  emailCount: number;
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
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    queuedAt: row.queued_at ? iso(row.queued_at) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null,
    contactChanges: Number(row.contact_changes ?? 0),
    emailCount: Number(row.email_count ?? 0),
  };
}

const CONVERSATION_COLUMNS = sql`id, store_id, status, handler, customer_id, message_seq, ended_at, channel_key, locale, assignee_id, queued_at, contact_email, contact_changes, email_count`;

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

/**
 * The visitor's conversation on this desk when the token is its own (the tab's, or the newest answer email's link), else null
 * (another site's, a wrong or replaced token, or one that is gone).
 */
export async function visitorConversation(desk: Desk, ref: ConversationRef): Promise<Conversation | null> {
  const hash = sha256(ref.token);
  const [row] = await db().execute<Row>(sql`
    select ${CONVERSATION_COLUMNS} from commerce.support_conversations
    where id = ${ref.id}::uuid and ${deskIs(desk, sql`store_id`)} and (token_hash = ${hash} or email_token_hash = ${hash}) and anonymised_at is null
  `);
  return row ? toConversation(row) : null;
}

/** The conversation an answer email's link opens (its token alone; the newest email's only), on this desk, or null. */
export async function conversationByEmailToken(desk: Desk, token: string): Promise<Conversation | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select ${CONVERSATION_COLUMNS} from commerce.support_conversations
    where email_token_hash = ${sha256(token)} and ${deskIs(desk, sql`store_id`)} and anonymised_at is null
  `);
  return row ? toConversation(row) : null;
}

/**
 * A new link for the conversation's answer emails: a fresh token whose hash replaces the last one, so only the newest email's link
 * opens it (the token itself is never kept, 2.3).
 */
export async function newEmailToken(desk: Desk, conversationId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db().execute(sql`
    update commerce.support_conversations set email_token_hash = ${sha256(token)}
    where id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)}
  `);
  return token;
}

/** The AI's words when it handed the conversation to a person (2.3), shown to staff as text. */
export async function setAiReason(desk: Desk, conversationId: string, reason: string): Promise<void> {
  await db().execute(sql`
    update commerce.support_conversations set ai_reason = ${reason.slice(0, AI_REASON_MAX)}
    where id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)}
  `);
}

export type ContactResult = { ok: true } | { ok: false; reason: "off" | "changes" };

/**
 * The email (and name) the visitor left for answers (2.3): typed, never proof, used only to send the answers. At most
 * `CONTACT_CHANGES_MAX` changes a conversation; a desk without email follow-up takes none.
 */
export async function setContact(desk: Desk, conversationId: string, settings: Pick<DeskSettings, "mode" | "emailFollowup">, contact: { name: string | null; email: string }): Promise<ContactResult> {
  if (settings.mode === "off" || !settings.emailFollowup) return { ok: false, reason: "off" };
  const rows = await db().execute<Row>(sql`
    update commerce.support_conversations set contact_email = ${contact.email}, contact_name = ${contact.name}, contact_changes = contact_changes + 1
    where id = ${conversationId}::uuid and ${deskIs(desk, sql`store_id`)} and anonymised_at is null and contact_changes < ${CONTACT_CHANGES_MAX}
    returning id
  `);
  return rows.length > 0 ? { ok: true } : { ok: false, reason: "changes" };
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

/** What the visitor's state needs beyond the conversation: where it stands in line, whether anyone can answer, and the follow-up email. */
export type VisitorExtras = {
  agent?: AgentIdentity | null;
  queuePosition?: number | null;
  available?: boolean;
  /** Where answers will be emailed: the email the visitor left, or a signed-in customer's own. */
  followupEmail?: string | null;
};

/** The conversation's state as the visitor's widget draws it; `agent` is the person who has it, as customers see them. */
export function visitorState(
  conversation: Pick<Conversation, "status" | "handler" | "emailCount">,
  settings: DeskSettings,
  signedIn: boolean,
  extras: VisitorExtras = {},
): VisitorState {
  const open = conversation.status === "open";
  const followup = settings.mode !== "off" && settings.emailFollowup;
  return {
    status: conversation.status,
    handler: conversation.handler,
    mode: settings.mode,
    agent: open && conversation.handler === "human" ? (extras.agent ?? null) : null,
    queue: open && conversation.handler === "queue" && extras.queuePosition ? { position: extras.queuePosition } : null,
    available: open && conversation.handler === "queue" ? (extras.available ?? true) : true,
    emailLeft: followup ? Math.max(0, EMAILS_MAX - conversation.emailCount) : 0,
    signedIn,
    emailFollowup: followup,
    followupEmail: followup ? (extras.followupEmail ?? null) : null,
  };
}

/** The conversation's place in the desk's queue (1 is next), or null when it is not waiting. */
export async function queuePosition(desk: Desk, conversation: Pick<Conversation, "id" | "status" | "handler" | "queuedAt">): Promise<number | null> {
  if (conversation.status !== "open" || conversation.handler !== "queue" || !conversation.queuedAt) return null;
  // Compared in the database: a time read into JavaScript loses its microseconds.
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_conversations c,
      (select queued_at, id from commerce.support_conversations where id = ${conversation.id}::uuid) me
    where ${deskIs(desk, sql`c.store_id`)} and c.status = 'open' and c.handler = 'queue' and c.anonymised_at is null
      and (c.queued_at < me.queued_at or (c.queued_at = me.queued_at and c.id <= me.id))
  `);
  return Math.max(1, Number(row?.n ?? 1));
}

/** The desk's people as presence knows them (online or away, and when last seen). */
export async function deskPresence(desk: Desk): Promise<AgentPresence[]> {
  const rows = await db().execute<Row>(sql`select status, last_seen_at from commerce.support_agents where ${deskIs(desk, sql`store_id`)}`);
  return rows.map((r) => ({ status: r.status === "online" ? "online" : "away", lastSeenAt: r.last_seen_at ? new Date(iso(r.last_seen_at)) : null }));
}

/** The desk's time zone: its store's, or Kaizen's. */
export async function deskTimeZone(desk: Desk): Promise<string> {
  if (!desk.storeId) return KAIZEN_TIME_ZONE;
  const [row] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${desk.storeId}::uuid`);
  return row?.time_zone ? String(row.time_zone) : KAIZEN_TIME_ZONE;
}

/** Whether the desk can answer now (2.3): someone online, inside its hours. */
export async function availabilityOf(desk: Desk, settings: Pick<DeskSettings, "hours">, now: Date = new Date()): Promise<Availability> {
  const [agents, timeZone] = await Promise.all([deskPresence(desk), deskTimeZone(desk)]);
  return deskAvailability({ agents, now, hours: settings.hours, timeZone });
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
 * Ends the conversations whose time is up (the five-minute dispatcher): with the AI, nobody has written for the desk's
 * `end_after_minutes` (30 by default); with a person, nobody has written for `HUMAN_IDLE_END_HOURS`; in the queue, nobody took it
 * for `QUEUE_GIVE_UP_DAYS` (2.3). Ended by the system with reason `timeout`.
 */
export async function endIdleConversations(now: Date = new Date(), limit = 500): Promise<number> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db().execute<Row>(sql`
    select c.id from commerce.support_conversations c
    left join commerce.support_settings s on s.store_id is not distinct from c.store_id
    where c.status = 'open' and c.anonymised_at is null and (
      (c.handler = 'ai' and c.last_message_at < ${at} - make_interval(mins => coalesce(s.end_after_minutes, ${END_AFTER_MINUTES.default})))
      or (c.handler = 'human' and c.last_message_at < ${at} - make_interval(hours => ${HUMAN_IDLE_END_HOURS}))
      or (c.handler = 'queue' and coalesce(c.queued_at, c.created_at) < ${at} - make_interval(days => ${QUEUE_GIVE_UP_DAYS})))
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

// Staff: the inbox (D216, step 3) ---------------------------------------------------------------------------------------------------

/** The inbox's tabs (2.4): waiting for a person, the agent's own, with the AI, every open one, and ended ones. */
export const INBOX_TABS = ["waiting", "mine", "ai", "open", "ended"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export type InboxFilters = { tab: InboxTab; q?: string; storeId?: string | null; tone?: ToneBand };

/** A tone band as a condition on a conversation alias `c` (2.6's edges). */
function toneBandCondition(band: ToneBand): SQL {
  switch (band) {
    case "very_bad":
      return sql`c.tone <= -60`;
    case "bad":
      return sql`c.tone between -59 and -20`;
    case "neutral":
      return sql`c.tone between -19 and 19`;
    case "good":
      return sql`c.tone between 20 and 59`;
    case "very_good":
      return sql`c.tone >= 60`;
  }
}

export type InboxRow = {
  id: string;
  /** The store's slug and name at the owner's level; null on a single desk. */
  store: { slug: string; name: string } | null;
  status: ConversationStatus;
  handler: Handler;
  source: "site" | "admin";
  /** Who wrote: the customer's or the account's name, else their email, else "Visitor" and four letters of the id. */
  who: string;
  email: string | null;
  signedIn: boolean;
  /** The last message's first line (a customer's, the AI's or a person's). */
  preview: string;
  lastMessageAt: string;
  /** In the queue since, for "Waiting 3 min". */
  queuedAt: string | null;
  assignee: { id: string; name: string } | null;
  tone: number | null;
  unread: boolean;
  summaryTitle: string | null;
  endedAt: string | null;
  /** The tone fell to the desk's alert line (or by 40) and the conversation is still open (2.6). */
  toneAlert: boolean;
};

const PREVIEW_MAX = 140;
const LIST_MAX = 100;

/** The desks' ids as a SQL condition on a conversation alias `c` (Kaizen's desk is `store_id is null`). */
function onDesks(desks: Desk[]): SQL {
  const ids = desks.map((d) => d.storeId).filter((id): id is string => id !== null);
  const kaizen = desks.some((d) => d.storeId === null);
  const parts: SQL[] = [];
  if (ids.length > 0) parts.push(sql`c.store_id = any(array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`);
  if (kaizen) parts.push(sql`c.store_id is null`);
  return parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` or `)})`;
}

function tabCondition(tab: InboxTab, accountId: string): SQL {
  switch (tab) {
    case "waiting":
      return sql`c.status = 'open' and c.handler = 'queue'`;
    case "mine":
      return sql`c.status = 'open' and c.handler = 'human' and c.assignee_id = ${accountId}::uuid`;
    case "ai":
      return sql`c.status = 'open' and c.handler = 'ai'`;
    case "open":
      return sql`c.status = 'open'`;
    case "ended":
      return sql`c.status = 'ended'`;
  }
}

/** Words to search for, escaped for `ilike` (a person's name, an email, a summary's title). */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export const visitorLabel = (id: string) => `Visitor ${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

/**
 * The inbox's list for one or several desks (the owner's level), newest first (the queue oldest first), at most 100 rows. Never an
 * anonymised conversation. A row is unread for the account when it has messages after the last the account read.
 */
export async function staffList(desks: Desk[], accountId: string, filters: InboxFilters): Promise<InboxRow[]> {
  const q = filters.q?.trim().slice(0, 100);
  const storeOnly = filters.storeId ? sql`and c.store_id = ${filters.storeId}::uuid` : sql``;
  const toneOnly = filters.tone ? sql`and ${toneBandCondition(filters.tone)}` : sql``;
  const search = q
    ? sql`and (cu.name ilike ${likeOf(q)} or cu.email ilike ${likeOf(q)} or c.contact_name ilike ${likeOf(q)} or c.contact_email ilike ${likeOf(q)}
        or ra.name ilike ${likeOf(q)} or ra.email ilike ${likeOf(q)} or c.summary->>'title' ilike ${likeOf(q)})`
    : sql``;
  const order = filters.tab === "waiting" ? sql`c.queued_at asc nulls last, c.created_at asc` : sql`c.last_message_at desc`;
  const rows = await db().execute<Row>(sql`
    select c.id, c.status, c.handler, c.source, c.last_message_at, c.queued_at, c.tone, c.tone_alert_at, c.ended_at, c.message_seq, c.customer_id,
      c.summary->>'title' as summary_title,
      s.slug as store_slug, s.name as store_name,
      coalesce(nullif(cu.name, ''), nullif(c.contact_name, ''), nullif(ra.name, '')) as who_name,
      coalesce(cu.email, c.contact_email, ra.email) as who_email,
      a.id as assignee_id, coalesce(nullif(a.name, ''), a.email) as assignee_name,
      coalesce(rd.last_read_seq, 0) as last_read,
      (select m.body from commerce.support_messages m
        where m.conversation_id = c.id and m.author in ('customer', 'ai', 'agent') order by m.seq desc limit 1) as preview
    from commerce.support_conversations c
    left join commerce.stores s on s.id = c.store_id
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    left join commerce.accounts ra on ra.id = c.requester_id
    left join commerce.accounts a on a.id = c.assignee_id
    left join commerce.support_reads rd on rd.conversation_id = c.id and rd.account_id = ${accountId}::uuid
    where ${onDesks(desks)} and c.anonymised_at is null and ${tabCondition(filters.tab, accountId)} ${storeOnly} ${toneOnly} ${search}
    order by ${order}
    limit ${LIST_MAX}
  `);
  const several = desks.length > 1;
  return rows.map((r) => ({
    id: String(r.id),
    store: several && r.store_slug ? { slug: String(r.store_slug), name: String(r.store_name) } : null,
    status: String(r.status) as ConversationStatus,
    handler: String(r.handler) as Handler,
    source: String(r.source) as InboxRow["source"],
    who: r.who_name ? String(r.who_name) : r.who_email ? String(r.who_email) : visitorLabel(String(r.id)),
    email: r.who_email ? String(r.who_email) : null,
    signedIn: Boolean(r.customer_id),
    preview: firstLine(r.preview ? String(r.preview) : ""),
    lastMessageAt: iso(r.last_message_at),
    queuedAt: r.queued_at ? iso(r.queued_at) : null,
    assignee: r.assignee_id ? { id: String(r.assignee_id), name: String(r.assignee_name) } : null,
    tone: r.tone == null ? null : Number(r.tone),
    unread: Number(r.message_seq) > Number(r.last_read),
    summaryTitle: r.summary_title ? String(r.summary_title) : null,
    endedAt: r.ended_at ? iso(r.ended_at) : null,
    toneAlert: r.status === "open" && r.tone_alert_at !== null,
  }));
}

/** When a tone alert was last raised on the desks' open conversations (the inbox notifies when it moves), or null. */
export async function lastToneAlert(desks: Desk[]): Promise<string | null> {
  if (desks.length === 0) return null;
  const [row] = await db().execute<Row>(sql`
    select max(c.tone_alert_at) as at from commerce.support_conversations c
    where ${onDesks(desks)} and c.status = 'open' and c.anonymised_at is null
  `);
  return row?.at ? iso(row.at) : null;
}

const firstLine = (text: string) => {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
};

/** How many conversations wait for a person on the desks (the tabs' badges). */
export async function waitingCount(desks: Desk[]): Promise<number> {
  if (desks.length === 0) return 0;
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_conversations c
    where ${onDesks(desks)} and c.status = 'open' and c.handler = 'queue' and c.anonymised_at is null
  `);
  return Number(row?.n ?? 0);
}

/** How many of the account's own open conversations have a customer message after the last it read (the inbox's alerts, 2.9). */
export async function mineUnreadCount(desks: Desk[], accountId: string): Promise<number> {
  if (desks.length === 0) return 0;
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_conversations c
    left join commerce.support_reads rd on rd.conversation_id = c.id and rd.account_id = ${accountId}::uuid
    where ${onDesks(desks)} and c.status = 'open' and c.handler = 'human' and c.assignee_id = ${accountId}::uuid and c.anonymised_at is null
      and exists (select 1 from commerce.support_messages m where m.conversation_id = c.id and m.author = 'customer' and m.seq > coalesce(rd.last_read_seq, 0))
  `);
  return Number(row?.n ?? 0);
}

/** A message as staff see it: every author, notes and the partner's help included, with the person who wrote it. */
export type StaffMessage = {
  seq: number;
  author: MessageAuthor;
  body: string;
  kind: string | null;
  data: unknown;
  /** The agent's or note writer's name. */
  by: string | null;
  tone: number | null;
  toneLabel: string | null;
  /** Which tools an AI answer used, by name. */
  tools: string[];
  at: string;
};

export type StaffConversation = {
  id: string;
  store: { slug: string; name: string } | null;
  status: ConversationStatus;
  handler: Handler;
  source: "site" | "admin";
  who: string;
  email: string | null;
  signedIn: boolean;
  locale: string;
  market: string | null;
  pagePath: string | null;
  assignee: { id: string; name: string } | null;
  tone: number | null;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  handoffReason: string | null;
  summary: { title: string; text: string; outcome: string; topics: string[] } | null;
  rating: string | null;
  messageSeq: number;
  /** The desk scores customers' messages (support and tone on): a customer message without a score is *not measured*. */
  toneMeasured: boolean;
  toneAlertAt: string | null;
  messages: StaffMessage[];
};

/** A conversation on the desk for staff, with its messages after `after` (at most 200), or null when it is not the desk's or is gone. */
export async function staffConversation(desk: Desk, conversationId: string, after = 0): Promise<StaffConversation | null> {
  const [c] = await db().execute<Row>(sql`
    select c.*, s.slug as store_slug, s.name as store_name,
      coalesce(nullif(cu.name, ''), nullif(c.contact_name, ''), nullif(ra.name, '')) as who_name,
      coalesce(cu.email, c.contact_email, ra.email) as who_email,
      coalesce(nullif(a.name, ''), a.email) as assignee_name,
      coalesce(ss.mode, 'off') <> 'off' and coalesce(ss.tone_on, true) as tone_measured
    from commerce.support_conversations c
    left join commerce.stores s on s.id = c.store_id
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    left join commerce.accounts ra on ra.id = c.requester_id
    left join commerce.accounts a on a.id = c.assignee_id
    left join commerce.support_settings ss on ss.store_id is not distinct from c.store_id
    where c.id = ${conversationId}::uuid and ${deskIs(desk, sql`c.store_id`)} and c.anonymised_at is null
  `);
  if (!c) return null;
  const messages = await db().execute<Row>(sql`
    select m.seq, m.author, m.body, m.kind, m.data, m.tone, m.tone_label, m.tools, m.created_at, coalesce(nullif(a.name, ''), a.email) as by_name
    from commerce.support_messages m left join commerce.accounts a on a.id = m.account_id
    where m.conversation_id = ${conversationId}::uuid and m.seq > ${after}
    order by m.seq limit 200
  `);
  const summary = c.summary as { title?: unknown; text?: unknown; outcome?: unknown; topics?: unknown } | null;
  return {
    id: String(c.id),
    store: c.store_slug ? { slug: String(c.store_slug), name: String(c.store_name) } : null,
    status: String(c.status) as ConversationStatus,
    handler: String(c.handler) as Handler,
    source: String(c.source) as StaffConversation["source"],
    who: c.who_name ? String(c.who_name) : c.who_email ? String(c.who_email) : visitorLabel(String(c.id)),
    email: c.who_email ? String(c.who_email) : null,
    signedIn: Boolean(c.customer_id),
    locale: String(c.locale),
    market: c.market ? String(c.market) : null,
    pagePath: c.page_path ? String(c.page_path) : null,
    assignee: c.assignee_id ? { id: String(c.assignee_id), name: String(c.assignee_name) } : null,
    tone: c.tone == null ? null : Number(c.tone),
    startedAt: iso(c.created_at),
    endedAt: c.ended_at ? iso(c.ended_at) : null,
    endedBy: c.ended_by ? String(c.ended_by) : null,
    handoffReason: c.handoff_reason ? String(c.handoff_reason) : null,
    summary:
      summary && typeof summary.title === "string"
        ? { title: summary.title, text: String(summary.text ?? ""), outcome: String(summary.outcome ?? ""), topics: Array.isArray(summary.topics) ? summary.topics.map(String) : [] }
        : null,
    rating: c.rating ? String(c.rating) : null,
    messageSeq: Number(c.message_seq),
    toneMeasured: Boolean(c.tone_measured),
    toneAlertAt: c.tone_alert_at ? iso(c.tone_alert_at) : null,
    messages: messages.map((m) => ({
      seq: Number(m.seq),
      author: String(m.author) as MessageAuthor,
      body: String(m.body),
      kind: m.kind ? String(m.kind) : null,
      data: m.data ?? null,
      by: m.by_name ? String(m.by_name) : null,
      tone: m.tone == null ? null : Number(m.tone),
      toneLabel: m.tone_label ? String(m.tone_label) : null,
      tools: Array.isArray(m.tools) ? (m.tools as { name?: unknown }[]).map((t) => String(t?.name ?? "")).filter(Boolean) : [],
      at: iso(m.created_at),
    })),
  };
}

/** The account has read the conversation up to `seq` (never back). */
export async function markRead(desk: Desk, conversationId: string, accountId: string, seq: number): Promise<void> {
  await assertOnDesk(desk, conversationId);
  await db().execute(sql`
    insert into commerce.support_reads (conversation_id, account_id, last_read_seq) values (${conversationId}::uuid, ${accountId}::uuid, ${Math.max(0, Math.floor(seq))})
    on conflict (conversation_id, account_id) do update set last_read_seq = greatest(commerce.support_reads.last_read_seq, excluded.last_read_seq)
  `);
}

// How a person is shown to customers ----------------------------------------------------------------------------------------------

/** A person as customers see them (2.4, S11): a name (never an email) and their own uploaded picture, or none. */
export type AgentIdentity = { name: string; picture: string | null };

/**
 * The name and picture customers see for a person of the desk: the name they chose for support, else their first name (or the
 * desk's name when the desk says so), never their email; the picture only if they uploaded one (a Gravatar would be looked up from
 * their email, so it is never shown to customers).
 */
export async function agentIdentity(desk: Desk, accountId: string, settings?: Pick<DeskSettings, "agentNaming"> | null): Promise<AgentIdentity> {
  const [row] = await db().execute<Row>(sql`
    select a.name, a.avatar_path, ag.display_name, s.name as store_name,
      (select agent_naming from commerce.support_settings ss where ${deskIs(desk, sql`ss.store_id`)}) as naming
    from commerce.accounts a
    left join commerce.support_agents ag on ag.account_id = a.id and ${deskIs(desk, sql`ag.store_id`)}
    left join commerce.stores s on s.id = ${desk.storeId}::uuid
    where a.id = ${accountId}::uuid
  `);
  const deskName = row?.store_name ? String(row.store_name) : "Kaizen";
  const naming = settings?.agentNaming ?? (row?.naming === "desk" ? "desk" : "first_name");
  const first = String(row?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const name = row?.display_name ? String(row.display_name) : naming === "desk" ? deskName : first || deskName;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const picture = naming !== "desk" && row?.avatar_path && supabaseUrl ? avatarPictureUrl(supabaseUrl, String(row.avatar_path)) : null;
  return { name: name.slice(0, 40), picture };
}

// Presence ------------------------------------------------------------------------------------------------------------------------

export type Presence = { status: "online" | "away"; maxChats: number; partner: boolean; displayName: string | null };

const presenceOf = (row: Row | undefined): Presence =>
  row
    ? { status: row.status === "online" ? "online" : "away", maxChats: Number(row.max_chats), partner: Boolean(row.partner), displayName: row.display_name ? String(row.display_name) : null }
    : { status: "away", maxChats: 5, partner: true, displayName: null };

/** The account's presence on a desk (away until they say otherwise). */
export async function presence(desk: Desk, accountId: string): Promise<Presence> {
  const [row] = await db().execute<Row>(sql`select * from commerce.support_agents where ${deskIs(desk, sql`store_id`)} and account_id = ${accountId}::uuid`);
  return presenceOf(row);
}

/** Online or away on the desks; the open inbox's heartbeat keeps an online agent counted as online (`ONLINE_SECONDS`). */
export async function setPresence(desks: Desk[], accountId: string, status: "online" | "away"): Promise<void> {
  for (const desk of desks) {
    await db().execute(sql`
      insert into commerce.support_agents (store_id, account_id, status, last_seen_at) values (${desk.storeId}::uuid, ${accountId}::uuid, ${status}, now())
      on conflict on constraint support_agents_key do update set status = excluded.status, last_seen_at = now()
    `);
  }
}

/** The open inbox says the agent is still there (every `HEARTBEAT_SECONDS`). */
export async function heartbeat(desks: Desk[], accountId: string): Promise<void> {
  for (const desk of desks) {
    await db().execute(sql`
      update commerce.support_agents set last_seen_at = now() where ${deskIs(desk, sql`store_id`)} and account_id = ${accountId}::uuid
    `);
  }
}

/** How many of the desk's people are online now: switched on and seen in the last `ONLINE_SECONDS`. */
export async function onlineCount(desk: Desk): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_agents
    where ${deskIs(desk, sql`store_id`)} and status = 'online' and last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS})
  `);
  return Number(row?.n ?? 0);
}

/** How many of the desk's conversations are open now (the settings page's note on changing who answers). */
export async function openConversationCount(desk: Desk): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_conversations where ${deskIs(desk, sql`store_id`)} and status = 'open' and anonymised_at is null
  `);
  return Number(row?.n ?? 0);
}
