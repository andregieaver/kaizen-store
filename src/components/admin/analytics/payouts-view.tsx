import Link from "next/link";

import { Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import { formatMoney } from "@/lib/money";
import { payoutFlagged, type PayoutReport, type PayoutRow, type PayoutState } from "@/lib/payouts";
import type { PayoutDetail, PayoutLineView } from "@/server/payouts-report";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

const STATE_SIGNAL: Record<PayoutState, "positive" | "warning" | "danger" | "neutral"> = {
  reconciles: "positive",
  difference: "danger",
  untied: "warning",
  not_read: "neutral",
  manual: "neutral",
  incomplete: "neutral",
};

/** A payout's state as a chip, with the amount that does not add up or is not tied to an order. */
function StateChip({ row, money, w }: { row: PayoutRow; money: (minor: number) => string; w: FinanceMessages["payouts"] }) {
  const r = row.reconciliation;
  const extra = r.state === "difference" ? fillWords(w.by, { amount: money(Math.abs(r.differenceMinor)) }) : r.state === "untied" ? fillWords(w.untiedAmount, { amount: money(r.untiedMinor) }) : "";
  return (
    <Chip signal={STATE_SIGNAL[r.state]} dot>
      {`${w.states[r.state]}${extra}`}
    </Chip>
  );
}

/**
 * The store's payouts (wave 4 unit C, D290, docs/analytics.md "Payouts"): each Stripe payout arriving in the period, in its own currency, with Stripe's
 * fees in it, what it settles, and whether it adds up (its lines' net against the payout) or holds money Kaizena Flow cannot tie to an order. Totals of the
 * paid live payouts are in the main currency. Nothing here is estimated: a payout not read yet says so.
 */
export function PayoutsView({ base, currency, locale, report: r, words = financeEn }: { base: string; currency: string; locale: string; report: PayoutReport; words?: FinanceMessages }) {
  const w = words.payouts;
  const main = safeMoney(currency, locale);
  const own = (row: PayoutRow) => (minor: number) => formatMoney(minor, row.currency, locale);
  const columns: Column<PayoutRow>[] = [
    {
      key: "payout",
      label: w.arrives,
      cell: (p) => (
        <Link href={`${base}/analytics/payouts/${p.id}`} className="underline">
          {p.arrivalOn ?? NO_FIGURE}
        </Link>
      ),
    },
    { key: "status", label: w.statusColumn, cell: (p) => `${w.status[p.status]}${p.testMode ? w.testSuffix : ""}` },
    { key: "amount", label: w.amount, align: "right", cell: (p) => own(p)(p.amountMinor) },
    { key: "fees", label: w.fees, align: "right", cell: (p) => (p.reconciliation.state === "not_read" || p.reconciliation.state === "manual" ? NO_FIGURE : own(p)(p.reconciliation.feesMinor)) },
    { key: "settles", label: w.settles, cell: (p) => settlesWords(p, words) },
    { key: "state", label: w.reconciliation, cell: (p) => <StateChip row={p} money={own(p)} w={w} /> },
  ];
  return (
    <AnalyticsSection id="payouts" title={w.title} description={w.description}>
      {r.payouts.length === 0 ? (
        <p className="text-sm text-muted">{w.empty}</p>
      ) : (
        <DataTable
          caption={w.caption}
          columns={columns}
          rows={r.payouts}
          rowKey={(p) => p.id}
          exportId="payouts.list"
          exportLeftOut={{ orders: r.unconverted, currencies: r.missingCurrencies }}
          footer={
            r.totals.paid > 0 ? (
              <tr className="text-ink">
                <th scope="row" className="px-3 py-2 text-left">{fillWords(w.paid, { n: formatCount(r.totals.paid) })}</th>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{main(r.totals.paidMinor)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{main(r.totals.feesMinor)}</td>
                <td colSpan={2} />
              </tr>
            ) : null
          }
        />
      )}
      <div className="space-y-2">
        {r.flagged > 0 && (
          <Note tone="warning">{countWords(r.flagged, w.flagged, { n: formatCount(r.flagged) })}</Note>
        )}
        <Note>{fillWords(w.ownCurrency, { currency })}</Note>
        {r.testPayouts > 0 && <Note>{countWords(r.testPayouts, w.tests, { n: formatCount(r.testPayouts) })}</Note>}
        {r.unconverted > 0 && (
          <Note tone="warning">{countWords(r.unconverted, w.leftOut, { n: formatCount(r.unconverted), currencies: r.missingCurrencies.join(", "), them: r.missingCurrencies.length === 1 ? w.it : w.them })}</Note>
        )}
      </div>
    </AnalyticsSection>
  );
}

/** What a payout settles, in words: "12 payments, 1 refund". */
export function settlesWords(p: Pick<PayoutRow, "payments" | "refunds" | "disputes" | "others" | "reconciliation">, words: FinanceMessages = financeEn): string {
  const w = words.payouts;
  if (p.reconciliation.state === "not_read") return w.settlesNotRead;
  if (p.reconciliation.state === "manual") return w.settlesManual;
  const parts = [
    p.payments ? countWords(p.payments, w.settlesPayments, { n: formatCount(p.payments) }) : null,
    p.refunds ? countWords(p.refunds, w.settlesRefunds, { n: formatCount(p.refunds) }) : null,
    p.disputes ? countWords(p.disputes, w.settlesDisputes, { n: formatCount(p.disputes) }) : null,
    p.others ? fillWords(w.settlesOthers, { n: formatCount(p.others) }) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : w.nothing;
}

/** One payout's lines: each payment, refund, dispute and fee Stripe lists in it, with the order it is for, and whether the payout adds up. */
export function PayoutDetailView({ base, locale, detail, row, words = financeEn }: { base: string; locale: string; detail: PayoutDetail; row: PayoutRow; words?: FinanceMessages }) {
  const w = words.payouts;
  const money = (minor: number) => formatMoney(minor, detail.payout.currency, locale);
  const r = row.reconciliation;
  const columns: Column<PayoutLineView>[] = [
    { key: "kind", label: w.what, cell: (l) => w.kinds[l.kind] },
    {
      key: "order",
      label: w.order,
      cell: (l) =>
        l.orderId && l.orderNumber ? (
          <Link href={`${base}/orders/${l.orderId}`} className="underline">
            {l.orderNumber}
          </Link>
        ) : l.kind === "charge" || l.kind === "refund" || l.kind === "dispute" ? (
          <span className="text-muted">{w.notTied}</span>
        ) : (
          NO_FIGURE
        ),
    },
    { key: "gross", label: w.gross, align: "right", cell: (l) => money(l.amountMinor) },
    { key: "fee", label: w.fee, align: "right", cell: (l) => (l.feeMinor === 0 ? NO_FIGURE : money(l.feeMinor)) },
    { key: "net", label: w.net, align: "right", cell: (l) => money(l.netMinor) },
    { key: "source", label: w.reference, cell: (l) => <span className="font-mono text-xs">{l.sourceReference ?? NO_FIGURE}</span> },
  ];
  const shown = detail.lines.filter((l) => l.kind !== "payout");
  return (
    <AnalyticsSection id="payout-lines" title={w.linesTitle} description={fillWords(w.linesDescription, { amount: money(detail.payout.amountMinor), date: detail.payout.arrivalOn ?? w.noDay, reference: detail.payout.reference })}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StateChip row={row} money={money} w={w} />
        {r.state === "difference" && <span>{fillWords(w.linesAddUp, { lines: money(r.linesNetMinor), amount: money(detail.payout.amountMinor) })}</span>}
      </p>
      {detail.payout.failure && <Note tone="warning">{fillWords(w.stripeSays, { failure: detail.payout.failure })}</Note>}
      {r.state === "manual" ? (
        <Note>{w.manualNote}</Note>
      ) : r.state === "not_read" ? (
        <Note>{w.notReadNote}</Note>
      ) : (
        <DataTable
          caption={w.linesCaption}
          columns={columns}
          rows={shown}
          rowKey={(l) => l.id}
          exportable={false}
          exportReason="payout-lines"
          empty={w.linesEmpty}
        />
      )}
      {r.state === "incomplete" && <Note>{w.incomplete}</Note>}
      {payoutFlagged(r.state) && r.untiedCount > 0 && (
        <Note tone="warning">{countWords(r.untiedCount, w.untiedLines, { n: formatCount(r.untiedCount), amount: money(r.untiedMinor) })}</Note>
      )}
    </AnalyticsSection>
  );
}
