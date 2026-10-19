import { Card, Chip } from "@/components/admin/ui";
import {
  DISPUTE_STATUS_WORDS,
  disputeDashboardUrl,
  disputeNeedsResponse,
  disputeReasonWords,
  methodWords,
  riskShown,
  riskWords,
  type DisputeStatus,
} from "@/lib/payment-facts";

/** What the card draws: the shape `orderPaymentFacts()` returns, kept here so the view needs no server module. */
export type PaymentCardPayment = {
  id: string;
  provider: string;
  amountMinor: number;
  currency: string;
  methodType: string | null;
  wallet: string | null;
  cardBrand: string | null;
  manualMethod: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  read: boolean;
};

export type PaymentCardDispute = {
  id: string;
  reference: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: DisputeStatus;
  evidenceDueBy: string | null;
  outcome: "won" | "lost" | null;
  feeMinor: number | null;
  testMode: boolean;
};

/**
 * The order's payment on its page (wave 4 unit A, D288, `docs/wave-4-payments.md` 3): how it was paid as Stripe said (*Unknown* until read), Stripe's
 * risk outcome when it is elevated or highest, and each dispute with its reason, status, deadline in the store's time zone and the link to the store's
 * Stripe Dashboard, where evidence is sent. Nothing is guessed.
 */
export function PaymentCard({
  payments,
  disputes,
  money,
  due,
}: {
  payments: readonly PaymentCardPayment[];
  disputes: readonly PaymentCardDispute[];
  money: (minor: number, currency: string) => string;
  /** The deadline in the store's time zone. */
  due: (iso: string) => string;
}) {
  if (payments.length === 0 && disputes.length === 0) return null;
  return (
    <Card title="Payment" className="text-sm" compact>
      <ul className="flex flex-col gap-2">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{p.provider === "stripe" && !p.read ? "Unknown (not read from Stripe yet)" : methodWords(p)}</span>
              <span className="tabular-nums">{money(p.amountMinor, p.currency)}</span>
            </span>
            {riskShown(p.riskLevel) && (
              <span>
                <Chip signal={p.riskLevel === "highest" ? "danger" : "warning"} dot>
                  {riskWords(p.riskLevel)}
                  {p.riskScore !== null && ` (${p.riskScore} of 100)`}
                </Chip>
              </span>
            )}
          </li>
        ))}
      </ul>
      {disputes.map((d) => (
        <div key={d.id} className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
          <span className="flex flex-wrap items-center gap-2">
            <Chip signal={d.outcome === "won" ? "positive" : d.outcome === "lost" || disputeNeedsResponse(d.status) ? "danger" : "warning"} dot>
              {d.outcome === "lost" ? "Dispute lost" : d.outcome === "won" ? "Dispute closed" : "Disputed"}
            </Chip>
            <span className="tabular-nums">{money(d.amountMinor, d.currency)}</span>
          </span>
          <dl className="flex flex-col gap-1">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">Reason</dt>
              <dd className="min-w-0">{disputeReasonWords(d.reason)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">Status</dt>
              <dd className="min-w-0">{DISPUTE_STATUS_WORDS[d.status]}</dd>
            </div>
            {d.evidenceDueBy && !d.outcome && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Evidence due</dt>
                <dd className="min-w-0">{due(d.evidenceDueBy)}</dd>
              </div>
            )}
            {d.outcome === "lost" && d.feeMinor !== null && d.feeMinor > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">Stripe&apos;s fee</dt>
                <dd className="min-w-0 tabular-nums">{money(d.feeMinor, d.currency)}</dd>
              </div>
            )}
          </dl>
          {!d.outcome && <p className="text-xs text-muted">Evidence is sent in your Stripe Dashboard. Without it the dispute is lost.</p>}
          <a href={disputeDashboardUrl(d.reference, d.testMode)} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-10 items-center self-start rounded-pill border border-edge px-4">
            Open in Stripe
          </a>
        </div>
      ))}
    </Card>
  );
}
