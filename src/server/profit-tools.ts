import "server-only";

import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { derive, estimatedCogs } from "@/lib/analytics-kpi";
import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { marketingReturn } from "@/lib/profit-figures";

import { forecastForStore } from "./analytics-insights";
import { getAnalyticsSettings } from "./analytics-settings";
import { periodTotals } from "./analytics-totals";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * `profit_overview` (`docs/100-day-challenge.md` E3): what a period earned after what it cost, for the autopilot's reviews and the AI manager.
 * Net sales, each cost the analytics count (goods, payment and platform fees, shipping, marketing, lost disputes), contribution profit and
 * margin, profit per krone of marketing and revenue per visitor (two of the challenge's ratios), and the month's forecast. Every figure from
 * the analytics' own functions (`periodTotals()`, `derive()`, `forecastForStore()`), written out in code; a figure that cannot be known says
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
  const period = await periodTotals(store, customPeriod(from, to), settings);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const t = period.totals;
  const d = derive(t, settings, days);
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
    ...(notKnown.length > 0 ? { not_known: notKnown } : {}),
    more: `/admin/${store.slug}/analytics/finance`,
  };
}
