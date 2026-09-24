import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatBps, isOnPlan, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { requireMember } from "@/server/auth";
import { getStoreBilling } from "@/server/billing";

import { openBillingPortalAction } from "../../actions";

export const metadata: Metadata = { title: "Plan" };

/** The store's plan with Kaizen, its fee per sale, and a way to Kaizen's invoices. */
export default async function BillingPage({ params }: PageProps<"/admin/[store]/billing">) {
  const { store, role } = await requireMember((await params).store);
  const billing = await getStoreBilling(store.id);
  const onPlan = isOnPlan(billing?.status);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="text-sm text-muted">What your store pays Kaizen.</p>
      </div>

      <section aria-labelledby="plan-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 id="plan-heading" className="mb-3 font-medium">
          {onPlan && billing?.planName ? billing.planName : "No plan yet"}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {onPlan && billing?.price && (
            <>
              <dt className="text-muted">Price</dt>
              <dd>
                {priceLabel(billing.price.amountMinor, billing.price.currency, billing.price.interval)}, excluding VAT
              </dd>
              <dt className="text-muted">Status</dt>
              <dd>{SUBSCRIPTION_LABELS[billing.status ?? ""] ?? billing.status}</dd>
              {billing.currentPeriodEnd && (
                <>
                  <dt className="text-muted">{billing.cancelAtPeriodEnd ? "Ends" : "Next invoice"}</dt>
                  <dd>{billing.currentPeriodEnd.slice(0, 10)}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-muted">Kaizen&apos;s fee</dt>
          <dd>{formatBps(billing?.feeBps ?? 0)} of each sale, taken when the shopper pays</dd>
        </dl>
        {!onPlan && (
          <p className="mt-3 text-muted">Kaizen will be in touch about plans. Your store works as normal meanwhile.</p>
        )}
      </section>

      {billing?.subscriptionId && role === "owner" && (
        <section aria-labelledby="invoices-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="invoices-heading" className="mb-1 font-medium">
            Invoices and payment
          </h2>
          <p className="mb-4 text-sm text-muted">
            Kaizen emails an invoice for each period. See them all, pay one, or save a card for the
            next ones in Stripe&apos;s billing page.
          </p>
          <ActionForm action={openBillingPortalAction.bind(null, store.slug)}>
            <SubmitButton>Open invoices and payment details</SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
