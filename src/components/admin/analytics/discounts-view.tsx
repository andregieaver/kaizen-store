import { CREEP_MIN_ORDERS, CREEP_MONTHS, CREEP_RISE, MIN_MONTH_ORDERS } from "@/lib/analytics-discounts";
import { formatCount, formatMonth, formatPercent, formatPoints, NO_FIGURE } from "@/lib/analytics-core";
import { addDays, addMonths, startOfMonth } from "@/lib/analytics-period";
import type { CouponReportRow, DiscountsReport } from "@/server/analytics-discounts-data";

import { HorizontalBars, LineChart, type BarRow } from "./charts";
import { DataTable, StatusPill, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { moneyWriter } from "./overview-view";
import { AnalyticsSection, ChartCard, Note } from "./section";

/**
 * The Marketing page's discounts and coupons (D152, docs/analytics.md): how much of the business is sold at a discount, whether that is
 * creeping up month after month, how big the baskets are with and without one, which kinds of discount were given and what each code did.
 * Drawn from the report it is handed and nothing else (no data access, so it can be rendered on fixture data). A figure that cannot be
 * known is never drawn as zero: a store with no orders gets calm sentences, not a row of zeros.
 */

export type DiscountsViewProps = {
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  report: DiscountsReport;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

/** `2026-10` as "Oct 2026" (the one month label every analytics page uses); anything that is not a month as it came. */
export function monthText(month: string): string {
  return formatMonth(month);
}

/**
 * The trend's months one after the other, from the first of the window to the month the period ends in, so a month with no orders is a gap on
 * the axis and not a missing tick. The share is null for a month with too few orders (or none): a gap, never a zero.
 */
export function trendSeries(report: Pick<DiscountsReport, "trend" | "trendWindow">): { labels: string[]; values: (number | null)[]; partial: boolean } {
  const byMonth = new Map(report.trend.map((m) => [m.month, m]));
  const last = startOfMonth(addDays(report.trendWindow.to, -1));
  const labels: string[] = [];
  const values: (number | null)[] = [];
  let partial = false;
  for (let month = startOfMonth(report.trendWindow.from); month <= last && labels.length < 36; month = addMonths(month, 1)) {
    const entry = byMonth.get(month.slice(0, 7));
    labels.push(entry?.partial ? `${monthText(month)} (so far)` : monthText(month));
    values.push(entry ? entry.share : null);
    if (entry?.partial) partial = true;
  }
  return { labels, values, partial };
}

/** The sentence for a basket: how much smaller or larger the discounted baskets are than the full-price ones. */
export function basketWords(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const gap = Math.abs(1 - ratio);
  if (gap < 0.005) return "About the same size as at full price.";
  return `${formatPercent(gap, 0)} ${ratio < 1 ? "smaller" : "larger"} than a basket at full price.`;
}

const CODE_KIND: Record<string, string> = { percent: "Percent off", fixed: "Fixed amount off", free_shipping: "Free shipping" };

/** What kind of code it is, in words; a code that has since been deleted says so. */
export function codeKindText(kind: string | null): string {
  return kind === null ? "Deleted code" : (CODE_KIND[kind] ?? kind);
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** The four cards: how much is sold at a discount, how deep, and how big the baskets are with and without one. */
export function discountCards(report: DiscountsReport, money: (minor: number) => string): KpiCardProps[] {
  const s = report.summary;
  const noOrders = { text: "No paid orders in this period yet." };
  const dependencyHelp = "Discount dependency: the share of paid orders that had any discount (a campaign, a customer group, a bonus credit, a welcome discount or a code).";
  const dependency: KpiCardProps =
    s.dependency === null
      ? { label: "Orders with a discount", value: null, state: "missing", missing: noOrders, help: dependencyHelp }
      : {
          label: "Orders with a discount",
          value: formatPercent(s.dependency),
          emphasis: true,
          good: "down",
          help: dependencyHelp,
          hint: `${formatCount(s.discountedOrders)} of ${formatCount(s.orders)} paid ${s.orders === 1 ? "order" : "orders"}.`,
        };

  const average: KpiCardProps =
    s.orders === 0
      ? { label: "Average discount", value: null, state: "missing", missing: noOrders }
      : s.averageDiscountPct === null
        ? { label: "Average discount", value: null, state: "missing", missing: { text: "No order used a discount in this period." } }
        : {
            label: "Average discount",
            value: formatPercent(s.averageDiscountPct),
            help: "What discounted orders took off, as a share of the price of their goods before the discount.",
            hint: `${money(s.discountMinor)} taken off ${formatCount(s.discountedOrders)} discounted ${s.discountedOrders === 1 ? "order" : "orders"}.`,
          };

  const basket = (label: string, value: number | null, none: string, hint?: string | null): KpiCardProps =>
    s.orders === 0
      ? { label, value: null, state: "missing", missing: noOrders, help: "Average order value: revenue divided by orders." }
      : value === null
        ? { label, value: null, state: "missing", missing: { text: none }, help: "Average order value: revenue divided by orders." }
        : { label, value: money(value), help: "Average order value: revenue divided by orders.", hint: hint ?? undefined };

  return [
    dependency,
    average,
    basket("Basket with a discount", s.aovDiscountedMinor, "No order had a discount in this period.", basketWords(s.aovRatio)),
    basket("Basket at full price", s.aovFullPriceMinor, "Every order in this period had a discount."),
  ];
}

// ---------------------------------------------------------------------------
// The coupon table
// ---------------------------------------------------------------------------

/** The coupon table's columns. A free-shipping code takes nothing off goods, so its discount cells have no figure. */
export function couponColumns(money: (minor: number) => string): Column<CouponReportRow>[] {
  const noGoods = (c: CouponReportRow) => c.codeKind === "free_shipping";
  const none = <span title="A free-shipping code takes nothing off the goods">{NO_FIGURE}</span>;
  return [
    { key: "code", label: "Code", cell: (c) => <span className="font-mono">{c.code}</span> },
    { key: "kind", label: "Type", cell: (c) => codeKindText(c.codeKind) },
    {
      key: "status",
      label: "Status",
      cell: (c) => (c.active === null ? <StatusPill>Deleted</StatusPill> : c.active ? <StatusPill tone="good">On</StatusPill> : <StatusPill>Off</StatusPill>),
    },
    { key: "orders", label: "Orders", align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: "Revenue", align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "discount", label: "Taken off", align: "right", cell: (c) => (noGoods(c) ? none : money(c.discountMinor)) },
    { key: "pct", label: "Discount", align: "right", cell: (c) => (noGoods(c) || c.discountPct === null ? none : formatPercent(c.discountPct)) },
    { key: "perOrder", label: "Per order", align: "right", cell: (c) => (noGoods(c) || c.discountPerOrderMinor === null ? none : money(c.discountPerOrderMinor)) },
    { key: "aov", label: "Avg order", align: "right", cell: (c) => (c.aovMinor === null ? NO_FIGURE : money(c.aovMinor)) },
    { key: "share", label: "Share of code revenue", align: "right", cell: (c) => formatPercent(c.revenueShare) },
  ];
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function DiscountsView({ currency, locale, report }: DiscountsViewProps) {
  const money = moneyWriter(currency, locale);
  const s = report.summary;
  const cards = discountCards(report, money);
  const series = trendSeries(report);
  const creeping = s.creeping;
  const shareOf = (month: string | null) => (month === null ? null : (report.trend.find((m) => m.month === month)?.share ?? null));

  const kindRows: BarRow[] = report.breakdown.kinds
    .filter((k) => k.discountMinor > 0)
    .map((k, i) => ({
      key: k.kind,
      label: k.label,
      value: k.discountMinor,
      valueText: money(k.discountMinor),
      detail: `${formatCount(k.orders)} ${k.orders === 1 ? "order" : "orders"}${k.share === null ? "" : ` · ${formatPercent(k.share, 0)}`}`,
      colorIndex: i,
    }));

  const codeColumns = couponColumns(money);
  const hasFreeShipping = report.coupons.some((c) => c.codeKind === "free_shipping");

  return (
    <AnalyticsSection
      id="discounts"
      title="Discounts and coupons"
      description="How much of your business is sold at a discount, whether that is growing, and what each discount code did. A discount is not bad in itself, but customers who learn to wait for one stop paying full price."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>

      {creeping.creeping ? (
        <Note tone="warning" title="Discounts are creeping up">
          {`The share of orders with a discount has risen ${creeping.risingMonths} months in a row, from ${formatPercent(shareOf(creeping.from), 0)} in ${creeping.from ? monthText(creeping.from) : NO_FIGURE} to ${formatPercent(shareOf(creeping.to), 0)} in ${creeping.to ? monthText(creeping.to) : NO_FIGURE}${creeping.rise === null ? "" : ` (${formatPoints(creeping.rise * 100)})`}. Look at which kind of discount is growing below.`}
        </Note>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Orders with a discount, by month"
          description={`The last 12 months. A month needs at least ${MIN_MONTH_ORDERS} paid orders to show.`}
        >
          <LineChart
            label="Share of paid orders with a discount, by month, last 12 months"
            labels={series.labels}
            series={[{ key: "share", label: "Orders with a discount", values: series.values }]}
            format={(v) => formatPercent(v, 1)}
            axisFormat={(v) => formatPercent(v, 0)}
            height={220}
            emptyText={`Not enough orders yet to show a trend: a month needs at least ${MIN_MONTH_ORDERS} paid orders.`}
          />
          <p className="mt-2 text-xs text-muted">
            {`You get a warning if the share rises ${CREEP_MONTHS} months in a row by ${Math.round(CREEP_RISE * 100)} points or more, the first and last of those months each have at least ${CREEP_MIN_ORDERS} orders, and the rise is too big to be chance.${series.partial ? " The month in progress is shown but not counted." : ""}`}
          </p>
        </ChartCard>

        <ChartCard
          title="What was taken off, by kind"
          description={s.orders === 0 ? undefined : `${money(report.breakdown.totalMinor)} in all, without VAT.`}
        >
          <HorizontalBars
            label="Discount given by kind"
            rows={kindRows}
            emptyText={s.orders === 0 ? "No paid orders in this period yet." : "No discounts were given in this period."}
          />
          {kindRows.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              An order can have more than one kind, so the order counts can add up to more than the orders with a discount.
              {report.breakdown.roundingMinor !== 0 ? ` The kinds differ from the total by ${money(Math.abs(report.breakdown.roundingMinor))} because of rounding.` : ""}
            </p>
          ) : null}
        </ChartCard>
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-semibold">Discount codes</h3>
        <DataTable
          caption="Discount codes used in the period"
          columns={codeColumns}
          rows={report.coupons}
          rowKey={(c) => c.code}
          empty="No discount code was used in this period."
        />
        <p className="text-xs text-muted">
          {report.couponCount > report.coupons.length
            ? `Showing the ${formatCount(report.coupons.length)} codes with most revenue of ${formatCount(report.couponCount)} used. `
            : ""}
          Revenue is what the orders that used the code brought in, without VAT. {hasFreeShipping ? "A free-shipping code takes nothing off the goods; the shipping it gives away is not counted here." : ""}
        </p>
      </div>

      {report.notes.length > 0 ? (
        <div className="space-y-2">
          {report.notes.map((n) => (
            <Note key={n}>{n}</Note>
          ))}
        </div>
      ) : null}
    </AnalyticsSection>
  );
}
