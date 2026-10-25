import { z } from "zod";

import { formatMoney } from "./money";

/**
 * The autopilot's goals (D309, `docs/ai-autopilot.md` 7.1): the owner's vision in their words and up to five targets the code measures
 * from the store's own figures. Pure: the targets' shapes, the tool's input and the arithmetic of progress; the figures are read by
 * `goalProgress()` in `src/server/autopilot-goals.ts`. A figure that cannot be known is *not measured* with its reason, never 0 and never met.
 */

export const GOAL_TARGETS = ["revenue_30d", "orders_30d", "conversion_30d", "open_by", "products", "pages", "stores"] as const;
export type GoalTargetKind = (typeof GOAL_TARGETS)[number];

/** The targets each scope measures: a store's figures, or Kaizena Flow's own (pages and open stores). */
export const TARGETS_FOR: Record<"store" | "platform", readonly GoalTargetKind[]> = {
  store: ["revenue_30d", "orders_30d", "conversion_30d", "open_by", "products", "pages"],
  platform: ["pages", "stores"],
};

export const GOALS_ACTIVE_MAX = 5;
export const TARGETS_MAX = 5;
export const GOAL_STATUSES = ["active", "met", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.");

/** A target as stored: amounts in integer minor units of the currency they were set in. */
export const goalTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revenue_30d"), amount_minor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.object({ kind: z.literal("orders_30d"), count: z.number().int().positive().max(10_000_000) }),
  z.object({ kind: z.literal("conversion_30d"), percent: z.number().positive().max(100) }),
  z.object({ kind: z.literal("open_by"), date: day }),
  z.object({ kind: z.literal("products"), count: z.number().int().positive().max(1_000_000) }),
  z.object({ kind: z.literal("pages"), count: z.number().int().positive().max(100_000) }),
  z.object({ kind: z.literal("stores"), count: z.number().int().positive().max(10_000_000) }),
]);
export type GoalTarget = z.infer<typeof goalTargetSchema>;
export const goalTargetsSchema = z.array(goalTargetSchema).max(TARGETS_MAX);

/** A target as the model gives it: flat, an amount typed in the main currency's major units ("50 000"). */
export const goalTargetInput = z.object({
  kind: z.enum(GOAL_TARGETS),
  amount: z.string().trim().max(30).optional().describe("revenue_30d: net sales of 30 days without VAT, in the store's main currency, such as '50000'."),
  count: z.number().int().positive().max(10_000_000).optional().describe("orders_30d, products, pages or stores: how many."),
  percent: z.number().positive().max(100).optional().describe("conversion_30d: orders per 100 visits."),
  date: day.optional().describe("open_by: the date the store should be open, YYYY-MM-DD."),
});
export type GoalTargetInput = z.infer<typeof goalTargetInput>;

/** A typed target made into a stored one, or the problem in words. `parseAmount` reads the major units in the main currency. */
export function targetFromInput(
  input: GoalTargetInput,
  scope: "store" | "platform",
  currency: string | null,
  parseAmount: (text: string, currency: string) => number | null,
): { ok: true; target: GoalTarget } | { ok: false; problem: string } {
  if (!TARGETS_FOR[scope].includes(input.kind)) return { ok: false, problem: `A ${scope === "store" ? "store" : "Kaizena Flow"} goal cannot measure ${input.kind}.` };
  const need = (what: string) => ({ ok: false as const, problem: `${input.kind} needs ${what}.` });
  switch (input.kind) {
    case "revenue_30d": {
      if (!input.amount || !currency) return need("an amount");
      const minor = parseAmount(input.amount, currency);
      if (minor === null || minor <= 0) return { ok: false, problem: `"${input.amount}" is not an amount in ${currency}.` };
      return { ok: true, target: { kind: "revenue_30d", amount_minor: minor, currency } };
    }
    case "conversion_30d":
      return input.percent ? { ok: true, target: { kind: "conversion_30d", percent: input.percent } } : need("a percent");
    case "open_by":
      return input.date ? { ok: true, target: { kind: "open_by", date: input.date } } : need("a date");
    default:
      return input.count ? { ok: true, target: { kind: input.kind, count: input.count } } : need("a count");
  }
}

/** The store's figures a goal is measured against; null where it cannot be known, with the reason in `missing`. */
export type GoalFigures = {
  /** Net sales of the last 30 store days in `currency`, without VAT (revenue less refunds). */
  revenue30d: number | null;
  currency: string | null;
  orders30d: number | null;
  /** Checkout orders per 100 counted visits. */
  conversion30d: number | null;
  /** The store's opening day (store time), or null while it is not open. */
  openedOn: string | null;
  today: string;
  products: number | null;
  pages: number | null;
  stores: number | null;
  /** Why a figure is null, by target kind. */
  missing: Partial<Record<GoalTargetKind, string>>;
};

export type TargetProgress = { kind: GoalTargetKind; target: string; now: string; met: boolean | null; missing?: string };

const count = (n: number) => n.toLocaleString("en-GB");
const pct = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-GB")} %`;

/** One target's progress in words worked out in code; `met` null when the figure is not known. */
export function targetProgress(target: GoalTarget, f: GoalFigures, locale = "en-GB"): TargetProgress {
  const notMeasured = (targetWords: string): TargetProgress => ({
    kind: target.kind,
    target: targetWords,
    now: "not measured",
    met: null,
    missing: f.missing[target.kind] ?? "The figure is not known.",
  });
  switch (target.kind) {
    case "revenue_30d": {
      const words = `${formatMoney(target.amount_minor, target.currency, locale)} net sales in 30 days`;
      if (f.currency && f.currency !== target.currency) {
        return { ...notMeasured(words), missing: `The target is in ${target.currency} and the store's figures are in ${f.currency}.` };
      }
      if (f.revenue30d === null) return notMeasured(words);
      return { kind: target.kind, target: words, now: formatMoney(f.revenue30d, target.currency, locale), met: f.revenue30d >= target.amount_minor };
    }
    case "orders_30d":
      return f.orders30d === null
        ? notMeasured(`${count(target.count)} orders in 30 days`)
        : { kind: target.kind, target: `${count(target.count)} orders in 30 days`, now: count(f.orders30d), met: f.orders30d >= target.count };
    case "conversion_30d":
      return f.conversion30d === null
        ? notMeasured(`${pct(target.percent)} of visits order`)
        : { kind: target.kind, target: `${pct(target.percent)} of visits order`, now: pct(f.conversion30d), met: f.conversion30d >= target.percent };
    case "open_by": {
      const words = `Open by ${target.date}`;
      if (f.openedOn) return { kind: target.kind, target: words, now: `Open since ${f.openedOn}`, met: f.openedOn <= target.date };
      return { kind: target.kind, target: words, now: f.today > target.date ? "Not open, and the date has passed" : "Not open yet", met: false };
    }
    case "products":
    case "pages":
    case "stores": {
      const noun = target.kind === "products" ? "active products" : target.kind === "pages" ? "published pages" : "open stores";
      const value = f[target.kind];
      return value === null
        ? notMeasured(`${count(target.count)} ${noun}`)
        : { kind: target.kind, target: `${count(target.count)} ${noun}`, now: count(value), met: value >= target.count };
    }
  }
}

/** A goal is met when it has targets and every one is met; never by the model's say. */
export function goalMet(progress: readonly TargetProgress[]): boolean {
  return progress.length > 0 && progress.every((p) => p.met === true);
}
