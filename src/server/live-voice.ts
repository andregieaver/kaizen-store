import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { clipForLive, readLiveTurns, type LiveTurn } from "@/lib/speech-text";

import { aiFor, type LiveConnection } from "./ai";
import { recordLiveSeconds, recordUsage, type UsageContext } from "./ai-usage";
import { addMessage, runTurn, type Approval, type AssistantEvent, type Principal } from "./owner-assistant";

type Row = Record<string, unknown>;

/**
 * The AI manager's live voice (D105), after Kaizen Life's: a full-duplex
 * voice model, set in the AI settings (`ai_providers.live_model`, never
 * named in code), talks with the person over WebRTC. It hears while it
 * speaks, so turn-taking, barge-in and backchannels are the model's own.
 *
 * It has no tools. When a request needs the store's data or a change, the
 * session hands it over (a delegation); the page sends what was said, and
 * `delegateLive()` runs it as a turn of the AI manager itself (`runTurn()`,
 * in voice mode), with every tool, the approval gate and memory; the answer
 * goes back for the voice to say in its own words. The call is kept in the
 * conversation: the request as it was said, and the rest of the transcript
 * as the page saves it (`saveLiveTurns()`).
 *
 * The session is made here with the site's key, which never reaches the
 * browser; the page may only add context, hand back delegations, mute and
 * hang up.
 */

/** Earlier turns the call starts with, and how much of each. */
const HISTORY_TURNS = 16;
const HISTORY_TURN_CHARS = 700;
/** A conversation idle longer than this is not continued by a call. */
const CONTINUE_MS = 6 * 60 * 60 * 1000;

export class LiveVoiceError extends Error {}

/** The live voice model for the person's site, and whose key it uses (D106). */
export async function liveConnectionFor(p: Principal): Promise<{ live: LiveConnection; source: "platform" | "store"; context: UsageContext } | null> {
  const connection = await aiFor(p.store?.id ?? null, { feature: "ai_manager", accountId: p.account.id });
  return connection?.textModel && connection.live && connection.usage ? { live: connection.live, source: connection.source, context: connection.usage } : null;
}

