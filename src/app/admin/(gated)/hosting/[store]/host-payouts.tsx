import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StripeConnect } from "@/components/admin/stripe-connect";
import { formatMoney } from "@/lib/money";
import { accountStage, type AccountStage, type PaymentModeName } from "@/lib/stripe-account";
import type { HostEarning, HostStripeAccount } from "@/server/host-payments";
import { platformPublishableKey } from "@/server/stripe";

import { hostAccountSessionAction, hostCreateStripeAccountAction, hostRefreshStripeAccountAction } from "./actions";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";


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
  words: w = adminText("en", "bookings").payouts,
  dateLocale = "en-GB",
}: {
  storeSlug: string;
  mode: PaymentModeName;
  account: HostStripeAccount | undefined;
  commissionPercent: number;
  earnings: HostEarning[];
  locale: string;
  /** The panel's words and dates (D312 A11); English when none are given. */
  words?: BookingsMessages["payouts"];
  dateLocale?: string;
}) {
  const STAGE_TEXT: Record<AccountStage, string> = w.stages;
  const stage = accountStage(account ?? null);
  const publishableKey = platformPublishableKey(mode);
  const date = new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <Card
      title={mode === "live" ? w.title : w.titleTest}
      description={
        <>
          {fillWords(w.description, { n: commissionPercent })}
          {mode === "test" && ` ${w.testMode}`}
        </>
      }
      className="flex flex-col gap-4"
      compact
    >
      <p className="text-body text-ink">
        <span className="sr-only">{w.status} </span>
        {STAGE_TEXT[stage]}
      </p>

      {stage === "not_started" && mode === "live" ? (
        <ActionForm action={hostCreateStripeAccountAction.bind(null, storeSlug)} successMessage={w.created}>
          <input type="hidden" name="mode" value={mode} />
          <p className="mb-3 text-sm text-muted">{w.setUpHint}</p>
          <SubmitButton>{w.setUp}</SubmitButton>
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
        <h3 className="text-body-strong text-ink">{w.payments}</h3>
        {earnings.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">{w.order}</th>
                  <th className="py-1 pr-3 font-normal">{w.for}</th>
                  <th className="py-1 pr-3 font-normal">{w.paid}</th>
                  <th className="py-1 pr-3 text-right font-normal">{w.guestPaid}</th>
                  <th className="py-1 pr-3 text-right font-normal">{w.refunded}</th>
                  <th className="py-1 pr-3 text-right font-normal">{w.commission}</th>
                  <th className="py-1 pr-3 text-right font-normal">{w.fee}</th>
                  <th className="py-1 text-right font-normal">{w.youGet}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {earnings.map((e) => (
                  <tr key={e.paymentId}>
                    <td className="py-1 pr-3">{e.number}</td>
                    <td className="py-1 pr-3">{e.kind === "no_show" ? w.noShowFee : w.booking}</td>
                    <td className="py-1 pr-3">{date.format(new Date(e.paidAt))}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(e.paidMinor, e.currency, locale)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {e.refundedMinor > 0 ? formatMoney(e.refundedMinor, e.currency, locale) : "–"}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(e.commissionMinor, e.currency, locale)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(e.kaizenFeeMinor, e.currency, locale)}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{formatMoney(e.netMinor, e.currency, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">{w.footnote}</p>
      </div>
    </Card>
  );
}
