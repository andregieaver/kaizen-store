import { z } from "zod";

/**
 * Privacy requests and their clock (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 and 4), pure: a request to see or erase a person's data,
 * the one month GDPR Art. 12(3) gives to answer it, the extension (once, with a reason, told within the first month, to at most three
 * months from receipt), a reasoned refusal (Art. 12(4)) and the fresh sign-in a shopper needs to download or delete their own data.
 *
 * How the month is counted is not read from Regulation (EEC, Euratom) No 1182/71 (docs/wave-1g-gdpr.md 1.3): `privacyDeadline()` takes the
 * safe side, the same day of the next month (the last day of that month when there is none), in UTC, and a weekend or holiday never
 * moves it (the safe side: Regulation 1182/71 may move a period that ends on one, unread). The rules here are held by the database too (`privacy_requests_rules`); nothing here is legal advice.
 */

export const PRIVACY_KINDS = ["export", "erasure"] as const;
export type PrivacyKind = (typeof PRIVACY_KINDS)[number];
export const PRIVACY_CHANNELS = ["shopper", "staff"] as const;
export type PrivacyChannel = (typeof PRIVACY_CHANNELS)[number];
export const PRIVACY_STATUSES = ["open", "done", "refused", "cancelled"] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];
export const PRIVACY_OUTCOMES = ["exported", "erased", "no_data", "refused", "cancelled"] as const;
export type PrivacyOutcome = (typeof PRIVACY_OUTCOMES)[number];

/** A refusal gives one of these reasons (Art. 12(4)); the decision that a request is unfounded or excessive is staff's, never the system's. */
export const REFUSAL_REASONS = ["identity_not_confirmed", "manifestly_unfounded", "excessive", "legal_hold", "other"] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** The staff screen's words (English: the admin is English only). */
export const REFUSAL_REASON_LABELS: Record<RefusalReason, string> = {
  identity_not_confirmed: "We could not confirm who is asking",
  manifestly_unfounded: "The request is manifestly unfounded",
  excessive: "The request is excessive (for example, repeated)",
  legal_hold: "The data must be kept to defend a legal claim",
  other: "Another reason",
};

export const PRIVACY_KIND_LABELS: Record<PrivacyKind, string> = { export: "Data export", erasure: "Erasure" };
export const PRIVACY_STATUS_LABELS: Record<PrivacyStatus, string> = { open: "Open", done: "Done", refused: "Refused", cancelled: "Cancelled" };

/** A shopper's fresh sign-in lasts this long: a download or a delete of their own data needs a sign-in or step-up within it. */
export const FRESH_SIGN_IN_MINUTES = 10;
/** A request that is due within this many days gets a reminder to the owners (and again once when it is overdue). */
export const DUE_SOON_DAYS = 7;
/** An extension is at most this many months from receipt (the month plus two further months, Art. 12(3)). */
export const MAX_REQUEST_MONTHS = 3;

const DAY = 86_400_000;

