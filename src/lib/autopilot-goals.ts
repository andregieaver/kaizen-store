import { z } from "zod";

import { formatMoney } from "./money";

/**
 * The autopilot's goals (D309, `docs/ai-autopilot.md` 7.1): the owner's vision in their words and up to five targets the code measures
 * from the store's own figures. Pure: the targets' shapes, the tool's input and the arithmetic of progress; the figures are read by
 * `goalProgress()` in `src/server/autopilot-goals.ts`. A figure that cannot be known is *not measured* with its reason, never 0 and never met.
 */

export const GOAL_TARGETS = [
  "revenue_30d",
  "orders_30d",
  "conversion_30d",
  "open_by",
  "products",
  "pages",
  "stores",
  // Profit (`docs/100-day-challenge.md` E2): what the challenge is won on, so the autopilot can steer by it rather than by sales alone.
  "contribution_30d",
  "margin_30d",
  "revenue_since",
  "contribution_since",
  // Kaizena Flow's sign-ups per 100 visits to its site (ecosystem plan E5.3, D757): its own store sells nothing, so this is what it aims at.
  "signup_rate_30d",
] as const;
export type GoalTargetKind = (typeof GOAL_TARGETS)[number];

/**
 * The targets the AI manager's `set_goal` offers: every one but those held out of its schema until the agents' eval is recorded with them
 * (D391, the tools' version; like `HELD_FOR_EVAL` in `owner-tools.ts`). Until then a person sets a held one on the Autopilot page's Goals.
 */
export const HELD_GOAL_TARGETS = ["signup_rate_30d"] as const satisfies readonly GoalTargetKind[];
export const TOOL_GOAL_TARGETS = [
  "revenue_30d",
  "orders_30d",
  "conversion_30d",
  "open_by",
  "products",
  "pages",
  "stores",
  "contribution_30d",
  "margin_30d",
  "revenue_since",
  "contribution_since",
] as const satisfies readonly Exclude<GoalTargetKind, (typeof HELD_GOAL_TARGETS)[number]>[];

/** Whose goals: a store's, Kaizena Flow's own store's (`stores.house`, D466), or Kaizena Flow's with no store. */
export type GoalScopeKind = "store" | "house" | "platform";

/**
 * The targets each scope measures: a store's figures, or Kaizena Flow's own (pages, open stores, and sign-ups per visit to its site, which its
 * own store serves since D484, so its store's autopilot can aim at them too).
 */
export const TARGETS_FOR: Record<GoalScopeKind, readonly GoalTargetKind[]> = {
  store: ["revenue_30d", "orders_30d", "conversion_30d", "open_by", "products", "pages", "contribution_30d", "margin_30d", "revenue_since", "contribution_since"],
  house: ["revenue_30d", "orders_30d", "conversion_30d", "open_by", "products", "pages", "contribution_30d", "margin_30d", "revenue_since", "contribution_since", "signup_rate_30d"],
  platform: ["pages", "stores", "signup_rate_30d"],
};

/** Whether a scope's goals can aim at Kaizena Flow's sign-ups per visit: its own, and its own store's. */
export const aimsAtSignups = (scope: GoalScopeKind): boolean => TARGETS_FOR[scope].includes("signup_rate_30d");

/**
 * The share of visits signing up the Autopilot page offers to aim for: a fifth more than today's (the change its tests are sized to find),
 * rounded up to a tenth of a percent; 1 % while today's is not known.
 */
export function suggestedSignupPercent(now: number | null): number {
  if (now === null || !(now > 0)) return 1;
  return Math.min(100, Math.ceil(Math.round(now * 1.2 * 1000) / 100) / 10);
}

export const GOALS_ACTIVE_MAX = 5;
export const TARGETS_MAX = 5;
export const GOAL_STATUSES = ["active", "met", "dropped"] as const;

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
  z.object({ kind: z.literal("contribution_30d"), amount_minor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.object({ kind: z.literal("margin_30d"), percent: z.number().positive().max(100) }),
  z.object({ kind: z.literal("revenue_since"), amount_minor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/), since: day }),
  z.object({ kind: z.literal("contribution_since"), amount_minor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/), since: day }),
  z.object({ kind: z.literal("signup_rate_30d"), percent: z.number().positive().max(100) }),
]);
export type GoalTarget = z.infer<typeof goalTargetSchema>;
export const goalTargetsSchema = z.array(goalTargetSchema).max(TARGETS_MAX);

/** A target as the model gives it: flat, an amount typed in the main currency's major units ("50 000"). Only the tool's kinds (`TOOL_GOAL_TARGETS`). */
export const goalTargetInput = z.object({
  kind: z.enum(TOOL_GOAL_TARGETS),
  amount: z
    .string()
    .trim()
    .max(30)
    .optional()
    .describe(
      "revenue_30d: net sales of 30 days without VAT; contribution_30d: contribution profit of 30 days (net sales less goods, fees, shipping and marketing); revenue_since and contribution_since: the same added up since `since`. In the store's main currency, such as '50000'.",
    ),
  count: z.number().int().positive().max(10_000_000).optional().describe("orders_30d, products, pages or stores: how many."),
  percent: z.number().positive().max(100).optional().describe("conversion_30d: orders per 100 visits; margin_30d: contribution profit per 100 of net sales, last 30 days."),
  date: day.optional().describe("open_by: the date the store should be open, YYYY-MM-DD."),
  since: day.optional().describe("revenue_since and contribution_since: the first day counted, YYYY-MM-DD (the challenge's Day 1)."),
});
export type GoalTargetInput = z.infer<typeof goalTargetInput>;
/** A target typed by the model or by a person on the Autopilot page, whose Goals also set the kinds held out of the tool. */
export type GoalTargetTyped = Omit<GoalTargetInput, "kind"> & { kind: GoalTargetKind };

