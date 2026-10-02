import "server-only";

import { formatPercent, formatSigned, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { addDays, parseAnalyticsParams, type AnalyticsPeriod } from "@/lib/analytics-period";
import { costModeOf, ESTIMATE_MIN_COVERAGE, estimateText, formatKpi, kpiChange, kpiMissing, kpiValue, KPI_CARDS } from "@/lib/analytics-kpi";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { alertsForStore, diagnosisFor } from "./analytics-insights";
import { overviewData } from "./analytics-totals";
import { sessionTotals } from "./analytics-traffic-data";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's read-only analytics tools (D152): the same figures, alerts and explanations the Analytics pages show, from the same
 * functions, written out here in the store's own format. Nothing is worked out by the model and nothing is changed: no tool here
 * sends, publishes or spends, so none is gated. Served to Kaizen Life's assistant through the store's MCP server like every owner tool.
 */

type Ctx = { store: Store };

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

/** A period as the model is told it: its words and its first and last day (inclusive). */
const periodWords = (p: AnalyticsPeriod) => ({ label: p.label, from: p.from, to: addDays(p.to, -1) });

/** What the figures are, said once so the model repeats it. */
const BASIS = "Amounts are in the store's main currency, without VAT, counted from paid orders. Refunds made only in Stripe's dashboard are not seen.";

/**
 * The store's figures for a period with their changes (`overviewData()`'s own cards), what is missing for the rest and where to add it.
 * A figure that cannot be known is `null` with its reason: never 0.
 */
export async function analyticsOverviewTool({ store }: Ctx, { period, compare }: OwnerToolInput<"analytics_overview">) {
  const now = new Date();
  const data = await overviewData(store, { period, compare }, now, { sessions: (p) => sessionTotals(store, p) });
  const against = compare === "year" ? data.lastYear : data.previous;
  const locale = mainLocale(store);
  const { current } = data;
  const t = current.totals;

  // With no orders at all there is no profit to speak of (the figure would be a zero that means "nothing sold"): as the page says.
  const sold = t.orders > 0 || t.revenueMinor !== 0 || t.refundsMinor !== 0;
  const figures = KPI_CARDS.map((card) => {
    if (!sold && (card.id === "grossProfit" || card.id === "grossMargin")) {
      return { figure: card.label, value: NO_FIGURE, not_known: "No orders were paid in this period, so there is no profit to show.", more: adminLink(store, `/analytics/${card.page}`) };
    }
    const value = kpiValue(card, current.derived);
    const missing = kpiMissing(card, current.derived);
    const before = kpiValue(card, against.derived);
    const change = value === null ? null : kpiChange(card, value, before);
    return {
      figure: card.label,
      value: formatKpi(card, value, data.currency, locale),
      ...(value === null && missing ? { not_known: missing.text, ...(missing.fixPage ? { where_to_fix: adminLink(store, `/analytics/${missing.fixPage}`) } : {}) } : {}),
      ...(change && change.abs !== null ? { change: change.text, was: formatKpi(card, before, data.currency, locale) } : {}),
      more: adminLink(store, `/analytics/${card.page}`),
    };
  });

  const missing: { what: string; how_to_fix: string; where: string }[] = [];
  const coverage = current.derived.costCoverage;
  if (t.revenueMinor > 0 && (coverage ?? 0) <= 0) {
    missing.push({ what: "Product costs are not entered, so profit and margin cannot be shown.", how_to_fix: "Enter what each variant costs in the product editor, or in bulk under Analytics settings.", where: adminLink(store, "/analytics/settings") });
  } else if (coverage !== null && coverage < ESTIMATE_MIN_COVERAGE) {
    missing.push({ what: `Product costs are known for only ${formatPercent(coverage, 0)} of sales, too few to estimate profit from, so gross, contribution and operating profit are not shown (the margin is for those sales only).`, how_to_fix: "Enter the costs still missing in the product editor.", where: adminLink(store, "/products") });
  } else if (coverage !== null && coverage < 1) {
    missing.push({ what: `Profit figures are estimated from the ${formatPercent(coverage, 0)} of sales whose cost is known (the cost of goods is scaled up to all sales); the margin is for those sales only.`, how_to_fix: "Enter the costs still missing in the product editor to make them exact.", where: adminLink(store, "/products") });
  }
  if (!store.visitCounting) {
    missing.push({ what: "Visit counting is off, so visits, conversion and revenue per visit are not known.", how_to_fix: "An owner can switch it on in Analytics settings. It sets no cookies and counts only from the day it is switched on.", where: adminLink(store, "/analytics/settings") });
  }
  if (t.revenueMinor > 0 && !data.settings.saved) {
    missing.push({ what: "Payment fees, shipping costs and fixed costs are not entered, so they count as nothing and profit may look better than it is.", how_to_fix: "An owner can enter them in Analytics settings.", where: adminLink(store, "/analytics/settings") });
  }

  return {
    period: periodWords(data.params.period),
    compared_with: { ...periodWords(compare === "year" ? data.lastYear.period : data.previous.period), how: compare === "year" ? "the same dates a year earlier" : "the period just before" },
    currency: data.currency,
    figures,
    cost_coverage: {
      share: current.derived.costCoverage === null ? null : formatPercent(current.derived.costCoverage, 0),
      words: data.costCoverageText,
      // Exact at 100 %, estimated from 30 %, not shown below it (docs/analytics.md, "Gross profit"); margin is for the covered sales only.
      profit: { basis: costModeOf(current.derived.costCoverage) === "missing" ? "not shown" : costModeOf(current.derived.costCoverage), ...(estimateText(current.derived.costCoverage) ? { estimated: estimateText(current.derived.costCoverage) } : {}) },
    },
    ...(missing.length > 0 ? { missing } : {}),
    notes: [BASIS, ...data.notes],
  };
}

/** Why revenue changed (`diagnosisFor()`): the factors, the movers, when it began and where to look, in the diagnosis's own sentences. */
export async function explainChangeTool({ store }: Ctx, { period, compare }: OwnerToolInput<"explain_change">) {
  const now = new Date();
  const diagnosis = await diagnosisFor(store, parseAnalyticsParams({ period, compare }, { now, timeZone: store.timeZone }), now);
  if (!diagnosis) throw new OwnerToolError("The change could not be worked out right now. Try again in a moment.");
  const { explanation: e } = diagnosis;
  const money = (minor: number) => formatAmount(Math.round(minor), diagnosis.currency, mainLocale(store));
  const signed = (minor: number) => `${minor < 0 ? MINUS : "+"}${money(Math.abs(minor))}`;
  return {
    period: periodWords(diagnosis.period),
    compared_with: periodWords(diagnosis.comparedWith),
    basis: `${diagnosis.basis}, in ${diagnosis.currency}.`,
    direction: e.direction,
    change: signed(e.changeMinor),
    change_percent: e.changePct === null ? null : formatSigned(e.changePct, 1),
    ...(e.reason ? { reason: e.reason } : {}),
    factors: e.factors.map((f) => ({ factor: f.label, its_own_change: formatSigned(f.changePct, 0), ...(f.sharePct === null ? {} : { share_of_the_change: `${f.sharePct} %` }) })),
    ...(e.mainFactor ? { main_factor: e.factors.find((f) => f.key === e.mainFactor)?.label } : {}),
    biggest_movers: e.segments.map((s) => ({ where: `${s.label} (${s.dimension})`, change: signed(s.changeMinor), share_of_the_change: `${s.shareOfChangePct} %` })),
    ...(e.startedOn ? { began_on: e.startedOn } : {}),
    sentences: e.sentences,
    ...(e.lookAt ? { where_to_look: { words: e.lookAt.text, page: adminLink(store, e.lookAt.href) } } : {}),
    notes: [...(e.note ? [e.note] : []), ...diagnosis.notes],
  };
}

/** What needs a look (`alertsForStore()`), most pressing first, each with its figures and the page to open. */
export async function analyticsAlertsTool({ store }: Ctx) {
  const alerts = await alertsForStore(store, new Date());
  return {
    count: alerts.length,
    alerts: alerts.map((a) => ({
      severity: a.severity,
      text: a.text,
      figures: a.evidence.map((e) => `${e.label}: ${e.value}${e.baseline ? ` (against ${e.baseline})` : ""}`),
      page: adminLink(store, a.href),
      action: a.action,
    })),
    note: alerts.length === 0 ? "No rule raised an alert from the figures that could be read: nothing needs a look in the analytics right now." : "Each rule has a minimum volume, so small numbers raise nothing.",
  };
}
