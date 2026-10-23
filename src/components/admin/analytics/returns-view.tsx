import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import { MIN_PRODUCT_UNITS, MIN_TIMING_SAMPLE } from "@/lib/analytics-returns";
import { financeNumbers } from "@/lib/finance-words";
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
  /** The words in the admin's language (D312 A9); English unless given. */
  words?: FinanceMessages;
};

/** The seven cards. A rate that cannot be given is a missing card with its reason; the counts are always numbers. */
export function returnCards({ currency, locale, report: r, queueHref, words = financeEn }: ReturnsViewProps): KpiCardProps[] {
  const w = words.returns;
  const HELP = w.help;
  const { percent: pct, days: formatDays } = financeNumbers(words);
  const money = safeMoney(currency, locale);
  const cards: KpiCardProps[] = [];

  cards.push({
    label: w.made,
    value: formatCount(r.made.returns),
    emphasis: true,
    help: HELP.made,
    hint:
      r.made.returns === 0
        ? w.noneMade
        : fillWords(w.madeHint, {
            withdrawals: countWords(r.made.withdrawals, w.withdrawalsN, { n: formatCount(r.made.withdrawals) }),
            voluntary: countWords(r.made.voluntary, w.voluntaryN, { n: formatCount(r.made.voluntary) }),
          }),
  });

  cards.push(
    r.orderRate.value === null
      ? { label: w.orderRate, value: null, state: "missing", missing: { text: r.orderRate.missing ?? w.notKnown }, help: HELP.orderRate }
      : {
          label: w.orderRate,
          value: pct(r.orderRate.value),
          good: "down",
          help: HELP.orderRate,
          hint: fillWords(w.orderRateHint, { returned: formatCount(r.cohort.returnedOrders), orders: formatCount(r.cohort.orders) }),
        },
  );

  cards.push(
    r.unitRate.value === null
      ? { label: w.unitRate, value: null, state: "missing", missing: { text: r.unitRate.missing ?? w.notKnown }, help: HELP.unitRate }
      : {
          label: w.unitRate,
          value: pct(r.unitRate.value),
          good: "down",
          help: HELP.unitRate,
          hint: fillWords(w.unitRateHint, { returned: formatCount(r.cohort.returnedUnits), sold: formatCount(r.cohort.unitsSold), amount: money(r.returnedMinor) }),
        },
  );

  cards.push({
    label: w.refunded,
    value: money(r.refunded.minor),
    good: "down",
    help: HELP.refunded,
    hint:
      r.refunded.returns === 0
        ? w.noneRefunded
        : fillWords(w.refundedHint, {
            returns: countWords(r.refunded.returns, w.returnsN, { n: formatCount(r.refunded.returns) }),
            outside: r.refunded.outside > 0 ? fillWords(w.outside, { n: formatCount(r.refunded.outside) }) : "",
          }),
  });

  const t = r.timing.requestToRefund;
  cards.push(
    t.medianDays === null
      ? { label: w.timing, value: null, state: "missing", missing: { text: t.missing ?? w.notKnown }, help: HELP.timing }
      : {
          label: w.timing,
          value: formatDays(t.medianDays),
          good: "down",
          help: HELP.timing,
          hint: fillWords(w.timingHint, { n: formatCount(t.n), slowest: formatDays(t.slowestDays) }),
        },
  );

  cards.push({
    label: w.overdue,
    value: formatCount(r.overdue),
    good: "down",
    help: HELP.overdue,
    href: queueHref,
    hint: r.overdue === 0 ? w.noneOverdue : countWords(r.overdue, w.overdueHint),
  });

  const x = r.exchanges;
  const kept = x.transfers > 0 ? fillWords(w.kept, { amount: money(x.keptMinor) }) : "";
  cards.push(
    !x.tracked
      ? { label: w.exchanged, value: null, state: "missing", missing: { text: x.share.missing ?? w.noneExchanged }, help: HELP.exchanged }
      : {
          label: w.exchanged,
          value: formatCount(x.returns),
          help: HELP.exchanged,
          hint:
            x.share.value === null
              ? `${x.share.missing ?? ""}${kept}`.trim()
              : fillWords(w.exchangedHint, { share: pct(x.share.value), returns: formatCount(r.made.returns), kept }),
        },
  );
  return cards;
}

