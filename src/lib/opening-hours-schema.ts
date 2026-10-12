import { z } from "zod";

import { DAYS, type Day, MAX_EXCEPTIONS, type OpeningHours } from "./opening-hours";

/**
 * The schemas of `opening-hours.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

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

/** Hours as stored, or null when they are missing or malformed. */
export function parseOpeningHours(value: unknown): OpeningHours | null {
  const parsed = openingHoursInput.safeParse(value);
  return parsed.success ? (parsed.data as OpeningHours) : null;
}
