/**
 * A repeating task's rule as kept and as the editor sends it (D903 P4.1): checked here, apart from `projects-recurrence.ts`, so the
 * screens that only read a rule carry no schema (`admin-bundle.scan.test.ts`). Pure.
 */

import { z } from "zod";

import { REPEATS } from "./projects-recurrence";

const days = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** A rule as kept and as the editor sends it, its lists sorted and without repeats; a weekly or monthly rule without a day is refused. */
export const recurrence = z
  .object({
    freq: z.enum(REPEATS),
    weekdays: z.array(z.int().min(0).max(6)).max(7).optional(),
    intervalDays: z.int().min(1).max(365).optional(),
    monthDays: z.array(z.int().min(1).max(31)).max(31).optional(),
    intervalMonths: z.int().min(1).max(24).optional(),
    times: z
      .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(6),
    /** The day an every-so-many rule counts from, in the store's zone. */
    anchor: z.iso.date().optional(),
  })
  .refine((r) => r.freq !== "weekly" || (r.weekdays?.length ?? 0) > 0, { path: ["weekdays"], message: "empty" })
  .refine((r) => r.freq !== "monthly" || (r.monthDays?.length ?? 0) > 0, { path: ["monthDays"], message: "empty" })
  .transform((r) => ({
    ...r,
    ...(r.weekdays && { weekdays: days(r.weekdays) }),
    ...(r.monthDays && { monthDays: days(r.monthDays) }),
    times: [...new Set(r.times)].sort(),
  }));

export type Recurrence = z.output<typeof recurrence>;

/** A kept value read back; anything that is not a rule is none. */
export function parseRecurrence(value: unknown): Recurrence | null {
  const parsed = recurrence.safeParse(value);
  return parsed.success ? parsed.data : null;
}

