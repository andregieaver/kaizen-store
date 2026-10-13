import "server-only";

import { after as afterResponse } from "next/server";

import { t } from "@/lib/i18n";
import { CONVERSATION_MESSAGES_MAX, REOPEN_HOURS } from "@/lib/support-rules";
import type { VisitorMessage, VisitorReply, VisitorState } from "@/lib/support-visitor";
import { BODY_MAX, type TurnInput } from "@/lib/support-visitor-schema";

import type { ChatSite } from "./chat-agent";
import { chatPlace, fail, type ChatContext, type ChatPlace } from "./chat-route";
import { getCustomer } from "./customers";
import {
  SupportError,
  addMessage,
  agentIdentity,
  availabilityOf,
  channelOf,
  claimForCustomer,
  conversationByEmailToken,
  deskSettings,
  markSeen,
  openConversation,
  queuePosition,
  setAiReason,
  setContact,
  transition,
  visitorConversation,
  visitorFeed,
  visitorState,
  type Conversation,
  type DeskSettings,
} from "./support";
import { visitorDesk, type Desk } from "./support-desk";
import { scoreTone, scoresTone } from "./support-tone";
import { runSupportTurn } from "./support-turn";

/**
 * What the chat's visitor routes share (D216, `docs/support.md` 5.3): the body (JSON, at most `BODY_MAX` characters), the site,
 * the desk, the conversation's token, and the answer every route gives (`VisitorReply`). The request's site check (`sameSite()`) is
 * each route's first line.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export const reply = (body: VisitorReply) => Response.json(body, { headers: NO_STORE });

/** The request's JSON body, or the response to give. */
export async function readBody(request: Request): Promise<unknown | Response> {
  try {
    const text = await request.text();
    if (text.length > BODY_MAX) return fail(413, "That message is too long.");
    return JSON.parse(text) as unknown;
  } catch {
    return fail(400, "The chat could not read that message.");
  }
}

/** The signed-in customer of a store's desk (their id and their own email), or null (Kaizen's desk has no customers). */
async function customerOf(place: ChatPlace): Promise<{ id: string; email: string } | null> {
  if (!place.storeId) return null;
  const customer = await getCustomer(place.storeId);
  return customer ? { id: customer.id, email: customer.email } : null;
}

/** The visitor's conversation on the site by its token: the desk, its settings and the conversation, or a 404 for anything else. */
export async function visitorPlace(raw: unknown, ref: { id: string; token: string }): Promise<{ place: ChatPlace; desk: Desk; settings: DeskSettings; conversation: Conversation } | Response> {
  const place = await chatPlace(raw);
  if (place instanceof Response) return place;
  const desk = visitorDesk(place.site);
  const [conversation, settings] = await Promise.all([visitorConversation(desk, ref), deskSettings(desk)]);
  if (!conversation || !settings) return fail(404, t(place.lang).chat.gone);
  return { place, desk, settings, conversation };
}

/**
 * The state and the messages after `after`, as every visitor route answers: the person who has the conversation, its place in line
 * and whether anyone can answer now while it waits, and where answers will be emailed (the email the visitor left, else a signed-in
 * customer's own).
 */
export async function visitorReply(
  desk: Desk,
  settings: DeskSettings,
  conversation: Conversation,
  after: number,
  customer: { email: string } | null,
  extra: Partial<VisitorReply> = {},
): Promise<VisitorReply> {
  const open = conversation.status === "open";
  const withPerson = open && conversation.handler === "human" && conversation.assigneeId;
  const waiting = open && conversation.handler === "queue";
  const [messages, agent, position, availability] = await Promise.all([
    visitorFeed(desk, conversation.id, after),
    withPerson ? agentIdentity(desk, conversation.assigneeId!, settings) : Promise.resolve(null),
    waiting ? queuePosition(desk, conversation) : Promise.resolve(null),
    waiting ? availabilityOf(desk, settings) : Promise.resolve(null),
  ]);
  return {
    ...extra,
    state: visitorState(conversation, settings, customer !== null, {
      agent,
      queuePosition: position,
      available: availability?.open ?? true,
      followupEmail: conversation.contactEmail ?? customer?.email ?? null,
    }),
    messages,
  };
}

