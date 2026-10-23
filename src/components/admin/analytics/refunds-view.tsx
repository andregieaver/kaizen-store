import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import { financeNumbers } from "@/lib/finance-words";
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
  /** The words in the admin's language (D312 A9); English unless given. */
  words?: FinanceMessages;
};

/** The four cards: how much, as a share of sales, how many orders, how many refunds. */
export function refundCards({ currency, locale, report: r, words = financeEn }: RefundsViewProps): KpiCardProps[] {
  const w = words.refunds;
  const HELP = w.help;
  const pct = financeNumbers(words).percent;
  const money = safeMoney(currency, locale);
  return [
    {
      label: w.refunded,
      value: money(r.refundsMinor),
      emphasis: true,
      good: "down",
      help: HELP.refunded,
      hint:
        r.refunds === 0
          ? w.noneMade
          : fillWords(w.made, { refunds: countWords(r.refunds, w.refundsN, { n: formatCount(r.refunds) }), orders: countWords(r.refundedOrders, w.ordersN, { n: formatCount(r.refundedOrders) }) }),
    },
    r.refundRate === null
      ? { label: w.rate, value: null, state: "missing", missing: { text: w.rateMissing }, help: HELP.rate }
      : { label: w.rate, value: pct(r.refundRate), good: "down", help: HELP.rate, hint: fillWords(w.rateHint, { refunded: money(r.refundsMinor), revenue: money(r.revenueMinor) }) },
    r.cohort.share === null
      ? { label: w.withRefund, value: null, state: "missing", missing: { text: w.withRefundMissing }, help: HELP.orders }
      : {
          label: w.withRefund,
          value: pct(r.cohort.share),
          good: "down",
          help: HELP.orders,
          hint: fillWords(w.withRefundHint, { refunded: formatCount(r.cohort.refundedOrders), orders: formatCount(r.cohort.orders) }),
        },
  ];
}

export const marketName = (names: RefundsViewProps["marketNames"], code: string) => names?.[code] ?? names?.[code.toUpperCase()] ?? code;

export function RefundsView(props: RefundsViewProps) {
  const { currency, locale, report: r, marketNames, words = financeEn } = props;
  const w = words.refunds;
  const pct = financeNumbers(words).percent;
  const money = safeMoney(currency, locale);
  const none = r.refunds === 0;

  const reasonRows: BarRow[] = r.reasons.map((x) => ({
    key: x.reason === "" ? "none" : x.reason,
    label: x.label,
    value: x.valueMinor,
    valueText: money(x.valueMinor),
    detail: `${countWords(x.refunds, w.refundsN, { n: formatCount(x.refunds) })}${x.share === null ? "" : `, ${pct(x.share)}`}`,
  }));
  if (r.other.reasons > 0) {
    reasonRows.push({
      key: "other",
      label: countWords(r.other.reasons, w.otherReasons, { n: formatCount(r.other.reasons) }),
      value: r.other.valueMinor,
      valueText: money(r.other.valueMinor),
      detail: countWords(r.other.refunds, w.refundsN, { n: formatCount(r.other.refunds) }),
      colorIndex: 99,
    });
  }

  const productColumns: Column<RefundsReport["products"][number]>[] = [
    { key: "product", label: w.product, cell: (p) => <span title={p.name}>{p.name}</span> },
    { key: "value", label: w.refunded, align: "right", cell: (p) => money(p.valueMinor) },
    { key: "share", label: w.shareOfRefunds, align: "right", cell: (p) => <ShareBar share={p.share} text={pct(p.share)} label={w.shareLabel} /> },
    { key: "refunds", label: w.refundsColumn, align: "right", cell: (p) => formatCount(p.refunds) },
    {
      key: "restocked",
      label: w.restocked,
      align: "right",
      cell: (p) => (p.productId === null ? <span title={w.notStock}>{NO_FIGURE}</span> : <span title={w.restockedTitle}>{formatCount(p.restockedUnits)}</span>),
    },
  ];

  const segmentColumns: Column<RefundsReport["segments"][number]>[] = [
    { key: "segment", label: w.customer, cell: (s) => s.label },
    { key: "value", label: w.refunded, align: "right", cell: (s) => money(s.valueMinor) },
    { key: "share", label: w.shareOfRefunds, align: "right", cell: (s) => <ShareBar share={s.share} text={pct(s.share)} /> },
    { key: "refunds", label: w.refundsColumn, align: "right", cell: (s) => formatCount(s.refunds) },
    { key: "orders", label: w.orders, align: "right", cell: (s) => formatCount(s.orders) },
  ];

  const marketColumns: Column<RefundsReport["markets"][number]>[] = [
    { key: "market", label: w.market, cell: (m) => marketName(marketNames, m.market) },
    { key: "value", label: w.refunded, align: "right", cell: (m) => money(m.valueMinor) },
    { key: "refunds", label: w.refundsColumn, align: "right", cell: (m) => formatCount(m.refunds) },
    { key: "orders", label: w.ordersRefunded, align: "right", cell: (m) => formatCount(m.orders) },
    { key: "revenue", label: w.revenue, align: "right", cell: (m) => money(m.revenueMinor) },
    {
      key: "rate",
      label: w.rate,
      align: "right",
      cell: (m) => (m.rate === null ? <span title={w.noRevenueMarket}>{NO_FIGURE}</span> : pct(m.rate)),
    },
  ];

  // Unknown customers are only worth a row when there are some.
  const segments = r.segments.filter((s) => s.segment !== "unknown" || s.refunds > 0);

  return (
    <AnalyticsSection
      id="refunds"
      title={w.title}
      description={w.description}
    >
      <Note title={w.notSeen}>{r.notSeenNote}</Note>
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
        <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          {w.none}
        </div>
      ) : (
        <>
          <div className="grid gap-4 2xl:grid-cols-2">
            <ChartCard title={w.whyTitle} description={w.whyDescription}>
              <HorizontalBars label={w.whyLabel} rows={reasonRows} emptyText={w.noReasons} exportId="traffic.refund_reasons" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </ChartCard>
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.productsTitle}</h3>
              <p className="text-xs text-muted">{w.productsNote}</p>
              <DataTable caption={w.productsCaption} columns={productColumns} rows={r.products} rowKey={(p, i) => p.productId ?? `none-${i}`} exportId="traffic.refund_products" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
              {r.productCount > r.products.length ? <p className="text-xs text-muted">{fillWords(w.showing, { shown: formatCount(r.products.length), all: formatCount(r.productCount) })}</p> : null}
            </div>
          </div>
          <div className="grid gap-4 2xl:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.segmentsTitle}</h3>
              <p className="text-xs text-muted">{w.segmentsNote}</p>
              <DataTable caption={w.segmentsCaption} columns={segmentColumns} rows={segments} rowKey={(s) => s.segment} exportId="traffic.refund_segments" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.marketsTitle}</h3>
              <p className="text-xs text-muted">{w.marketsNote}</p>
              <DataTable caption={w.marketsCaption} columns={marketColumns} rows={r.markets} rowKey={(m) => m.market} exportId="traffic.refund_markets" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
          </div>
        </>
      )}
    </AnalyticsSection>
  );
}
