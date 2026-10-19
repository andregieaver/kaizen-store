import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import type { PaymentMethodLine, PaymentsByMethod } from "@/lib/analytics-payments";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * Payments by method on the Finance page (wave 4 unit A, D288, docs/analytics.md "Payments by method"): what the period's paid orders were paid with, as
 * the provider said, with the money received, refunds and Stripe's fee estimated from Analytics settings. Amounts are with VAT, as the money moved
 * (unlike the bridge above it); the rows add up to the money received. *Unknown* holds Stripe payments whose method was not read.
 */
export function PaymentsView({ currency, locale, report: r }: { currency: string; locale: string; report: PaymentsByMethod }) {
  const money = safeMoney(currency, locale);
  const columns: Column<PaymentMethodLine>[] = [
    { key: "method", label: "Method", cell: (l) => l.label },
    { key: "payments", label: "Payments", align: "right", cell: (l) => formatCount(l.payments) },
    { key: "received", label: "Received (with VAT)", align: "right", cell: (l) => money(l.receivedMinor) },
    { key: "share", label: "Share", align: "right", cell: (l) => (l.share === null ? NO_FIGURE : formatPercent(l.share)) },
    { key: "refunded", label: "Refunded (with VAT)", align: "right", cell: (l) => money(l.refundedMinor) },
    { key: "fees", label: r.estimatedFeePayments > 0 ? "Fees (estimated)" : "Fees", align: "right", cell: (l) => (l.feesMinor === null ? "None" : money(l.feesMinor)) },
  ];
  return (
    <AnalyticsSection
      id="payment-methods"
      title="Payments by method"
      description="What the period's paid orders were paid with, as Stripe said. Amounts include VAT, as the money moved."
    >
      {r.lines.length === 0 ? (
        <p className="text-sm text-muted">No order was paid in this period.</p>
      ) : (
        <DataTable
          caption="Payments by method with the number of payments, the money received and its share, refunds and estimated fees"
          columns={columns}
          rows={r.lines}
          rowKey={(l) => l.key}
          exportId="finance.payment_methods"
          exportLeftOut={{ orders: r.unconverted, currencies: r.missingCurrencies }}
          footer={
            <tr className="text-ink">
              <th scope="row" className="px-3 py-2 text-left">Total</th>
              <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.total.payments)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.receivedMinor)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.total.receivedMinor > 0 ? formatPercent(1) : NO_FIGURE}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.refundedMinor)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.total.feesMinor)}</td>
            </tr>
          }
        />
      )}
      <div className="space-y-2">
        <Note>
          {r.realFeePayments > 0 && r.estimatedFeePayments === 0
            ? "Fees are what Stripe took, as Stripe reported it. Payments recorded by staff, a return's credit and payments at the venue have none."
            : r.realFeePayments > 0
              ? `Fees are what Stripe took for ${formatCount(r.realFeePayments)} of ${formatCount(r.realFeePayments + r.estimatedFeePayments)} payments through Stripe and estimated from the fee in Analytics settings for the rest. Payments recorded by staff, a return's credit and payments at the venue have none.`
              : "Fees are estimated from the fee in Analytics settings for payments through Stripe; payments recorded by staff, a return's credit and payments at the venue have none."}
        </Note>
        {r.unknown > 0 && (
          <Note>{`${formatCount(r.unknown)} ${r.unknown === 1 ? "payment's method is" : "payments' methods are"} not known yet: Kaizena Flow reads it from Stripe shortly after the payment.`}</Note>
        )}
        {r.unconverted > 0 && (
          <Note tone="warning">{`${formatCount(r.unconverted)} ${r.unconverted === 1 ? "payment" : "payments"} in ${r.missingCurrencies.join(", ")} ${r.unconverted === 1 ? "is" : "are"} left out: the store has no rate for ${r.missingCurrencies.length === 1 ? "it" : "them"}.`}</Note>
        )}
      </div>
    </AnalyticsSection>
  );
}
