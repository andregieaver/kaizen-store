import "server-only";

import { t } from "@/lib/i18n";
import { CONVERSATION_MESSAGES_MAX, REOPEN_HOURS } from "@/lib/support-rules";
import type { VisitorReply } from "@/lib/support-visitor";
import { BODY_MAX, type TurnInput } from "@/lib/support-visitor-schema";

import { chatPlace, fail, type ChatContext, type ChatPlace } from "./chat-route";
import { getCustomer } from "./customers";
import {
  SupportError,
  addMessage,
  agentIdentity,
  channelOf,
  claimForCustomer,
  deskSettings,
  ensureDesk,
  markSeen,
  openConversation,
  transition,
  visitorConversation,
  visitorFeed,
  visitorState,
  type Conversation,
  type DeskSettings,
} from "./support";
import { visitorDesk, type Desk } from "./support-desk";
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

/** The signed-in customer of a store's desk, or null (Kaizen's desk has no customers). */
async function customerOf(place: ChatPlace): Promise<string | null> {
  if (!place.storeId) return null;
  return (await getCustomer(place.storeId))?.id ?? null;
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

/** The state and the messages after `after`, as every visitor route answers. */
export async function visitorReply(desk: Desk, settings: DeskSettings, conversation: Conversation, after: number, signedIn: boolean, extra: Partial<VisitorReply> = {}): Promise<VisitorReply> {
  const withPerson = conversation.status === "open" && conversation.handler === "human" && conversation.assigneeId;
  const [messages, agent] = await Promise.all([visitorFeed(desk, conversation.id, after), withPerson ? agentIdentity(desk, conversation.assigneeId!, settings) : Promise.resolve(null)]);
  return { ...extra, state: visitorState(conversation, settings, signedIn, agent), messages };
}

/**
 * A visitor's message (typed, or the words of a spoken one): the conversation is made on the first message and continued with its
 * token; an ended one is reopened within `REOPEN_HOURS`, else a new one starts. The message is kept before the AI is asked, so a
 * failing AI loses nothing; the answer is every message after `after`.
 */
export async function visitorTurn(context: ChatContext, input: Omit<TurnInput, "message">, words: string): Promise<VisitorReply | Response> {
  const m = t(context.lang);
  const desk = visitorDesk(context.site);
  const settings = await ensureDesk(desk);
  const customerId = await customerOf(context);

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
    const opened = await openConversation(desk, { mode: settings.mode, locale: context.locale, market: context.market, pagePath: input.path ?? null, customerId });
    conversation = opened.conversation;
    token = opened.token;
    after = 0;
  } else if (customerId && !conversation.customerId) {
    await claimForCustomer(desk, conversation.id, customerId);
  }

  try {
    await addMessage(desk, conversation.id, "customer", null, words);
  } catch (error) {
    if (error instanceof SupportError) return fail(409, m.chat.sorry);
    throw error;
  }
  // The AI answers only while it has the conversation (support off or the AI first); with a person or in the queue the message waits for them.
  const current = (await visitorConversation(desk, { id: conversation.id, token: token ?? input.conversation!.token })) ?? conversation;
  const turn = settings.mode !== "people" && current.handler === "ai" ? await runSupportTurn(desk, context, conversation.id, { path: input.path, signals: input.signals }) : { reply: null };
  const fresh = (await visitorConversation(desk, { id: conversation.id, token: token ?? input.conversation!.token })) ?? conversation;
  return visitorReply(desk, settings, fresh, after, customerId !== null, {
    conversation: { id: conversation.id, ...(token ? { token } : {}), channel: channelOf(conversation) },
    ...("error" in turn && turn.error ? { error: turn.error } : {}),
  });
}

/** What is new in the visitor's conversation; looking counts as seen. */
export async function visitorFeedReply(raw: unknown, ref: { id: string; token: string }, after: number): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  await markSeen(found.desk, found.conversation.id);
  return visitorReply(found.desk, found.settings, found.conversation, after, (await customerOf(found.place)) !== null);
}

/** The visitor ends the conversation (an ended one stays ended). */
export async function visitorEnd(raw: unknown, ref: { id: string; token: string }, after: number): Promise<VisitorReply | Response> {
  const found = await visitorPlace(raw, ref);
  if (found instanceof Response) return found;
  let conversation = found.conversation;
  if (conversation.status === "open") {
    try {
      await transition(found.desk, conversation.id, "end", { kind: "customer" });
    } catch (error) {
      if (!(error instanceof SupportError)) throw error;
    }
    conversation = (await visitorConversation(found.desk, ref)) ?? conversation;
  }
  return visitorReply(found.desk, found.settings, conversation, after, (await customerOf(found.place)) !== null);
}
