import "server-only";

import { sql } from "drizzle-orm";

import { after } from "next/server";

import { db } from "@/db/client";
import { MESSAGE_MAX, PARTNER_QUESTION_MAX } from "@/lib/support-rules";
import type { SavedReply } from "@/lib/support-replies";
import { REFUSAL_WORDS } from "@/lib/support-state";

import { audit } from "./auth";
import { SupportError, addMessage, agentIdentity, deskSettings, setPartnerPaused, transition } from "./support";
import type { StaffDesk } from "./support-desk";
import { runPartner } from "./support-partner";
import { repliesFor } from "./support-replies";
import { editSummary, makeBrief, readSummaryEdit, summarise } from "./support-summary";
import { translateMessage, translateReply } from "./support-translate";

type Row = Record<string, unknown>;

/**
 * What a person does in a conversation (D216, `docs/support.md` 2.4, step 4): take it over, answer, write an internal note, hand it
 * to another person or back to the queue, give it back to the AI, end it, and ask the customer to sign in. Every level's action
 * checks who may write at that desk and calls `agentAct()`; the database's rules decide (one person at a time, only the one who has
 * it answers), and a refusal comes back in plain words. Taking over, handing over and ending are written to the activity log.
 */

export type AgentAct =
  | { kind: "claim" }
  | { kind: "reply"; body: string; translated?: boolean; partnerDraft?: boolean }
  | { kind: "note"; body: string }
  | { kind: "transfer"; target: string | null }
  | { kind: "hand_back" }
  | { kind: "end" }
  | { kind: "ask_sign_in" }
  | { kind: "brief" }
  | { kind: "summary"; summary: unknown }
  | { kind: "partner"; seq: number }
  | { kind: "ask_partner"; question: string }
  | { kind: "pause_partner"; paused: boolean }
  | { kind: "replies" }
  | { kind: "translate"; seq: number }
  | { kind: "translate_reply"; text: string };

/**
 * `brief` is the conversation so far, when one was asked for (step 7); `ran`, whether the silent partner answered (step 8);
 * `replies`, the desk's saved replies filled in for the conversation, and `text`, a translation for the person alone (step 13).
 */
export type AgentActResult =
  | { ok: true; brief?: string | null; ran?: boolean; replies?: SavedReply[]; locale?: string; text?: string; language?: string }
  | { ok: false; problem: string };

export const ACT_KINDS = [
  "claim",
  "reply",
  "note",
  "transfer",
  "hand_back",
  "end",
  "ask_sign_in",
  "brief",
  "summary",
  "partner",
  "ask_partner",
  "pause_partner",
  "replies",
  "translate",
  "translate_reply",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An action's input from a form or the inbox, checked; null when it is not one. */
export function readAct(raw: unknown): AgentAct | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  switch (value.kind) {
    case "claim":
    case "hand_back":
    case "end":
    case "ask_sign_in":
    case "brief":
    case "replies":
      return { kind: value.kind };
    case "summary":
      return { kind: "summary", summary: value.summary };
    case "translate":
      return Number.isInteger(value.seq) && (value.seq as number) > 0 && (value.seq as number) < 1_000_000 ? { kind: "translate", seq: value.seq as number } : null;
    case "translate_reply": {
      const text = typeof value.text === "string" ? value.text.trim() : "";
      return text.length > 0 && text.length <= MESSAGE_MAX.agent ? { kind: "translate_reply", text } : null;
    }
    case "partner":
      return Number.isInteger(value.seq) && (value.seq as number) > 0 && (value.seq as number) < 1_000_000 ? { kind: "partner", seq: value.seq as number } : null;
    case "ask_partner": {
      const question = typeof value.question === "string" ? value.question.trim() : "";
      return question.length > 0 && question.length <= PARTNER_QUESTION_MAX ? { kind: "ask_partner", question } : null;
    }
    case "pause_partner":
      return typeof value.paused === "boolean" ? { kind: "pause_partner", paused: value.paused } : null;
    case "reply":
    case "note": {
      const body = typeof value.body === "string" ? value.body.trim() : "";
      const max = value.kind === "reply" ? MESSAGE_MAX.agent : MESSAGE_MAX.note;
      if (body.length === 0 || body.length > max) return null;
      if (value.kind === "note") return { kind: "note", body };
      // A reply the AI translated says so to the customer (step 13); one that started from the partner's draft is counted for the
      // desk's report (step 14). A note is never sent, so it has neither.
      return { kind: "reply", body, ...(value.translated === true ? { translated: true } : {}), ...(value.partnerDraft === true ? { partnerDraft: true } : {}) };
    }
    case "transfer":
      return value.target === null || (typeof value.target === "string" && UUID.test(value.target)) ? { kind: "transfer", target: value.target as string | null } : null;
    default:
      return null;
  }
}

