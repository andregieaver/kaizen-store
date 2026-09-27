/**
 * The admin's week calendar of bookings (D65), worked out without a
 * database: which week, where each booking sits in its day, and how
 * bookings at the same time share the width.
 */
import { addDays } from "./booking-slots";

/** The Monday of a date's week, as `YYYY-MM-DD`. */
export function weekStart(date: string): string {
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** Minutes after midnight of an instant in a time zone (a booking at 09:30 is 570). */
export function minuteOfDay(iso: string, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export type DayItem = { id: string; start: number; end: number };
export type PlacedItem = DayItem & { lane: number; lanes: number };

/**
 * Side by side where bookings overlap: each gets the first free lane, and
 * every booking in a group of overlapping ones takes that group's number of
 * lanes, so they share the day's width evenly.
 */
export function layoutDay(items: DayItem[]): PlacedItem[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: PlacedItem[] = [];
  let group: PlacedItem[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    const lanes = Math.max(0, ...group.map((item) => item.lane)) + 1;
    for (const item of group) item.lanes = lanes;
    group = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    const taken = new Set(group.filter((other) => other.end > item.start).map((other) => other.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    const next = { ...item, lane, lanes: 1 };
    group.push(next);
    placed.push(next);
    groupEnd = Math.max(groupEnd, item.end);
  }
  close();
  return placed;
}
