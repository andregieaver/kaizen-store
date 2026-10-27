import { zonedDate } from "./booking-slots";
import { localInstant } from "./follow-ups";

/**
 * When a scheduled change happens (wave 7 unit G, D341, for pages and articles; unit F, D340, `docs/wave-7-storefront.md` F, for headers,
 * footers, themes and the way back): a day and a time on the store's own clock, worked out to an instant here and nowhere else. Pure. The
 * five-minute dispatcher runs it, so it happens within five minutes after the time and never before it.
 */

/** The soonest a schedule may be, from now, and the furthest ahead. */
export const SCHEDULE_SOONEST_MINUTES = 2;
export const SCHEDULE_LATEST_DAYS = 365;
/** The least time between going live and going back (D340): more than one run of the five-minute job, so the change is seen. */
export const REVERT_GAP_MINUTES = 10;
/** The page types a schedule publishes: pages and articles (D341), headers and footers (D340). Themes have their own plans. */
export const SCHEDULED_TYPES = ["page", "article", "header", "footer"] as const;
export type ScheduledType = (typeof SCHEDULED_TYPES)[number];
export const isScheduledType = (type: unknown): type is ScheduledType => (SCHEDULED_TYPES as readonly unknown[]).includes(type);

export type ScheduleProblem = "not_a_time" | "too_soon" | "too_late";
export type ScheduleTime = { ok: true; at: Date } | { ok: false; problem: ScheduleProblem };

/** The instant of a day (`YYYY-MM-DD`) and time (`HH:MM`) in a time zone, if it is far enough ahead and not too far. */
export function scheduleInstant(day: string, time: string, timeZone: string, now: Date): ScheduleTime {
  const at = localInstant(`${day.trim()} ${time.trim()}`, timeZone);
  if (at === null) return { ok: false, problem: "not_a_time" };
  if (at < now.getTime() + SCHEDULE_SOONEST_MINUTES * 60_000) return { ok: false, problem: "too_soon" };
  if (at > now.getTime() + SCHEDULE_LATEST_DAYS * 86_400_000) return { ok: false, problem: "too_late" };
  return { ok: true, at: new Date(at) };
}

export type RevertProblem = "revert_not_a_time" | "revert_too_soon" | "revert_too_late";
export type RevertTime = { ok: true; at: Date } | { ok: false; problem: RevertProblem };

/**
 * The instant the version before is put back (D340): a day and time on the store's clock at least `REVERT_GAP_MINUTES` after the change goes
 * live, and within a year of it.
 */
export function revertInstant(day: string, time: string, timeZone: string, live: Date): RevertTime {
  const at = localInstant(`${day.trim()} ${time.trim()}`, timeZone);
  if (at === null) return { ok: false, problem: "revert_not_a_time" };
  if (at < live.getTime() + REVERT_GAP_MINUTES * 60_000) return { ok: false, problem: "revert_too_soon" };
  if (at > live.getTime() + SCHEDULE_LATEST_DAYS * 86_400_000) return { ok: false, problem: "revert_too_late" };
  return { ok: true, at: new Date(at) };
}

/** An instant as the store's own day and time (`{ day: "2026-10-30", time: "09:00" }`), for the editor's fields. */
export function wallClock(at: Date | string, timeZone: string): { day: string; time: string } {
  const ms = new Date(at).getTime();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return { day: zonedDate(ms, timeZone), time };
}

/**
 * Why a schedule did not happen when it ran: the page or theme was gone, its maker may no longer change it, the store is not open, a running
 * A/B test holds it, the save was refused, the time to go back had passed before it could go live (`expired`), the page or look was changed
 * by someone since it went live (`changed`, the way back only), or the theme costs money the store has not agreed to pay (`costs`).
 */
export const SCHEDULE_FAILURES = ["gone", "not_allowed", "store_closed", "ab_test", "refused", "expired", "changed", "costs"] as const;
export type ScheduleFailure = (typeof SCHEDULE_FAILURES)[number];

/** A schedule's state as a list shows it (D340): what waits next, or the latest failure since. */
export type ScheduleFacts = {
  /** When the change goes live, while it waits. */
  publishAt: string | null;
  /** When the version before is put back, while that waits. */
  revertAt: string | null;
  /** The latest leg that failed, since nothing waited after it. */
  failure: { leg: "publish" | "revert"; at: string; problem: string } | null;
};

export type ScheduleChipWords = { publishes: string; goesBack: string; didNotPublish: string; didNotGoBack: string };
export type ScheduleChip = { signal: "neutral" | "warning"; text: string; detail: string | null };

/**
 * The chip a list shows for a page or theme with a schedule (`scheduleChips()`): the next thing to happen, else the latest failure. `when`
 * writes an instant in the person's words.
 */
export function scheduleChip(facts: ScheduleFacts, words: ScheduleChipWords, when: (iso: string) => string): ScheduleChip | null {
  const fill = (template: string, at: string) => template.replace("{when}", when(at));
  if (facts.publishAt) return { signal: "neutral", text: fill(words.publishes, facts.publishAt), detail: facts.revertAt ? fill(words.goesBack, facts.revertAt) : null };
  if (facts.revertAt) return { signal: "neutral", text: fill(words.goesBack, facts.revertAt), detail: null };
  if (facts.failure) {
    return { signal: "warning", text: fill(facts.failure.leg === "publish" ? words.didNotPublish : words.didNotGoBack, facts.failure.at), detail: facts.failure.problem || null };
  }
  return null;
}

/** A form's server action as a theme's *Make it live later* takes it (D340): the state before, the form, the state after. */
export type ScheduleFormAction<S> = (state: S, formData: FormData) => Promise<S>;