/** The words for a refusal; "Someone else has this conversation" names who. */
async function refusalWords(error: SupportError, conversationId: string): Promise<string> {
  if (error.code === "support_taken") {
    const [row] = await db().execute<Row>(sql`
      select coalesce(nullif(a.name, ''), a.email) as name from commerce.support_conversations c join commerce.accounts a on a.id = c.assignee_id
      where c.id = ${conversationId}::uuid
    `);
    if (row?.name) return `${String(row.name)} has this conversation now.`;
  }
  return REFUSAL_WORDS[error.code];
}

/** People of the desk a conversation can be handed to: those with presence on the desk, by name. */
export async function deskAgents(staff: StaffDesk): Promise<{ id: string; name: string; online: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, coalesce(nullif(ag.display_name, ''), nullif(a.name, ''), a.email) as name,
      (ag.status = 'online' and ag.last_seen_at > now() - interval '60 seconds') as online
    from commerce.support_agents ag join commerce.accounts a on a.id = ag.account_id
    where ${staff.desk.storeId ? sql`ag.store_id = ${staff.desk.storeId}::uuid` : sql`ag.store_id is null`}
    order by online desc, lower(coalesce(nullif(ag.display_name, ''), nullif(a.name, ''), a.email))
  `);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), online: Boolean(r.online) }));
}

/** Whether the account is a person of the desk (has presence there), so a conversation may be handed to them. */
async function isDeskAgent(staff: StaffDesk, accountId: string): Promise<boolean> {
  return (await deskAgents(staff)).some((a) => a.id === accountId);
}

export async function agentAct(staff: StaffDesk, conversationId: string, act: AgentAct): Promise<AgentActResult> {
  if (!staff.canWrite) return { ok: false, problem: "You can read this desk's conversations but not answer them." };
  if (!UUID.test(conversationId)) return { ok: false, problem: REFUSAL_WORDS.support_gone };
  const me = staff.account.id;
  const store = staff.desk.storeId;
  try {
    switch (act.kind) {
      case "claim": {
        const name = (await agentIdentity(staff.desk, me)).name;
        await transition(staff.desk, conversationId, "claim", { kind: "agent", id: me, name });
        await audit(me, store, "support.claimed", { conversation: conversationId }, { target: { type: "support_conversation", id: conversationId } });
        // A brief of the conversation so far is ready by the time the person reads it (step 7), and the partner looks (step 8).
        after(() => makeBrief(staff.desk, conversationId).catch(() => undefined));
        after(() => runPartner(staff, conversationId, { kind: "claim" }).catch((error) => console.warn(`[support] partner of ${conversationId}: ${String(error)}`)));
        return { ok: true };
      }
      case "reply": {
        const identity = await agentIdentity(staff.desk, me);
        // The name and picture the customer sees are kept with the message, as they were when it was written.
        await addMessage(staff.desk, conversationId, "agent", me, act.body, {
          data: act.translated ? { ...identity, translated: true } : identity,
          // Staff-only (the customer's feed never reads `tools`): counted per desk in the report, never per person.
          ...(act.partnerDraft ? { tools: ["partner_draft"] } : {}),
        });
        return { ok: true };
      }
      case "note":
        await addMessage(staff.desk, conversationId, "note", me, act.body);
        return { ok: true };
      case "transfer": {
        if (act.target !== null && !(await isDeskAgent(staff, act.target))) return { ok: false, problem: "That person does not answer on this desk." };
        const name = act.target ? (await agentIdentity(staff.desk, act.target)).name : (await agentIdentity(staff.desk, me)).name;
        await transition(staff.desk, conversationId, "transfer", { kind: "agent", id: me, name }, { target: act.target });
        await audit(me, store, "support.transferred", { conversation: conversationId, to: act.target ?? "queue" }, { target: { type: "support_conversation", id: conversationId } });
        return { ok: true };
      }
      case "hand_back": {
        const name = (await agentIdentity(staff.desk, me)).name;
        await transition(staff.desk, conversationId, "hand_back", { kind: "agent", id: me, name });
        await audit(me, store, "support.handed_back", { conversation: conversationId }, { target: { type: "support_conversation", id: conversationId } });
        return { ok: true };
      }
      case "end": {
        await transition(staff.desk, conversationId, "end", { kind: "agent", id: me, name: (await agentIdentity(staff.desk, me)).name });
        await audit(me, store, "support.ended", { conversation: conversationId }, { target: { type: "support_conversation", id: conversationId } });
        after(() => summarise(staff.desk, conversationId).catch((error) => console.warn(`[support] summary of ${conversationId}: ${String(error)}`)));
        return { ok: true };
      }
      case "ask_sign_in": {
        if (!store) return { ok: false, problem: "Kaizena Flow's desk has no customer accounts to sign in to." };
        const settings = await deskSettings(staff.desk);
        if (!settings) return { ok: false, problem: REFUSAL_WORDS.support_gone };
        const [row] = await db().execute<Row>(sql`select status, customer_id from commerce.support_conversations where id = ${conversationId}::uuid and store_id = ${store}::uuid`);
        if (!row) return { ok: false, problem: REFUSAL_WORDS.support_gone };
        if (row.status !== "open") return { ok: false, problem: REFUSAL_WORDS.support_ended };
        if (row.customer_id) return { ok: false, problem: "The customer is already signed in." };
        await addMessage(staff.desk, conversationId, "system", me, "", { kind: "sign_in" });
        return { ok: true };
      }
      case "brief": {
        const made = await makeBrief(staff.desk, conversationId);
        return made.ok ? { ok: true, brief: made.brief } : made;
      }
      case "summary": {
        const edit = readSummaryEdit(act.summary, store === null);
        if (!edit) return { ok: false, problem: "A summary needs a title, a text, an outcome and at least one topic from the list." };
        return editSummary(staff, conversationId, edit);
      }
      case "partner": {
        const ran = await runPartner(staff, conversationId, { kind: "message", seq: act.seq });
        return ran.ok ? { ok: true, ran: ran.ran } : ran;
      }
      case "ask_partner": {
        const ran = await runPartner(staff, conversationId, { kind: "question", text: act.question });
        return ran.ok ? { ok: true, ran: ran.ran } : ran;
      }
      case "replies": {
        const filled = await repliesFor(staff, conversationId);
        return filled ? { ok: true, replies: filled.replies, locale: filled.locale } : { ok: false, problem: REFUSAL_WORDS.support_gone };
      }
      // Translations are the person's alone: shown or put in their composer, never written to the conversation from here.
      case "translate": {
        const done = await translateMessage(staff, conversationId, act.seq);
        return done.ok ? { ok: true, text: done.text, language: done.language } : done;
      }
      case "translate_reply": {
        const done = await translateReply(staff, conversationId, act.text);
        return done.ok ? { ok: true, text: done.text, language: done.language } : done;
      }
      case "pause_partner":
        return (await setPartnerPaused(staff.desk, conversationId, me, act.paused)) ? { ok: true } : { ok: false, problem: "Only the person who has the conversation pauses the partner in it." };
    }
  } catch (error) {
    if (error instanceof SupportError) return { ok: false, problem: await refusalWords(error, conversationId) };
    throw error;
  }
}
