import { adminDate } from "./admin-date";
import { addCalendarDays } from "./work-dates";

/**
 * The platform's Emails page as rows to read (round 16, D650): which emails a chip shows, how many each has, and the list grouped by the
 * day it was made (Today, Yesterday, then the date, in Norwegian time). Pure: rows come from `listEmails()`.
 */
export type EmailRowLike = { kind: string; subject: string; status: string; createdAt: string };

export const EMAIL_SHOWS = ["all", "unsent", "failed", "tests"] as const;
export type EmailShow = (typeof EMAIL_SHOWS)[number];

const FAILED = new Set(["failed", "bounced", "complained"]);

export const isTestEmail = (row: EmailRowLike) => row.kind.endsWith(".test") || row.subject.startsWith("[Test]");
export const isFailedEmail = (row: EmailRowLike) => FAILED.has(row.status);
/** Recorded only because email is not set up, or still waiting to go. */
export const isUnsentEmail = (row: EmailRowLike) => row.status === "logged" || row.status === "queued";

export function isEmailShow(value: unknown): value is EmailShow {
  return typeof value === "string" && (EMAIL_SHOWS as readonly string[]).includes(value);
}

export function emailsShown<T extends EmailRowLike>(rows: readonly T[], show: EmailShow): T[] {
  if (show === "unsent") return rows.filter(isUnsentEmail);
  if (show === "failed") return rows.filter(isFailedEmail);
  if (show === "tests") return rows.filter(isTestEmail);
  return [...rows];
}

export function emailCounts(rows: readonly EmailRowLike[]): Record<EmailShow, number> {
  return { all: rows.length, unsent: rows.filter(isUnsentEmail).length, failed: rows.filter(isFailedEmail).length, tests: rows.filter(isTestEmail).length };
}

/** What went in the last seven days before `now`: sent (or delivered) and failed. */
export function emailWeek(rows: readonly EmailRowLike[], now: number): { sent: number; failed: number } {
  const recent = rows.filter((row) => now - new Date(row.createdAt).getTime() <= 7 * 86_400_000);
  return { sent: recent.filter((row) => row.status === "sent" || row.status === "delivered").length, failed: recent.filter(isFailedEmail).length };
}

/** The rows by day in a time zone (the store's, or the platform's, D786), newest first as given: Today, Yesterday, else the date in `locale`. */
export function emailDays<T extends EmailRowLike>(
  rows: readonly T[],
  now: number,
  words: { today: string; yesterday: string },
  timeZone: string,
  locale = "en-GB",
): { label: string; rows: T[] }[] {
  const today = adminDate(timeZone, now, "iso", locale);
  const yesterday = addCalendarDays(today, -1);
  const days: { key: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const time = new Date(row.createdAt).getTime();
    const key = adminDate(timeZone, time, "iso", locale);
    let day = days.find((d) => d.key === key);
    if (!day) {
      const label = key === today ? words.today : key === yesterday ? words.yesterday : adminDate(timeZone, time, "long", locale);
      day = { key, label, rows: [] };
      days.push(day);
    }
    day.rows.push(row);
  }
  return days.map(({ label, rows: dayRows }) => ({ label, rows: dayRows }));
}
