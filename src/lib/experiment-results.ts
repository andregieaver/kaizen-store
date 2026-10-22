import { erfc, MIN_PER_ARM } from "./experiment-stats";
import { GOAL_WORDS, MAX_RUN_DAYS, MIN_DAYS, type Goal } from "./experiments";
import { countWords, fillWords } from "./admin-fill";
import { experimentsEn, type ExperimentsMessages } from "./admin-messages/experiments.en";
import { formatMoney } from "./money";

/**
 * What an A/B test's numbers say, and how to say it (D148, docs/ab-testing.md): the arithmetic is fixed here before any
 * result is in. Rates are compared on the share of exposed visitors who did the thing; money on revenue per exposed
 * visitor (winsorised by the server, so one huge order does not decide). The words are built in code, never by a model.
 */

/** The standard normal's distribution function. */
export const normalCdf = (z: number): number => 1 - 0.5 * erfc(z / Math.SQRT2);

/** The z with `normalCdf(z) = p`, for p in (0, 1) (Acklam's approximation, error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------------------
// The split check
// ---------------------------------------------------------------------------

function lnGamma(x: number): number {
  const g = 7;
  const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let sum = coef[0];
  const t = y + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) sum += coef[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The regularised upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/**
 * The sample-ratio check for any number of versions: how likely the counts seen are if visitors really went to each
 * version with its share. Below 0.001 the assignment or the logging is broken and the results are not to be trusted.
 */
export function splitCheckP(counts: readonly number[], shares: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length < 2) return 1;
  let chi = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const expected = total * shares[i];
    if (expected <= 0) continue;
    chi += (counts[i] - expected) ** 2 / expected;
  }
  return gammaQ((counts.length - 1) / 2, chi / 2);
}

// ---------------------------------------------------------------------------
// Comparing a version with the original
// ---------------------------------------------------------------------------

/** What one version got: its exposed visitors, and for a rate goal those who did the thing, for money the sums of their revenue. */
export type VariantFigures = {
  key: string;
  name: string;
  visitors: number;
  conversions: number;
  /** Per-visitor revenue in minor units (the same currency, winsorised): the sum and the sum of squares, over all `visitors`. */
  money: { sum: number; sumSq: number } | null;
};

export type Comparison = {
  key: string;
  /** The original's rate or revenue per visitor, and this version's. */
  original: number;
  version: number;
  /** The difference (version minus original) and its interval, in the same unit. */
  diff: number;
  low: number;
  high: number;
  /** The difference as a share of the original; null while the original has none. */
  relative: number | null;
  /** How likely it is that the version is better than the original. */
  chanceBetter: number;
};

const meanVar = (money: { sum: number; sumSq: number }, n: number) => {
  const mean = money.sum / n;
  const variance = n > 1 ? Math.max(0, (money.sumSq - n * mean * mean) / (n - 1)) : 0;
  return { mean, variance };
};

/** The version against the original; null while either has no visitors. `z` is the interval's (1.96 for 95 %). */
export function compareToOriginal(goalKind: "rate" | "money", original: VariantFigures, version: VariantFigures, z = 1.96): Comparison | null {
  if (original.visitors === 0 || version.visitors === 0) return null;
  let a: number;
  let b: number;
  let se: number;
  if (goalKind === "rate") {
    a = original.conversions / original.visitors;
    b = version.conversions / version.visitors;
    se = Math.sqrt((a * (1 - a)) / original.visitors + (b * (1 - b)) / version.visitors);
  } else {
    if (!original.money || !version.money) return null;
    const mo = meanVar(original.money, original.visitors);
    const mv = meanVar(version.money, version.visitors);
    a = mo.mean;
    b = mv.mean;
    se = Math.sqrt(mo.variance / original.visitors + mv.variance / version.visitors);
  }
  const diff = b - a;
  return {
    key: version.key,
    original: a,
    version: b,
    diff,
    low: diff - z * se,
    high: diff + z * se,
    relative: a > 0 ? diff / a : null,
    chanceBetter: se > 0 ? normalCdf(diff / se) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5,
  };
}

// ---------------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------------

export type VerdictKind = "few" | "early" | "better" | "worse" | "even" | "broken";

export type Verdict = {
  kind: VerdictKind;
  /** The version that is better than the original, for `better`. */
  best: string | null;
  /** One sentence for the top of the results. */
  headline: string;
  /** What it rests on, and what to do next. */
  detail: string;
};

