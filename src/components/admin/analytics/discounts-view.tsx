import { CREEP_MIN_ORDERS, CREEP_MONTHS, CREEP_RISE, MIN_MONTH_ORDERS } from "@/lib/analytics-discounts";
import { formatCount, formatMonth, formatPercent, formatPoints, NO_FIGURE } from "@/lib/analytics-core";
import { addDays, addMonths, startOfMonth } from "@/lib/analytics-period";
import type { CouponReportRow, DiscountsReport } from "@/server/analytics-discounts-data";
import { countWords, fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";

/** The words of this view (D312 A9), English unless given. */
export type DiscountsWords = ReportsMessages["discounts"];

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
  /** The words, in the account's language (D312 A9); English unless given. */
  words?: DiscountsWords;
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
export function trendSeries(report: Pick<DiscountsReport, "trend" | "trendWindow">, w: DiscountsWords = reportsEn.discounts): { labels: string[]; values: (number | null)[]; partial: boolean } {
  const months = trendMonths(report, w);
  return { labels: months.map((m) => m.label), values: months.map((m) => m.share), partial: months.some((m) => m.partial) };
}

/** The same months with their first day (`2026-10-01`), for the CSV: the chart's x axis, one entry for every month of the window. */
export function trendMonths(report: Pick<DiscountsReport, "trend" | "trendWindow">, w: DiscountsWords = reportsEn.discounts): { start: string; label: string; share: number | null; partial: boolean }[] {
  const byMonth = new Map(report.trend.map((m) => [m.month, m]));
  const last = startOfMonth(addDays(report.trendWindow.to, -1));
  const out: { start: string; label: string; share: number | null; partial: boolean }[] = [];
  for (let month = startOfMonth(report.trendWindow.from); month <= last && out.length < 36; month = addMonths(month, 1)) {
    const entry = byMonth.get(month.slice(0, 7));
    out.push({ start: month, label: entry?.partial ? fillWords(w.soFar, { month: monthText(month) }) : monthText(month), share: entry ? entry.share : null, partial: entry?.partial === true });
  }
  return out;
}

/** The sentence for a basket: how much smaller or larger the discounted baskets are than the full-price ones. */
export function basketWords(ratio: number | null, w: DiscountsWords = reportsEn.discounts): string | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const gap = Math.abs(1 - ratio);
  if (gap < 0.005) return w.basketSame;
  return fillWords(ratio < 1 ? w.basketSmaller : w.basketLarger, { pct: formatPercent(gap, 0) });
}

