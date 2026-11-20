import { z } from "zod";

import {
  ADJUST_MODES,
  ADJUST_PROBLEM_WORDS,
  ADJUST_REASONS,
  ADJUST_ROWS_MAX,
  BACKORDER_DAYS_MAX,
  BACKORDER_DAYS_MIN,
  DEFAULT_ADJUST_REASON,
  LOCATION_NAME_MAX,
  NOTE_MAX,
  STOCK_MAX,
  STOCK_POLICIES,
  THRESHOLD_MAX,
} from "./inventory";

/**
 * The stock saves' schemas (D46, bloat review step 2.46): an Inventory page save, a variant's policy fields, a bulk change and a
 * location, apart from the limits, reasons and helpers in inventory.ts, so a screen that only words a figure loads no zod. Import this
 * file only where a schema runs.
 */

const stockFigure = z.number().int("Use a whole number.").min(-STOCK_MAX).max(STOCK_MAX);

const noteText = z
  .string()
  .trim()
  .max(NOTE_MAX, `A note is at most ${NOTE_MAX} characters.`)
  .nullable()
  .default(null)
  .transform((v) => (v === "" ? null : v));

/** One row of the Inventory page's save: the figure typed (`set` or `adjust`) and the figure the row was loaded with. */
export const adjustRow = z
  .object({
    variantId: z.uuid(),
    locationId: z.uuid(),
    mode: z.enum(ADJUST_MODES),
    value: stockFigure,
    /** The figure the row was loaded with: a different stored figure at save time makes the row a conflict. */
    was: z.number().int().min(-STOCK_MAX).max(STOCK_MAX),
  })
  .refine((r) => r.mode !== "set" || (r.value >= 0 && r.value <= STOCK_MAX), { message: ADJUST_PROBLEM_WORDS.negative, path: ["value"] });

/** The whole save: a reason for it, an optional note, and up to 500 rows (no row twice). */
export const adjustInput = z
  .object({
    reason: z.enum(ADJUST_REASONS).default(DEFAULT_ADJUST_REASON),
    note: noteText,
    rows: z.array(adjustRow).min(1, "Change at least one figure.").max(ADJUST_ROWS_MAX, `Save at most ${ADJUST_ROWS_MAX} rows at a time.`),
  })
  .refine((v) => new Set(v.rows.map((r) => `${r.variantId}:${r.locationId}`)).size === v.rows.length, {
    message: "A figure is changed twice in one save.",
    path: ["rows"],
  });

/** The product editor's and the bulk action's fields of a variant, shared with the browser (`productInput` widens with these). */
export const stockPolicyFields = {
  stockPolicy: z.enum(STOCK_POLICIES).default("deny"),
  backorderDays: z.number().int().min(BACKORDER_DAYS_MIN).max(BACKORDER_DAYS_MAX).nullable().default(null),
  /** A pre-order's release date, `YYYY-MM-DD` (D396): only with `continue`; null for none. */
  preorderUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Write the release date as a date.").nullable().default(null),
  lowStockThreshold: z.number().int().min(0).max(THRESHOLD_MAX).nullable().default(null),
};

/** A bulk change from the Inventory page: the selected rows' policy, or their warning level. */
export const bulkPolicyInput = z
  .object({
    variantIds: z.array(z.uuid()).min(1).max(ADJUST_ROWS_MAX),
    change: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("continue"), backorderDays: z.number().int().min(BACKORDER_DAYS_MIN).max(BACKORDER_DAYS_MAX) }),
      z.object({ kind: z.literal("deny") }),
      z.object({ kind: z.literal("threshold"), lowStockThreshold: z.number().int().min(0).max(THRESHOLD_MAX).nullable() }),
    ]),
  })
  .refine((v) => new Set(v.variantIds).size === v.variantIds.length, { message: "A variant is chosen twice.", path: ["variantIds"] });

export const locationInput = z.object({
  name: z.string().trim().min(1, "Give the location a name.").max(LOCATION_NAME_MAX, `A name is at most ${LOCATION_NAME_MAX} characters.`),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Choose a country."),
});