/** Adds calendar months in UTC, clamping to the last day of the target month (31 January + 1 month = 28 or 29 February); keeps the time of day. */
export function addUtcMonths(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(date.getUTCDate(), last), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

/** The day the answer is due: one month from receipt. Not moved for a weekend or holiday (the safe side; Regulation 1182/71 unread). */
export const privacyDeadline = (received: Date): Date => addUtcMonths(received, 1);
/** The latest an extended answer may be due: three months from receipt (the month plus two). */
export const extensionLimit = (received: Date): Date => addUtcMonths(received, MAX_REQUEST_MONTHS);

export type RequestClock = {
  status: PrivacyStatus;
  receivedAt: Date;
  dueAt: Date;
  extendedUntil: Date | null;
};

/** When the answer is due now: the extension's date once there is one. */
export const effectiveDue = (r: Pick<RequestClock, "dueAt" | "extendedUntil">): Date => r.extendedUntil ?? r.dueAt;

/** Overdue: still open after its (possibly extended) due moment. An answered request is never overdue. */
export const isOverdue = (r: RequestClock, now: Date): boolean => r.status === "open" && now.getTime() > effectiveDue(r).getTime();

/** Whole days left until it is due (rounded up; zero on the day, negative once overdue). */
export const daysLeft = (r: Pick<RequestClock, "dueAt" | "extendedUntil">, now: Date): number => Math.ceil((effectiveDue(r).getTime() - now.getTime()) / DAY);

export type ExtensionRefusal = "not_open" | "already_extended" | "too_late" | "no_reason";

/** Whether staff may extend: open, never extended, before the due date, with a reason. `null` is allowed. */
export function extensionProblem(r: RequestClock, now: Date, reason: string): ExtensionRefusal | null {
  if (r.status !== "open") return "not_open";
  if (r.extendedUntil) return "already_extended";
  if (now.getTime() > r.dueAt.getTime()) return "too_late";
  if (reason.trim().length === 0) return "no_reason";
  return null;
}

export const EXTENSION_PROBLEM_TEXT: Record<ExtensionRefusal, string> = {
  not_open: "Only an open request can be extended.",
  already_extended: "A request can be extended once.",
  too_late: "The extension must be told to the person within the first month, so it is too late to extend this request.",
  no_reason: "Say why the request is extended: the person is told the reasons.",
};

/** The reminder an open request is due for (each is sent once): seven days before it is due, and once when it is overdue. */
export function reminderDue(r: RequestClock, now: Date): "overdue" | "due_soon" | null {
  if (r.status !== "open") return null;
  if (isOverdue(r, now)) return "overdue";
  return daysLeft(r, now) <= DUE_SOON_DAYS ? "due_soon" : null;
}

/** A session is fresh when its last proof of identity is within the window; a stale one never downloads or deletes. */
export function isFresh(verifiedAt: Date | null | undefined, now: Date): boolean {
  if (!verifiedAt) return false;
  const age = now.getTime() - verifiedAt.getTime();
  return age >= 0 && age <= FRESH_SIGN_IN_MINUTES * 60_000;
}

/** The idempotency key of a reminder email, so the daily job sends each once. */
export const reminderKey = (kind: "overdue" | "due_soon", requestId: string): string => `privacy.${kind === "overdue" ? "overdue" : "due"}:${requestId}`;
/** The idempotency key of the confirmation email after an erasure. */
export const erasedEmailKey = (requestId: string): string => `privacy.erased:${requestId}`;

// ---------------------------------------------------------------------------
// What the staff forms send (shared by the browser and the server).
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);

/** Logging a request that arrived by email, post or phone. `receivedOn` is the day it arrived (not in the future). */
export const logRequestInput = z.object({
  kind: z.enum(PRIVACY_KINDS, "Choose export or erasure."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Enter the email address the person wrote from.")),
  receivedOn: z.iso.date("Enter the date the request was received."),
  note: text(1000).default(""),
});
export type LogRequestInput = z.infer<typeof logRequestInput>;

export const extendInput = z.object({ reason: text(1000).min(1, "Say why the request is extended.") });
export const refuseInput = z.object({
  reason: z.enum(REFUSAL_REASONS, "Choose a reason."),
  note: text(1000).default(""),
});
export type RefuseInput = z.infer<typeof refuseInput>;

/** The confirmation a staff erasure asks for: the subject's own email typed again, or the word ERASE for a subject with none. */
export function erasureConfirmed(typed: string, subjectEmail: string | null): boolean {
  const value = typed.trim();
  if (subjectEmail) return value.toLowerCase() === subjectEmail.trim().toLowerCase();
  return value === "ERASE";
}

/**
 * The instant a request logged on a day was received: staff give a day, the clock runs from that day (the start of it in UTC, so a request
 * logged for today is not "received in the future"). A day in the future is refused by the caller (`receivedProblem()`).
 */
export const receivedInstant = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export function receivedProblem(day: string, now: Date): "future" | "too_old" | null {
  const at = receivedInstant(day);
  // A day that does not exist (30 February) is not a day: refused like a future one.
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) return "future";
  if (at.getTime() > now.getTime()) return "future";
  // A request older than the longest clock is already overdue; logging it is allowed, a year back is where we stop (a typing mistake).
  if (now.getTime() - at.getTime() > 366 * DAY) return "too_old";
  return null;
}