const percentIn = (share: number, locale = "en-GB") => `${Math.abs(Math.round(share * 100)).toLocaleString(locale)} %`;
const letter = (key: string) => key.toUpperCase();

export type VerdictInput = {
  goal: Goal;
  figures: VariantFigures[];
  /** `splitCheckP` of the visitors' counts against the shares. */
  splitP: number;
  /** Whole days the test has counted. */
  days: number;
  /** The least visitors each version needs, and the least days. */
  minVisitors: number;
  minDays: number;
  currency: string;
  locale: string;
  /** The words, in the account's language (D312 A7); English, as the AI manager reads it, unless given. */
  words?: ExperimentsMessages;
  /** How numbers are written in those words; en-GB unless given. */
  numberLocale?: string;
};

/** The results in words and one of six verdicts; the rule is fixed here: nothing is said before the minimum, a broken split says so first. */
export function verdictOf(input: VerdictInput): Verdict {
  const { goal, figures, days } = input;
  const all = input.words ?? experimentsEn;
  const w = all.verdict;
  const nl = input.numberLocale ?? "en-GB";
  const pct = (share: number) => percentIn(share, nl);
  const sure = (chance: number) => (chance > 0.99 ? w.moreThan99 : chance < 0.01 ? w.lessThan1 : `${Math.round(chance * 100)} %`);
  const rateWords = (rate: number) => `${(rate * 100).toLocaleString(nl, { maximumFractionDigits: rate < 0.1 ? 2 : 1 })} %`;
  const kind = GOAL_WORDS[goal].kind;
  const original = figures.find((f) => f.key === "a");
  const others = figures.filter((f) => f.key !== "a");
  const visitors = figures.reduce((sum, f) => sum + f.visitors, 0);
  const basis = countWords(days, w.basis, { n: visitors.toLocaleString(nl), days });
  if (!original || others.length === 0) return { kind: "few", best: null, headline: w.noResults, detail: w.nobody };
  if (input.splitP < 0.001) {
    return {
      kind: "broken",
      best: null,
      headline: w.broken,
      detail: fillWords(w.brokenDetail, { chance: input.splitP < 0.0001 ? w.under10000 : w.under1000, basis }),
    };
  }
  const floor = Math.max(input.minVisitors, MIN_PER_ARM);
  const fewest = Math.min(...figures.map((f) => f.visitors));
  // Several versions are each compared with the original at a stricter level, so a lucky one is not picked.
  const z = normalQuantile(1 - 0.025 / others.length);
  const comparisons = others.map((o) => compareToOriginal(kind, original, o, z)).filter((c): c is Comparison => c !== null);
  const leading = [...comparisons].sort((x, y) => y.chanceBetter - x.chanceBetter)[0];
  const describe = (c: Comparison) => {
    const name = letter(c.key);
    if (kind === "rate") {
      const more = c.diff >= 0;
      return c.relative === null
        ? fillWords(w.rateNoChange, { name, version: rateWords(c.version), original: rateWords(c.original) })
        : fillWords(more ? w.rateMore : w.rateFewer, { name, change: pct(c.relative), per: all.goals[goal].per, original: rateWords(c.original), version: rateWords(c.version) });
    }
    const money = (v: number) => formatMoney(Math.round(v), input.currency, input.locale);
    return c.relative === null
      ? fillWords(w.moneyNoChange, { name, version: money(c.version), original: money(c.original) })
      : fillWords(c.diff >= 0 ? w.moneyMore : w.moneyLess, { name, change: pct(c.relative), original: money(c.original), version: money(c.version) });
  };
  if (fewest < floor || days < input.minDays) {
    const needVisitors = Math.max(0, floor - fewest);
    const needDays = Math.max(0, input.minDays - days);
    const need = [needVisitors > 0 && fillWords(w.needVisitors, { n: needVisitors.toLocaleString(nl) }), needDays > 0 && countWords(needDays, w.needDays)].filter(Boolean).join(w.and);
    return {
      kind: fewest < floor ? "few" : "early",
      best: null,
      headline: w.early,
      detail: fillWords(w.earlyDetail, { start: leading ? fillWords(w.earlyStart, { describe: describe(leading) }) : "", need, basis }),
    };
  }
  if (!leading) return { kind: "few", best: null, headline: w.noResults, detail: basis };
  const winners = comparisons.filter((c) => c.low > 0).sort((x, y) => y.chanceBetter - x.chanceBetter);
  if (winners.length > 0) {
    const win = winners[0];
    return {
      kind: "better",
      best: win.key,
      headline: fillWords(w.better, { name: letter(win.key) }),
      detail: fillWords(w.betterDetail, { describe: describe(win), sure: sure(win.chanceBetter), name: letter(win.key), basis }),
    };
  }
  const worse = comparisons.filter((c) => c.high < 0).sort((x, y) => x.chanceBetter - y.chanceBetter)[0];
  if (worse && comparisons.every((c) => c.high < 0 || c.diff <= 0)) {
    return {
      kind: "worse",
      best: null,
      headline: w.worse,
      detail: fillWords(w.worseDetail, { describe: describe(worse), sure: sure(1 - worse.chanceBetter), name: letter(worse.key), basis }),
    };
  }
  return {
    kind: "even",
    best: null,
    headline: w.even,
    detail: fillWords(w.evenDetail, { describe: describe(leading), basis }),
  };
}

