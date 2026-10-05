import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import type { RefundsReport } from "@/server/analytics-refunds-data";

import { HorizontalBars, type BarRow } from "./charts";
import { DataTable, ShareBar, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * The refunds section of the Traffic page (D152, docs/analytics.md): how much was given back, why, for which products, to which kind of
 * customer and in which market. Drawn from the report object and nothing else. The report counts only refunds made from Kaizen's own
 * admin, and says so in a note that is always shown: a quiet refund rate must never read as "no refunds".
 */

export type RefundsViewProps = {
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  report: RefundsReport;
  /** Market codes to names, for the table by market; a code without a name is shown as it is. */
  marketNames?: Readonly<Record<string, string>>;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const HELP = {
  refunded: "Money paid back to shoppers in this period, without VAT, dated by the day of the refund (not the day of the order).",
  rate: "Refund rate: money refunded in the period divided by the revenue of the period, both without VAT.",
  orders: "Of the paid orders placed in this period, the share that has had a refund so far. It keeps growing while refunds for these orders arrive.",
};

/** The four cards: how much, as a share of sales, how many orders, how many refunds. */
export function refundCards({ currency, locale, report: r }: RefundsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const refundsWord = plural(r.refunds, "refund", "refunds");
  return [
    {
      label: "Refunded",
      value: money(r.refundsMinor),
      emphasis: true,
      good: "down",
      help: HELP.refunded,
      hint: r.refunds === 0 ? "No refund was made from Kaizen in this period." : `${formatCount(r.refunds)} ${refundsWord} for ${formatCount(r.refundedOrders)} ${plural(r.refundedOrders, "order", "orders")}.`,
    },
    r.refundRate === null
      ? { label: "Refund rate", value: null, state: "missing", missing: { text: "There was no revenue in this period, so there is nothing to compare refunds with." }, help: HELP.rate }
      : { label: "Refund rate", value: formatPercent(r.refundRate), good: "down", help: HELP.rate, hint: `${money(r.refundsMinor)} refunded out of ${money(r.revenueMinor)} of revenue.` },
    r.cohort.share === null
      ? { label: "Orders with a refund", value: null, state: "missing", missing: { text: "No order was paid in this period." }, help: HELP.orders }
      : {
          label: "Orders with a refund",
          value: formatPercent(r.cohort.share),
          good: "down",
          help: HELP.orders,
          hint: `${formatCount(r.cohort.refundedOrders)} of ${formatCount(r.cohort.orders)} orders placed in this period, so far.`,
        },
  ];
}

export const marketName = (names: RefundsViewProps["marketNames"], code: string) => names?.[code] ?? names?.[code.toUpperCase()] ?? code;

export function RefundsView(props: RefundsViewProps) {
  const { currency, locale, report: r, marketNames } = props;
  const money = safeMoney(currency, locale);
  const none = r.refunds === 0;

  const reasonRows: BarRow[] = r.reasons.map((x) => ({
    key: x.reason === "" ? "none" : x.reason,
    label: x.label,
    value: x.valueMinor,
    valueText: money(x.valueMinor),
    detail: `${formatCount(x.refunds)} ${plural(x.refunds, "refund", "refunds")}${x.share === null ? "" : `, ${formatPercent(x.share)}`}`,
  }));
  if (r.other.reasons > 0) {
    reasonRows.push({
      key: "other",
      label: `${formatCount(r.other.reasons)} other ${plural(r.other.reasons, "reason", "reasons")}`,
      value: r.other.valueMinor,
      valueText: money(r.other.valueMinor),
      detail: `${formatCount(r.other.refunds)} ${plural(r.other.refunds, "refund", "refunds")}`,
      colorIndex: 99,
    });
  }

  const productColumns: Column<RefundsReport["products"][number]>[] = [
    { key: "product", label: "Product", cell: (p) => <span title={p.name}>{p.name}</span> },
    { key: "value", label: "Refunded", align: "right", cell: (p) => money(p.valueMinor) },
    { key: "share", label: "Share of refunds", align: "right", cell: (p) => <ShareBar share={p.share} text={formatPercent(p.share)} label="Share of the period's refunds" /> },
    { key: "refunds", label: "Refunds", align: "right", cell: (p) => formatCount(p.refunds) },
    {
      key: "restocked",
      label: "Back in stock",
      align: "right",
      cell: (p) => (p.productId === null ? <span title="Not a product with stock">{NO_FIGURE}</span> : <span title="Units staff put back into stock when refunding">{formatCount(p.restockedUnits)}</span>),
    },
  ];

  const segmentColumns: Column<RefundsReport["segments"][number]>[] = [
    { key: "segment", label: "Customer", cell: (s) => s.label },
    { key: "value", label: "Refunded", align: "right", cell: (s) => money(s.valueMinor) },
    { key: "share", label: "Share of refunds", align: "right", cell: (s) => <ShareBar share={s.share} text={formatPercent(s.share)} /> },
    { key: "refunds", label: "Refunds", align: "right", cell: (s) => formatCount(s.refunds) },
    { key: "orders", label: "Orders", align: "right", cell: (s) => formatCount(s.orders) },
  ];

  const marketColumns: Column<RefundsReport["markets"][number]>[] = [
    { key: "market", label: "Market", cell: (m) => marketName(marketNames, m.market) },
    { key: "value", label: "Refunded", align: "right", cell: (m) => money(m.valueMinor) },
    { key: "refunds", label: "Refunds", align: "right", cell: (m) => formatCount(m.refunds) },
    { key: "orders", label: "Orders refunded", align: "right", cell: (m) => formatCount(m.orders) },
    { key: "revenue", label: "Revenue", align: "right", cell: (m) => money(m.revenueMinor) },
    {
      key: "rate",
      label: "Refund rate",
      align: "right",
      cell: (m) => (m.rate === null ? <span title="No revenue in this market in this period">{NO_FIGURE}</span> : formatPercent(m.rate)),
    },
  ];

  // Unknown customers are only worth a row when there are some.
  const segments = r.segments.filter((s) => s.segment !== "unknown" || s.refunds > 0);

  return (
    <AnalyticsSection
      id="refunds"
      title="Refunds"
      description="How much was given back, how it compares with what was sold, and why. Without VAT, dated by the day of the refund."
    >
      <Note title="Refunds made only at your payment provider are not seen">{r.notSeenNote}</Note>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {refundCards(props).map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>
      {r.notes.length > 0 ? (
        <div className="space-y-2">
          {r.notes.map((n) => (
            <Note key={n} tone="warning">
              {n}
            </Note>
          ))}
        </div>
      ) : null}

      {none ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No refund was made from Kaizen in this period, so there are no reasons, products or markets to show.
        </div>
      ) : (
        <>
          <div className="grid gap-4 2xl:grid-cols-2">
            <ChartCard title="Why money was refunded" description="The reasons staff wrote, grouped when they read the same. A refund with no reason written is counted as such.">
              <HorizontalBars label="Refunded amount by reason" rows={reasonRows} emptyText="No reasons to show." exportId="traffic.refund_reasons" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </ChartCard>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">Most refunded products</h3>
              <p className="text-xs text-muted">Each refund is shared over the products on its order by what they were sold for, so the products add up to the refunds.</p>
              <DataTable caption="The most refunded products with the value refunded, its share, the number of refunds and the units put back in stock" columns={productColumns} rows={r.products} rowKey={(p, i) => p.productId ?? `none-${i}`} exportId="traffic.refund_products" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
              {r.productCount > r.products.length ? <p className="text-xs text-muted">{`Showing ${formatCount(r.products.length)} of ${formatCount(r.productCount)} products.`}</p> : null}
            </div>
          </div>
          <div className="grid gap-4 2xl:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">New and returning customers</h3>
              <p className="text-xs text-muted">A new customer is one whose first paid order is in this period.</p>
              <DataTable caption="Refunds by new and returning customers" columns={segmentColumns} rows={segments} rowKey={(s) => s.segment} exportId="traffic.refund_segments" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">By market</h3>
              <p className="text-xs text-muted">The refund rate is the market&apos;s refunds over its own revenue in this period.</p>
              <DataTable caption="Refunds and refund rate by market" columns={marketColumns} rows={r.markets} rowKey={(m) => m.market} exportId="traffic.refund_markets" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
          </div>
        </>
      )}
    </AnalyticsSection>
  );
}
