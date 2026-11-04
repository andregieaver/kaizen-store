import { fillWords } from "./admin-fill";
import type { AnalyticsMessages } from "./admin-messages/analytics.en";
import type { Alert } from "./analytics-alerts";

/**
 * Handing an alert to the AI manager (wave 8 unit D, D348): *Ask the AI manager* beside an alert sends the panel a first message written by code from
 * the alert's own words and figures, never the model's, asking for a next step kept for a yes. The button and the panel meet through a window event, so
 * the alert lists need no link to the panel; the launcher marks the page (`data-ai-manager` on `<html>`) while it is there.
 */

export const ASK_AI_MANAGER_EVENT = "kaizen:ask-ai-manager";
/**
 * `send` false: the words wait in the message box for the person to read and send (the briefing's email link, D416). Left out, they are sent
 * as the person's message (the button beside an alert, a press on the page, D348).
 */
export type AskDetail = { message: string; send?: boolean };

/** What the AI manager is handed for an ask: its words, counted per press, and whether they are sent or wait in the box. Null for no words. */
export function askFrom(detail: Partial<AskDetail> | undefined, previous?: { n: number }): { text: string; n: number; send: boolean } | null {
  const message = detail?.message;
  if (typeof message !== "string" || !message.trim()) return null;
  return { text: message, n: (previous?.n ?? 0) + 1, send: detail?.send !== false };
}

/** The first message for an alert, in the words given (the page's language). */
export function askAboutAlert(alert: Pick<Alert, "text" | "evidence">, words: AnalyticsMessages["alerts"]): string {
  const list = alert.evidence.map((e) => `${e.label}: ${e.value}${e.baseline ? fillWords(words.against, { baseline: e.baseline }) : ""}`).join("; ");
  return fillWords(words.askMessage, { text: alert.text, figures: list ? fillWords(words.askFigures, { list }) : "" });
}
