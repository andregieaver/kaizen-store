import { EURO_RATE, type Rates } from "./currency";
import { minorUnitDigits } from "./money";

/**
 * Market price rules (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2), pure: a market's price of a variant worked out from its price in
 * another market of the store. This is the only arithmetic of a derived price; the server reads the facts and writes the result through
 * `commerce.set_price`. Every step is exact (BigInt over the rates and VAT rates as integers) and the result is rounded once, at the end.
 */

/** How the base price carries over: the price before VAT (the destination's VAT put back), or the price with VAT as it is. */
export const PRICE_BASES = ["net", "gross"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** A market's rule as the store keeps it. */
export type MarketPriceRule = {
  market: string;
  base: string;
  /** Basis points up (+) or down (-): 1,250 is 12.5 %. */
  percentBps: number;
  basis: PriceBasis;
  /** The step a derived price is rounded to, in the market's minor units (100 is one krone). */
  roundToMinor: number;
  /** An ending below the step (90 with a step of 100 is ",90"): the price is rounded up to the next price that ends so. */
  endingMinor: number | null;
};

export const PERCENT_MIN_BPS = -9_000;
export const PERCENT_MAX_BPS = 100_000;

/** What a derived price needs besides the rule: the base price and both sides' currency and VAT rate (percent, as `commerce.vat_rate()` gives it). */
export type DeriveFacts = {
  baseMinor: number;
  baseCurrency: string;
  baseVatPercent: number;
  currency: string;
  vatPercent: number;
  rates: Rates;
};

const RATE_SCALE = BigInt(100_000_000);
const BP = BigInt(10_000);

/** A rate (units per euro) as an integer of 1e8ths; null when the store has none for the currency. */
function scaledRate(rates: Rates, currency: string): bigint | null {
  const rate = currency === "EUR" ? EURO_RATE : (rates.get(currency)?.rate ?? null);
  if (rate === null || !(rate > 0)) return null;
  return BigInt(Math.round(rate * 1e8));
}

/** A VAT rate in percent (25, 12.5) as basis points. */
const vatBps = (percent: number) => BigInt(Math.round(percent * 100));

/** `a / b` rounded half up, for b > 0 and a >= 0. */
const halfUp = (a: bigint, b: bigint) => (a * BigInt(2) + b) / (b * BigInt(2));
/** `a / b` rounded up, for b > 0 (a may be negative). */
const ceilDiv = (a: bigint, b: bigint) => (a >= BigInt(0) ? (a + b - BigInt(1)) / b : -(-a / b));

/**
 * The rule's price of a variant in its market, in the market's minor units, or null when it cannot be worked out (no rate for one of the two
 * currencies). The base price, with its VAT taken off for `net`, converted from the base currency (through the euro, at the store's rates),
 * changed by the percentage, the market's VAT put back for `net`; then rounded half up to the step, or, with an ending, up to the next price that
 * ends so. Never below 0.
 */
export function derivedPrice(rule: Pick<MarketPriceRule, "percentBps" | "basis" | "roundToMinor" | "endingMinor">, facts: DeriveFacts): number | null {
  const from = scaledRate(facts.rates, facts.baseCurrency);
  const to = scaledRate(facts.rates, facts.currency);
  if (facts.baseCurrency !== facts.currency && (from === null || to === null)) return null;
  let num = BigInt(facts.baseMinor) * (BP + BigInt(rule.percentBps));
  let den = BP;
  if (facts.baseCurrency !== facts.currency) {
    num *= to!;
    den *= from!;
    const digits = minorUnitDigits(facts.currency) - minorUnitDigits(facts.baseCurrency);
    if (digits > 0) num *= BigInt(10) ** BigInt(digits);
    if (digits < 0) den *= BigInt(10) ** BigInt(-digits);
  }
  if (rule.basis === "net") {
    num *= BP + vatBps(facts.vatPercent);
    den *= BP + vatBps(facts.baseVatPercent);
  }
  if (num <= BigInt(0)) return 0;
  const step = BigInt(Math.max(1, rule.roundToMinor));
  if (rule.endingMinor === null) return Number(halfUp(num, den * step) * step);
  // The smallest price at or above the exact one that ends with the ending.
  const ending = BigInt(rule.endingMinor);
  const k = ceilDiv(num - ending * den, den * step);
  return Number((k < BigInt(0) ? BigInt(0) : k) * step + ending);
}

/** Why a rule as typed cannot be kept, in the owner's words; null when it can. */
export function ruleProblem(rule: MarketPriceRule, markets: readonly string[], ruled: readonly MarketPriceRule[]): string | null {
  if (!markets.includes(rule.market) || !markets.includes(rule.base)) return "Choose two of the store's countries.";
  if (rule.market === rule.base) return "A country cannot take its prices from itself.";
  if (rule.percentBps < PERCENT_MIN_BPS || rule.percentBps > PERCENT_MAX_BPS) return "The change is at most −90 % to +1,000 %.";
  if (!Number.isInteger(rule.roundToMinor) || rule.roundToMinor < 1 || rule.roundToMinor > 100_000) return "Choose how prices are rounded.";
  if (rule.endingMinor !== null && (rule.endingMinor < 0 || rule.endingMinor >= rule.roundToMinor)) return "The ending must be below the rounding step.";
  if (ruled.some((r) => r.market === rule.base && r.market !== rule.market)) return "That country takes its own prices from another; choose one whose prices are set by hand.";
  if (ruled.some((r) => r.base === rule.market && r.market !== rule.market)) return "Another country takes its prices from this one, so its own are set by hand.";
  return null;
}

/** An amount in a currency's major units (2.5, 9) as its minor units; null for one that does not fit them exactly. */
export function minorOf(major: number, currency: string): number | null {
  const minor = major * 10 ** minorUnitDigits(currency);
  const whole = Math.round(minor);
  return Math.abs(minor - whole) < 1e-6 && whole >= 0 ? whole : null;
}

/** Minor units written in major units, plainly (`10.00`, `9`), for the AI manager's sentences. */
const majorWords = (minor: number, currency: string) => `${(minor / 10 ** minorUnitDigits(currency)).toFixed(minorUnitDigits(currency))} ${currency}`;

/** A rule in one sentence, written by code for the AI manager and its approvals (never the model's). */
export function ruleSentence(rule: Omit<MarketPriceRule, "market">, currency: string): string {
  const percent = rule.percentBps / 100;
  const change = percent === 0 ? "no change" : `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %`;
  const basis = rule.basis === "net" ? "on the price before VAT, the country's own VAT put back" : "on the price with VAT as it is";
  const round =
    rule.roundToMinor <= 1
      ? "not rounded"
      : rule.endingMinor === null
        ? `rounded to ${majorWords(rule.roundToMinor, currency)}`
        : `rounded up to the next price ending in ${majorWords(rule.endingMinor, currency)} in steps of ${majorWords(rule.roundToMinor, currency)}`;
  return `Worked out from ${rule.base}: ${change} ${basis}, ${round}.`;
}

/** One of five products' prices as a rule as typed would make them, before it is saved (the Countries page's preview). */
export type RulePreview = { variantId: string; title: string; sku: string; base: number | null; before: number | null; after: number | null };

/** The Countries page's actions for its rules, bound to the store. */
export type PriceRuleActions = {
  preview: (rule: MarketPriceRule) => Promise<RulePreview[] | { problem: string }>;
  save: (rule: MarketPriceRule) => Promise<{ ok: true; message: string } | { ok: false; problem: string }>;
  remove: (market: string) => Promise<{ ok: true; message: string } | { ok: false; problem: string }>;
};
