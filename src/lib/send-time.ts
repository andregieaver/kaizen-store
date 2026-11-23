import { atWallHour, QUIET_DEFAULT, wallClock } from "./sms";

/**
 * Send time per person (email plan M4.4): a broadcast sent at each reader's own hour, the hour of day they press links in the store's emails
 * most (M1.3, presses kept 180 days), or else the store's best hour, always within the day's hours (`QUIET_DEFAULT`, 9 to 20 o'clock). Pure;
 * the hours are read in the store's time zone.
 */

/** Presses a reader needs before their own hour is trusted, and the store's before its hour is. */
export const PERSON_PRESSES_MIN = 3;
export const STORE_PRESSES_MIN = 30;

/** The hour of day (0 to 23) most of these presses fell in, when there are enough of them; the earlier hour on a tie. */
export function bestHour(hours: readonly number[], min: number): number | null {
  if (hours.length < min) return null;
  const counts = new Array<number>(24).fill(0);
  for (const h of hours) if (Number.isInteger(h) && h >= 0 && h < 24) counts[h]++;
  let best = 0;
  for (let h = 1; h < 24; h++) if (counts[h] > counts[best]) best = h;
  return counts[best] > 0 ? best : null;
}

/** The hour a reader is sent at: their own, else the store's, kept within the day's hours; null to send at once. */
export function sendHour(person: number | null, store: number | null): number | null {
  const hour = person ?? store;
  if (hour === null) return null;
  return Math.min(QUIET_DEFAULT.until - 1, Math.max(QUIET_DEFAULT.from, hour));
}

/** The next moment that is `hour` o'clock in `zone`: now during that hour, else today's or tomorrow's. Within a day of `now`. */
export function nextAtHour(now: Date, hour: number, zone: string): Date {
  const w = wallClock(now, zone);
  if (w.hour === hour) return now;
  const today = atWallHour(w.year, w.month, w.day, hour, zone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(Date.UTC(w.year, w.month - 1, w.day) + 86_400_000);
  return atWallHour(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, zone);
}
