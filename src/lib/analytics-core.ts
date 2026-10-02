import { convertMinor, type Rates } from "./currency";

/**
 * The arithmetic every analytics figure shares (D152, docs/analytics.md):
 * changes between periods, safe ratios, the one way percentages and changes
 * are written, whether a change is good news, summing amounts in several
 * currencies, and the shape of a sparkline. Nothing here knows what a figure
 * means; the other analytics modules do.
 */

/** What shows where a figure cannot be known. */
export const NO_FIGURE = "–";

/** The one minus sign every analytics figure is written with: the proper minus U+2212, never a hyphen. */
export const MINUS = "\u2212";

/**
 * Text with its negative numbers' hyphen-minus written as the proper minus: "-3.2 %" → "−3.2 %", "-$5.00" → "−$5.00", "-NOK 5.00" → "−NOK 5.00", "kr -5" → "kr −5".
 * Only a hyphen right before a digit, a currency symbol or a three-letter currency code, at the start or after a space, bracket or currency symbol, is changed, so
 * a range or a hyphenated word is left alone. `Intl` writes money with a hyphen in some locales and U+2212 in others; this makes
 * every amount the admin shows read the same (`formatAmount()` in `analytics-format.ts`).
 */
export function withMinus(text: string): string {
  return text.replace(/(^|[\s(\p{Sc}])-(?=[\p{Sc}\d]|[A-Z]{3}\b)/gu, `$1${MINUS}`);
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** `a / b`, or null when either is missing or `b` is zero: never 0 or Infinity for "unknown". */
export function safeRatio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!finite(a) || !finite(b) || b === 0) return null;
  return a / b;
}

/** A figure's change since the comparison. */
export type Delta = {
  /** Current minus previous. */
  abs: number;
  /** As a ratio of the previous (0.124 is +12.4 %), against its size so a figure going from -100 to -50 is +50 %; null when previous is 0. */
  pct: number | null;
};

/**
 * Current against previous. Null when either is missing: a change to or from a
 * figure that cannot be known is not a change. A previous of 0 gives the
 * absolute change and no percentage.
 */
export function change(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (!finite(current) || !finite(previous)) return null;
  return { abs: current - previous, pct: previous === 0 ? null : (current - previous) / Math.abs(previous) };
}

/** A change in a share, in percentage points (0.012 is 1.2 points); null when either is missing. */
export function changePoints(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!finite(current) || !finite(previous)) return null;
  return (current - previous) * 100;
}

// ---------- writing figures ----------

/*
 * One convention for every figure the analytics write, whichever kind and wherever it is built (a view, an alert, a
 * sentence in a report): a decimal POINT and thousands separated by a no-break space, never depending on the store's
 * market ("2 110", "2.7 %", "1 234.5", "1.4"). Only an amount of money follows its market's locale (`formatMoney()`),
 * because a currency is written the way its readers write it. The admin is in English, so the figures around an amount
 * read the same on every store's page. `formatNumber()` is the only place digits are grouped and rounded (`roundedText()`
 * rounds, nothing else may), and `formatCount`, `formatPercent`, `formatSigned`, `formatPoints` and the views' decimal
 * helpers (`analytics-format.ts`) are built on them, so a kind of number cannot be written two ways.
 */

/** Rounds half away from zero to `digits` decimals as text with a decimal point, and never gives "-0". */
export function roundedText(value: number, digits: number): string {
  const factor = 10 ** digits;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits);
}

/** Separates the thousands of the whole part of a plain number's text ("-12345.6" → "−12 345.6", with no-break spaces and the proper minus). */
export function groupThousands(text: string): string {
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${negative ? MINUS : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** A number with `digits` decimals and thousands grouped: 12345.678 → "12 345.7" (digits 1); the dash when it cannot be known. */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  return finite(n) ? groupThousands(roundedText(n, digits)) : NO_FIGURE;
}

/** A ratio as a percentage with a space before the sign, as the admin writes it: 0.834 → "83.4 %". */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  return finite(ratio) ? `${formatNumber(ratio * 100, digits)} %` : NO_FIGURE;
}

/** The same with a sign, for changes: "+12.4 %", "−3.2 %", "0.0 %". */
export function formatSigned(ratio: number | null | undefined, digits = 1): string {
  if (!finite(ratio)) return NO_FIGURE;
  const text = formatNumber(ratio * 100, digits);
  return Number(roundedText(ratio * 100, digits)) > 0 ? `+${text} %` : `${text} %`;
}

/**
 * A change in words without an arrow: "+12.4 %". With nothing before it, "new"
 * when it rose from nothing and "0.0 %" when it stayed there; no figure for a
 * change that cannot be known.
 */
export function formatChange(delta: Delta | null | undefined, digits = 1): string {
  if (!delta) return NO_FIGURE;
  if (delta.pct !== null) return formatSigned(delta.pct, digits);
  return delta.abs === 0 ? formatSigned(0, digits) : delta.abs > 0 ? "new" : NO_FIGURE;
}

