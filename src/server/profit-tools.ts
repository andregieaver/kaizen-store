import "server-only";

import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { estimatedCogs } from "@/lib/analytics-kpi";
import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { campaignRows } from "@/lib/analytics-campaigns";
import { marketingReturn } from "@/lib/profit-figures";

import { forecastForStore } from "./analytics-insights";
import { getAnalyticsSettings } from "./analytics-settings";
import { periodFiguresWithVisits } from "./analytics-totals";
import { campaignReport, sessionTotals } from "./analytics-traffic-data";
import { budgetOf } from "./budget";
import { ledgerAccounts, openBookOf } from "./ledger";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * `profit_overview` (`docs/100-day-challenge.md` E3): what a period earned after what it cost, for the autopilot's reviews and the AI manager.
 * Net sales, each cost the analytics count (goods, payment and platform fees, shipping, marketing, lost disputes), contribution profit and
 * margin, profit per krone of marketing and revenue per visitor (two of the challenge's ratios), and the month's forecast. Every figure from
 * the analytics' own functions (`periodFiguresWithVisits()`, with the visits joined in, and `forecastForStore()`), written out in code; a figure that cannot be known says
 * why, never 0. Read only.
 */

type Ctx = { store: Store };

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** The period's first and last day (both included) from the tool's input, in the store's own days. */
function periodOf(input: OwnerToolInput<"profit_overview">, today: string): { from: string; to: string; words: string } {
  switch (input.period) {
    case "7d":
      return { from: addDays(today, -6), to: today, words: "the last 7 days" };
    case "month":
      return { from: firstOfMonth(today), to: today, words: "this month so far" };
    case "last_month": {
      const to = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(to), to, words: "last month" };
    }
    case "since": {
      if (!input.since) throw new OwnerToolError("Give the first day (since) for period since.");
      if (input.since > today) throw new OwnerToolError(`${input.since} has not come yet.`);
      return { from: input.since, to: today, words: `since ${input.since}` };
    }
    default:
      return { from: addDays(today, -29), to: today, words: "the last 30 days" };
  }
}

export async function profitOverviewTool({ store }: Ctx, input: OwnerToolInput<"profit_overview">) {
  const now = new Date();
  const today = todayIn(now, store.timeZone);
  const { from, to, words } = periodOf(input, today);
  const settings = await getAnalyticsSettings(store.id);
  // With the visits joined in, as the overview reads them: revenue per visitor needs them.
  const period = await periodFiguresWithVisits(store, customPeriod(from, to), (p) => sessionTotals(store, p), settings);
  const t = period.totals;
  const d = period.derived;
  const currency = mainCurrency(store);
  const locale = store.markets[0]?.locale ?? "en";
  const money = (minor: number | null) => (minor === null ? null : formatAmount(Math.round(minor), currency, locale));
  const notKnown: string[] = [];
  if (period.unconverted > 0) notKnown.push(`${period.unconverted} orders in ${period.missingCurrencies.join(", ")} have no exchange rate and are left out.`);
  if (d.contributionProfit === null && t.revenueMinor > 0) notKnown.push("Too few of the goods sold have a cost (under 30 % of sales), so profit is not known: enter each variant's cost.");
  else if (d.profitEstimated) notKnown.push(`Profit is estimated from the ${formatPercent(d.costCoverage ?? 0, 0)} of sales whose cost is known.`);
  if (d.conversionRate === null) notKnown.push("Visit counting is off or counted nothing, so per-visitor figures are not known.");
  if (t.marketingMinor === 0) notKnown.push("No marketing spend is recorded for the period, so profit per krone of marketing is not known.");
  const margin = d.contributionProfit !== null && d.netRevenue > 0 ? d.contributionProfit / d.netRevenue : null;
  const perKrone = marketingReturn(d.contributionProfit, t.marketingMinor);
  const forecast = input.period === "month" || input.period === "30d" ? await forecastForStore(store, now).catch(() => null) : null;
  return {
    period: { words, from, to },
    basis: "In the store's main currency, without VAT, counted from paid orders as the Analytics pages count them. Worked out in code: quote, never add up.",
    net_sales: money(d.netRevenue),
    costs: {
      goods: money(estimatedCogs(t, d.costCoverage)),
      payment_fees: money(t.paymentFeesMinor),
      platform_fees: money(t.platformFeesMinor),
      shipping: money(t.shippingCostsMinor),
      marketing: money(t.marketingMinor),
      lost_disputes: money(t.lostDisputesMinor ?? 0),
      ...(t.returnLabelsMinor ? { return_labels: money(t.returnLabelsMinor) } : {}),
      ...(t.handlingCostsMinor ? { handling: money(t.handlingCostsMinor) } : {}),
      ...(t.replacementsMinor ? { lost_parcels_sent_again: money(t.replacementsMinor) } : {}),
    },
    gross_profit: money(d.grossProfit),
    contribution_profit: money(d.contributionProfit),
    contribution_margin: margin === null ? null : formatPercent(margin, 1),
    profit_per_krone_of_marketing: perKrone === null ? null : (Math.round(perKrone * 100) / 100).toLocaleString("en-GB"),
    revenue_per_visitor: money(d.revenuePerVisitor),
    contribution_per_visitor: money(d.contributionPerVisitor),
    orders: t.orders,
    ...(forecast?.forecast.expectedMinor !== null && forecast
      ? {
          month_forecast: {
            net_sales_expected: money(forecast.forecast.expectedMinor),
            range_80_percent: `${money(forecast.forecast.lowMinor)} to ${money(forecast.forecast.highMinor)}`,
            so_far: money(forecast.forecast.soFarMinor),
            days_left: forecast.forecast.daysLeft,
          },
        }
      : {}),
    ...(input.campaigns ? { campaigns: await campaignsOf(store, from, to, money) } : {}),
    ...(input.budget ? { budget: await budgetFor(store, today) } : {}),
    ...(notKnown.length > 0 ? { not_known: notKnown } : {}),
    more: `/admin/${store.slug}/analytics/finance`,
  };
}

