import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { TONE_CONTEXT, TONE_SYSTEM, crossedLine, parseTone, tonePrompt, toneFell, toneHistory } from "@/lib/support-tone";

import { AiError, aiFor, completeText } from "./ai";
import { SupportError, deskSettings, transition, type DeskSettings } from "./support";
import type { Desk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * A customer's tone (D216, `docs/support.md` 2.6, step 6): after each customer message, in the background (`after()` in the chat's
 * routes), the desk's text model scores that message in its context; the score is kept on the message (once, by
 * `commerce.support_record_tone()`), and the conversation's tone is the rolling value of its scored messages. When it reaches the
 * desk's alert line or falls `TONE_DROP` within three messages, the conversation is marked (`tone_alert_at`, once per fall) and the
 * inbox notifies; with the AI first, reaching the hand-over line moves a conversation the AI has to the queue (reason `tone`).
 * Only on a desk with support on and tone on, with a text model. A failed or unreadable answer leaves the message *not measured*,
 * never 0. Nothing is decided about the customer from it.
 */

export type ToneOutcome = { outcome: "scored"; score: number; tone: number; alerted: boolean; handedOver: boolean } | { outcome: "not_measured" | "skipped" };

/** Whether a desk scores tone at all: support on and tone on (a text model is checked when scoring). */
export const scoresTone = (settings: Pick<DeskSettings, "mode" | "toneOn"> | null): boolean => settings !== null && settings.mode !== "off" && settings.toneOn;

export async function scoreTone(desk: Desk, conversationId: string, seq: number): Promise<ToneOutcome> {
  const settings = await deskSettings(desk);
  if (!scoresTone(settings)) return { outcome: "skipped" };
  const lines = await db().execute<Row>(sql`
    select m.seq, m.author, m.body, m.tone from commerce.support_messages m
    join commerce.support_conversations c on c.id = m.conversation_id
    where m.conversation_id = ${conversationId}::uuid and c.store_id is not distinct from ${desk.storeId}::uuid and c.anonymised_at is null
      and m.seq <= ${seq} and m.author in ('customer', 'ai', 'agent')
    order by m.seq desc limit ${TONE_CONTEXT + 1}
  `);
  const target = lines[0];
  if (!target || Number(target.seq) !== seq || target.author !== "customer" || target.tone !== null) return { outcome: "skipped" };
  const connection = await aiFor(desk.storeId, { feature: "support_tone" });
  if (!connection?.textModel) return { outcome: "not_measured" };

  let answer: string;
  try {
    const prompt = tonePrompt(lines.reverse().map((r) => ({ author: String(r.author) as "customer" | "ai" | "agent", body: String(r.body) })));
    answer = (await completeText(connection, [{ role: "system", content: TONE_SYSTEM }, { role: "user", content: prompt }], { maxTokens: 60, temperature: 0, reasoningEffort: "low", timeoutMs: 20_000 })).text;
  } catch (error) {
    if (error instanceof AiError) return { outcome: "not_measured" };
    throw error;
  }
  const scored = parseTone(answer);
  if (!scored) return { outcome: "not_measured" };
  const [recorded] = await db().execute<Row>(sql`select commerce.support_record_tone(${conversationId}::uuid, ${seq}, ${scored.score}, ${scored.label}) as done`);
  if (!recorded?.done) return { outcome: "skipped" };
  const result = await updateConversationTone(desk, conversationId, settings!);
  return { outcome: "scored", score: scored.score, ...result };
}

/**
 * The conversation's tone from its scored customer messages (under the conversation's lock, so two scores at once agree), its alert
 * when it fell, and the hand-over at the desk's line while the AI has it.
 */
export async function updateConversationTone(desk: Desk, conversationId: string, settings: DeskSettings): Promise<{ tone: number; alerted: boolean; handedOver: boolean }> {
  const { tone, alerted, handOver } = await db().transaction(async (tx) => {
    const [conversation] = await tx.execute<Row>(sql`
      select status, handler from commerce.support_conversations
      where id = ${conversationId}::uuid and store_id is not distinct from ${desk.storeId}::uuid for update
    `);
    const scores = await tx.execute<Row>(sql`
      select tone from commerce.support_messages where conversation_id = ${conversationId}::uuid and author = 'customer' order by seq
    `);
    const history = toneHistory(scores.map((r) => (r.tone === null ? null : Number(r.tone))));
    const now = history[history.length - 1];
    const fell = toneFell(history, settings.toneAlert);
    await tx.execute(sql`
      update commerce.support_conversations set tone = ${now}, tone_alert_at = case when ${fell} then now() else tone_alert_at end
      where id = ${conversationId}::uuid
    `);
    const aiHasIt = conversation?.status === "open" && conversation.handler === "ai";
    return { tone: now, alerted: fell, handOver: settings.mode === "ai_first" && aiHasIt && crossedLine(history, settings.toneHandoff) };
  });
  let handedOver = false;
  if (handOver) {
    try {
      await transition(desk, conversationId, "handoff", { kind: "system" }, { reason: "tone" });
      handedOver = true;
    } catch (error) {
      // A person took it or it ended in the meantime.
      if (!(error instanceof SupportError)) throw error;
    }
  }
  return { tone, alerted, handedOver };
}
