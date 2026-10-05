import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatDays, MIN_PRODUCT_UNITS, MIN_TIMING_SAMPLE } from "@/lib/analytics-returns";
import type { ReturnsReport } from "@/server/analytics-returns-data";

import { HorizontalBars, type BarRow } from "./charts";
import { DataTable, ShareBar, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * The Returns section of the Traffic page (D153, docs/analytics.md "Returns"): how much comes back, why, which products, how fast the
 * store refunds and what is overdue. Drawn from the report object and nothing else. A rate that has too little behind it, or a store that
 * has recorded no return, shows what is missing and never a zero; the note that returns made outside Kaizen are not seen is always shown.
 */

export type ReturnsViewProps = {
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  report: ReturnsReport;
  /** Where the returns queue is (a path under the store's admin), for the overdue figure. */
  queueHref?: string;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const HELP = {
  made: "Returns made in this period that ask for goods back: a withdrawal, or a return inside your own longer window. Declined and cancelled ones are not counted.",
  orderRate: "Of the paid orders with goods placed in this period, the share that has had a return so far (at any time). It keeps rising while returns for these orders arrive.",
  unitRate: "Units on accepted return lines of the orders placed in this period, divided by the units sold in them.",
  refunded: "Money refunded through returns in this period, without VAT, dated by the day of the refund.",
  timing: "The middle value of the days from the shopper's request (a withdrawal's confirmation) to the refund, for returns refunded in this period.",
  overdue: "Withdrawals past the legal day for the refund, not refunded yet. It is as of now, whatever the period.",
};

/** The six cards. A rate that cannot be given is a missing card with its reason; the counts are always numbers. */
export function returnCards({ currency, locale, report: r, queueHref }: ReturnsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const cards: KpiCardProps[] = [];

  cards.push({
    label: "Returns made",
    value: formatCount(r.made.returns),
    emphasis: true,
    help: HELP.made,
    hint:
      r.made.returns === 0
        ? "No return was made in this period."
        : `${formatCount(r.made.withdrawals)} ${plural(r.made.withdrawals, "withdrawal", "withdrawals")} and ${formatCount(r.made.voluntary)} voluntary ${plural(r.made.voluntary, "return", "returns")}.`,
  });

  cards.push(
    r.orderRate.value === null
      ? { label: "Return rate, orders", value: null, state: "missing", missing: { text: r.orderRate.missing ?? "Not known." }, help: HELP.orderRate }
      : {
          label: "Return rate, orders",
          value: formatPercent(r.orderRate.value),
          good: "down",
          help: HELP.orderRate,
          hint: `${formatCount(r.cohort.returnedOrders)} of ${formatCount(r.cohort.orders)} orders with goods, so far.`,
        },
  );

  cards.push(
    r.unitRate.value === null
      ? { label: "Return rate, units", value: null, state: "missing", missing: { text: r.unitRate.missing ?? "Not known." }, help: HELP.unitRate }
      : {
          label: "Return rate, units",
          value: formatPercent(r.unitRate.value),
          good: "down",
          help: HELP.unitRate,
          hint: `${formatCount(r.cohort.returnedUnits)} of ${formatCount(r.cohort.unitsSold)} units sold, so far; worth ${money(r.returnedMinor)} without VAT.`,
        },
  );

  cards.push({
    label: "Refunded for returns",
    value: money(r.refunded.minor),
    good: "down",
    help: HELP.refunded,
    hint:
      r.refunded.returns === 0
        ? "No return was refunded in this period."
        : `${formatCount(r.refunded.returns)} ${plural(r.refunded.returns, "return", "returns")}${r.refunded.outside > 0 ? `, ${formatCount(r.refunded.outside)} outside Kaizen's Stripe` : ""}.`,
  });

  const t = r.timing.requestToRefund;
  cards.push(
    t.medianDays === null
      ? { label: "Typical time to refund", value: null, state: "missing", missing: { text: t.missing ?? "Not known." }, help: HELP.timing }
      : {
          label: "Typical time to refund",
          value: formatDays(t.medianDays),
          good: "down",
          help: HELP.timing,
          hint: `Median of ${formatCount(t.n)} returns; the slowest took ${formatDays(t.slowestDays)}.`,
        },
  );

  cards.push({
    label: "Overdue now",
    value: formatCount(r.overdue),
    good: "down",
    help: HELP.overdue,
    href: queueHref,
    hint: r.overdue === 0 ? "No withdrawal is past its refund deadline." : `${plural(r.overdue, "Withdrawal is", "Withdrawals are")} past the legal day for the refund.`,
  });
  return cards;
}

export function ReturnsView(props: ReturnsViewProps) {
  const { currency, locale, report: r } = props;
  const money = safeMoney(currency, locale);
  const nothing = r.made.returns === 0 && r.made.declined === 0 && r.made.cancelled === 0 && r.refunded.returns === 0 && r.products.length === 0;

  const reasonRows: BarRow[] = r.reasons.rows.map((x) => ({
    key: x.reason === "" ? "none" : x.reason,
    label: x.label,
    value: x.returns,
    valueText: formatCount(x.returns),
    detail: [`${formatCount(x.units)} ${plural(x.units, "unit", "units")}`, x.share === null ? null : formatPercent(x.share)].filter(Boolean).join(", "),
    colorIndex: x.reason === "" ? 99 : undefined,
  }));

  const kindColumns: Column<ReturnsReport["kinds"][number]>[] = [
    { key: "kind", label: "Kind", cell: (k) => k.label },
    { key: "returns", label: "Made", align: "right", cell: (k) => formatCount(k.returns) },
    { key: "units", label: "Units", align: "right", cell: (k) => formatCount(k.units) },
    {
      key: "declined",
      label: "Declined",
      align: "right",
      cell: (k) => (k.kind === "withdrawal" ? <span title="A withdrawal is not the store's to refuse">{NO_FIGURE}</span> : formatCount(k.declined)),
    },
    { key: "cancelled", label: "Cancelled", align: "right", cell: (k) => formatCount(k.cancelled) },
    { key: "refunded", label: "Refunded", align: "right", cell: (k) => formatCount(k.refunded) },
    { key: "value", label: "Refunded amount", align: "right", cell: (k) => money(k.refundedMinor) },
  ];

  const timingRows = [
    { key: "request", label: "Request to refund", timing: r.timing.requestToRefund },
    { key: "received", label: "Goods received to refund", timing: r.timing.receivedToRefund },
  ];
  const timingColumns: Column<(typeof timingRows)[number]>[] = [
    { key: "what", label: "Time", cell: (x) => x.label },
    { key: "n", label: "Returns", align: "right", cell: (x) => formatCount(x.timing.n) },
    {
      key: "median",
      label: "Typical (median)",
      align: "right",
      cell: (x) => (x.timing.medianDays === null ? <span title={x.timing.missing ?? ""}>{NO_FIGURE}</span> : formatDays(x.timing.medianDays)),
    },
    { key: "slowest", label: "Slowest", align: "right", cell: (x) => (x.timing.slowestDays === null ? NO_FIGURE : formatDays(x.timing.slowestDays)) },
  ];

  const productColumns: Column<ReturnsReport["products"][number]>[] = [
    { key: "product", label: "Product", cell: (p) => <span title={p.name}>{p.name}</span> },
    { key: "returned", label: "Units returned", align: "right", cell: (p) => formatCount(p.returnedUnits) },
    { key: "sold", label: "Units sold", align: "right", cell: (p) => formatCount(p.sold) },
    {
      key: "rate",
      label: "Return rate",
      align: "right",
      cell: (p) =>
        p.rate.value === null ? (
          <span title={p.rate.missing ?? ""}>{NO_FIGURE}</span>
        ) : (
          <ShareBar share={p.rate.value} text={formatPercent(p.rate.value)} label="Share of the units sold that were returned" />
        ),
    },
    { key: "value", label: "Returned value", align: "right", cell: (p) => money(p.returnedMinor) },
  ];

  const deadline = r.timing.afterDeadline;

  return (
    <AnalyticsSection
      id="returns"
      title="Returns"
      description="How much comes back, why, which products, and how fast you refund. Without VAT; rates are of the orders placed in the period, whenever they were returned."
    >
      <Note title="Returns made outside Kaizen are not seen">{r.notSeenNote}</Note>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {returnCards(props).map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>
      {r.maturity ? <Note tone="warning">{r.maturity}</Note> : null}
      {r.notes.length > 0 ? (
        <div className="space-y-2">
          {r.notes.map((n) => (
            <Note key={n} tone="warning">
              {n}
            </Note>
          ))}
        </div>
      ) : null}

      {!r.tracked ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No return has been recorded in Kaizen yet, so there are no rates, reasons or products to show. They appear once a shopper uses the withdrawal function or a return request.
        </div>
      ) : nothing ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No return was made or refunded in this period, so there are no reasons, times or products to show.
        </div>
      ) : (
        <>
          <div className="grid gap-4 2xl:grid-cols-2">
            <ChartCard title="Why goods came back" description="The reason the shopper chose, by number of returns made in the period. A withdrawal asks for no reason, so many have none.">
              <HorizontalBars label="Returns made by reason" rows={reasonRows} emptyText="No returns were made in this period." exportId="traffic.return_reasons" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
              {r.reasons.note ? <p className="mt-2 text-xs text-muted">{r.reasons.note}</p> : null}
            </ChartCard>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">Withdrawals and voluntary returns</h3>
              <p className="text-xs text-muted">A withdrawal is the shopper&apos;s legal right and is not refused. A voluntary return is inside your own longer window and you may decline it.</p>
              <DataTable caption="Returns made in the period by kind, with those refunded" columns={kindColumns} rows={r.kinds} rowKey={(k) => k.kind} exportId="traffic.return_kinds" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
          </div>
          <div className="grid gap-4 2xl:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">How fast you refund</h3>
              <p className="text-xs text-muted">For returns refunded in this period. A typical time is shown from {formatCount(MIN_TIMING_SAMPLE)} returns.</p>
              <DataTable caption="Time from the request and from the goods arriving to the refund" columns={timingColumns} rows={timingRows} rowKey={(x) => x.key} exportId="traffic.return_timing" />
              <p className="text-xs text-muted">
                {deadline.of === 0
                  ? "No withdrawal was refunded in this period."
                  : `${formatCount(deadline.late)} of ${formatCount(deadline.of)} ${plural(deadline.of, "withdrawal was", "withdrawals were")} refunded after the 14-day deadline.`}
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">Most returned products</h3>
              <p className="text-xs text-muted">
                Units returned of what was sold in this period. A product&apos;s rate is shown from {formatCount(MIN_PRODUCT_UNITS)} units sold.
              </p>
              <DataTable
                caption="The most returned products with units returned and sold, their return rate and the value returned"
                columns={productColumns}
                rows={r.products}
                rowKey={(p) => p.productId}
                empty="No goods from this period's orders have been returned."
                exportId="traffic.return_products"
                exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }}
              />
              {r.productCount > r.products.length ? <p className="text-xs text-muted">{`Showing ${formatCount(r.products.length)} of ${formatCount(r.productCount)} products.`}</p> : null}
            </div>
          </div>
        </>
      )}
    </AnalyticsSection>
  );
}
