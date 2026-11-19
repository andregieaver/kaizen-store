import "server-only";

import type { ChatReply } from "@/lib/chat";
import type { ChatRequest } from "@/lib/chat-schema";
import { t } from "@/lib/i18n";
import type { Signals } from "@/lib/recommendations";
import { AI_HISTORY, MESSAGE_MAX, type EscalationCategory } from "@/lib/support-rules";
import type { VisitorMessageData } from "@/lib/support-visitor";

import { AiError } from "./ai";
import { runChat } from "./chat-agent";
import type { ChatContext } from "./chat-route";
import { addMessage, historyForAi } from "./support";
import type { Desk } from "./support-desk";
import type { Account } from "./auth";
import { aboutStoreOf, joinTools, kaizenToolsFor } from "./support-kaizen";
import { supportToolsFor, type SupportCustomer } from "./support-tools";
import { chatPromptVersion } from "./prompt-versions";
import { gapOf } from "@/lib/unanswered-questions";
import { log } from "./log";
import { keepUnanswered } from "./unanswered-questions";

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
export type SupportTurn = { reply: ChatReply | null; error?: string; handoff?: string; escalation?: EscalationCategory };

/** Runs only where the AI answers (`context.agent` and `context.connection` are set: `chatContext()`). */
export async function runSupportTurn(
  desk: Desk,
  context: ChatContext,
  conversationId: string,
  input: { path?: string; signals: Signals },
  customer: SupportCustomer = null,
  /** An account asking Kaizen from the admin (step 11): Kaizen's tools for their stores and the admin's pages. */
  admin: { requester: Account } | null = null,
  /** A conversation by email (D332): the AI is told so and has no tool that needs a button, nor one that needs a signed-in customer unless
   * `customer` is the sender's own (B1, `emailCustomer()`). `onText`: the
   * answer's finished sentences as they are written, for the chat to show (PSI PERF-08); the message is kept whole, as without it.
   * `account`: by email on Kaizena Flow's own desks, the account whose address the sender's is (`emailAccount()`): its stores' tools, which
   * only read. */
  channel: { email?: boolean; onText?: (shown: string) => void; account?: Account | null } = {},
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
    const accountTools = channel.email && channel.account ? kaizenToolsFor(channel.account, null, { email: true }) : null;
    const support =
      // On a site of the owner's own (D582) nobody can sign in, so none of support's tools for a customer's orders is offered there.
      context.site.kind === "store" && !context.site.embed
        ? joinTools(await supportToolsFor({ site: context.site, settings: context.settings, customer, desk, conversationId, email: channel.email }), accountTools)
        : admin
          ? kaizenToolsFor(admin.requester, await aboutStoreOf(conversationId))
          : accountTools;
    reply = await runChat(context.site, context.agent, request, context.connection, {
      handoff: context.settings.mode === "ai_first",
      ...(support ? { support } : {}),
      admin: admin !== null,
      email: channel.email,
      // By email a customer is given only when the sender's address is theirs (`emailCustomer()` in `support-inbound.ts`).
      emailOrders: Boolean(channel.email && customer),
      emailAccount: Boolean(accountTools),
      ...(channel.onText ? { onText: channel.onText } : {}),
    });
  } catch (error) {
    console.warn(`[support] ${context.storeId ?? "Kaizena Flow"}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof AiError) return { reply: null, error: m.chat.sorry };
    throw error;
  }
  const data: VisitorMessageData = {};
  if (reply.products.length > 0) data.products = reply.products;
  if (reply.actions.length > 0) data.actions = reply.actions;
  if (reply.chips?.length) data.chips = reply.chips;
  if (reply.card) data.card = reply.card;
  const body = (reply.reply || m.chat.sorry).slice(0, MESSAGE_MAX.ai);
  // The prompt version the answer was written under (D391) is kept with it, for the desk; the visitor's feed leaves it out.
  await addMessage(desk, conversationId, "ai", null, body, { data: { ...data, prompt: chatPromptVersion() }, ...(reply.action ? { action: reply.action } : {}) });
  // A question the answer stood on nothing for goes to the site's gap list (ecosystem plan E4.3): the customer's last message, as code saw
  // it (`gapOf()`). Never in the way of the answer: a failure is logged with ids only.
  const signal = gapOf(reply);
  if (signal) {
    await keepUnanswered(desk, { conversationId, lang: context.lang, words: history.at(-1)!.body, signal }).catch((error: unknown) =>
      log("warn", "support.question_not_kept", { storeId: context.storeId, conversationId, signal }, error),
    );
  }
  return { reply, ...(reply.handoff ? { handoff: reply.handoff, ...(reply.escalation ? { escalation: reply.escalation } : {}) } : {}) };
}