export function ReturnsView(props: ReturnsViewProps) {
  const { currency, locale, report: r, words = financeEn } = props;
  const w = words.returns;
  const { percent: pct, days: formatDays } = financeNumbers(words);
  const money = safeMoney(currency, locale);
  const nothing = r.made.returns === 0 && r.made.declined === 0 && r.made.cancelled === 0 && r.refunded.returns === 0 && r.products.length === 0;

  const reasonRows: BarRow[] = r.reasons.rows.map((x) => ({
    key: x.reason === "" ? "none" : x.reason,
    label: x.label,
    value: x.returns,
    valueText: formatCount(x.returns),
    detail: [countWords(x.units, w.unitsN, { n: formatCount(x.units) }), x.share === null ? null : pct(x.share)].filter(Boolean).join(", "),
    colorIndex: x.reason === "" ? 99 : undefined,
  }));

  const kindColumns: Column<ReturnsReport["kinds"][number]>[] = [
    { key: "kind", label: w.kind, cell: (k) => k.label },
    { key: "returns", label: w.madeColumn, align: "right", cell: (k) => formatCount(k.returns) },
    { key: "units", label: w.units, align: "right", cell: (k) => formatCount(k.units) },
    {
      key: "declined",
      label: w.declined,
      align: "right",
      cell: (k) => (k.kind === "withdrawal" ? <span title={w.notRefusable}>{NO_FIGURE}</span> : formatCount(k.declined)),
    },
    { key: "cancelled", label: w.cancelled, align: "right", cell: (k) => formatCount(k.cancelled) },
    { key: "refunded", label: w.refundedColumn, align: "right", cell: (k) => formatCount(k.refunded) },
    { key: "value", label: w.refundedAmount, align: "right", cell: (k) => money(k.refundedMinor) },
    { key: "exchanged", label: w.exchangedColumn, align: "right", cell: (k) => formatCount(k.exchanged) },
  ];

  const timingRows = [
    { key: "request", label: w.requestToRefund, timing: r.timing.requestToRefund },
    { key: "received", label: w.receivedToRefund, timing: r.timing.receivedToRefund },
  ];
  const timingColumns: Column<(typeof timingRows)[number]>[] = [
    { key: "what", label: w.time, cell: (x) => x.label },
    { key: "n", label: w.returns, align: "right", cell: (x) => formatCount(x.timing.n) },
    {
      key: "median",
      label: w.typical,
      align: "right",
      cell: (x) => (x.timing.medianDays === null ? <span title={x.timing.missing ?? ""}>{NO_FIGURE}</span> : formatDays(x.timing.medianDays)),
    },
    { key: "slowest", label: w.slowest, align: "right", cell: (x) => (x.timing.slowestDays === null ? NO_FIGURE : formatDays(x.timing.slowestDays)) },
  ];

  const productColumns: Column<ReturnsReport["products"][number]>[] = [
    { key: "product", label: w.product, cell: (p) => <span title={p.name}>{p.name}</span> },
    { key: "returned", label: w.unitsReturned, align: "right", cell: (p) => formatCount(p.returnedUnits) },
    { key: "sold", label: w.unitsSold, align: "right", cell: (p) => formatCount(p.sold) },
    {
      key: "rate",
      label: w.returnRate,
      align: "right",
      cell: (p) =>
        p.rate.value === null ? (
          <span title={p.rate.missing ?? ""}>{NO_FIGURE}</span>
        ) : (
          <ShareBar share={p.rate.value} text={pct(p.rate.value)} label={w.returnShare} />
        ),
    },
    { key: "value", label: w.returnedValue, align: "right", cell: (p) => money(p.returnedMinor) },
  ];

  const deadline = r.timing.afterDeadline;

  return (
    <AnalyticsSection
      id="returns"
      title={w.title}
      description={w.description}
    >
      <Note title={w.notSeen}>{r.notSeenNote}</Note>
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
        <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          {w.untracked}
        </div>
      ) : nothing ? (
        <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          {w.nothing}
        </div>
      ) : (
        <>
          <div className="grid gap-4 2xl:grid-cols-2">
            <ChartCard title={w.whyTitle} description={w.whyDescription}>
              <HorizontalBars label={w.whyLabel} rows={reasonRows} emptyText={w.noReturns} exportId="traffic.return_reasons" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
              {r.reasons.note ? <p className="mt-2 text-xs text-muted">{r.reasons.note}</p> : null}
            </ChartCard>
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.kindsTitle}</h3>
              <p className="text-xs text-muted">{w.kindsNote}</p>
              <DataTable caption={w.kindsCaption} columns={kindColumns} rows={r.kinds} rowKey={(k) => k.kind} exportId="traffic.return_kinds" exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }} />
            </div>
          </div>
          <div className="grid gap-4 2xl:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.fastTitle}</h3>
              <p className="text-xs text-muted">{fillWords(w.fastNote, { n: formatCount(MIN_TIMING_SAMPLE) })}</p>
              <DataTable caption={w.fastCaption} columns={timingColumns} rows={timingRows} rowKey={(x) => x.key} exportId="traffic.return_timing" />
              <p className="text-xs text-muted">
                {deadline.of === 0 ? w.noWithdrawalRefunded : countWords(deadline.of, w.late, { late: formatCount(deadline.late), n: formatCount(deadline.of) })}
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-body-strong text-ink">{w.productsTitle}</h3>
              <p className="text-xs text-muted">{fillWords(w.productsNote, { n: formatCount(MIN_PRODUCT_UNITS) })}</p>
              <DataTable
                caption={w.productsCaption}
                columns={productColumns}
                rows={r.products}
                rowKey={(p) => p.productId}
                empty={w.productsEmpty}
                exportId="traffic.return_products"
                exportLeftOut={{ orders: r.unconverted, currencies: r.missingRates }}
              />
              {r.productCount > r.products.length ? <p className="text-xs text-muted">{fillWords(w.showing, { shown: formatCount(r.products.length), all: formatCount(r.productCount) })}</p> : null}
            </div>
          </div>
        </>
      )}
    </AnalyticsSection>
  );
}
