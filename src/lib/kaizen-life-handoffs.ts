import type { Signal } from "./admin-schemes";

/**
 * Tasks the assistants hand each other over the account link (docs/assistants-together.md, step 2): the statuses, the limits and the
 * words, pure. The records and the doors are `src/server/kaizen-life-handoffs.ts`.
 */

export const HANDOFF_STATUSES = ["working", "waiting_for_you", "done", "declined", "failed", "cancelled", "expired"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

const FINAL: ReadonlySet<HandoffStatus> = new Set(["done", "declined", "failed", "cancelled", "expired"]);
/** A status nothing changes any more: the task ended. */
export const isFinal = (status: HandoffStatus): boolean => FINAL.has(status);

export const isHandoffStatus = (value: unknown): value is HandoffStatus =>
  typeof value === "string" && (HANDOFF_STATUSES as readonly string[]).includes(value);

/** Tasks one person may hand over in a day, each way. */
export const HANDOFFS_PER_DAY = 20;
export const TASK_MAX = 4000;
export const RESULT_MAX = 8000;
export const FROM_MAX = 200;

/** How long a task handed to Kaizen Life may stay unanswered before it is given up. */
export const TO_LIFE_DAYS = 2;
/** How long a run of a task from Kaizen Life may hold it before it counts as stopped. */
export const RUN_STALE_MINUTES = 30;
/** Tries to tell Kaizen Life a status before the five-minute job gives up on that status. */
export const REPORT_TRIES = 6;

/**
 * The message a store's AI manager is given for a task Kaizen Life's assistant handed it. Nobody is watching, so it is told to do what it
 * can with its tools, keep any change for the owner's yes, and end with a short report, which goes back to Kaizen Life as said.
 */
export function fromLifeTurnMessage(task: string, from: string | null): string {
  return [
    `Kaizen Life's assistant hands you a task for the owner${from ? ` (asked in ${from})` : ""}. Nobody is watching this conversation now.`,
    "Do what you can with your tools. Keep any change for the owner's yes as always, and never decide one in words.",
    "End with a short report in plain text: what you did, and what waits for the owner's yes.",
    "",
    `The task: ${task.slice(0, TASK_MAX)}`,
  ].join("\n");
}

/**
 * What a task's kept changes came to once none waits: `done` when every one ran; else `failed` if one failed, `declined` if the owner said
 * no to one, `expired` if they ran out unanswered. Null while one still waits for a yes.
 */
export function outcomeOfApprovals(statuses: readonly string[]): HandoffStatus | null {
  if (statuses.length === 0 || statuses.some((s) => s === "pending")) return null;
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "declined")) return "declined";
  return "expired";
}

const REPORT_HEAD: Record<HandoffStatus, string> = {
  working: "is working on",
  waiting_for_you: "waits for your yes on",
  done: "did",
  declined: "was told no on",
  failed: "could not do",
  cancelled: "stopped",
  expired: "did not finish",
};

/**
 * The line written into the AI manager's conversation when Kaizen Life reports on a task it was handed: marked as Kaizen Life's (its
 * words are another app's, read as data), the task named, the result and link as given.
 */
export function lifeReportMessage(task: string, status: HandoffStatus, result: string | null, link: string | null): string {
  const quoted = task.length > 200 ? `${task.slice(0, 199)}…` : task;
  return [`${LIFE_REPORT_MARK}Kaizen Life ${REPORT_HEAD[status]}: “${quoted}”`, result?.trim() || null, link || null]
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
    .slice(0, RESULT_MAX + 600);
}

/** The notice's outcome for a status Kaizen Life reported: its words are the notice kind's (`noticeWordKey()`). */
export function noticeOutcome(status: HandoffStatus): "done" | "waiting" | "failed" {
  if (status === "done") return "done";
  if (status === "waiting_for_you" || status === "working") return "waiting";
  return "failed";
}

/** How a status looks on *Between your assistants* (step 3): what waits for the person stands out, what failed is red. */
export const HANDOFF_SIGNAL: Record<HandoffStatus, Signal> = {
  working: "neutral",
  waiting_for_you: "warning",
  done: "positive",
  declined: "neutral",
  failed: "danger",
  cancelled: "neutral",
  expired: "warning",
};

/** The marker Kaizen Life's reports start with in the AI manager's conversation (`lifeReportMessage()`); the chat draws them as a card. */
export const LIFE_REPORT_MARK = "[From Kaizen Life] ";

/** A message that is Kaizen Life's report, without its marker; null for any other message. */
export function lifeReportOf(content: string): string | null {
  return content.startsWith(LIFE_REPORT_MARK) ? content.slice(LIFE_REPORT_MARK.length) : null;
}
