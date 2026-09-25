import { z } from "zod";

/**
 * Opening hours (D40): the usual week, and exceptions to it, either a season
 * (a run of dates with its own week, such as summer hours) or single dates
 * (a holiday, closed or with its own hours). Kept as JSON with each place.
 */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_NAMES: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** Open from `open` to `close` (24-hour "HH:MM"); null is closed. */
export type DayHours = { open: string; close: string } | null;
export type WeekHours = Record<Day, DayHours>;

export type HoursException =
  | { kind: "season"; label: string; from: string; to: string; week: WeekHours }
  | { kind: "date"; label: string; date: string; hours: DayHours };

export type OpeningHours = { week: WeekHours; exceptions: HoursException[] };

export const MAX_EXCEPTIONS = 40;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Write times as HH:MM, such as 09:00.");
const date = z.iso.date("Choose a date.");

const dayHours = z
  .object({ open: time, close: time })
  .nullable()
  .refine((h) => h === null || h.open < h.close, "A day must close after it opens.");

const weekHours = z.object(Object.fromEntries(DAYS.map((d) => [d, dayHours])) as Record<Day, typeof dayHours>);

const label = z.string().trim().max(60).default("");

export const openingHoursInput = z.object({
  week: weekHours,
  exceptions: z
    .array(
      z.discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("season"), label, from: date, to: date, week: weekHours })
          .refine((s) => s.from <= s.to, "A season must end on or after the day it starts."),
        z.object({ kind: z.literal("date"), label, date, hours: dayHours }),
      ]),
    )
    .max(MAX_EXCEPTIONS, `Add at most ${MAX_EXCEPTIONS} exceptions.`),
});

/** Weekdays 09:00–17:00, weekends closed: a place to start. */
export function defaultWeek(): WeekHours {
  return Object.fromEntries(
    DAYS.map((d) => [d, d === "sat" || d === "sun" ? null : { open: "09:00", close: "17:00" }]),
  ) as WeekHours;
}

export function defaultHours(): OpeningHours {
  return { week: defaultWeek(), exceptions: [] };
}

/** Hours as stored, or null when they are missing or malformed. */
export function parseOpeningHours(value: unknown): OpeningHours | null {
  const parsed = openingHoursInput.safeParse(value);
  return parsed.success ? (parsed.data as OpeningHours) : null;
}

const short = (d: Day) => DAY_NAMES[d].slice(0, 3);
const same = (a: DayHours, b: DayHours) => (a === null ? b === null : b !== null && a.open === b.open && a.close === b.close);

/** "Mon–Fri 09:00–17:00, Sat 10:00–14:00": days with the same hours run together; closed days are left out. */
export function weekSummary(week: WeekHours): string {
  const parts: string[] = [];
  for (let i = 0; i < DAYS.length; ) {
    let j = i;
    while (j + 1 < DAYS.length && same(week[DAYS[j + 1]], week[DAYS[i]])) j++;
    const hours = week[DAYS[i]];
    if (hours) {
      const days = i === j ? short(DAYS[i]) : `${short(DAYS[i])}–${short(DAYS[j])}`;
      parts.push(`${days} ${hours.open}–${hours.close}`);
    }
    i = j + 1;
  }
  return parts.length > 0 ? parts.join(", ") : "Closed";
}

/** The hours in force on a date (YYYY-MM-DD): a single date first, then a season, then the usual week. */
export function hoursOn(hours: OpeningHours, isoDate: string): DayHours {
  const single = hours.exceptions.find((e) => e.kind === "date" && e.date === isoDate);
  if (single && single.kind === "date") return single.hours;
  const weekday = DAYS[(new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7];
  const season = hours.exceptions.find((e) => e.kind === "season" && e.from <= isoDate && isoDate <= e.to);
  if (season && season.kind === "season") return season.week[weekday];
  return hours.week[weekday];
}
