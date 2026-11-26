/**
 * The social calendar (D870 S2.4, `docs/social-manager.md` 5): the adviser's two-week plan as days, each planned post matched to the draft
 * written for it, and the drafts planned for a day that no plan names. Homer sees one button: write the week's missing drafts, then approve
 * the week; Lisa sees every post with its own buttons. Pure; the server is `src/server/social-calendar.ts`.
 */

import { addDays, startOfWeek } from "./analytics-period";
import type { CalendarSlot } from "./social-advice";
import type { PostChannel } from "./social-posts";
import { checkFailed } from "./social-vision";

/** A draft on the calendar: a post planned for a day, and whether a person has said yes to it. */
export type CalendarDraft = {
  id: string;
  day: string;
  channel: PostChannel;
  caption: string;
  approved: boolean;
  productId: string | null;
  topic: string;
  /** When its words were last changed by hand, so its picture (drawn from them) is asked for again; absent when never. */
  editedAt?: string | null;
  /** The vision check's verdict (S2.3): what it found wrong (none: passed) and its note; null or absent while unchecked. */
  check?: { problems: string[]; note: string } | null;
  /** Whether it draws a made scene (S2.1), and how often one was made for it. */
  scene?: { on: boolean; tries: number };
  /** Its slideshow video's address in the library (S2.5), if one was made. */
  video?: string | null;
  /** Published (S3.1): its address on the platform (null when Meta gave none); absent while not. A refusal's words, in `publishProblem`. */
  published?: { url: string | null } | null;
  publishProblem?: string | null;
};

/** One planned post: the adviser's idea (or none, for a draft written straight onto a day) and its draft, if written. */
export type CalendarItem = { day: string; channel: PostChannel; productId: string | null; idea: string; draft: CalendarDraft | null };

export type CalendarWeek = {
  /** The Monday the week starts on. */
  start: string;
  days: { day: string; items: CalendarItem[] }[];
  /** Planned posts without a draft yet, from today on: what *Write this week's posts* writes. */
  toWrite: CalendarItem[];
  /** Drafts not yet approved: what *Approve the week* approves. */
  toApprove: CalendarDraft[];
  /** Homer's one button for the week (`weekAction()`). */
  action: WeekAction;
};

export type WeekAction = { kind: "write"; count: number } | { kind: "approve"; count: number } | null;

/** The calendar's days: from the Monday of today's week to the end of the next week (14 days of plan always fit, as the adviser plans from today). */
export const CALENDAR_WEEKS = 2;

/**
 * The weeks from today's Monday, each day with its planned posts. A slot takes the newest draft planned for its day and channel; a draft no
 * slot claims shows on its own (written for that day from the creator or the manager). Days before today show what was planned but are
 * never offered to write.
 */
export function socialCalendar(today: string, slots: readonly CalendarSlot[], drafts: readonly CalendarDraft[]): CalendarWeek[] {
  const first = startOfWeek(today);
  const last = addDays(first, CALENDAR_WEEKS * 7 - 1);
  const free = drafts.filter((d) => d.day >= first && d.day <= last);
  const claim = (day: string, channel: PostChannel): CalendarDraft | null => {
    const at = free.findIndex((d) => d.day === day && d.channel === channel);
    return at < 0 ? null : free.splice(at, 1)[0];
  };
  const items: CalendarItem[] = [];
  for (const s of [...slots].filter((s) => s.day >= first && s.day <= last).sort((a, b) => a.day.localeCompare(b.day))) {
    items.push({ day: s.day, channel: s.channel, productId: s.productId, idea: s.idea, draft: claim(s.day, s.channel) });
  }
  for (const d of free) items.push({ day: d.day, channel: d.channel, productId: d.productId, idea: "", draft: d });

  return Array.from({ length: CALENDAR_WEEKS }, (_, w) => {
    const start = addDays(first, w * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => ({ day, items: items.filter((it) => it.day === day) }));
    const inWeek = days.flatMap((d) => d.items);
    const toWrite = inWeek.filter((it) => !it.draft && it.idea && it.day >= today);
    // A post the vision check failed waits for a person to approve it on its own (S2.3).
    const toApprove = inWeek.flatMap((it) => (it.draft && !it.draft.approved && !checkFailed(it.draft.check?.problems) ? [it.draft] : []));
    return { start, days, toWrite, toApprove, action: weekAction({ toWrite, toApprove }) };
  });
}

/** What Homer's one button does for a week: write the missing drafts first, then approve the rest; nothing once every post is approved. */
export function weekAction(week: Pick<CalendarWeek, "toWrite" | "toApprove">): WeekAction {
  if (week.toWrite.length > 0) return { kind: "write", count: week.toWrite.length };
  if (week.toApprove.length > 0) return { kind: "approve", count: week.toApprove.length };
  return null;
}