/** The conversation the call is kept in: the one open, else a recent one, else a new one. */
async function pickConversation(p: Principal, requested: string | null): Promise<{ id: string; history: LiveTurn[] }> {
  const scope = p.store ? sql`store_id = ${p.store.id}::uuid` : sql`store_id is null`;
  let id: string | null = null;
  if (requested && /^[0-9a-f-]{36}$/i.test(requested)) {
    const [row] = await db().execute<Row>(sql`
      select id from commerce.assistant_conversations
      where id = ${requested}::uuid and ${scope} and account_id = ${p.account.id}::uuid and source is distinct from 'kaizen-life'
    `);
    id = row ? String(row.id) : null;
  }
  if (!id) {
    const [row] = await db().execute<Row>(sql`
      select id from commerce.assistant_conversations
      where ${scope} and account_id = ${p.account.id}::uuid and source is distinct from 'kaizen-life'
        and updated_at > now() - make_interval(secs => ${CONTINUE_MS / 1000})
      order by updated_at desc limit 1
    `);
    id = row ? String(row.id) : null;
  }
  if (!id) {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title)
      values (${p.store ? sql`${p.store.id}::uuid` : sql`null`}, ${p.account.id}::uuid, 'Voice call') returning id
    `);
    return { id: String(row.id), history: [] };
  }
  const rows = await db().execute<Row>(sql`
    select role, content from (
      select role, content, created_at, id from commerce.assistant_messages
      where conversation_id = ${id}::uuid order by created_at desc, id desc limit ${HISTORY_TURNS}
    ) recent order by created_at, id
  `);
  return {
    id,
    history: rows
      .map((row) => ({ role: row.role === "user" ? ("user" as const) : ("assistant" as const), text: String(row.content).replace(/\s+/g, " ").trim().slice(0, HISTORY_TURN_CHARS) }))
      .filter((turn) => turn.text),
  };
}

/** The voice's own instructions: who it is and how it talks and hands over work. The store's rules live in the AI manager it delegates to. */
export function liveInstructions(p: Principal, now = new Date()): string {
  const { store, account } = p;
  const timeZone = store?.timeZone ?? "Europe/Oslo";
  const stamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(now);
  return [
    "# Who you are",
    store
      ? `You are the AI manager of ${store.name}, an online store on Kaizen: the owner's guide to the admin, their analyst and their right hand, on a voice call with them from the store's admin.`
      : "You are Kaizen's AI manager: the platform admins' guide to Kaizen's admin, their analyst and their right hand, on a voice call from the platform admin.",
    account.name ? `Their name is ${account.name}.` : "",
    `It is ${stamp} (${timeZone}).`,
    "",
    "# Personality",
    "Warm, natural and unhurried; clear and direct. Keep turns short, a sentence or two, and let them lead. If they are rushed, be brisk. Speak their language; if they switch, switch with them.",
    "",
    "# Backchannel",
    "Use light, natural backchannels while they talk (mm-hm, right, got it) without competing with them. Don't fill every pause.",
    "",
    "# Interruptions",
    "When they start talking, stop and listen. Don't finish your sentence over them. If they correct you, take the correction and carry on.",
    "",
    "# Delegation: how you get things done",
    "You do real work through your backend: it reads and changes the store (orders, products, stock, customers, sales figures, discounts, bookings, pages, emails), works out numbers, knows every admin page and opens them on their screen, follows playbooks, and remembers them.",
    "Delegate whenever the answer depends on their data or needs an action, a lookup, a calculation or careful thought, when they ask where or how to do something in the admin, and when they answer a question your backend asked.",
    "Don't delegate for greetings, small talk, a quick clarifying question, or repeating something you already said.",
    'Delegate BEFORE you answer anything that depends on it. Never guess, invent or pre-announce a number, a name or a result: say a brief natural line ("Let me check.", "On it.") and keep the conversation going until the result arrives, then tell them in your own words. Say amounts as the result gives them. Don\'t read out ids, links or long lists: summarise and offer the detail, which is on their screen.',
    "Say something is done only when the result says it is done. If the result is a question, ask it.",
    "Changes that email customers, change the site or cost money wait for their yes: when a result says one is waiting, say in a sentence what it will do and ask. When they answer yes or no, delegate again so their answer is carried out.",
    "You are one person: never mention a backend, a system, delegation or another model. Say \"I\".",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

export type LiveSession = { sdp: string; sessionId: string; conversationId: string; opening: string };

/** Starts a call: the page's WebRTC offer goes to the provider with the session made here, and its answer comes back. */
export async function startLiveSession(p: Principal, input: { sdp: string; conversationId: string | null }): Promise<LiveSession> {
  const found = await liveConnectionFor(p);
  if (!found) throw new LiveVoiceError("No live voice model is set up under AI.");
  const { live } = found;
  const conversation = await pickConversation(p, input.conversationId);
  const response = await fetch(`${live.apiUrl}/live/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${live.apiKey}`,
      "Content-Type": "application/json",
      // Lets the provider's abuse checks tell people apart without learning who they are.
      "OpenAI-Safety-Identifier": createHash("sha256").update(p.account.id).digest("hex"),
    },
    body: JSON.stringify({
      session: {
        model: live.model,
        instructions: liveInstructions(p),
        ...(live.voice && { audio: { output: { voice: live.voice } } }),
        delegation: { type: "client" },
        input: conversation.history.map((turn) => ({
          type: "message",
          role: turn.role,
          content: [{ type: turn.role === "user" ? "input_text" : "output_text", text: turn.text }],
        })),
        store: false,
        client: {
          data_channel: {
            // The page may steer the call with context, hand back delegations, mute and hang up; never change the session.
            allowed_client_events: [
              "session.instructions.append",
              "session.thinking.append",
              "session.commentary.append",
              "session.input_audio.mute",
              "session.input_audio.unmute",
              "session.close",
            ],
          },
        },
      },
      transport: { type: "webrtc", sdp: input.sdp },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response) throw new LiveVoiceError("The live voice provider could not be reached.");
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error(`[live-voice] session ${response.status}: ${detail}`);
    throw new LiveVoiceError(
      response.status === 429 ? "The live voice provider refused the call: its account is out of quota or busy." : `The call could not start (${response.status}).`,
    );
  }
  const data = (await response.json().catch(() => null)) as { session?: { id?: string }; transport?: { sdp?: string } } | null;
  if (!data?.transport?.sdp || !data.session?.id) throw new LiveVoiceError("The live voice provider gave no answer.");
  const opening =
    conversation.history.length > 0
      ? "They just opened a voice call with you, continuing your recent conversation. Greet them warmly, by name if you know it, and in one short sentence offer to pick up where you left off, without saying what it was about."
      : "They just opened a voice call with you. Greet them warmly in one short sentence, by name if you know it, and ask what they'd like to do.";
  // A call is one request; its length is added when the page ends it (`endLiveCall()`), and its tokens are the provider's to bill.
  await recordUsage(found.context, { source: found.source, provider: live.provider, model: live.model, kind: "live", sessionRef: data.session.id });
  return { sdp: data.transport.sdp, sessionId: data.session.id, conversationId: conversation.id, opening };
}

/** The conversation, if it is the person's own in this store or on the platform. */
async function ownConversation(p: Principal, conversationId: unknown): Promise<string | null> {
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const [row] = await db().execute<Row>(sql`
    select id from commerce.assistant_conversations
    where id = ${conversationId}::uuid and account_id = ${p.account.id}::uuid
      and ${p.store ? sql`store_id = ${p.store.id}::uuid` : sql`store_id is null`}
  `);
  return row ? String(row.id) : null;
}

/** Keeps what was said on the call, in order, naming a new call after the first thing they said. */
export async function saveLiveTurns(p: Principal, conversationId: unknown, raw: unknown): Promise<number | null> {
  const id = await ownConversation(p, conversationId);
  if (!id) return null;
  const turns = readLiveTurns(raw);
  for (const turn of turns) await addMessage(p, id, turn.role, turn.text);
  await nameCall(id);
  return turns.length;
}

/** A new call is named after the first thing they said, as a typed first message names a conversation. */
async function nameCall(conversationId: string) {
  await db().execute(sql`
    update commerce.assistant_conversations c set title = left(first.content, 80)
    from (
      select content from commerce.assistant_messages
      where conversation_id = ${conversationId}::uuid and role = 'user' order by created_at, id limit 1
    ) first
    where c.id = ${conversationId}::uuid and c.title = 'Voice call'
  `);
}

export type LiveDelegation = {
  /** What the voice says, in its own words. */
  speak: string;
  /** Admin pages the AI manager opened, for the page to open. */
  navigate: { href: string; label: string }[];
  /** Changes it kept for their yes, or carried out on it. */
  approvals: Approval[];
  failed?: boolean;
};

/**
 * Does the work the call handed over: what was said before the request is
 * kept first, then the request (the last thing they said) runs as a turn of
 * the AI manager, in voice mode. A "yes" to a waiting change is carried out
 * there by `decide_approval`, which checks their own words.
 */
export async function delegateLive(
  p: Principal,
  input: { conversationId: unknown; turns: unknown; path: string | null },
  invalidate: (tag: string) => void,
  later?: (task: () => Promise<unknown>) => void,
): Promise<LiveDelegation | null> {
  const conversationId = await ownConversation(p, input.conversationId);
  if (!conversationId) return null;
  const turns = readLiveTurns(input.turns);
  const lastUser = turns.map((t) => t.role).lastIndexOf("user");
  for (const turn of lastUser >= 0 ? turns.slice(0, lastUser) : turns) await addMessage(p, conversationId, turn.role, turn.text);
  await nameCall(conversationId);
  let request = lastUser >= 0 ? turns[lastUser].text : "";
  if (lastUser < 0) {
    // Nothing new from them: the request is the one already kept (a "yes" saved a moment ago).
    const [row] = await db().execute<Row>(sql`
      select content from commerce.assistant_messages where conversation_id = ${conversationId}::uuid and role = 'user'
      order by created_at desc, id desc limit 1
    `);
    request = row ? String(row.content) : "";
  }
  if (!request) return { speak: "Ask them what they would like you to do.", navigate: [], approvals: [] };

  const events: AssistantEvent[] = [];
  await runTurn({
    member: p,
    conversationId,
    message: request,
    emit: (event) => events.push(event),
    invalidate,
    path: input.path,
    voice: true,
    live: { reuseSaved: lastUser < 0 },
    later,
  });
  const done = events.find((e) => e.type === "done");
  const error = events.find((e) => e.type === "error");
  const approvals = new Map<string, Approval>();
  for (const e of events) if (e.type === "approval") approvals.set(e.approval.id, e.approval);
  return {
    speak: clipForLive(
      error && error.type === "error"
        ? `That didn't go through: ${error.message} Tell them plainly and offer to try again.`
        : done && done.type === "done"
          ? done.message.content
          : "That didn't go through on my side. Tell them it failed and offer to try again.",
    ),
    navigate: events.flatMap((e) => (e.type === "navigate" ? [{ href: e.href, label: e.label }] : [])),
    approvals: [...approvals.values()],
    ...(error && { failed: true }),
  };
}

/** A call ended: its length, as the person's own page reports it, is added to the usage its start recorded. */
export async function endLiveCall(p: Principal, sessionId: unknown, seconds: unknown): Promise<void> {
  if (typeof sessionId !== "string" || typeof seconds !== "number") return;
  await recordLiveSeconds(p.account.id, p.store?.id ?? null, sessionId, seconds);
}