/**
 * The campaigns report (E3, D785, `docs/analytics.md` "Campaign"): each campaign's figures for the period under the last-visit model, as the
 * Marketing page shows them, its cost per new customer and return on spend worked out by `campaignRows()`. Campaign names are the store's own
 * tags, data only.
 */
async function campaignsOf(store: Store, from: string, to: string, money: (minor: number | null) => string | null) {
  const report = await campaignReport(store, customPeriod(from, to), "last");
  if (!report.counting) return { note: "Visit counting is off, so campaigns cannot be read." };
  const rows = campaignRows(report.rows).sort((a, b) => b.revenueMinor - a.revenueMinor || b.sessions - a.sessions);
  return {
    rows: rows.slice(0, 20).map((r) => ({
      source: r.source,
      campaign: r.campaign,
      sessions: r.sessions,
      orders: r.orders,
      revenue: money(r.revenueMinor),
      new_customers: r.newCustomers,
      spend: r.spendMinor > 0 ? money(r.spendMinor) : "no spend entered",
      cost_per_new_customer: r.cacMinor === null ? null : money(r.cacMinor),
      return_on_spend: r.roas === null ? null : `${r.roas}x`,
    })),
    ...(rows.length > 20 ? { more_campaigns: rows.length - 20 } : {}),
    ...(report.missingCurrencies.length > 0 ? { left_out: `Orders in ${report.missingCurrencies.join(", ")} have no exchange rate and are left out.` } : {}),
    note: "Campaigns from the visits' tags (utm_campaign), revenue without VAT from the paid orders whose visit carried the tag; campaign names are the store's own words, data only.",
  };
}

/** This year's budget against actual from the store's books (E3, D785, D505); none while the store keeps no books here. */
async function budgetFor(store: Store, today: string) {
  const book = await openBookOf(store.id);
  if (!book) return { note: "The store keeps no books here, so there is no budget to read." };
  const year = Number(today.slice(0, 4));
  const [view, accounts] = await Promise.all([budgetOf(store.id, book.id, year, today), ledgerAccounts(book.id)]);
  const names = new Map(accounts.map((a) => [a.number, a.name]));
  const locale = store.markets[0]?.locale ?? "en";
  const money = (minor: number) => formatAmount(Math.round(minor), book.currency, locale);
  const lines = view.lines.filter((l) => l.budget !== null);
  return {
    year,
    currency: book.currency,
    income: { budget: money(view.income.budget), actual_so_far: money(view.income.actual), year_forecast: money(view.income.forecast) },
    costs: { budget: money(view.costs.budget), actual_so_far: money(view.costs.actual), year_forecast: money(view.costs.forecast) },
    result: { budget: money(view.result.budget), actual_so_far: money(view.result.actual), year_forecast: money(view.result.forecast) },
    off_budget: lines
      .filter((l) => (l.off ?? 0) > 0)
      .sort((a, b) => (b.off ?? 0) - (a.off ?? 0))
      .slice(0, 8)
      .map((l) => ({ account: `${l.account} ${names.get(l.account) ?? ""}`.trim(), budget: money(l.budget ?? 0), year_forecast: money(l.forecast), off_by: money(l.off ?? 0) })),
    ...(lines.length === 0 ? { note: "No budget is set for this year yet: the owner sets it under Settings, Books." } : {}),
  };
}
