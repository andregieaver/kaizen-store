import { fillWords } from "@/lib/admin-fill";
import type { AnalyticsMessages } from "@/lib/admin-messages/analytics.en";
import { formatCount, formatDate, formatPercent, formatSigned } from "@/lib/analytics-core";
import { analyticsWords, countText } from "@/lib/analytics-words";
import type { ChangeExplanation } from "@/lib/analytics-diagnosis";
import type { MonthForecast } from "@/lib/analytics-forecast";
import { costsKnown, estimateText, kpiChange } from "@/lib/analytics-kpi";
import { formatAmount, formatTimes } from "@/lib/analytics-format";
import { isSumMetric, LEVEL_MINIMUMS, type PeriodProgress, type TargetMetric, type TargetProgress } from "@/lib/analytics-targets";
import type { OverviewHead, PeriodFigures } from "@/server/analytics-totals";

import type { BarRow } from "./charts";

/**
 * What the Overview's sections say (D152), as pure functions of the figures they are handed: the sentences, the amounts and the rows of
 * the bars. No data access and no markup, so the sections (`overview-sections.tsx`) and the tests share them. `overview-view.tsx`
 * re-exports what the tests and other pages import from it.
 */

// ---------------------------------------------------------------------------
// Props of the parts that come from the server's reports
// ---------------------------------------------------------------------------

export type OverviewTarget = {
  /** "October 2026". */
  monthLabel: string;
  /** This month's net revenue against its target; status `no_target` when none is set. */
  progress: TargetProgress;
  /** Every other target whose period covers today (D348), soonest ending first; absent or empty when there is none. */
  others?: readonly OverviewTargetCard[];
};

/** A running target of any metric and period (`runningTargets()`), with its period in words. */
export type OverviewTargetCard = {
  id: string;
  metric: TargetMetric;
  /** "the week of 26 Oct 2026", "Q4 2026", "October 2026", "1 Oct 2026 to 31 Dec 2026". */
  periodLabel: string;
  progress: PeriodProgress;
  unconverted: number;
  missingCurrencies: readonly string[];
};

/** This month's forecast (`forecastForStore()`), for the card under the target. */
export type OverviewForecast = {
  /** "October 2026". */
  monthLabel: string;
  forecast: MonthForecast;
  /** The month's paid orders, forecast the same way (D348; its `*Minor` figures are counts); absent in older callers. */
  orders?: MonthForecast;
  /** The month's target; null when none is set. */
  targetMinor: number | null;
};