/**
 * Moves a conversation from the AI to the queue (D216, 2.3): the AI asked for a person (`ai`, its words kept for the staff), or the
 * system did because the AI failed or is not set up (`no_ai`) or reached its daily limit (`limit`). A conversation a person took in
 * the meantime is left as it is.
 */
async function handOver(desk: Desk, conversationId: string, by: "ai" | "system", reason: "ai" | "no_ai" | "limit", aiReason?: string): Promise<void> {
  try {
    await transition(desk, conversationId, "handoff", { kind: by }, { reason });
    if (aiReason) await setAiReason(desk, conversationId, aiReason);
  } catch (error) {
    if (!(error instanceof SupportError)) throw error;
  }
}

/**
 * A visitor's message (typed, or the words of a spoken one): the conversation is made on the first message and continued with its
 * token; an ended one is reopened within `REOPEN_HOURS`, else a new one starts. The message is kept before the AI is asked, so a
 * failing AI loses nothing. The AI answers only while it has the conversation; with the AI first, a conversation goes to a person
 * when the AI asks for one, fails, is not set up or reached its daily limit (`limited`). The answer is every message after `after`.
 */
export async function visitorTurn(context: ChatContext, input: Omit<TurnInput, "message">, words: string, options: { limited?: boolean } = {}): Promise<VisitorReply | Response> {
  const m = t(context.lang);
  const desk = visitorDesk(context.site);
  const settings = context.settings;
  const customer = await customerOf(context);

  let conversation: Conversation | null = null;
  let token: string | undefined;
  let after = input.after;
  if (input.conversation) {
    conversation = await visitorConversation(desk, input.conversation);
    if (!conversation) return fail(404, m.chat.gone);
  }
  if (conversation && conversation.status === "ended") {
    const recent = conversation.endedAt !== null && Date.now() - Date.parse(conversation.endedAt) < REOPEN_HOURS * 3_600_000;
    if (recent) {
      await transition(desk, conversation.id, "reopen", { kind: "customer" });
    } else {
      conversation = null;
    }
  }
  if (conversation && conversation.messageSeq >= CONVERSATION_MESSAGES_MAX) return fail(409, m.chat.full);
  if (!conversation) {
    const opened = await openConversation(desk, { mode: settings.mode, locale: context.locale, market: context.market, pagePath: input.path ?? null, customerId: customer?.id ?? null });
    conversation = opened.conversation;
    token = opened.token;
    after = 0;
  } else if (customer && !conversation.customerId) {
    await claimForCustomer(desk, conversation.id, customer.id);
  }
  const ref = { id: conversation.id, token: token ?? input.conversation!.token };

  let added: { seq: number } | null;
  try {
    added = await addMessage(desk, conversation.id, "customer", null, words);
  } catch (error) {
    if (error instanceof SupportError) return fail(409, m.chat.sorry);
    throw error;
  }
  // The message's tone is scored after the answer is sent (step 6), where the desk has support and tone on.
  if (added && scoresTone(settings)) {
    const id = conversation.id;
    const seq = added.seq;
    afterResponse(() => scoreTone(desk, id, seq).catch((error) => console.warn(`[support] tone of ${id}: ${error instanceof Error ? error.message : String(error)}`)));
  }

  let error: string | undefined;
  const current = (await visitorConversation(desk, ref)) ?? conversation;
  // The AI answers only while it has the conversation; with a person or in the queue the message waits for them.
  if (current.status === "open" && current.handler === "ai") {
    if (settings.mode === "ai_first" && (!context.agent || options.limited)) {
      await handOver(desk, conversation.id, "system", context.agent ? "limit" : "no_ai");
    } else {
      const turn = await runSupportTurn(desk, context, conversation.id, { path: input.path, signals: input.signals });
      if (turn.error && settings.mode === "ai_first") await handOver(desk, conversation.id, "system", "no_ai");
      else if (turn.error) error = turn.error;
      else if (turn.handoff && settings.mode === "ai_first") await handOver(desk, conversation.id, "ai", "ai", turn.handoff);
    }
  }
  const fresh = (await visitorConversation(desk, ref)) ?? conversation;
  return visitorReply(desk, settings, fresh, after, customer, {
    conversation: { id: conversation.id, ...(token ? { token } : {}), channel: channelOf(conversation) },
    ...(error ? { error } : {}),
  });
}