/** A change in a share as points: "+0.4 pts". */
export function formatPoints(points: number | null | undefined, digits = 1): string {
  if (!finite(points)) return NO_FIGURE;
  const text = formatNumber(points, digits);
  return Number(roundedText(points, digits)) > 0 ? `+${text} pts` : `${text} pts`;
}

/** A whole number with spaces between thousands: 12345 → "12 345" (a no-break space) so a number is never split over two lines. */
export function formatCount(n: number | null | undefined): string {
  return formatNumber(n, 0);
}

// ---------- months and days ----------

/** The short month names every analytics label uses ("Sep", never the runtime's "Sept"): one list, so no two places can differ. */
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-09` (or a longer date that starts with it) as "Sep 2026"; anything that is not a month as it came. */
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  const index = match ? Number(match[2]) - 1 : -1;
  return match && index >= 0 && index < 12 ? `${MONTH_SHORT[index]} ${match[1]}` : month;
}

/** `2026-09-03` as "3 Sep 2026"; anything that is not a real day as it came. */
export function formatDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real ? `${d} ${MONTH_SHORT[m - 1]} ${y}` : day;
}

// ---------- good or bad ----------

/** Which way is good news for a figure: more sales is up, more refunds is down, sessions neither. */
export type GoodDirection = "up" | "down" | "neutral";
export type Verdict = "good" | "bad" | "neutral";

/**
 * Whether a change is good news. A change within `epsilon` (in the figure's own
 * unit) is neutral, so noise is not painted green or red; a figure with no
 * preferred direction, or no change known, is neutral.
 */
export function verdictOf(abs: number | null | undefined, good: GoodDirection, epsilon = 0): Verdict {
  if (!finite(abs) || good === "neutral" || Math.abs(abs) <= epsilon) return "neutral";
  return (abs > 0) === (good === "up") ? "good" : "bad";
}

// ---------- several currencies ----------

/** An amount in one currency's minor units, as SQL groups it. */
export type CurrencyAmount = { currency: string; minor: number };

export type MainTotal = {
  /** The sum, in minor units of the main currency, of every amount that could be converted. */
  minor: number;
  /** How many non-zero amounts were left out because their currency has no rate. */
  unconverted: number;
  /** Those currencies, each once, in the order they were met. */
  missing: string[];
};

/**
 * Adds amounts in several currencies in the store's main currency at its
 * rates (`convertMinor()`). A currency with no rate is not summed: it is
 * counted, so the page can say what is missing instead of understating a total
 * silently. An amount of 0 loses nothing and is never counted.
 */
export function toMain(byCurrency: readonly CurrencyAmount[], main: string, rates: Rates): MainTotal {
  let minor = 0;
  let unconverted = 0;
  const missing: string[] = [];
  for (const row of byCurrency) {
    if (!finite(row.minor) || row.minor === 0) continue;
    const converted = convertMinor(row.minor, row.currency, main, rates);
    if (converted === null) {
      unconverted += 1;
      if (!missing.includes(row.currency)) missing.push(row.currency);
    } else {
      minor += converted;
    }
  }
  return { minor, unconverted, missing };
}

// ---------- sparklines ----------

/**
 * A series scaled to 0..1 (lowest 0, highest 1). A flat series, and a single
 * point, sit in the middle (0.5) rather than dividing by nothing; a gap (null)
 * stays a gap and does not count towards the scale.
 */
export function normalise(series: readonly (number | null)[]): (number | null)[] {
  const known = series.filter(finite);
  if (known.length === 0) return series.map(() => null);
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return series.map((v) => (finite(v) ? 0.5 : null));
  return series.map((v) => (finite(v) ? (v - min) / (max - min) : null));
}

export type SparkPoint = { x: number; y: number };

/**
 * Where a series' points go in a box of `width` × `height` with `pad` around
 * it: x spread evenly (a single point in the middle), y upside down so the
 * highest is at the top. A gap stays null.
 */
export function sparklinePoints(series: readonly (number | null)[], width: number, height: number, pad = 2): (SparkPoint | null)[] {
  const scaled = normalise(series);
  const innerW = Math.max(0, width - 2 * pad);
  const innerH = Math.max(0, height - 2 * pad);
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  return scaled.map((v, i) =>
    v === null
      ? null
      : {
          x: round2(series.length > 1 ? pad + step * i : width / 2),
          y: round2(pad + innerH * (1 - v)),
        },
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the points, lifting the pen at gaps; a lone point is a zero-length line (draw it with round caps). */
export function sparklinePath(points: readonly (SparkPoint | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x} ${p.y}`;
    pen = true;
  }
  // An isolated point (a gap on both sides) would draw nothing: give it a zero-length line.
  return d.replace(/M([\d.-]+) ([\d.-]+)(?=M|$)/g, "M$1 $2h0");
}
