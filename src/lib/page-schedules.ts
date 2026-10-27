import { zonedDate } from "./booking-slots";
import { localInstant } from "./follow-ups";

/**
 * When a scheduled page or article is published (wave 7 unit G, D341; the start of D340's model, `docs/wave-7-storefront.md` F): a day and
 * a time on the store's own clock, worked out to an instant here and nowhere else. Pure. The five-minute dispatcher publishes it, so it
 * goes live within five minutes after the time and never before it.
 */

/** The soonest a schedule may be, from now, and the furthest ahead. */
export const SCHEDULE_SOONEST_MINUTES = 2;
export const SCHEDULE_LATEST_DAYS = 365;
/** The page types a schedule publishes (F adds headers, footers and themes). */
export const SCHEDULED_TYPES = ["page", "article"] as const;
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

/** An instant as the store's own day and time (`{ day: "2026-10-30", time: "09:00" }`), for the editor's fields. */
export function wallClock(at: Date | string, timeZone: string): { day: string; time: string } {
  const ms = new Date(at).getTime();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  return { day: zonedDate(ms, timeZone), time };
}

/** Why a waiting schedule did not publish when it ran: the page was gone, its maker may no longer publish it, the store is not open … */
export const SCHEDULE_FAILURES = ["gone", "not_allowed", "store_closed", "ab_test", "refused"] as const;
export type ScheduleFailure = (typeof SCHEDULE_FAILURES)[number];
