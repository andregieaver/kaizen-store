import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import type { PaymentMethodLine, PaymentsByMethod } from "@/lib/analytics-payments";
import { financeNumbers } from "@/lib/finance-words";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * Payments by method on the Finance page (wave 4 unit A, D288, docs/analytics.md "Payments by method"): what the period's paid orders were paid with, as
 * the provider said, with the money received, refunds and Stripe's fee estimated from Analytics settings. Amounts are with VAT, as the money moved
 * (unlike the bridge above it); the rows add up to the money received. *Unknown* holds Stripe payments whose method was not read.
 */
export function PaymentsView({ currency, locale, report: r, words = financeEn }: { currency: string; locale: string; report: PaymentsByMethod; words?: FinanceMessages }) {
  const w = words.payments;
  const pct = financeNumbers(words).percent;
  const money = safeMoney(currency, locale);
  const columns: Column<PaymentMethodLine>[] = [
    { key: "method", label: w.method, cell: (l) => l.label },
    { key: "payments", label: w.payments, align: "right", cell: (l) => formatCount(l.payments) },
    { key: "received", label: w.received, align: "right", cell: (l) => money(l.receivedMinor) },
    { key: "share", label: w.share, align: "right", cell: (l) => (l.share === null ? NO_FIGURE : pct(l.share)) },
    { key: "refunded", label: w.refunded, align: "right", cell: (l) => money(l.refundedMinor) },
    { key: "fees", label: r.estimatedFeePayments > 0 ? w.feesEstimated : w.fees, align: "right", cell: (l) => (l.feesMinor === null ? w.none : money(l.feesMinor)) },
  ];
  return (
    <AnalyticsSection
      id="payment-methods"
      title={w.title}
      description={w.description}
    >
      {r.lines.length === 0 ? (
        <p className="text-sm text-muted">{w.empty}</p>
      ) : (
        <DataTable
          caption={w.caption}
          columns={columns}
          rows={r.lines}
          rowKey={(l) => l.key}
          exportId="finance.payment_methods"
          exportLeftOut={{ orders: r.unconverted, currencies: r.missingCurrencies }}
          footer={
            <tr className="text-ink">
              <th scope="row" className="px-3 py-2 text-left">{w.total}</th>
              <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.total.payments)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.receivedMinor)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.total.receivedMinor > 0 ? pct(1) : NO_FIGURE}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.refundedMinor)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.feesMinor)}</td>
            </tr>
          }
        />
      )}
      <div className="space-y-2">
        <Note>
          {r.realFeePayments > 0 && r.estimatedFeePayments === 0
            ? w.feesReal
            : r.realFeePayments > 0
              ? fillWords(w.feesPart, { real: formatCount(r.realFeePayments), all: formatCount(r.realFeePayments + r.estimatedFeePayments) })
              : w.feesEstimatedNote}
        </Note>
        {r.unknown > 0 && (
          <Note>{countWords(r.unknown, w.unknown, { n: formatCount(r.unknown) })}</Note>
        )}
        {r.unconverted > 0 && (
          <Note tone="warning">{countWords(r.unconverted, w.leftOut, { n: formatCount(r.unconverted), currencies: r.missingCurrencies.join(", "), them: r.missingCurrencies.length === 1 ? w.it : w.them })}</Note>
        )}
      </div>
    </AnalyticsSection>
  );
}
