import { z } from "zod";

import { COMPARE_KEYS, DEFAULT_ROWS, DIMENSION_KEYS, MAX_DIMENSIONS, MAX_FILTER_VALUES, MAX_FILTERS, MAX_METRICS, MAX_ROWS, METRIC_KEYS, PERIOD_PRESETS, type ReportSpec } from "./report-catalogue";

/**
 * A report's spec as the builder, a saved report and the AI manager send it (wave 8 unit A, D345): only the catalogue's keys, a period as
 * the analytics pages take it, at most `MAX_ROWS` rows. The shape is checked here; whether the cuts are allowed is `specProblems()`.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportFilterSchema = z.object({
  dimension: z.enum(DIMENSION_KEYS),
  values: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_FILTER_VALUES),
});

export const reportSpecSchema = z.object({
  metrics: z.array(z.enum(METRIC_KEYS)).min(1).max(MAX_METRICS),
  dimensions: z.array(z.enum(DIMENSION_KEYS)).max(MAX_DIMENSIONS).default([]),
  filters: z.array(reportFilterSchema).max(MAX_FILTERS).default([]),
  period: z
    .object({
      preset: z.enum(PERIOD_PRESETS).default("30d"),
      from: day.optional(),
      to: day.optional(),
      compare: z.enum(COMPARE_KEYS).default("previous"),
    })
    .default({ preset: "30d", compare: "previous" }),
  sort: z.union([z.enum(METRIC_KEYS), z.enum(DIMENSION_KEYS)]).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
  chart: z.enum(["table", "bar", "line"]).default("table"),
}) satisfies z.ZodType<ReportSpec, unknown>;

/** A spec read back from storage or a request; null when it is not one. */
export function readSpec(value: unknown): ReportSpec | null {
  const parsed = reportSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
