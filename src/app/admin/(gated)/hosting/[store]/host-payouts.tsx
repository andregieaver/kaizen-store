import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StripeConnect } from "@/components/admin/stripe-connect";
import { formatMoney } from "@/lib/money";
import { accountStage, type AccountStage, type PaymentModeName } from "@/lib/stripe-account";
import type { HostEarning, HostStripeAccount } from "@/server/host-payments";
import { platformPublishableKey } from "@/server/stripe";

import { hostAccountSessionAction, hostCreateStripeAccountAction, hostRefreshStripeAccountAction } from "./actions";

const STAGE_TEXT: Record<AccountStage, string> = {
  not_started: "Not set up yet: guests cannot pay for your listings until it is.",
  needs_info: "Stripe needs a few more details before guests can pay you.",
  in_review: "Stripe is checking your details. This usually takes minutes, sometimes a day or two.",
  ready: "Ready: guests pay you directly, and Stripe pays out to your bank.",
};

/**
 * Where a host is paid (D71): their own Stripe account for the store's
 * mode, set up and managed with Stripe's embedded screens, and what their
 * bookings brought in with the store's commission.
 */
export function HostPayouts({
  storeSlug,
  mode,
  account,
  commissionPercent,
  earnings,
  locale,
}: {
  storeSlug: string;
  mode: PaymentModeName;
  account: HostStripeAccount | undefined;
  commissionPercent: number;
  earnings: HostEarning[];
  locale: string;
}) {
  const stage = accountStage(account ?? null);
  const publishableKey = platformPublishableKey(mode);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section aria-labelledby="payouts-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <div>
        <h2 id="payouts-heading" className="font-medium">
          {mode === "live" ? "Getting paid" : "Getting paid (test mode)"}
        </h2>
        <p className="text-sm">
          <span className="sr-only">Status: </span>
          {STAGE_TEXT[stage]}
        </p>
        <p className="text-sm text-muted">
          Guests pay your own Stripe account: you are the seller, and refunds come from it. The store keeps{" "}
          {commissionPercent} % of each payment as its commission.
          {mode === "test" && " The store is in test mode, so no real money moves: Kaizen set up a test account for you."}
        </p>
      </div>

      {stage === "not_started" && mode === "live" ? (
        <ActionForm action={hostCreateStripeAccountAction.bind(null, storeSlug)} successMessage="Account created.">
          <input type="hidden" name="mode" value={mode} />
          <p className="mb-3 text-sm text-muted">
            Stripe asks who you are and where to send your money; it takes about ten minutes. Have your ID and bank
            account ready.
          </p>
          <SubmitButton>Set up Stripe</SubmitButton>
        </ActionForm>
      ) : account && publishableKey && !account.managedByKaizen ? (
        <StripeConnect
          actions={{
            session: hostAccountSessionAction.bind(null, storeSlug, mode),
            refresh: hostRefreshStripeAccountAction.bind(null, storeSlug, mode),
          }}
          publishableKey={publishableKey}
          stage={stage}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Paid bookings</h3>
        {earnings.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Order</th>
                  <th className="py-1 pr-3 font-normal">Paid</th>
                  <th className="py-1 pr-3 text-right font-normal">Guest paid</th>
                  <th className="py-1 pr-3 text-right font-normal">Refunded</th>
                  <th className="py-1 text-right font-normal">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {earnings.map((e) => (
                  <tr key={e.orderId}>
                    <td className="py-1 pr-3">{e.number}</td>
                    <td className="py-1 pr-3">{date.format(new Date(e.placedAt))}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(e.paidMinor, e.currency, locale)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {e.refundedMinor > 0 ? formatMoney(e.refundedMinor, e.currency, locale) : "–"}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatMoney(e.commissionMinor, e.currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Kaizen&apos;s service fee and Stripe&apos;s fees also come off what you are paid; see them in your Stripe Dashboard.</p>
      </div>
    </section>
  );
}
