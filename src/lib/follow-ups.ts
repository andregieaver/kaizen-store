import { addDays, zonedDate, zonedTime } from "./booking-slots";

/**
 * Follow-ups the AI manager keeps for a person (PSI AGT-04, AGT-11): "check this again on Friday", "every Monday, tell me what needs a
 * look". At the time, the five-minute job gives the task back to the AI manager as a message in the conversation it was asked in, in the
 * person's name and with their role's tools, and emails them that the answer is there. Pure: times and words, no database.
 */

export const FOLLOW_UP_REPEATS = ["none", "daily", "weekly"] as const;
export type FollowUpRepeat = (typeof FOLLOW_UP_REPEATS)[number];

/** Follow-ups one person may have waiting in one store (or on the platform). */
export const FOLLOW_UPS_MAX = 20;
/** Tries before a follow-up whose turn keeps failing stops; a try that failed waits `RETRY_MINUTES`. */
export const FOLLOW_UP_TRIES = 3;
export const RETRY_MINUTES = 30;
/** How soon and how far ahead one may be set. */
export const SOONEST_MINUTES = 5;
export const LATEST_DAYS = 365;
export const TASK_MAX = 500;

const MINUTE = 60_000;
const LOCAL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/;

/** A wall-clock time written `YYYY-MM-DD HH:MM` in a time zone, as milliseconds since 1970; null when it is not one. */
export function localInstant(at: string, timeZone: string): number | null {
  const match = LOCAL.exec(at.trim());
  if (!match) return null;
  const [, date, hours, minutes] = match;
  const day = new Date(`${date}T00:00:00Z`);
  if (Number(hours) > 23 || Number(minutes) > 59 || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  return zonedTime(date, `${hours}:${minutes}`, timeZone);
}

export type DueInput = { at?: string | null; inHours?: number | null };
export type DueResult = { ok: true; due: Date } | { ok: false; problem: string };

/** When a follow-up is due: a wall-clock time in the time zone (`2026-10-30 09:00`), or a number of hours from now. */
export function dueFrom(input: DueInput, timeZone: string, now: Date): DueResult {
  let due: number;
  if (input.at) {
    const at = localInstant(input.at, timeZone);
    if (at === null) return { ok: false, problem: "Give the time as YYYY-MM-DD HH:MM, in the time zone of your instructions." };
    due = at;
  } else if (typeof input.inHours === "number" && Number.isFinite(input.inHours)) {
    due = now.getTime() + Math.round(input.inHours * 60) * MINUTE;
  } else {
    return { ok: false, problem: "Say when: at (a date and time) or in_hours." };
  }
  if (due < now.getTime() + SOONEST_MINUTES * MINUTE) return { ok: false, problem: `Choose a time at least ${SOONEST_MINUTES} minutes from now.` };
  if (due > now.getTime() + LATEST_DAYS * 1440 * MINUTE) return { ok: false, problem: `A follow-up can be at most ${LATEST_DAYS} days ahead.` };
  return { ok: true, due: new Date(due) };
}

/** A time of day in a time zone, `HH:MM`. */
export function localTimeOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/**
 * The next time a repeating follow-up is due after it ran: the same time of day in its time zone (so a clock change keeps "9:00" at
 * nine), a day or a week on, past `now` (a run that was late skips the times it missed). Null for one that does not repeat.
 */
export function nextDue(due: Date, repeat: FollowUpRepeat, timeZone: string, now: Date): Date | null {
  if (repeat === "none") return null;
  const step = repeat === "daily" ? 1 : 7;
  const time = localTimeOf(due, timeZone);
  let date = zonedDate(due.getTime(), timeZone);
  for (let i = 0; i < 800; i++) {
    date = addDays(date, step);
    const next = zonedTime(date, time, timeZone);
    if (next > now.getTime()) return new Date(next);
  }
  return null;
}

/** When a follow-up is due, as the person reads it: `Friday 30 October 2026, 09:00`, and how often. */
export function dueWords(due: Date, repeat: FollowUpRepeat, timeZone: string, locale = "en-GB"): string {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone }).format(due);
  return repeat === "none" ? when : `${when}, then ${repeat === "daily" ? "every day" : "every week"}`;
}

/**
 * The message the AI manager is given at the time: what it was asked, by whom and when, and that nobody is there to say yes. Kept in
 * the conversation as the person's message, so it reads as theirs.
 */
export function followUpMessage(task: string, askedAt: Date, repeat: FollowUpRepeat, timeZone: string): string {
  const asked = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone }).format(askedAt);
  return [
    `[Follow-up${repeat === "none" ? "" : repeat === "daily" ? ", daily" : ", weekly"}, asked for on ${asked}] ${task.trim().slice(0, TASK_MAX)}`,
    "Do it now with your tools and answer in a few lines. They are not here: say what you found, and anything that needs their yes waits for them.",
  ].join("\n");
}
