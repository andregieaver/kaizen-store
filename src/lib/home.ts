/**
 * The store's Home as redesigned in round 1 (`docs/audits/admin-redesign-round-1.md`): what its greeting, its one sentence, its week chart
 * and its milestones say, worked out in code from the store's own figures. Pure.
 */

import { countWords, fillWords } from "./admin-fill";
import type { HomeMessages } from "./admin-messages/home.en";

type Today = HomeMessages["today"];

/** Which part of the day it is at the store, for the greeting: before 12 morning, before 18 afternoon, else evening. */
export function partOfDay(now: Date, timeZone: string): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/** The first word of a person's name, or null when there is none to greet them by. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** How this week's sales compare with last week's, as one of a few plain ways of saying it. */
export type WeekChange = { kind: "first" } | { kind: "same" } | { kind: "times"; times: string } | { kind: "up" | "down"; n: number };

export function weekChange(week: number, prior: number, locale = "en"): WeekChange {
  if (prior <= 0) return { kind: "first" };
  const ratio = week / prior;
  if (ratio >= 2) return { kind: "times", times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.floor(ratio * 10) / 10) };
  const pct = Math.round((ratio - 1) * 100);
  if (Math.abs(pct) < 3) return { kind: "same" };
  return pct > 0 ? { kind: "up", n: pct } : { kind: "down", n: -pct };
}

/** The sentence under the greeting: the orders to send first, then the week's sales against the week before. */
export function homeSummary(
  { toSend, week, prior, amount }: { toSend: number; week: number; prior: number; amount: string | null },
  w: Today,
  locale = "en",
): { lead: string | null; rest: string } {
  const lead = toSend > 0 ? countWords(toSend, w.toSendLead) : null;
  if (amount === null || week <= 0) return { lead, rest: lead ? "" : w.noSalesYet };
  const change = weekChange(week, prior, locale);
  const rest =
    change.kind === "first"
      ? fillWords(w.salesFirst, { amount })
      : change.kind === "same"
        ? fillWords(w.salesSame, { amount })
        : change.kind === "times"
          ? fillWords(w.salesTimes, { amount, times: change.times })
          : fillWords(change.kind === "up" ? w.salesUp : w.salesDown, { amount, n: change.n });
  return { lead, rest };
}

/** The chip beside the week's total. */
export function weekChip(week: number, prior: number, w: Today, locale = "en"): { text: string; good: boolean | null } {
  const change = weekChange(week, prior, locale);
  if (change.kind === "first") return { text: w.firstWeek, good: null };
  if (change.kind === "same") return { text: w.same, good: null };
  if (change.kind === "times") return { text: fillWords(w.times, { times: change.times }), good: true };
  return { text: fillWords(change.kind === "up" ? w.up : w.down, { n: change.n }), good: change.kind === "up" };
}

/** Bar heights for the week chart, in pixels of `tallest`: both weeks on one scale, a day with sales never thinner than 3 px. */
export function barHeights(days: number[], prior: number[], tallest: number): { days: number[]; prior: number[] } {
  const max = Math.max(1, ...days, ...prior);
  const h = (v: number) => (v <= 0 ? 0 : Math.max(3, Math.round((v / max) * tallest)));
  return { days: days.map(h), prior: prior.map(h) };
}

/** The order counts a store celebrates. */
export const MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/** Where a store is on its milestones: the next one, how far along to it, and the ones on the track (the last reached and the next few). */
export function milestoneTrack(count: number): { next: number | null; share: number; marks: { at: number; reached: boolean }[] } {
  const next = MILESTONES.find((m) => m > count) ?? null;
  const lastIndex = MILESTONES.findLastIndex((m) => m <= count);
  const from = Math.max(0, Math.min(lastIndex - 1, MILESTONES.length - 5));
  const marks = MILESTONES.slice(from, from + 5).map((at) => ({ at, reached: count >= at }));
  // The marks stand evenly along the track, so the bar is drawn by segment: the reached ones whole, the one under way in part.
  let position = 0;
  for (let i = 0; i < marks.length - 1; i++) {
    if (count >= marks[i + 1].at) position = i + 1;
    else if (count > marks[i].at) position = i + (count - marks[i].at) / (marks[i + 1].at - marks[i].at);
  }
  const share = marks.length > 1 ? Math.max(0, Math.min(1, position / (marks.length - 1))) : 0;
  return { next, share, marks };
}

/** "today", "yesterday" or "3 days ago", counted in the store's calendar days. */
export function whenWords(at: string, now: Date, timeZone: string, w: Today["when"]): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const days = Math.round((Date.parse(`${day(now)}T00:00:00Z`) - Date.parse(`${day(new Date(at))}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return w.today;
  if (days === 1) return w.yesterday;
  return countWords(days, w.daysAgo);
}

/** An attention line said inside the store itself, without the store's name in front of it (audit D454 N9). */
export function withoutStoreName(text: string, store: string): string {
  const prefix = `${store}: `;
  if (!text.startsWith(prefix)) return text;
  const rest = text.slice(prefix.length);
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}