/** A typed target made into a stored one, or the problem in words. `parseAmount` reads the major units in the main currency. */
export function targetFromInput(
  input: GoalTargetTyped,
  scope: GoalScopeKind,
  currency: string | null,
  parseAmount: (text: string, currency: string) => number | null,
): { ok: true; target: GoalTarget } | { ok: false; problem: string } {
  if (!TARGETS_FOR[scope].includes(input.kind)) {
    if (input.kind === "signup_rate_30d") return { ok: false, problem: "Only Kaizena Flow and its own store count sign-ups to Kaizena Flow." };
    return { ok: false, problem: `A ${scope === "platform" ? "Kaizena Flow" : "store"} goal cannot measure ${input.kind}.` };
  }
  const need = (what: string) => ({ ok: false as const, problem: `${input.kind} needs ${what}.` });
  switch (input.kind) {
    case "revenue_30d":
    case "contribution_30d":
    case "revenue_since":
    case "contribution_since": {
      if (!input.amount || !currency) return need("an amount");
      const minor = parseAmount(input.amount, currency);
      if (minor === null || minor <= 0) return { ok: false, problem: `"${input.amount}" is not an amount in ${currency}.` };
      if (input.kind === "revenue_since" || input.kind === "contribution_since") {
        return input.since ? { ok: true, target: { kind: input.kind, amount_minor: minor, currency, since: input.since } } : need("a first day (since)");
      }
      return { ok: true, target: { kind: input.kind, amount_minor: minor, currency } };
    }
    case "conversion_30d":
    case "margin_30d":
    case "signup_rate_30d":
      return input.percent ? { ok: true, target: { kind: input.kind, percent: input.percent } } : need("a percent");
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
  /** Contribution profit of the last 30 store days in `currency` (`derive()`: net sales less goods, fees, shipping, marketing, lost disputes). */
  contribution30d: number | null;
  /** Contribution profit per 100 of net sales, last 30 days. */
  margin30d: number | null;
  /** Net sales and contribution profit since each first day a goal names, keyed by the day; null where not known. */
  since: Record<string, { revenue: number | null; contribution: number | null; missing?: string }>;
  /** Sign-ups to Kaizena Flow per 100 visits to its site over the last 30 days, its own store's (D757); null anywhere else or not known. */
  signupRate30d: number | null;
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
    case "signup_rate_30d": {
      const words = `${pct(target.percent)} of visits sign up to Kaizena Flow`;
      return f.signupRate30d === null ? notMeasured(words) : { kind: target.kind, target: words, now: pct(f.signupRate30d), met: f.signupRate30d >= target.percent };
    }
    case "open_by": {
      const words = `Open by ${target.date}`;
      if (f.openedOn) return { kind: target.kind, target: words, now: `Open since ${f.openedOn}`, met: f.openedOn <= target.date };
      return { kind: target.kind, target: words, now: f.today > target.date ? "Not open, and the date has passed" : "Not open yet", met: false };
    }
    case "contribution_30d": {
      const words = `${formatMoney(target.amount_minor, target.currency, locale)} contribution profit in 30 days`;
      if (f.currency && f.currency !== target.currency) return { ...notMeasured(words), missing: `The target is in ${target.currency} and the store's figures are in ${f.currency}.` };
      if (f.contribution30d === null) return notMeasured(words);
      return { kind: target.kind, target: words, now: formatMoney(f.contribution30d, target.currency, locale), met: f.contribution30d >= target.amount_minor };
    }
    case "margin_30d":
      return f.margin30d === null
        ? notMeasured(`${pct(target.percent)} contribution margin`)
        : { kind: target.kind, target: `${pct(target.percent)} contribution margin`, now: pct(f.margin30d), met: f.margin30d >= target.percent };
    case "revenue_since":
    case "contribution_since": {
      const what = target.kind === "revenue_since" ? "net sales" : "contribution profit";
      const words = `${formatMoney(target.amount_minor, target.currency, locale)} ${what} since ${target.since}`;
      if (f.currency && f.currency !== target.currency) return { ...notMeasured(words), missing: `The target is in ${target.currency} and the store's figures are in ${f.currency}.` };
      if (target.since > f.today) return { kind: target.kind, target: words, now: `Counting starts on ${target.since}`, met: null, missing: "The first day has not come." };
      const since = f.since[target.since];
      const value = since ? (target.kind === "revenue_since" ? since.revenue : since.contribution) : null;
      if (value === null) return { ...notMeasured(words), missing: since?.missing ?? f.missing[target.kind] ?? "The figure is not known." };
      return { kind: target.kind, target: words, now: formatMoney(value, target.currency, locale), met: value >= target.amount_minor };
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
