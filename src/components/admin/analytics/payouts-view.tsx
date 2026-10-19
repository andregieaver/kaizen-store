import Link from "next/link";

import { Chip } from "@/components/admin/ui";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import { formatMoney } from "@/lib/money";
import { PAYOUT_LINE_KIND_WORDS, PAYOUT_STATE_WORDS, PAYOUT_STATUS_WORDS, payoutFlagged, type PayoutReport, type PayoutRow, type PayoutState } from "@/lib/payouts";
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
function StateChip({ row, money }: { row: PayoutRow; money: (minor: number) => string }) {
  const r = row.reconciliation;
  const extra = r.state === "difference" ? ` by ${money(Math.abs(r.differenceMinor))}` : r.state === "untied" ? `: ${money(r.untiedMinor)}` : "";
  return (
    <Chip signal={STATE_SIGNAL[r.state]} dot>
      {`${PAYOUT_STATE_WORDS[r.state]}${extra}`}
    </Chip>
  );
}

/**
 * The store's payouts (wave 4 unit C, D290, docs/analytics.md "Payouts"): each Stripe payout arriving in the period, in its own currency, with Stripe's
 * fees in it, what it settles, and whether it adds up (its lines' net against the payout) or holds money Kaizena Flow cannot tie to an order. Totals of the
 * paid live payouts are in the main currency. Nothing here is estimated: a payout not read yet says so.
 */