/** Why revenue changed (`diagnosisFor()`), for the "Why did sales change?" section. */
export type OverviewDiagnosis = {
  explanation: ChangeExplanation;
  /** What the period is compared with, in words ("Previous period", "Same period last year"). */
  comparedWith: string;
  /** What the figures are ("Revenue before refunds, without VAT"). */
  basis: string;
  /** What the explanation leaves out or rests on. */
  notes: readonly string[];
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** A whole number of minor units written as an amount; a value between whole minor units (an axis tick) is rounded, never refused. */
export function moneyWriter(currency: string, locale: string): (minor: number) => string {
  return (minor) => formatAmount(Math.round(minor), currency, locale);
}

/** `2026-10-03` as "3 Oct 2026" (the one day label every analytics page uses); anything that is not a day as it came. */
export function dayText(day: string): string {
  return formatDate(day);
}

/** A return on spend as "3.2×" (kept here for the views and tests that import it from this module). */
export { formatTimes };

export const noSales = (f: PeriodFigures) => f.totals.orders === 0 && f.totals.revenueMinor === 0 && f.totals.refundsMinor === 0;

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the first screen's parts ask of the cost coverage: whether there are sales, how much of them has a known cost, and whether too little does to show profit. */
export function moneySignals(data: Pick<OverviewHead, "current" | "costCoverage">): { sales: boolean; coverage: number | null; costsMissing: boolean } {
  const sales = !noSales(data.current);
  const coverage = data.costCoverage;
  return { sales, coverage, costsMissing: sales && coverage !== null && !costsKnown(coverage) };
}

/**
 * The sentences under "Are we making money?": what came in, what is left after costs, and what is missing to say. Written in code from
 * the figures, never flattering: a shortfall is a shortfall, and profit that cannot be known says so.
 */
export function moneyLines(data: OverviewHead, money: (minor: number) => string, words: AnalyticsMessages = analyticsWords()): string[] {
  const w = words.overview.money;
  const { current, params } = data;
  const t = current.totals;
  const d = current.derived;
  if (noSales(current)) return [w.noSales];

  const against = params.compare.mode === "year" ? data.lastYear : params.compare.mode === "previous" ? data.previous : null;
  const againstWords = params.compare.mode === "year" ? words.compare.theLastYear : words.compare.thePrevious;
  let first = countText(w.first, t.orders, { amount: money(d.netRevenue) }, formatCount(t.orders));
  if (against && !noSales(against)) {
    const delta = kpiChange({ kind: "money", good: "up" }, d.netRevenue, against.derived.netRevenue);
    const pct = delta.abs === null ? null : against.derived.netRevenue === 0 ? null : delta.abs / Math.abs(against.derived.netRevenue);
    if (pct !== null && Math.abs(pct) >= 0.0005) first += fillWords(pct > 0 ? w.up : w.down, { pct: formatPercent(Math.abs(pct)), against: againstWords });
  }
  const lines = [`${first}.`];

  const profit = d.contributionProfit;
  if (profit === null) {
    lines.push(d.costCoverage !== null && d.costCoverage > 0 ? fillWords(w.tooFew, { share: formatPercent(d.costCoverage, 0) }) : w.noCosts);
  } else {
    // An estimate says so: "estimated from the 45 % of sales whose cost is known"; exact profit is based on all sales.
    const coverage = estimateText(d.costCoverage) ?? data.costCoverageText;
    lines.push(profit >= 0 ? fillWords(w.left, { amount: money(profit), coverage }) : fillWords(w.short, { amount: money(-profit), coverage }));
  }
  return lines;
}

/** The words under a month's target meter, from the progress alone. Amounts and the estimate say it; the meter carries the pace word. */
export function targetLines(p: TargetProgress, money: (minor: number) => string, words: AnalyticsMessages = analyticsWords()): string[] {
  const w = words.overview.target;
  if (p.targetMinor === null) return [];
  const lines: string[] = [];
  if (p.actualMinor >= p.targetMinor) lines.push(w.reached);
  if (p.tooEarly) {
    lines.push(w.early);
  } else {
    if (p.expectedByTodayMinor !== null && p.aheadByMinor !== null) {
      const expected = money(p.expectedByTodayMinor);
      lines.push(p.aheadByMinor >= 0 ? fillWords(w.ahead, { amount: money(p.aheadByMinor), expected }) : fillWords(w.behind, { amount: money(-p.aheadByMinor), expected }));
    }
    if (p.projectedMinor !== null && p.projectedPct !== null) {
      lines.push(fillWords(w.projected, { amount: money(p.projectedMinor), share: formatPercent(p.projectedPct, 0) }));
    }
  }
  if (p.daysLeft > 0) lines.push(countText(w.daysLeft, p.daysLeft, {}, formatCount(p.daysLeft)));
  lines.push(p.weekdayWeighted ? w.weekdays : w.flat);
  return lines;
}

/** A figure of a target's metric written: an amount for net sales and AOV, a count of orders, a percentage for conversion (basis points). */
export function metricWriter(metric: TargetMetric, money: (minor: number) => string): (value: number) => string {
  if (metric === "orders") return (n) => formatCount(Math.round(n));
  if (metric === "conversion") return (bps) => formatPercent(bps / 10_000, 2);
  return money;
}

/** The sentences under a running target's meter (D348): where it stands, what is missing for a verdict, and how long is left. */
export function periodTargetLines(card: OverviewTargetCard, money: (minor: number) => string, words: AnalyticsMessages = analyticsWords()): string[] {
  const w = words.overview.target;
  const p = card.progress;
  const write = metricWriter(card.metric, money);
  const lines: string[] = [];
  if (p.missing === "visits") return [w.notKnownVisits];
  if (isSumMetric(card.metric)) {
    if (p.actual !== null && p.actual >= p.targetValue) lines.push(w.reached);
    if (p.tooEarly) lines.push(w.periodEarly);
    else {
      if (p.expected !== null && p.actual !== null) {
        const gap = p.actual - p.expected;
        lines.push(fillWords(gap >= 0 ? w.ahead : w.behind, { amount: write(Math.abs(gap)), expected: write(p.expected) }));
      }
      if (p.projected !== null && !p.ended) lines.push(fillWords(w.projectedPeriod, { amount: write(p.projected), share: formatPercent(p.projected / p.targetValue, 0) }));
    }
    lines.push(p.weekdayWeighted ? w.weekdays : w.flat);
  } else {
    if (p.actual !== null) lines.push(fillWords(w.levelSoFar, { actual: write(p.actual), target: write(p.targetValue) }));
    if (p.missing === "orders") lines.push(fillWords(w.fewOrders, { n: formatCount(LEVEL_MINIMUMS.aov.orders) }));
    else if (p.missing === "sessions") lines.push(fillWords(w.fewSessions, { n: formatCount(LEVEL_MINIMUMS.conversion.sessions) }));
    else if (p.actual !== null) lines.push(p.actual >= p.targetValue ? w.levelReached : fillWords(w.levelBehind, { amount: write(p.targetValue - p.actual) }));
  }
  if (p.daysLeft > 0) lines.push(countText(w.periodDaysLeft, p.daysLeft, {}, formatCount(p.daysLeft)));
  return lines;
}

/** The month's orders forecast in one sentence: about how many, the range and what is banked, or that there is too little history. */
export function ordersForecastLine(orders: MonthForecast, words: AnalyticsMessages = analyticsWords()): string {
  const w = words.overview.forecast;
  if (orders.expectedMinor === null || orders.lowMinor === null || orders.highMinor === null) return w.ordersTooLittle;
  return fillWords(w.orders, { n: formatCount(orders.expectedMinor), low: formatCount(orders.lowMinor), high: formatCount(orders.highMinor), sofar: formatCount(orders.soFarMinor) });
}

/** The month's name in a month label: "October 2026" is "October", "oktober 2026" "oktober". */
const monthName = (label: string) => label.split(" ")[0] || label;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The sentences of the forecast card, from the forecast alone: where the month is heading and how likely, against the target when there is
 * one, or that there is too little history to say (never a figure made up). The figures are an estimate and the words say so.
 */
export function forecastLines(f: OverviewForecast, money: (minor: number) => string, words: AnalyticsMessages = analyticsWords()): string[] {
  const w = words.overview.forecast;
  const { forecast: fc, targetMinor } = f;
  const month = monthName(f.monthLabel);
  if (fc.expectedMinor === null || fc.lowMinor === null || fc.highMinor === null) {
    const lines = [fillWords(w.tooLittle, { month })];
    if (fc.notes[0]) lines.push(fc.notes[0]);
    if (fc.soFarMinor > 0) lines.push(fillWords(w.soFarOnly, { amount: money(fc.soFarMinor) }));
    return lines;
  }
  const target = targetMinor !== null && targetMinor > 0 ? targetMinor : null;
  const onTrack = target !== null && fc.expectedMinor >= target * 0.97;
  const lines = [fillWords(onTrack ? w.onTrack : w.heading, { month: capital(month), amount: money(fc.expectedMinor), low: money(fc.lowMinor), high: money(fc.highMinor) })];
  if (target !== null) {
    const range = fc.lowMinor >= target ? w.lowReaches : fc.highMinor < target ? w.highShort : w.inside;
    lines.push(fillWords(w.share, { share: formatPercent(fc.expectedMinor / target, 0), target: money(target), range }));
  }
  lines.push(countText(w.soFar, fc.daysLeft, { amount: money(fc.soFarMinor) }, formatCount(fc.daysLeft)));
  return lines;
}

/** The factors of a change as bars: each one's own change, signed, with its share of the revenue change. */
export function factorRows(explanation: ChangeExplanation, words: AnalyticsMessages = analyticsWords()): BarRow[] {
  return explanation.factors.map((f) => ({
    key: f.key,
    label: f.label,
    value: f.changePct,
    valueText: formatSigned(f.changePct, 0),
    ...(f.sharePct === null ? {} : { detail: fillWords(words.overview.why.shareOfChange, { share: formatCount(f.sharePct) }) }),
  }));
}
