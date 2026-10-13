import "server-only";

import type { ChatReply } from "@/lib/chat";
import type { ChatRequest } from "@/lib/chat-schema";
import { t } from "@/lib/i18n";
import type { Signals } from "@/lib/recommendations";
import { AI_HISTORY, MESSAGE_MAX } from "@/lib/support-rules";
import type { VisitorMessageData } from "@/lib/support-visitor";

import { AiError } from "./ai";
import { runChat } from "./chat-agent";
import type { ChatContext } from "./chat-route";
import { addMessage, historyForAi } from "./support";
import type { Desk } from "./support-desk";
import { supportToolsFor, type SupportCustomer } from "./support-tools";

/**
 * The AI's answer in a support conversation (D216, `docs/support.md` 5.2): its history comes from the database (the customer's
 * messages as the user's, the AI's and people's as the assistant's; system lines, notes and the partner's help left out), the chat
 * agent answers as before (`runChat()`), and the answer is stored through `support_add_message()`, which drops it when a person has
 * taken over in the meantime. With the AI first it may hand the conversation to a person (`handoff_to_human`, step 5) and, on a
 * store's desk, has the first line's tools (step 9, `supportToolsFor()`): their chips and card are kept with the answer.
 */

/** How a person's words are given to the AI, so it knows who said them. */
export const PERSON_PREFIX = "(A person from the store wrote:)";

/** The AI's answer; `error` when it could not answer (the customer's message is kept), `handoff` when it asked for a person. */
export type SupportTurn = { reply: ChatReply | null; error?: string; handoff?: string };

/** Runs only where the AI answers (`context.agent` and `context.connection` are set: `chatContext()`). */
export async function runSupportTurn(
  desk: Desk,
  context: ChatContext,
  conversationId: string,
  input: { path?: string; signals: Signals },
  customer: SupportCustomer = null,
): Promise<SupportTurn> {
  const m = t(context.lang);
  if (!context.agent || !context.connection) return { reply: null, error: m.chat.sorry };
  const history = await historyForAi(desk, conversationId, AI_HISTORY);
  // The last message must be the customer's (another tab may have answered in the meantime).
  if (history.at(-1)?.author !== "customer") return { reply: null };
  const request: ChatRequest = {
    path: input.path,
    signals: input.signals,
    messages: history.map((message) =>
      message.author === "customer"
        ? { role: "user" as const, content: message.body.slice(0, MESSAGE_MAX.customer) }
        : { role: "assistant" as const, content: message.author === "agent" ? `${PERSON_PREFIX} ${message.body}`.slice(0, MESSAGE_MAX.customer) : message.body.slice(0, MESSAGE_MAX.customer) },
    ),
  };
  let reply: ChatReply;
  try {
    const support = context.site.kind === "store" ? await supportToolsFor({ site: context.site, settings: context.settings, customer }) : null;
    reply = await runChat(context.site, context.agent, request, context.connection, { handoff: context.settings.mode === "ai_first", ...(support ? { support } : {}) });
  } catch (error) {
    console.warn(`[support] ${context.storeId ?? "Kaizen"}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof AiError) return { reply: null, error: m.chat.sorry };
    throw error;
  }
  const data: VisitorMessageData = {};
  if (reply.products.length > 0) data.products = reply.products;
  if (reply.actions.length > 0) data.actions = reply.actions;
  if (reply.chips?.length) data.chips = reply.chips;
  if (reply.card) data.card = reply.card;
  const body = (reply.reply || m.chat.sorry).slice(0, MESSAGE_MAX.ai);
  await addMessage(desk, conversationId, "ai", null, body, Object.keys(data).length > 0 ? { data } : {});
  return { reply, ...(reply.handoff ? { handoff: reply.handoff } : {}) };
}