/** What is new in the visitor's conversation; looking counts as seen. */
export async function visitorFeedReply(raw: unknown, ref: { id: string; token: string }, after: number): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  await markSeen(found.desk, found.conversation.id);
  return visitorReply(found.desk, found.settings, found.conversation, after, await customerOf(found.place));
}

/** A change the visitor asks for (end, a person, the assistant again): done when the conversation's state allows it, then the reply. */
async function visitorChange(raw: unknown, ref: { id: string; token: string }, after: number, change: (found: { desk: Desk; conversation: Conversation; settings: DeskSettings }) => Promise<void>): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  try {
    await change(found);
  } catch (error) {
    // Someone else changed it first (a person took it, it ended): the reply shows how it stands.
    if (!(error instanceof SupportError)) throw error;
  }
  const conversation = (await visitorConversation(found.desk, ref)) ?? found.conversation;
  return visitorReply(found.desk, found.settings, conversation, after, await customerOf(found.place));
}

/** The visitor ends the conversation (an ended one stays ended). */
export const visitorEnd = (raw: unknown, ref: { id: string; token: string }, after: number) =>
  visitorChange(raw, ref, after, async ({ desk, conversation }) => {
    if (conversation.status === "open") await transition(desk, conversation.id, "end", { kind: "customer" });
  });

/** *Talk to a person* (2.3, the AI first): the conversation goes from the AI to the queue. */
export const visitorHandoff = (raw: unknown, ref: { id: string; token: string }, after: number) =>
  visitorChange(raw, ref, after, async ({ desk, conversation, settings }) => {
    if (settings.mode === "ai_first" && conversation.status === "open" && conversation.handler === "ai") {
      await transition(desk, conversation.id, "handoff", { kind: "customer" }, { reason: "customer" });
    }
  });

/** *Continue with the assistant* (2.3, the AI first): a waiting conversation goes back to the AI. */
export const visitorAssistant = (raw: unknown, ref: { id: string; token: string }, after: number) =>
  visitorChange(raw, ref, after, async ({ desk, conversation, settings }) => {
    if (settings.mode === "ai_first" && conversation.status === "open" && conversation.handler === "queue") {
      await transition(desk, conversation.id, "hand_back", { kind: "customer" });
    }
  });

/** The email (and name) the visitor leaves for answers (the email card, 2.3), or the response to give. */
export async function visitorEmail(raw: unknown, ref: { id: string; token: string }, after: number, contact: { name: string | null; email: string }): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  const m = t(found.place.lang);
  const saved = await setContact(found.desk, found.conversation.id, found.settings, contact);
  if (!saved.ok) return fail(saved.reason === "off" ? 404 : 409, saved.reason === "off" ? m.chat.sorry : m.chat.emailCard.tooMany);
  const conversation = (await visitorConversation(found.desk, ref)) ?? found.conversation;
  return visitorReply(found.desk, found.settings, conversation, after, await customerOf(found.place));
}

/** What the page an answer email opens shows (2.3): the conversation's reference with the email's token, its messages and its state. */
export type EmailThread = { conversation: { id: string; token: string }; messages: VisitorMessage[]; state: Pick<VisitorState, "status" | "handler"> };

/** The conversation an answer email's link opens on this site, or null (a token of another site, a replaced or malformed one, or a desk with support off). */
export async function emailThread(site: ChatSite, token: string): Promise<EmailThread | null> {
  const desk = visitorDesk(site);
  const [conversation, settings] = await Promise.all([conversationByEmailToken(desk, token), deskSettings(desk)]);
  if (!conversation || !settings || settings.mode === "off") return null;
  await markSeen(desk, conversation.id);
  return {
    conversation: { id: conversation.id, token },
    messages: await visitorFeed(desk, conversation.id, Math.max(0, conversation.messageSeq - 100)),
    state: { status: conversation.status, handler: conversation.handler },
  };
}