// ---------------------------------------------------------------------------
// Before it starts: how long will it take?
// ---------------------------------------------------------------------------

/** Visitors each version needs to see a relative change in a rate (two-sided 95 %, 80 % power). */
export function visitorsPerVersion(baseline: number, relativeChange: number): number | null {
  if (!(baseline > 0 && baseline < 1) || !(relativeChange > 0)) return null;
  const p1 = baseline;
  const p2 = Math.min(0.999, baseline * (1 + relativeChange));
  const pbar = (p1 + p2) / 2;
  const zAlpha = 1.959964;
  const zBeta = 0.841621;
  const n = ((zAlpha * Math.sqrt(2 * pbar * (1 - pbar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) / (p2 - p1) ** 2;
  return Math.ceil(n);
}

export type RuntimeEstimate = {
  perVersion: number;
  /** Whole weeks' worth of days, never fewer than the minimum. */
  days: number;
  tooLong: boolean;
  sentence: string;
};

/** How long a test takes at today's traffic; null when there is nothing to base it on. */
export function estimateRuntime(input: {
  baseline: number;
  relativeChange: number;
  versions: number;
  /** Visitors a day who could be enrolled (consented, on the page). */
  eligiblePerDay: number;
  trafficShare: number;
  minDays?: number;
  /** The words and how numbers are written (D312 A7); English unless given. */
  words?: ExperimentsMessages;
  numberLocale?: string;
}): RuntimeEstimate | null {
  const perVersion = visitorsPerVersion(input.baseline, input.relativeChange);
  const perDay = input.eligiblePerDay * input.trafficShare;
  if (perVersion === null || !(perDay > 0)) return null;
  const raw = Math.ceil((perVersion * input.versions) / perDay);
  const weeks = Math.ceil(Math.max(raw, input.minDays ?? MIN_DAYS) / 7);
  const days = weeks * 7;
  const tooLong = days > 42;
  const nl = input.numberLocale ?? "en-GB";
  const w = (input.words ?? experimentsEn).estimate;
  const change = percentIn(input.relativeChange, nl);
  const n = perVersion.toLocaleString(nl);
  return {
    perVersion,
    days,
    tooLong,
    sentence:
      days > MAX_RUN_DAYS
        ? fillWords(w.tooLong, { change, n, max: MAX_RUN_DAYS })
        : `${fillWords(w.days, { change, n, days })}${tooLong ? w.long : ""}`,
  };
}

/**
 * The guardrail that stops a test by itself in the first version: orders per visitor clearly worse in a version, once
 * every version has at least 1,000 visitors (a strict interval, so only real harm trips it). Returns the harmed version.
 */
export function harmedVersion(figures: VariantFigures[], ordersByVersion: Record<string, number>): string | null {
  const original = figures.find((f) => f.key === "a");
  if (!original) return null;
  if (figures.some((f) => f.visitors < 1000)) return null;
  for (const f of figures) {
    if (f.key === "a") continue;
    const c = compareToOriginal("rate", { ...original, conversions: ordersByVersion.a ?? 0 }, { ...f, conversions: ordersByVersion[f.key] ?? 0 }, 3.29);
    if (c && c.high < 0) return f.key;
  }
  return null;
}