export function PayoutsView({ base, currency, locale, report: r }: { base: string; currency: string; locale: string; report: PayoutReport }) {
  const main = safeMoney(currency, locale);
  const own = (row: PayoutRow) => (minor: number) => formatMoney(minor, row.currency, locale);
  const columns: Column<PayoutRow>[] = [
    {
      key: "payout",
      label: "Arrives",
      cell: (p) => (
        <Link href={`${base}/analytics/payouts/${p.id}`} className="underline">
          {p.arrivalOn ?? NO_FIGURE}
        </Link>
      ),
    },
    { key: "status", label: "Status", cell: (p) => `${PAYOUT_STATUS_WORDS[p.status]}${p.testMode ? " (test)" : ""}` },
    { key: "amount", label: "Amount", align: "right", cell: (p) => own(p)(p.amountMinor) },
    { key: "fees", label: "Stripe's fees", align: "right", cell: (p) => (p.reconciliation.state === "not_read" || p.reconciliation.state === "manual" ? NO_FIGURE : own(p)(p.reconciliation.feesMinor)) },
    { key: "settles", label: "Settles", cell: (p) => settlesWords(p) },
    { key: "state", label: "Reconciliation", cell: (p) => <StateChip row={p} money={own(p)} /> },
  ];
  return (
    <AnalyticsSection id="payouts" title="Payouts" description="What Stripe paid to your bank, what each payout settles and whether it adds up.">
      {r.payouts.length === 0 ? (
        <p className="text-sm text-muted">No payout arrives in this period. Stripe makes payouts on its own schedule; they appear here once Stripe reports them.</p>
      ) : (
        <DataTable
          caption="Payouts with their date, status, amount, Stripe's fees, what they settle and whether they add up"
          columns={columns}
          rows={r.payouts}
          rowKey={(p) => p.id}
          exportId="payouts.list"
          exportLeftOut={{ orders: r.unconverted, currencies: r.missingCurrencies }}
          footer={
            r.totals.paid > 0 ? (
              <tr className="text-ink">
                <th scope="row" className="px-3 py-2 text-left">{`Paid (${formatCount(r.totals.paid)})`}</th>
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
          <Note tone="warning">{`${formatCount(r.flagged)} ${r.flagged === 1 ? "payout does" : "payouts do"} not add up to ${r.flagged === 1 ? "its" : "their"} orders, or ${r.flagged === 1 ? "holds" : "hold"} money Kaizena Flow cannot tie to an order. Open ${r.flagged === 1 ? "it" : "one"} to see the lines.`}</Note>
        )}
        <Note>Amounts are in each payout&apos;s own currency, as Stripe paid them; the totals are the paid payouts in {currency}.</Note>
        {r.testPayouts > 0 && <Note>{`${formatCount(r.testPayouts)} test ${r.testPayouts === 1 ? "payout is" : "payouts are"} listed but not in the totals.`}</Note>}
        {r.unconverted > 0 && (
          <Note tone="warning">{`${formatCount(r.unconverted)} ${r.unconverted === 1 ? "payout" : "payouts"} in ${r.missingCurrencies.join(", ")} ${r.unconverted === 1 ? "is" : "are"} left out of the totals: the store has no rate for ${r.missingCurrencies.length === 1 ? "it" : "them"}.`}</Note>
        )}
      </div>
    </AnalyticsSection>
  );
}

/** What a payout settles, in words: "12 payments, 1 refund". */
export function settlesWords(p: Pick<PayoutRow, "payments" | "refunds" | "disputes" | "others" | "reconciliation">): string {
  if (p.reconciliation.state === "not_read") return "Not read yet";
  if (p.reconciliation.state === "manual") return "Stripe does not list what a manual payout settles";
  const parts = [
    p.payments ? `${formatCount(p.payments)} ${p.payments === 1 ? "payment" : "payments"}` : null,
    p.refunds ? `${formatCount(p.refunds)} ${p.refunds === 1 ? "refund" : "refunds"}` : null,
    p.disputes ? `${formatCount(p.disputes)} ${p.disputes === 1 ? "dispute" : "disputes"}` : null,
    p.others ? `${formatCount(p.others)} other` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing";
}

/** One payout's lines: each payment, refund, dispute and fee Stripe lists in it, with the order it is for, and whether the payout adds up. */
export function PayoutDetailView({ base, locale, detail, row }: { base: string; locale: string; detail: PayoutDetail; row: PayoutRow }) {
  const money = (minor: number) => formatMoney(minor, detail.payout.currency, locale);
  const r = row.reconciliation;
  const columns: Column<PayoutLineView>[] = [
    { key: "kind", label: "What", cell: (l) => PAYOUT_LINE_KIND_WORDS[l.kind] },
    {
      key: "order",
      label: "Order",
      cell: (l) =>
        l.orderId && l.orderNumber ? (
          <Link href={`${base}/orders/${l.orderId}`} className="underline">
            {l.orderNumber}
          </Link>
        ) : l.kind === "charge" || l.kind === "refund" || l.kind === "dispute" ? (
          <span className="text-muted">Not tied to an order</span>
        ) : (
          NO_FIGURE
        ),
    },
    { key: "gross", label: "Gross", align: "right", cell: (l) => money(l.amountMinor) },
    { key: "fee", label: "Fee", align: "right", cell: (l) => (l.feeMinor === 0 ? NO_FIGURE : money(l.feeMinor)) },
    { key: "net", label: "Net", align: "right", cell: (l) => money(l.netMinor) },
    { key: "source", label: "Stripe reference", cell: (l) => <span className="font-mono text-xs">{l.sourceReference ?? NO_FIGURE}</span> },
  ];
  const shown = detail.lines.filter((l) => l.kind !== "payout");
  return (
    <AnalyticsSection id="payout-lines" title="What it settles" description={`${money(detail.payout.amountMinor)} paid on ${detail.payout.arrivalOn ?? "a day Stripe did not give"}, Stripe's ${detail.payout.reference}.`}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StateChip row={row} money={money} />
        {r.state === "difference" && <span>{`The lines add up to ${money(r.linesNetMinor)}; the payout is ${money(detail.payout.amountMinor)}.`}</span>}
      </p>
      {detail.payout.failure && <Note tone="warning">{`Stripe says: ${detail.payout.failure}`}</Note>}
      {r.state === "manual" ? (
        <Note>This payout was made by hand in Stripe, and Stripe does not list what a manual payout settles.</Note>
      ) : r.state === "not_read" ? (
        <Note>What this payout settles is read from Stripe once it is paid. Check back later.</Note>
      ) : (
        <DataTable
          caption="The lines of the payout with the order each is for, its gross, fee and net, and Stripe's reference"
          columns={columns}
          rows={shown}
          rowKey={(l) => l.id}
          exportable={false}
          exportReason="payout-lines"
          empty="Stripe listed nothing in this payout."
        />
      )}
      {r.state === "incomplete" && <Note>This payout has more lines than Kaizena Flow reads; Stripe&apos;s own payout report has them all.</Note>}
      {payoutFlagged(r.state) && r.untiedCount > 0 && (
        <Note tone="warning">{`${formatCount(r.untiedCount)} ${r.untiedCount === 1 ? "line" : "lines"} (${money(r.untiedMinor)}) could not be tied to an order: a payment taken in Stripe directly, or one Kaizena Flow has no record of.`}</Note>
      )}
    </AnalyticsSection>
  );
}
