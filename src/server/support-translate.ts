import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { MESSAGE_MAX } from "@/lib/support-rules";
import { cleanTranslation, languageName, translateInput, translatePrompt } from "@/lib/support-translate";

import { AiError, aiFor, completeText } from "./ai";
import type { StaffDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * Translation for agents (D216, 2.4, step 13), on a person's press: a customer's message into English, shown to them alone, and a
 * draft of theirs into the conversation's language, which fills their composer. Nothing here writes a message or sends anything:
 * a translated reply reaches the customer only through the person's own Send (`agentAct()`'s `reply` with `translated`). Through the
 * desk's AI (feature `support_partner`); without a text model it says so.
 */

export type Translation = { ok: true; text: string; language: string } | { ok: false; problem: string };

const NO_AI = "Translation needs a text model in the AI settings.";
const COULD_NOT = "The text could not be translated just now. Try again.";

async function conversationOf(staff: StaffDesk, conversationId: string): Promise<{ locale: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select locale from commerce.support_conversations
    where id = ${conversationId}::uuid and ${staff.desk.storeId ? sql`store_id = ${staff.desk.storeId}::uuid` : sql`store_id is null`} and anonymised_at is null
  `);
  return row ? { locale: String(row.locale) } : null;
}

async function translate(staff: StaffDesk, text: string, to: string, max: number): Promise<Translation> {
  const connection = await aiFor(staff.desk.storeId, { feature: "support_partner", accountId: staff.account.id });
  if (!connection?.textModel) return { ok: false, problem: NO_AI };
  try {
    const answer = await completeText(
      connection,
      [
        { role: "system", content: translatePrompt(to) },
        { role: "user", content: translateInput(text) },
      ],
      { maxTokens: 1600, temperature: 0, timeoutMs: 30_000 },
    );
    const translated = cleanTranslation(answer.text, max);
    return translated ? { ok: true, text: translated, language: to } : { ok: false, problem: COULD_NOT };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: COULD_NOT };
    throw error;
  }
}

/** A customer's message of the desk's conversation in English, for the person reading; never stored. */
export async function translateMessage(staff: StaffDesk, conversationId: string, seq: number): Promise<Translation> {
  if (!(await conversationOf(staff, conversationId))) return { ok: false, problem: "This conversation is gone." };
  const [message] = await db().execute<Row>(sql`
    select body from commerce.support_messages where conversation_id = ${conversationId}::uuid and seq = ${seq} and author = 'customer'
  `);
  if (!message) return { ok: false, problem: "Only the customer's messages are translated." };
  return translate(staff, String(message.body), "English", MESSAGE_MAX.agent);
}

/** A draft in the conversation's language, to fill the person's composer; never stored and never sent from here. */
export async function translateReply(staff: StaffDesk, conversationId: string, text: string): Promise<Translation> {
  const conversation = await conversationOf(staff, conversationId);
  if (!conversation) return { ok: false, problem: "This conversation is gone." };
  return translate(staff, text, languageName(conversation.locale), MESSAGE_MAX.agent);
}
