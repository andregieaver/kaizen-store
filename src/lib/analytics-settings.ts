/**
 * What an owner enters for the analytics (D152, `docs/analytics.md`): cost assumptions, a month's revenue target and marketing
 * spend. Pure, so the browser and the server check the same text. Money is typed like a price in the store's main currency
 * (`parsePrice`: "249", "249,00", "1 249.5") and kept as integer minor units; a percentage is typed in whole and hundredths of
 * a percent ("2,9") and kept as basis points. Nothing here is a default for a store that has not entered anything: a store
 * with no row has `ANALYTICS_DEFAULTS` (all zero), which the pages show as "not entered", never as a profit.
 */
import { z } from "zod";

import { CHANNEL_KEYS } from "./analytics-channels";
import { formatPriceInput, parsePrice } from "./product-input";

export const ANALYTICS_DEFAULTS = {
  paymentFeeBps: 0,
  paymentFeeFixedMinor: 0,
  shippingCostMinor: 0,
  fixedCostsMonthlyMinor: 0,
  ltvLifespanYears: 3,
} as const;

/** The cost assumptions as kept: integer minor units in the main currency, basis points, whole years. */
export type AnalyticsSettings = {
  paymentFeeBps: number;
  paymentFeeFixedMinor: number;
  shippingCostMinor: number;
  fixedCostsMonthlyMinor: number;
  ltvLifespanYears: number;
};

/** The most a money amount here may be: far above any real cost, far below what a bigint column or a double holds exactly. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

const typed = z.string().trim().max(20);

/** The settings form as typed. */
export const analyticsSettingsInput = z.object({
  /** Estimated payment fee, a percentage of an order's total with VAT: "2,9". */
  paymentFeePercent: typed.default(""),
  /** Plus a fixed fee per paid order. */
  paymentFeeFixed: typed.default(""),
  /** What sending one order costs. */
  shippingCost: typed.default(""),
  /** Rent, pay and other fixed costs for a month. */
  fixedCostsMonthly: typed.default(""),
  /** Years a customer is expected to keep buying (1 to 10). */
  ltvLifespanYears: z.number().int("Use whole years.").min(1, "Use at least 1 year.").max(10, "Use at most 10 years."),
});
export type AnalyticsSettingsInput = z.infer<typeof analyticsSettingsInput>;

/**
 * A typed percentage in basis points: "2,9" is 290, "0.25" is 25, "100" is 10000. Null for text that is not a percentage, one
 * with more than two decimals, or one over 100. Empty is 0.
 */
export function parsePercentBps(value: string): number | null {
  const compact = value.replace(/[\s ]/g, "").replace(/%$/, "");
  if (compact === "") return 0;
  const match = /^([0-9]{1,3})(?:[.,]([0-9]{1,2}))?$/.exec(compact);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : null;
}

/** Basis points as the text of the field: 290 → "2,9", 25 → "0,25", 10000 → "100", 0 → "". */
export function formatPercentBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "";
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : String(whole);
}

