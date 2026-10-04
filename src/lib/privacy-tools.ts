import { extensionProblem, EXTENSION_PROBLEM_TEXT, PRIVACY_KIND_LABELS, PRIVACY_STATUS_LABELS, type PrivacyKind, type PrivacyOutcome, type PrivacyStatus, type RequestClock } from "./privacy-request";

/**
 * What the AI manager's privacy tools (wave 1, 1g, D162) may say, decided without a database. `list_privacy_requests` and
 * `explain_privacy_request` only read the log and its one-month clock (GDPR Art. 12(3)): counts, dates and the state of a request, never a
 * person's name, email, notes or data, so a person's record never enters a model's context. There is no tool that exports or erases (the
 * irreversible work is done on the customer's page, behind a confirmation), and the model never works out a date: every day here is the
 * clock's own.
 */

/** What each kind of request is, for the owner who asks. */
export const KIND_MEANS: Record<PrivacyKind, string> = {
  export: "The person asked for a copy of the data the store holds about them (the right of access, GDPR Art. 15, and to take it with them, Art. 20).",
  erasure: "The person asked for their data to be erased (GDPR Art. 17). Data the law makes the store keep, such as the accounts for sales, is kept restricted until its period ends, then made anonymous; the rest goes now.",
};

/** What each state means for the store. */
export const STATUS_MEANS: Record<PrivacyStatus, string> = {
  open: "Waiting for the store. The one-month clock is running.",
  done: "Answered.",
  refused: "Refused with a reason; the person was told the reason, their right to complain and to a judicial remedy.",
  cancelled: "Logged by mistake and cancelled.",
};

export const OUTCOME_MEANS: Record<PrivacyOutcome, string> = {
  exported: "A file was downloaded for the person.",
  erased: "The person's data was erased (and what the law makes the store keep was restricted).",
  no_data: "The store held no data about the person.",
  refused: "The request was refused.",
  cancelled: "Cancelled as a mistake.",
};

export const kindLabel = (kind: PrivacyKind): string => PRIVACY_KIND_LABELS[kind];
export const statusLabel = (status: PrivacyStatus): string => PRIVACY_STATUS_LABELS[status];

/** The clock in words: "12 days left", "Due today", "3 days overdue". Empty for an answered request. */
export function clockSentence(daysLeft: number | null, overdue: boolean): string {
  if (daysLeft === null) return "";
  if (overdue) {
    const days = Math.max(1, Math.abs(daysLeft));
    return `${days} ${days === 1 ? "day" : "days"} overdue`;
  }
  if (daysLeft <= 0) return "Due today";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}

/** Counts of the open requests, as one sentence for the owner. */
export function waitingSentence(counts: { open: number; overdue: number; dueSoon: number }): string {
  if (counts.open === 0) return "No privacy request is open.";
  const parts = [`${counts.open} open`];
  if (counts.overdue > 0) parts.push(`${counts.overdue} past the one-month deadline`);
  if (counts.dueSoon > 0) parts.push(`${counts.dueSoon} due within the week`);
  return `${parts.join(", ")}.`;
}

/**
 * What can be done with an open request and where: every answer is a step on the request's own page (the assistant exports and erases
 * nothing). The extension is offered only while the rules allow it (once, with reasons, within the first month).
 */
export function nextSteps(clock: RequestClock, kind: PrivacyKind, now: Date): string[] {
  if (clock.status !== "open") return [];
  const steps = [
    kind === "export"
      ? "Download the file from the person's customer page (it is never emailed: send it to the person yourself, by a channel you trust)."
      : "Review the plan on the person's erase page, then erase: it shows what goes, what is kept and until when.",
    "Refuse it with a reason, if it is unfounded or excessive: the person is told the reason and their right to complain.",
    "Close it as no data held, if the store holds nothing about the person.",
  ];
  if (extensionProblem(clock, now, "x") === null) {
    steps.push("Extend the answer once, by up to two further months, with a reason: the person must be told within the first month.");
  } else if (clock.extendedUntil === null) {
    steps.push(`It cannot be extended: ${EXTENSION_PROBLEM_TEXT[extensionProblem(clock, now, "x") ?? "too_late"]}`);
  }
  return steps;
}

/** The order the list shows requests in: open ones first, the soonest due first. */
export const WHICH_REQUESTS = ["open", "overdue", "due_soon", "answered", "all"] as const;
export type WhichRequests = (typeof WHICH_REQUESTS)[number];
