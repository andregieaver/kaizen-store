import "server-only";

import { after as afterResponse } from "next/server";

import { t } from "@/lib/i18n";
import { CONVERSATION_MESSAGES_MAX, REOPEN_HOURS } from "@/lib/support-rules";
import type { VisitorMessage, VisitorReply, VisitorState } from "@/lib/support-visitor";
import { BODY_MAX, type TurnInput } from "@/lib/support-visitor-schema";

import type { ChatSite } from "./chat-agent";
import { chatPlace, fail, type ChatContext, type ChatPlace } from "./chat-route";
import { createSignInCode, getCustomer, startSession, verifySignInCode } from "./customers";
import { sendSignInCode } from "./shopper-emails";
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
  setRating,
  transition,
  visitorConversation,
  visitorFeed,
  visitorState,
  type Conversation,
  type DeskSettings,
} from "./support";
import { visitorDesk, type Desk } from "./support-desk";
import type { SupportCustomer } from "./support-tools";
import { confirmAction } from "./support-actions";
import { summarise } from "./support-summary";
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
async function sessionCustomer(place: ChatPlace): Promise<SupportCustomer> {
  if (!place.storeId) return null;
  const customer = await getCustomer(place.storeId);
  return customer ? { id: customer.id, email: customer.email } : null;
}

/**
 * The customer a conversation is for (D216, step 9): the signed-in customer, when the conversation is theirs or no one's yet. A
 * conversation linked to one customer treats anyone else signed in on the browser as not signed in, so their tools see nothing.
 */
export function customerFor(signedIn: SupportCustomer, conversation: Pick<Conversation, "customerId">): SupportCustomer {
  if (!signedIn) return null;
  return conversation.customerId === null || conversation.customerId === signedIn.id ? signedIn : null;
}

const customerOf = async (place: ChatPlace, conversation: Pick<Conversation, "customerId">) => customerFor(await sessionCustomer(place), conversation);

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
  const signedIn = await sessionCustomer(context);

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
    const opened = await openConversation(desk, { mode: settings.mode, locale: context.locale, market: context.market, pagePath: input.path ?? null, customerId: signedIn?.id ?? null });
    conversation = opened.conversation;
    token = opened.token;
    after = 0;
  } else if (signedIn && !conversation.customerId) {
    await claimForCustomer(desk, conversation.id, signedIn.id);
    conversation = { ...conversation, customerId: desk.storeId ? signedIn.id : null };
  }
  const customer = customerFor(signedIn, conversation);
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
      const turn = await runSupportTurn(desk, context, conversation.id, { path: input.path, signals: input.signals }, customer);
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
  return visitorReply(found.desk, found.settings, found.conversation, after, await customerOf(found.place, found.conversation));
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
  return visitorReply(found.desk, found.settings, conversation, after, await customerOf(found.place, conversation));
}

/** The visitor ends the conversation (an ended one stays ended). */
export const visitorEnd = (raw: unknown, ref: { id: string; token: string }, after: number) =>
  visitorChange(raw, ref, after, async ({ desk, conversation }) => {
    if (conversation.status !== "open") return;
    await transition(desk, conversation.id, "end", { kind: "customer" });
    // The summary is written after the answer (step 7); the five-minute job catches any that is not.
    afterResponse(() => summarise(desk, conversation.id).catch((error) => console.warn(`[support] summary of ${conversation.id}: ${String(error)}`)));
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
  return visitorReply(found.desk, found.settings, conversation, after, await customerOf(found.place, conversation));
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

/** The rating card (2.1, step 7): the visitor's answer to "Did we help?" for an ended conversation, or the response to give. */
export async function visitorRate(raw: unknown, ref: { id: string; token: string }, after: number, rating: "good" | "bad", comment: string | null): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  if (!(await setRating(found.desk, found.conversation.id, rating, comment))) return fail(409, t(found.place.lang).chat.sorry);
  const conversation = (await visitorConversation(found.desk, ref)) ?? found.conversation;
  return visitorReply(found.desk, found.settings, conversation, after, await customerOf(found.place, conversation));
}

/**
 * The sign-in card's first step (D216, 2.1, step 9): a code is emailed, as on the store's own sign-in page, and the answer is the same
 * whether or not the email has an account (a new one is made when the code is used); only asking for too many codes is refused, as
 * there. Only on a store's desk.
 */
export async function visitorSignIn(raw: unknown, ref: { id: string; token: string }, email: string): Promise<Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  const { site } = found.place;
  if (site.kind !== "store") return fail(404, t(found.place.lang).chat.sorry);
  const code = await createSignInCode(site.store.id, email);
  if (!code) return Response.json({ ok: false, error: t(site.market.lang).account.tooManyCodes }, { status: 429, headers: NO_STORE });
  await sendSignInCode(site.store.id, site.market.code, site.market.locale, email, code);
  return Response.json({ ok: true }, { headers: NO_STORE });
}

/**
 * The sign-in card's second step: the code signs the visitor in to the store (the session cookie, as the store's own page sets it, with
 * the orders of the email claimed) and links the conversation to them. A conversation already linked to another customer stays
 * theirs: the visitor is signed in to the store but not here (`signedIn: false`, with a sentence saying so).
 */
export async function visitorSignInCode(raw: unknown, ref: { id: string; token: string }, after: number, email: string, code: string): Promise<Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  const { site } = found.place;
  if (site.kind !== "store") return fail(404, t(found.place.lang).chat.sorry);
  const m = t(site.market.lang);
  const customerId = await verifySignInCode(site.store.id, email, code);
  if (!customerId) return Response.json({ signedIn: false, error: m.account.wrongCode }, { status: 400, headers: NO_STORE });
  await startSession(site.store.id, customerId);
  if (!found.conversation.customerId) await claimForCustomer(found.desk, found.conversation.id, customerId);
  const conversation = (await visitorConversation(found.desk, ref)) ?? found.conversation;
  const customer = customerFor({ id: customerId, email }, conversation);
  const answer = await visitorReply(found.desk, found.settings, conversation, after, customer);
  return Response.json({ ...answer, signedIn: customer !== null, ...(customer ? {} : { error: m.chat.signInCard.otherAccount }) }, { headers: NO_STORE });
}

/**
 * The confirm card (D216, 2.1, step 10): the visitor confirms or declines a proposal of this conversation. The action runs only for
 * the signed-in customer the conversation is for, and only while it is open (`confirmAction()`); the answer is the conversation as
 * it stands, with the line saying what happened.
 */
export async function visitorConfirm(raw: unknown, ref: { id: string; token: string }, after: number, actionId: string, confirm: boolean): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  const { site } = found.place;
  const m = t(found.place.lang);
  if (site.kind !== "store") return fail(404, m.chat.sorry);
  const customer = await customerOf(found.place, found.conversation);
  const outcome = await confirmAction(
    { site, settings: found.settings, customer, desk: found.desk, conversationId: found.conversation.id, conversation: found.conversation },
    actionId,
    confirm,
  );
  if (!outcome.ok) return fail(404, m.chat.actions.expired);
  const conversation = (await visitorConversation(found.desk, ref)) ?? found.conversation;
  return visitorReply(found.desk, found.settings, conversation, after, customer, outcome.status === "expired" ? { error: m.chat.actions.expired } : {});
}
