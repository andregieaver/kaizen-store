import { formatCount, formatDate, formatPercent, formatSigned } from "@/lib/analytics-core";
import type { ChangeExplanation } from "@/lib/analytics-diagnosis";
import type { MonthForecast } from "@/lib/analytics-forecast";
import { costsKnown, estimateText, kpiChange } from "@/lib/analytics-kpi";
import { formatAmount, formatTimes } from "@/lib/analytics-format";
import type { TargetProgress } from "@/lib/analytics-targets";
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
};

/** This month's forecast (`forecastForStore()`), for the card under the target. */
export type OverviewForecast = {
  /** "October 2026". */
  monthLabel: string;
  forecast: MonthForecast;
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
export function moneyLines(data: OverviewHead, money: (minor: number) => string): string[] {
  const { current, params } = data;
  const t = current.totals;
  const d = current.derived;
  if (noSales(current)) return ["No orders were paid in this period yet. Once they are, this is where you see whether the store is making money."];

  const against = params.compare.mode === "year" ? data.lastYear : params.compare.mode === "previous" ? data.previous : null;
  const againstWords = params.compare.mode === "year" ? "the same period last year" : "the previous period";
  let first = `${formatCount(t.orders)} paid ${plural(t.orders, "order", "orders")} brought in ${money(d.netRevenue)} after refunds`;
  if (against && !noSales(against)) {
    const delta = kpiChange({ kind: "money", good: "up" }, d.netRevenue, against.derived.netRevenue);
    const pct = delta.abs === null ? null : against.derived.netRevenue === 0 ? null : delta.abs / Math.abs(against.derived.netRevenue);
    if (pct !== null && Math.abs(pct) >= 0.0005) first += `, ${pct > 0 ? "up" : "down"} ${formatPercent(Math.abs(pct))} on ${againstWords}`;
  }
  const lines = [`${first}.`];

  const profit = d.contributionProfit;
  if (profit === null) {
    lines.push(
      d.costCoverage !== null && d.costCoverage > 0
        ? `Product costs are known for only ${formatPercent(d.costCoverage, 0)} of sales, too few to estimate profit from. Add what the rest cost to see how much of this is yours to keep.`
        : "Your products have no cost entered, so profit cannot be shown. Add what they cost to see how much of this is yours to keep.",
    );
  } else {
    // An estimate says so: "estimated from the 45 % of sales whose cost is known"; exact profit is based on all sales.
    const coverage = estimateText(d.costCoverage) ?? data.costCoverageText;
    lines.push(
      profit >= 0
        ? `After the cost of goods, fees, shipping and ad spend, about ${money(profit)} is left (${coverage}).`
        : `After the cost of goods, fees, shipping and ad spend, the store is about ${money(-profit)} short (${coverage}).`,
    );
  }
  return lines;
}

/** The words under a month's target meter, from the progress alone. Amounts and the estimate say it; the meter carries the pace word. */
export function targetLines(p: TargetProgress, money: (minor: number) => string): string[] {
  if (p.targetMinor === null) return [];
  const lines: string[] = [];
  if (p.actualMinor >= p.targetMinor) lines.push("The target is reached.");
  if (p.tooEarly) {
    lines.push("It is early in the month, so there is no verdict on the pace yet.");
  } else {
    if (p.expectedByTodayMinor !== null && p.aheadByMinor !== null) {
      lines.push(
        p.aheadByMinor >= 0
          ? `${money(p.aheadByMinor)} more than the ${money(p.expectedByTodayMinor)} expected by today.`
          : `${money(-p.aheadByMinor)} less than the ${money(p.expectedByTodayMinor)} expected by today.`,
      );
    }
    if (p.projectedMinor !== null && p.projectedPct !== null) {
      lines.push(`If the pace holds, the month ends at about ${money(p.projectedMinor)}, ${formatPercent(p.projectedPct, 0)} of the target. That is an estimate.`);
    }
  }
  if (p.daysLeft > 0) lines.push(`${formatCount(p.daysLeft)} ${plural(p.daysLeft, "day", "days")} left this month.`);
  lines.push(p.weekdayWeighted ? "Expected by today follows your usual busy and quiet weekdays." : "Expected by today counts every day alike: there is not enough history for a weekday pattern yet.");
  return lines;
}

/** The month's name in a month label: "October 2026" is "October". */
const monthName = (label: string) => label.split(" ")[0] || label;

/**
 * The sentences of the forecast card, from the forecast alone: where the month is heading and how likely, against the target when there is
 * one, or that there is too little history to say (never a figure made up). The figures are an estimate and the words say so.
 */
export function forecastLines(f: OverviewForecast, money: (minor: number) => string): string[] {
  const { forecast: fc, targetMinor } = f;
  const month = monthName(f.monthLabel);
  if (fc.expectedMinor === null || fc.lowMinor === null || fc.highMinor === null) {
    const lines = [`There is too little history to forecast ${month} yet.`];
    if (fc.notes[0]) lines.push(fc.notes[0]);
    if (fc.soFarMinor > 0) lines.push(`So far this month: ${money(fc.soFarMinor)} in net revenue.`);
    return lines;
  }
  const target = targetMinor !== null && targetMinor > 0 ? targetMinor : null;
  const onTrack = target !== null && fc.expectedMinor >= target * 0.97;
  const lines = [`${month} is ${onTrack ? "on track" : "heading"} for about ${money(fc.expectedMinor)}, likely ${money(fc.lowMinor)} to ${money(fc.highMinor)} (an estimate).`];
  if (target !== null) {
    const range = fc.lowMinor >= target ? "Even the low end of the range reaches the target." : fc.highMinor < target ? "Even the high end of the range falls short of the target." : "The target is inside the range.";
    lines.push(`That is ${formatPercent(fc.expectedMinor / target, 0)} of the ${money(target)} target. ${range}`);
  }
  lines.push(`So far: ${money(fc.soFarMinor)} in net revenue, with ${formatCount(fc.daysLeft)} ${plural(fc.daysLeft, "day", "days")} still to come.`);
  return lines;
}

/** The factors of a change as bars: each one's own change, signed, with its share of the revenue change. */
export function factorRows(explanation: ChangeExplanation): BarRow[] {
  return explanation.factors.map((f) => ({
    key: f.key,
    label: f.label,
    value: f.changePct,
    valueText: formatSigned(f.changePct, 0),
    ...(f.sharePct === null ? {} : { detail: `${formatCount(f.sharePct)} % of the change` }),
  }));
}
