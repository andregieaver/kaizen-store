import type { Handler, MessageAuthor } from "./support-rules";
import { bandOf, TONE_BAND_WORDS, TONE_BANDS, type ToneBand } from "./support-tone";

/**
 * The inbox's words (D216, `docs/support.md` 2.4), pure, for the admin (English only, as the whole admin). The views draw these and
 * `support-inbox-text.test.ts` holds them.
 */

/** "Just now", "3 min", "2 h", "4 d": how long ago, in the shortest words. */
export function agoWords(at: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Who is answering, as a row says it: the AI, waiting (and for how long), the person who has it, or ended. */
export function handlerWords(row: { status: "open" | "ended"; handler: Handler; assignee: { name: string } | null; queuedAt: string | null }, now: Date): string {
  if (row.status === "ended") return "Ended";
  if (row.handler === "ai") return "AI";
  if (row.handler === "queue") return row.queuedAt ? `Waiting ${agoWords(row.queuedAt, now)}` : "Waiting";
  return row.assignee?.name ?? "A person";
}

/** A system line in the transcript, for staff. Unknown kinds say nothing. */
export function systemWords(kind: string | null, data: unknown): string | null {
  const name = data && typeof data === "object" && typeof (data as { name?: unknown }).name === "string" ? (data as { name: string }).name : null;
  switch (kind) {
    case "queued":
      return "Waiting for a person";
    case "joined":
      return `${name ?? "Someone"} joined the conversation`;
    case "left":
      return `${name ?? "Someone"} left`;
    case "assistant_back":
      return "The assistant is back";
    case "ended":
      return "The conversation ended";
    case "reopened":
      return "The conversation was opened again";
    default:
      return null;
  }
}

/** Who wrote a message, as staff read it. */
export function authorWords(author: MessageAuthor, by: string | null): string {
  switch (author) {
    case "customer":
      return "Customer";
    case "ai":
      return "AI assistant";
    case "agent":
      return by ?? "Staff";
    case "note":
      return `Internal note${by ? ` · ${by}` : ""}`;
    case "partner":
      return "AI partner — only your team sees this";
    case "system":
      return "";
  }
}

/** A tone in words: its band and the score (never colour alone). */
export function toneWords(score: number | null): { band: ToneBand; words: string; level: number } | null {
  if (score === null) return null;
  const band = bandOf(score);
  return { band, words: `${TONE_BAND_WORDS[band]} (${score > 0 ? "+" : ""}${score})`, level: TONE_BANDS.indexOf(band) + 1 };
}

/** What the inbox's tabs are called. */
export const TAB_WORDS = { waiting: "Waiting", mine: "Mine", ai: "With the AI", open: "All open", ended: "Ended" } as const;

/** Why a conversation went to a person, for the header. */
export const HANDOFF_WORDS: Record<string, string> = {
  customer: "The customer asked for a person",
  ai: "The assistant asked for a person",
  tone: "The customer's tone fell",
  no_ai: "The assistant could not answer",
  limit: "The assistant reached its daily limit",
};