/** A typed amount in minor units; empty is 0, and null means unreadable or out of range. */
export function parseAmountMinor(value: string, currency: string): number | null {
  if (value.trim() === "") return 0;
  const minor = parsePrice(value, currency);
  return minor === null || minor > MAX_AMOUNT_MINOR ? null : minor;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

/** The settings as typed, checked and turned into what is kept. */
export function parseAnalyticsSettings(raw: unknown, currency: string): Parsed<AnalyticsSettings> {
  const parsed = analyticsSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const input = parsed.data;
  const problems: string[] = [];
  const bps = parsePercentBps(input.paymentFeePercent);
  if (bps === null) problems.push(`"${input.paymentFeePercent}" is not a percentage between 0 and 100 with at most two decimals.`);
  const money = (text: string, label: string) => {
    const minor = parseAmountMinor(text, currency);
    if (minor === null) problems.push(`${label}: "${text}" is not an amount in ${currency}.`);
    return minor ?? 0;
  };
  const value: AnalyticsSettings = {
    paymentFeeBps: bps ?? 0,
    paymentFeeFixedMinor: money(input.paymentFeeFixed, "Fixed payment fee"),
    shippingCostMinor: money(input.shippingCost, "Shipping cost per order"),
    fixedCostsMonthlyMinor: money(input.fixedCostsMonthly, "Fixed costs per month"),
    ltvLifespanYears: input.ltvLifespanYears,
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
}

/** The kept settings as the form's text (zero shows empty, so "not entered" looks like it). */
export function analyticsSettingsText(settings: AnalyticsSettings, currency: string): AnalyticsSettingsInput {
  const amount = (minor: number) => (minor > 0 ? formatPriceInput(minor, currency) : "");
  return {
    paymentFeePercent: formatPercentBps(settings.paymentFeeBps),
    paymentFeeFixed: amount(settings.paymentFeeFixedMinor),
    shippingCost: amount(settings.shippingCostMinor),
    fixedCostsMonthly: amount(settings.fixedCostsMonthlyMinor),
    ltvLifespanYears: settings.ltvLifespanYears,
  };
}

/** Whether any cost assumption has been entered: until then the pages say so instead of showing estimates as zero cost. */
export function settingsEntered(settings: AnalyticsSettings): boolean {
  return (
    settings.paymentFeeBps > 0 ||
    settings.paymentFeeFixedMinor > 0 ||
    settings.shippingCostMinor > 0 ||
    settings.fixedCostsMonthlyMinor > 0
  );
}

// ---------------------------------------------------------------------------
// Days and months
// ---------------------------------------------------------------------------

/** A calendar day as `YYYY-MM-DD` that exists ("2026-02-30" does not). */
export function isValidDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A month typed as `YYYY-MM` or any day in it as the month's first day (`YYYY-MM-01`); null when it is not a month. */
export function firstOfMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const first = `${match[1]}-${match[2]}-01`;
  if (!isValidDay(first)) return null;
  if (match[3] !== undefined && !isValidDay(`${match[1]}-${match[2]}-${match[3]}`)) return null;
  return first;
}

// ---------------------------------------------------------------------------
// A month's target
// ---------------------------------------------------------------------------

export const targetInput = z.object({
  month: z.string().trim().max(10),
  /** Net revenue the month should reach, without VAT, typed in the main currency. */
  revenueTarget: typed,
});

export type MonthTarget = { month: string; revenueTargetMinor: number };

export function parseTarget(raw: unknown, currency: string): Parsed<MonthTarget> {
  const parsed = targetInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const month = firstOfMonth(parsed.data.month);
  if (!month) return { ok: false, problems: ["Choose a month."] };
  const minor = parseAmountMinor(parsed.data.revenueTarget, currency);
  if (minor === null) return { ok: false, problems: [`"${parsed.data.revenueTarget}" is not an amount in ${currency}.`] };
  if (minor <= 0) return { ok: false, problems: ["The target must be more than 0."] };
  return { ok: true, value: { month, revenueTargetMinor: minor } };
}

// ---------------------------------------------------------------------------
// Marketing spend
// ---------------------------------------------------------------------------

export const spendInput = z.object({
  day: z.string().trim().max(10),
  channel: z.string().trim().max(40),
  /** The campaign within the channel, empty for the channel as a whole. */
  campaign: z.string().trim().max(100, "Keep the campaign name to 100 characters.").default(""),
  amount: typed,
  note: z.string().trim().max(500, "Keep the note to 500 characters.").default(""),
});

export type Spend = { day: string; channel: string; campaign: string; amountMinor: number; note: string | null };

export function parseSpend(raw: unknown, currency: string): Parsed<Spend> {
  const parsed = spendInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const input = parsed.data;
  if (!isValidDay(input.day)) return { ok: false, problems: ["Choose a day."] };
  if (!(CHANNEL_KEYS as readonly string[]).includes(input.channel)) return { ok: false, problems: ["Choose a channel."] };
  const minor = parseAmountMinor(input.amount, currency);
  if (minor === null) return { ok: false, problems: [`"${input.amount}" is not an amount in ${currency}.`] };
  if (minor <= 0) return { ok: false, problems: ["The amount must be more than 0."] };
  return {
    ok: true,
    value: { day: input.day, channel: input.channel, campaign: input.campaign, amountMinor: minor, note: input.note || null },
  };
}
