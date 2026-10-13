import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { SUMMARY_TRIES } from "@/lib/support-rules";
import {
  BRIEF_SYSTEM,
  FOLLOW_UP_MAX,
  OUTCOMES,
  SUMMARY_TEXT_MAX,
  SUMMARY_TITLE_MAX,
  TOPICS_MAX,
  parseBrief,
  parseSummary,
  summarySystem,
  topicsFor,
  transcriptOf,
  type Outcome,
  type Summary,
  type TranscriptLine,
} from "@/lib/support-summary";

import { AiError, aiFor, completeText } from "./ai";
import { audit } from "./auth";
import { deskSettings } from "./support";
import type { Desk, StaffDesk } from "./support-desk";
import { systemDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * Summaries and briefs (D216, `docs/support.md` 2.7, step 7). When a conversation ends on a desk with support on and summaries on, it
 * is marked `pending` by `support_transition()`; `summarise()` (in `after()` where a person or the visitor ends it, and
 * `summarisePending()` in the five-minute dispatcher for the rest) asks the desk's text model for a title, a text, an outcome and
 * topics from closed lists and a follow-up, in English, from the transcript (staff notes marked, the partner's help left out). A
 * model answer is kept only when `parseSummary()` reads it; a failure is tried again, `SUMMARY_TRIES` times in all, then `failed`.
 * Without a text model it is `skipped`: never an invented summary. A brief of the conversation so far is made when a person takes it
 * over and on their button, kept with the message number it was made at so it is not made twice. Staff may edit a summary
 * (`support.summary_edited`).
 */

export type SummaryOutcome = "done" | "failed" | "retry" | "skipped" | "none";

const deskIs = (desk: Desk) => (desk.storeId ? sql`store_id = ${desk.storeId}::uuid` : sql`store_id is null`);

/** The transcript's lines for the model, oldest first (never the partner's help). */
async function lines(desk: Desk, conversationId: string): Promise<TranscriptLine[]> {
  const rows = await db().execute<Row>(sql`
    select m.author, m.body, m.kind, coalesce(nullif(a.name, ''), a.email) as by_name
    from commerce.support_messages m left join commerce.accounts a on a.id = m.account_id
    where m.conversation_id = ${conversationId}::uuid and m.author in ('customer', 'ai', 'agent', 'note', 'system')
      and m.store_id is not distinct from ${desk.storeId}::uuid
    order by m.seq
  `);
  return rows.map((r) => ({
    author: String(r.author) as TranscriptLine["author"],
    body: String(r.body),
    kind: r.kind ? String(r.kind) : null,
    // The customer's view of a person is their first name; staff see the account's name in their own summary.
    by: r.by_name ? String(r.by_name).split(/\s+/)[0] : null,
  }));
}

/**
 * Summarises an ended conversation whose summary is pending. Takes a try first (so two callers never both ask), then asks the model.
 */
export async function summarise(desk: Desk, conversationId: string): Promise<SummaryOutcome> {
  const [taken] = await db().execute<Row>(sql`
    update commerce.support_conversations set summary_tries = summary_tries + 1
    where id = ${conversationId}::uuid and ${deskIs(desk)} and status = 'ended' and summary_status = 'pending'
      and summary_tries < ${SUMMARY_TRIES} and anonymised_at is null
    returning summary_tries
  `);
  if (!taken) return "none";
  const tries = Number(taken.summary_tries);
  const settings = await deskSettings(desk);
  const connection = settings && settings.mode !== "off" && settings.summariesOn ? await aiFor(desk.storeId, { feature: "support_summary" }) : null;
  if (!connection?.textModel) {
    await setStatus(desk, conversationId, "skipped");
    return "skipped";
  }
  const transcript = transcriptOf(await lines(desk, conversationId));
  let summary: Summary | null = null;
  if (transcript.includes("Customer:")) {
    try {
      const answer = await completeText(
        connection,
        [
          { role: "system", content: summarySystem(topicsFor(desk.storeId === null)) },
          { role: "user", content: transcript },
        ],
        { maxTokens: 500, temperature: 0, timeoutMs: 45_000 },
      );
      summary = parseSummary(answer.text, topicsFor(desk.storeId === null));
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
    }
  } else {
    // Nothing from the customer: nothing to summarise, and nothing is invented.
    summary = { title: "No message from the customer", text: "The conversation ended before the customer wrote anything.", outcome: "no_reply", topics: ["other"], followUp: null };
  }
  if (summary) {
    await db().execute(sql`
      update commerce.support_conversations set summary = ${JSON.stringify({ ...summary, at: new Date().toISOString() })}::jsonb, summary_status = 'done'
      where id = ${conversationId}::uuid and ${deskIs(desk)}
    `);
    return "done";
  }
  if (tries >= SUMMARY_TRIES) {
    await setStatus(desk, conversationId, "failed");
    return "failed";
  }
  return "retry";
}

async function setStatus(desk: Desk, conversationId: string, status: "skipped" | "failed") {
  await db().execute(sql`update commerce.support_conversations set summary_status = ${status} where id = ${conversationId}::uuid and ${deskIs(desk)}`);
}

/** The summaries still to write, oldest end first (the five-minute dispatcher): each is tried again until it is done or has had its tries. */
export async function summarisePending(limit = 30): Promise<{ done: number; failed: number; skipped: number }> {
  const out = { done: 0, failed: 0, skipped: 0 };
  const rows = await db().execute<Row>(sql`
    select id, store_id from commerce.support_conversations
    where status = 'ended' and summary_status = 'pending' and summary_tries < ${SUMMARY_TRIES} and anonymised_at is null
      and ended_at < now() - interval '1 minute'
    order by ended_at limit ${limit}
  `);
  for (const row of rows) {
    try {
      const outcome = await summarise(systemDesk(row.store_id ? String(row.store_id) : null), String(row.id));
      if (outcome === "done") out.done++;
      else if (outcome === "failed") out.failed++;
      else if (outcome === "skipped") out.skipped++;
    } catch (error) {
      console.error(`[support] the summary of ${String(row.id)} failed`, error);
    }
  }
  return out;
}

export type BriefResult = { ok: true; brief: string | null } | { ok: false; problem: string };

/**
 * A brief of the conversation so far (2.7): made when a person takes it over and on their button, unless one was made at the same
 * message. Needs support on, summaries on and a text model; without them it says so and invents nothing.
 */
export async function makeBrief(desk: Desk, conversationId: string): Promise<BriefResult> {
  const [row] = await db().execute<Row>(sql`
    select message_seq, brief from commerce.support_conversations where id = ${conversationId}::uuid and ${deskIs(desk)} and anonymised_at is null
  `);
  if (!row) return { ok: false, problem: "This conversation is no longer here." };
  const seq = Number(row.message_seq);
  const kept = row.brief as { seq?: number; text?: string } | null;
  if (kept && kept.seq === seq && typeof kept.text === "string") return { ok: true, brief: kept.text };
  const settings = await deskSettings(desk);
  const connection = settings && settings.mode !== "off" && settings.summariesOn ? await aiFor(desk.storeId, { feature: "support_summary" }) : null;
  if (!connection?.textModel) return { ok: false, problem: "Briefs need the AI: summaries on in the support settings and a text model." };
  const transcript = transcriptOf(await lines(desk, conversationId));
  if (!transcript.includes("Customer:")) return { ok: true, brief: null };
  try {
    const answer = await completeText(connection, [{ role: "system", content: BRIEF_SYSTEM }, { role: "user", content: transcript }], { maxTokens: 220, temperature: 0, timeoutMs: 30_000 });
    const brief = parseBrief(answer.text);
    if (!brief) return { ok: false, problem: "The AI could not write a brief just now." };
    await db().execute(sql`
      update commerce.support_conversations set brief = ${JSON.stringify({ seq, text: brief, at: new Date().toISOString() })}::jsonb
      where id = ${conversationId}::uuid and ${deskIs(desk)}
    `);
    return { ok: true, brief };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: "The AI could not write a brief just now." };
    throw error;
  }
}

/** A summary as staff edit it; checked against the desk's closed lists. */
export type SummaryEdit = { title: string; text: string; outcome: Outcome; topics: string[]; followUp: string | null };

export function readSummaryEdit(raw: unknown, kaizen: boolean): SummaryEdit | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const title = text(v.title, SUMMARY_TITLE_MAX);
  const body = text(v.text, SUMMARY_TEXT_MAX);
  const outcome = typeof v.outcome === "string" && (OUTCOMES as readonly string[]).includes(v.outcome) ? (v.outcome as Outcome) : null;
  const allowed = topicsFor(kaizen);
  const topics = Array.isArray(v.topics) ? [...new Set(v.topics.filter((t): t is string => typeof t === "string" && allowed.includes(t)))].slice(0, TOPICS_MAX) : [];
  const followUp = text(v.followUp, FOLLOW_UP_MAX) || null;
  if (!title || !body || !outcome || topics.length === 0) return null;
  return { title, text: body, outcome, topics, followUp };
}

/** Staff correct a summary (2.7): who and when are kept with it, and the change is in the activity log (never its words). */
export async function editSummary(staff: StaffDesk, conversationId: string, edit: SummaryEdit): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!staff.canWrite) return { ok: false, problem: "You can read this desk's conversations but not answer them." };
  const rows = await db().execute<Row>(sql`
    update commerce.support_conversations
    set summary = ${JSON.stringify({ ...edit, at: new Date().toISOString(), editedBy: staff.account.id, editedAt: new Date().toISOString() })}::jsonb, summary_status = 'done'
    where id = ${conversationId}::uuid and ${deskIs(staff.desk)} and status = 'ended' and anonymised_at is null
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "Only an ended conversation has a summary." };
  await audit(staff.account.id, staff.desk.storeId, "support.summary_edited", { conversation: conversationId, outcome: edit.outcome }, { target: { type: "support_conversation", id: conversationId } });
  return { ok: true };
}