/** What kind of code it is, in words; a code that has since been deleted says so. */
export function codeKindText(kind: string | null, w: DiscountsWords = reportsEn.discounts): string {
  return kind === null ? w.deletedCode : (w.codeKinds[kind] ?? kind);
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** The four cards: how much is sold at a discount, how deep, and how big the baskets are with and without one. */
export function discountCards(report: DiscountsReport, money: (minor: number) => string, w: DiscountsWords = reportsEn.discounts): KpiCardProps[] {
  const s = report.summary;
  const noOrders = { text: w.noOrders };
  const dependencyHelp = w.dependencyHelp;
  const dependency: KpiCardProps =
    s.dependency === null
      ? { label: w.withDiscount, value: null, state: "missing", missing: noOrders, help: dependencyHelp }
      : {
          label: w.withDiscount,
          value: formatPercent(s.dependency),
          emphasis: true,
          good: "down",
          help: dependencyHelp,
          hint: countWords(s.orders, w.dependencyHint, { n: formatCount(s.orders), discounted: formatCount(s.discountedOrders) }),
        };

  const average: KpiCardProps =
    s.orders === 0
      ? { label: w.averageDiscount, value: null, state: "missing", missing: noOrders }
      : s.averageDiscountPct === null
        ? { label: w.averageDiscount, value: null, state: "missing", missing: { text: w.noDiscountUsed } }
        : {
            label: w.averageDiscount,
            value: formatPercent(s.averageDiscountPct),
            help: w.averageHelp,
            hint: countWords(s.discountedOrders, w.averageHint, { n: formatCount(s.discountedOrders), amount: money(s.discountMinor) }),
          };

  const basket = (label: string, value: number | null, none: string, hint?: string | null): KpiCardProps =>
    s.orders === 0
      ? { label, value: null, state: "missing", missing: noOrders, help: w.aovHelp }
      : value === null
        ? { label, value: null, state: "missing", missing: { text: none }, help: w.aovHelp }
        : { label, value: money(value), help: w.aovHelp, hint: hint ?? undefined };

  return [
    dependency,
    average,
    basket(w.basketWith, s.aovDiscountedMinor, w.noneHadDiscount, basketWords(s.aovRatio, w)),
    basket(w.basketFull, s.aovFullPriceMinor, w.allHadDiscount),
  ];
}

// ---------------------------------------------------------------------------
// The coupon table
// ---------------------------------------------------------------------------

/** The coupon table's columns. A free-shipping code takes nothing off goods, so its discount cells have no figure. */
export function couponColumns(money: (minor: number) => string, w: DiscountsWords = reportsEn.discounts): Column<CouponReportRow>[] {
  const l = w.columns;
  const noGoods = (c: CouponReportRow) => c.codeKind === "free_shipping";
  const none = <span title={w.freeShippingNone}>{NO_FIGURE}</span>;
  return [
    { key: "code", label: l.code, cell: (c) => <span className="font-mono">{c.code}</span> },
    { key: "kind", label: l.kind, cell: (c) => codeKindText(c.codeKind, w) },
    {
      key: "status",
      label: l.status,
      cell: (c) => (c.active === null ? <StatusPill>{w.deleted}</StatusPill> : c.active ? <StatusPill tone="good">{w.on}</StatusPill> : <StatusPill>{w.off}</StatusPill>),
    },
    { key: "orders", label: l.orders, align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: l.revenue, align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "discount", label: l.discount, align: "right", cell: (c) => (noGoods(c) ? none : money(c.discountMinor)) },
    { key: "pct", label: l.pct, align: "right", cell: (c) => (noGoods(c) || c.discountPct === null ? none : formatPercent(c.discountPct)) },
    { key: "perOrder", label: l.perOrder, align: "right", cell: (c) => (noGoods(c) || c.discountPerOrderMinor === null ? none : money(c.discountPerOrderMinor)) },
    { key: "aov", label: l.aov, align: "right", cell: (c) => (c.aovMinor === null ? NO_FIGURE : money(c.aovMinor)) },
    { key: "share", label: l.share, align: "right", cell: (c) => formatPercent(c.revenueShare) },
  ];
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function DiscountsView({ currency, locale, report, words: w = reportsEn.discounts }: DiscountsViewProps) {
  const money = moneyWriter(currency, locale);
  const s = report.summary;
  const cards = discountCards(report, money, w);
  const series = trendSeries(report, w);
  const creeping = s.creeping;
  const shareOf = (month: string | null) => (month === null ? null : (report.trend.find((m) => m.month === month)?.share ?? null));

  const kindRows: BarRow[] = report.breakdown.kinds
    .filter((k) => k.discountMinor > 0)
    .map((k, i) => ({
      key: k.kind,
      label: w.kindLabels[k.kind] ?? k.label,
      value: k.discountMinor,
      valueText: money(k.discountMinor),
      detail: `${countWords(k.orders, w.kindOrders, { n: formatCount(k.orders) })}${k.share === null ? "" : ` · ${formatPercent(k.share, 0)}`}`,
      colorIndex: i,
    }));

  const codeColumns = couponColumns(money, w);
  const hasFreeShipping = report.coupons.some((c) => c.codeKind === "free_shipping");

  return (
    <AnalyticsSection
      id="discounts"
      title={w.title}
      description={w.description}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>

      {creeping.creeping ? (
        <Note tone="warning" title={w.creepTitle}>
          {fillWords(w.creepText, {
            months: creeping.risingMonths,
            from: formatPercent(shareOf(creeping.from), 0),
            fromMonth: creeping.from ? monthText(creeping.from) : NO_FIGURE,
            to: formatPercent(shareOf(creeping.to), 0),
            toMonth: creeping.to ? monthText(creeping.to) : NO_FIGURE,
            rise: creeping.rise === null ? "" : ` (${formatPoints(creeping.rise * 100)})`,
          })}
        </Note>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={w.trendTitle}
          description={fillWords(w.trendDescription, { min: MIN_MONTH_ORDERS })}
        >
          <LineChart
            label={w.trendLabel}
            labels={series.labels}
            series={[{ key: "share", label: w.withDiscount, values: series.values }]}
            format={(v) => formatPercent(v, 1)}
            axisFormat={(v) => formatPercent(v, 0)}
            height={220}
            emptyText={fillWords(w.trendEmpty, { min: MIN_MONTH_ORDERS })}
            exportId="marketing.discount_share"
            exportLeftOut={{ orders: report.unconverted, currencies: report.missingRates }}
          />
          <p className="mt-2 text-xs text-muted">
            {`${fillWords(w.creepRule, { months: CREEP_MONTHS, points: Math.round(CREEP_RISE * 100), orders: CREEP_MIN_ORDERS })}${series.partial ? w.partialMonth : ""}`}
          </p>
        </ChartCard>

        <ChartCard
          title={w.kindsTitle}
          description={s.orders === 0 ? undefined : fillWords(w.kindsTotal, { amount: money(report.breakdown.totalMinor) })}
        >
          <HorizontalBars
            label={w.kindsLabel}
            rows={kindRows}
            emptyText={s.orders === 0 ? w.noOrders : w.noneGiven}
            exportId="marketing.discount_by_kind"
            exportLeftOut={{ orders: report.unconverted, currencies: report.missingRates }}
          />
          {kindRows.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {w.kindsOverlap}
              {report.breakdown.roundingMinor !== 0 ? fillWords(w.rounding, { amount: money(Math.abs(report.breakdown.roundingMinor)) }) : ""}
            </p>
          ) : null}
        </ChartCard>
      </div>

      <div className="space-y-2">
        <h3 className="text-body-strong text-ink">{w.codesTitle}</h3>
        <DataTable
          caption={w.codesCaption}
          columns={codeColumns}
          rows={report.coupons}
          rowKey={(c) => c.code}
          empty={w.codesEmpty}
          exportId="marketing.discount_codes"
          exportLeftOut={{ orders: report.unconverted, currencies: report.missingRates }}
        />
        <p className="text-xs text-muted">
          {report.couponCount > report.coupons.length
            ? fillWords(w.codesShowing, { shown: formatCount(report.coupons.length), total: formatCount(report.couponCount) })
            : ""}
          {w.codesRevenue}
          {hasFreeShipping ? w.codesFreeShipping : ""}
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
