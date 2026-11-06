import { z } from "zod";

import { addDays, zonedDate, zonedTime } from "./booking-slots";

/**
 * Activities (S3 of `docs/own-books-and-sales.md`, D467), pure: a call, a meeting or a task with the person who does it and when, about a
 * customer, a company or a deal, seen by the team. What staff may type, when it is due in the store's own time, and the *Today* list the
 * store's home shows. A task may be for a day without a time; a meeting has a length. Nothing here knows a database.
 */

export const ACTIVITY_KINDS = ["call", "meeting", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const isActivityKind = (value: unknown): value is ActivityKind => (ACTIVITY_KINDS as readonly unknown[]).includes(value);

export const ACTIVITY_TITLE_MAX = 200;
export const ACTIVITY_NOTE_MAX = 2000;
/** The longest meeting, in minutes: a working day. */
export const ACTIVITY_DURATION_MAX = 12 * 60;

/** An activity as a person types it, checked: when it is due as an instant, and whether a time of day was given. */
export type ActivityInput = {
  kind: ActivityKind;
  title: string;
  note: string | null;
  /** When it is due: the time given in the store's time zone, or the start of the day when none was. */
  dueAt: string;
  /** A time of day was given (a call at 10:00); else it is for the day as a whole (a task for Friday). */
  timed: boolean;
  durationMinutes: number | null;
  assigneeId: string | null;
  customerId: string | null;
  companyId: string | null;
  dealId: string | null;
};

export type ActivityProblem = "kind" | "title" | "note" | "due" | "duration" | "assignee" | "who";

const blank = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a person typed, checked: a kind, a title, a day (and a time, if any) in the store's time zone, a length for a meeting, and who it
 * is about (a customer, a company or a deal: at least one). The note is kept as written, at most 2000 characters.
 */
export function cleanActivityInput(
  raw: Record<string, unknown>,
  timeZone: string,
): { ok: true; activity: ActivityInput } | { ok: false; problems: ActivityProblem[] } {
  const problems: ActivityProblem[] = [];
  const kind = blank(raw.kind);
  if (!isActivityKind(kind)) problems.push("kind");
  const title = blank(raw.title).replace(/\s+/g, " ");
  if (title.length < 1 || title.length > ACTIVITY_TITLE_MAX) problems.push("title");
  const noteText = typeof raw.note === "string" ? raw.note.trim() : "";
  if (noteText.length > ACTIVITY_NOTE_MAX) problems.push("note");
  const day = blank(raw.dueOn);
  const time = blank(raw.dueTime);
  let dueAt = "";
  if (!DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || (time !== "" && !TIME.test(time))) problems.push("due");
  else dueAt = new Date(zonedTime(day, time || "00:00", timeZone)).toISOString();
  let durationMinutes: number | null = null;
  if (blank(raw.duration)) {
    const n = Number(blank(raw.duration));
    if (!Number.isInteger(n) || n < 1 || n > ACTIVITY_DURATION_MAX) problems.push("duration");
    else durationMinutes = n;
  }
  const id = (value: unknown) => (blank(value) ? (z.uuid().safeParse(blank(value)).success ? blank(value) : undefined) : null);
  const assigneeId = id(raw.assigneeId);
  if (assigneeId === undefined) problems.push("assignee");
  const customerId = id(raw.customerId);
  const companyId = id(raw.companyId);
  const dealId = id(raw.dealId);
  if (customerId === undefined || companyId === undefined || dealId === undefined || (!customerId && !companyId && !dealId)) problems.push("who");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    activity: {
      kind: kind as ActivityKind,
      title,
      note: noteText || null,
      dueAt,
      timed: time !== "",
      // A length belongs to a meeting; a call or a task has none.
      durationMinutes: kind === "meeting" ? durationMinutes : null,
      assigneeId: assigneeId ?? null,
      customerId: customerId ?? null,
      companyId: companyId ?? null,
      dealId: dealId ?? null,
    },
  };
}

/** What an activity's form starts from for one that exists: its day and time in the store's zone, as the fields show them. */
export function dueFields(dueAt: string, timed: boolean, timeZone: string): { dueOn: string; dueTime: string } {
  const ms = Date.parse(dueAt);
  const dueOn = zonedDate(ms, timeZone);
  if (!timed) return { dueOn, dueTime: "" };
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { dueOn, dueTime: `${get("hour")}:${get("minute")}` };
}

export type TodayActivity = { id: string; dueAt: string; timed: boolean; doneAt: string | null };

/** Where an activity stands on the store's day: late (before today and not done), today, later, or done. */
export type ActivityWhen = "late" | "today" | "later" | "done";

export function activityWhen(activity: TodayActivity, now: Date, timeZone: string): ActivityWhen {
  if (activity.doneAt) return "done";
  const today = zonedDate(now.getTime(), timeZone);
  const day = zonedDate(Date.parse(activity.dueAt), timeZone);
  if (day < today) return "late";
  // A call at 09:00 that is still not done at 11:00 is late too, though it is today's.
  if (day === today) return activity.timed && Date.parse(activity.dueAt) < now.getTime() - 60 * 60_000 ? "late" : "today";
  return "later";
}

/**
 * The *Today* list (Homer's): what is late first (the oldest first), then today's (those with a time in order, then those for the day),
 * then what was done today; nothing for later days. One activity appears once.
 */
export function todayList<A extends TodayActivity>(activities: readonly A[], now: Date, timeZone: string): { late: A[]; today: A[]; done: A[] } {
  const today = zonedDate(now.getTime(), timeZone);
  const late: A[] = [];
  const due: A[] = [];
  const done: A[] = [];
  for (const a of activities) {
    const when = activityWhen(a, now, timeZone);
    if (when === "late") late.push(a);
    else if (when === "today") due.push(a);
    else if (when === "done" && a.doneAt && zonedDate(Date.parse(a.doneAt), timeZone) === today) done.push(a);
  }
  const byDue = (a: A, b: A) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
  late.sort(byDue);
  due.sort((a, b) => Number(b.timed) - Number(a.timed) || byDue(a, b));
  done.sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || a.id.localeCompare(b.id));
  return { late, today: due, done };
}

/** The days the store's *Today* reads, from the start of yesterday-and-before (everything not done) to the end of today, in UTC. */
export function todayWindow(now: Date, timeZone: string): { endOfToday: string; startOfToday: string } {
  const today = zonedDate(now.getTime(), timeZone);
  return {
    startOfToday: new Date(zonedTime(today, "00:00", timeZone)).toISOString(),
    endOfToday: new Date(zonedTime(addDays(today, 1), "00:00", timeZone)).toISOString(),
  };
}

/** A deal's next step, for its card on the board: the earliest activity not done, or none (Lisa's "no next step"). */
export function nextActivity<A extends TodayActivity>(activities: readonly A[]): A | null {
  return [...activities].filter((a) => !a.doneAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id))[0] ?? null;
}
