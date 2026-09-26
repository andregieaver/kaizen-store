/**
 * When an appointment can start (D65), worked out without a database: from
 * each resource's hours in the store's time zone, the appointment's rules
 * and the times already taken. `commerce.hold_booking` checks the same
 * again under a lock when a time is held, so a slot shown here is an offer,
 * not a promise.
 */
import { hoursOn, type OpeningHours } from "./opening-hours";

export type AppointmentRules = {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  stepMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
};

/** A time taken on a resource, with its buffers, in milliseconds since 1970 (UTC). */
export type Busy = { from: number; to: number };

export type SlotResource = { id: string; hours: OpeningHours; capacity: number; busy: Busy[] };

export type Slot = { startsAt: string; endsAt: string; resourceIds: string[] };

const MINUTE = 60_000;

/** A time zone's offset from UTC at an instant, in minutes (e.g. 120 in Oslo in summer). */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / MINUTE);
}

/** A wall-clock time on a date in a time zone, as milliseconds since 1970 (UTC). */
export function zonedTime(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMinutes(guess, timeZone) * MINUTE;
  // Near a change of clocks the first guess can be an hour out: look again.
  const second = guess - offsetMinutes(first, timeZone) * MINUTE;
  return second;
}

/** The date an instant falls on in a time zone, as `YYYY-MM-DD`. */
export function zonedDate(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(utcMs),
  );
}

/** The date `days` after a date, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whether a date can be booked at all: not before today, not beyond how far ahead the rules allow. */
export function dateBookable(date: string, rules: AppointmentRules, timeZone: string, now: number): boolean {
  const today = zonedDate(now, timeZone);
  return date >= today && date <= addDays(today, rules.maxDaysAhead);
}

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The start times on a date, each with the resources free for it: every
 * step from opening until the appointment no longer fits before closing,
 * at least the notice ahead of now, where the resource has room for it
 * with its buffers.
 */
export function slotsOn(
  date: string,
  timeZone: string,
  rules: AppointmentRules,
  resources: SlotResource[],
  now: number,
): Slot[] {
  if (!dateBookable(date, rules, timeZone, now)) return [];
  const earliest = now + rules.minNoticeMinutes * MINUTE;
  const byStart = new Map<number, { endsAt: number; resourceIds: string[] }>();
  for (const resource of resources) {
    const hours = hoursOn(resource.hours, date);
    if (!hours) continue;
    const close = minutesOf(hours.close);
    for (let minute = minutesOf(hours.open); minute + rules.durationMinutes <= close; minute += rules.stepMinutes) {
      const start = zonedTime(date, timeOf(minute), timeZone);
      if (start < earliest) continue;
      const end = start + rules.durationMinutes * MINUTE;
      const from = start - rules.bufferBeforeMinutes * MINUTE;
      const to = end + rules.bufferAfterMinutes * MINUTE;
      const taken = resource.busy.filter((b) => b.from < to && b.to > from).length;
      if (taken >= resource.capacity) continue;
      const slot = byStart.get(start) ?? { endsAt: end, resourceIds: [] };
      slot.resourceIds.push(resource.id);
      byStart.set(start, slot);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, slot]) => ({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(slot.endsAt).toISOString(),
      resourceIds: slot.resourceIds,
    }));
}

/** What a booking starting then blocks on its resource: the appointment and its buffers. */
export function bookingSpan(startsAt: number, rules: AppointmentRules) {
  const endsAt = startsAt + rules.durationMinutes * MINUTE;
  return {
    startsAt,
    endsAt,
    blockedFrom: startsAt - rules.bufferBeforeMinutes * MINUTE,
    blockedTo: endsAt + rules.bufferAfterMinutes * MINUTE,
  };
}
