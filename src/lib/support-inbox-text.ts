import { fillWords } from "./admin-fill";
import { supportEn, type SupportMessages } from "./admin-messages/support.en";
import type { Handler, MessageAuthor } from "./support-rules";
import { bandOf, TONE_BANDS, type ToneBand } from "./support-tone";

/**
 * The inbox's words (D216, `docs/support.md` 2.4), pure, for the admin. Each takes the `support` catalogue's `lib` words (D312 A10;
 * English unless given). The views draw these and `support-inbox-text.test.ts` holds them.
 */
type LibWords = SupportMessages["lib"];
const EN: LibWords = supportEn.lib;

/** "Just now", "3 min", "2 h", "4 d": how long ago, in the shortest words. */
export function agoWords(at: string, now: Date, w: LibWords = EN): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(at)) / 60_000),
  );
  if (minutes < 1) return w.justNow;
  if (minutes < 60) return fillWords(w.minutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fillWords(w.hours, { n: hours });
  return fillWords(w.days, { n: Math.floor(hours / 24) });
}

/** Who is answering, as a row says it: the AI, waiting (and for how long), the person who has it, or ended. */
export function handlerWords(
  row: {
    status: "open" | "ended";
    handler: Handler;
    assignee: { name: string } | null;
    queuedAt: string | null;
  },
  now: Date,
  w: LibWords = EN,
): string {
  if (row.status === "ended") return w.handler.ended;
  if (row.handler === "ai") return w.handler.ai;
  if (row.handler === "queue")
    return row.queuedAt
      ? fillWords(w.handler.waitingFor, { ago: agoWords(row.queuedAt, now, w) })
      : w.handler.waiting;
  return row.assignee?.name ?? w.handler.person;
}

/** A system line in the transcript, for staff. Unknown kinds say nothing. */
export function systemWords(
  kind: string | null,
  data: unknown,
  w: LibWords = EN,
): string | null {
  const text = (key: string) =>
    data &&
    typeof data === "object" &&
    typeof (data as Record<string, unknown>)[key] === "string"
      ? ((data as Record<string, string>)[key] as string)
      : null;
  const name = text("name");
  const summary = text("summary");
  const why = text("why");
  const someone = name ?? w.system.someone;
  const sys = w.system;
  switch (kind) {
    case "queued":
      return sys.queued;
    case "joined":
      return fillWords(sys.joined, { name: someone });
    case "left":
      return fillWords(sys.left, { name: someone });
    case "assistant_back":
      return sys.assistantBack;
    case "ended":
      return sys.ended;
    case "reopened":
      return sys.reopened;
    case "sign_in":
      return sys.signIn;
    case "action_done":
      return fillWords(sys.actionDone, { summary: summary ?? "" });
    case "action_failed":
      return fillWords(sys.actionFailed, {
        why: why ?? sys.failed,
        summary: summary ?? "",
      });
    case "action_declined":
      return fillWords(sys.actionDeclined, { summary: summary ?? "" });
    case "request_done":
      return fillWords(sys.requestDone, {
        name: someone,
        summary: summary ?? "",
      });
    case "request_declined":
      return fillWords(sys.requestDeclined, {
        name: someone,
        summary: summary ?? "",
      });
    default:
      return null;
  }
}

/** Who wrote a message, as staff read it. */
export function authorWords(
  author: MessageAuthor,
  by: string | null,
  w: LibWords = EN,
): string {
  const a = w.author;
  switch (author) {
    case "customer":
      return a.customer;
    case "ai":
      return a.ai;
    case "agent":
      return by ?? a.staff;
    case "note":
      return by ? fillWords(a.noteBy, { name: by }) : a.note;
    case "partner":
      return a.partner;
    case "system":
      return "";
  }
}

/** A tone in words: its band and the score (never colour alone). */
export function toneWords(
  score: number | null,
  w: LibWords = EN,
): { band: ToneBand; words: string; level: number } | null {
  if (score === null) return null;
  const band = bandOf(score);
  return {
    band,
    words: `${w.tones[band]} (${score > 0 ? "+" : ""}${score})`,
    level: TONE_BANDS.indexOf(band) + 1,
  };
}

/** What the inbox's tabs are called. */
export const TAB_WORDS = EN.tabs;

/** Why a conversation went to a person, for the header. */
export const HANDOFF_WORDS: Record<string, string> = EN.handoff;

/** An outcome of a summary, in words (2.7). */
export const OUTCOME_WORDS: Record<string, string> = EN.outcomes;

/** A topic of the closed lists in words: `order_status` is "Order status", `ai` "AI". */
export function topicWords(topic: string, w: LibWords = EN): string {
  const own = (w.topics as Record<string, string>)[topic];
  if (own) return own;
  if (topic === "ai") return "AI";
  const words = topic.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Why an ended conversation shows no summary, in words; null when it has one or is still open. */
export function summaryStatusWords(
  status: string,
  w: LibWords = EN,
): string | null {
  switch (status) {
    case "pending":
    case "failed":
    case "skipped":
      return w.summaryStatus[status];
    default:
      return null;
  }
}

/** How long a conversation lasted, in the shortest words ("12 min", "2 h 5 min", "3 d"). */
export function durationWords(
  from: string,
  to: string,
  w: LibWords = EN,
): string {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(to) - Date.parse(from)) / 60_000),
  );
  if (minutes < 60) return fillWords(w.minutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60
      ? fillWords(w.hoursMinutes, { h: hours, n: minutes % 60 })
      : fillWords(w.hours, { n: hours });
  return fillWords(w.days, { n: Math.floor(hours / 24) });
}
