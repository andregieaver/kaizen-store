import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CustomerBar } from "@/components/admin/customer-bar";
import { InvoiceList } from "@/components/admin/plan-invoices";
import { PlanDiscount } from "@/components/admin/plan-discount";
import { formatBps, isOnPlan, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { billingMode, getStoreBilling, listPlans, listStoreInvoices } from "@/server/billing";
import { listStorePeople } from "@/server/platform-customers";
import { getStore } from "@/server/stores";

import { applyStoreDiscountAction, assignPlanAction, cancelPlanAction, setStoreFeeAction } from "../../actions";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Store plan" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** One store's plan with Kaizen: start, change or cancel it, and its fee. */
export default async function PlatformStorePage({ params }: PageProps<"/admin/platform/stores/[store]">) {
  await requirePlatformAdmin();
  const store = await getStore((await params).store);
  if (!store) notFound();
  const [billing, plans, people, invoices] = await Promise.all([
    getStoreBilling(store.id),
    listPlans(),
    listStorePeople(store.id),
    listStoreInvoices(store.id, 12),
  ]);
  const owner = people.find((p) => p.role === "owner");
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });
  if (!billing) notFound();
  const mode = billingMode();
  const onPlan = isOnPlan(billing.status);
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const currency = store.markets[0]?.currency ?? "NOK";
  const suggested =
    billing.priceId ??
    offered.flatMap((plan) => plan.prices).find((p) => p.active && p.currency === currency && p.interval === "month")?.id;

  return (
    <>
      <div>
        <p className="text-sm">
          <Link href="/admin/platform/stores" className="underline">
            Stores
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{store.name}</h1>
        <p className="text-sm text-muted">
          {billing.ownerEmail ?? "No owner yet"} · {store.details.country ?? "country not set"} ·{" "}
          <Link href={`/admin/${store.slug}`} className="underline">
            Open the store&apos;s admin
          </Link>
        </p>
      </div>

      {owner && (
        <CustomerBar
          customer={{
            href: `/admin/platform/customers/${owner.id}`,
            name: owner.name,
            email: owner.email,
            account: "verified",
            badge: `Owner of ${store.name}`,
            facts: [people.length === 1 ? "Runs the store alone" : `${people.length} people run the store`],
          }}
        />
      )}

      <section aria-labelledby="current-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 id="current-heading" className="mb-2 font-medium">
          Current plan
        </h2>
        {billing.planName && billing.status ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted">Plan</dt>
            <dd>
              {billing.planName}
              {billing.price && ` · ${priceLabel(billing.price.amountMinor, billing.price.currency, billing.price.interval)}`}
            </dd>
            <dt className="text-muted">Status</dt>
            <dd>
              {SUBSCRIPTION_LABELS[billing.status] ?? billing.status}
              {billing.cancelAtPeriodEnd && " · ends at the end of the period"}
              {billing.mode === "test" && " · test mode"}
            </dd>
            {billing.currentPeriodEnd && billing.status !== "canceled" && (
              <>
                <dt className="text-muted">{billing.cancelAtPeriodEnd ? "Ends" : "Next invoice"}</dt>
                <dd>{billing.currentPeriodEnd.slice(0, 10)}</dd>
              </>
            )}
            {billing.subscriptionId && (
              <>
                <dt className="text-muted">In Stripe</dt>
                <dd>
                  <a
                    href={`https://dashboard.stripe.com/${billing.mode === "test" ? "test/" : ""}subscriptions/${billing.subscriptionId}`}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {billing.subscriptionId}
                  </a>
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p>No plan. The store pays the default fee per sale.</p>
        )}
      </section>

      <section aria-labelledby="assign-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="assign-heading" className="mb-1 font-medium">
          {onPlan ? "Change plan" : "Start a plan"}
        </h2>
        {!mode ? (
          <p className="text-sm text-muted">Kaizen&apos;s Stripe keys are not set (Platform → Stripe).</p>
        ) : offered.length === 0 ? (
          <p className="text-sm text-muted">
            There are no plans to offer yet.{" "}
            <Link href="/admin/platform/plans" className="underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ActionForm action={assignPlanAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {onPlan
                ? "The change applies now; Stripe credits or charges the difference on the next invoice."
                : `Stripe emails the store an invoice for each period, due in 14 days${(store.details.country ?? "NO") === "NO" ? ", with 25 % Norwegian VAT" : ", without VAT (reverse charge)"}.`}
              {mode === "test" && " Kaizen is in test mode: no real invoices are sent."}
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Plan and price
              <select name="priceId" required defaultValue={suggested} className={control}>
                {offered.map((plan) => (
                  <optgroup key={plan.id} label={`${plan.name} (${formatBps(plan.saleFeeBps)} per sale)`}>
                    {plan.prices
                      .filter((price) => price.active)
                      .map((price) => (
                        <option key={price.id} value={price.id}>
                          {plan.name} · {priceLabel(price.amountMinor, price.currency, price.interval)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {!onPlan && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                Free trial (days)
                <input name="trialDays" type="number" min={0} max={730} defaultValue={0} className={`${control} w-32`} />
              </label>
            )}
            <div>
              <SubmitButton>{onPlan ? "Change plan" : "Start plan"}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      {onPlan && (
        <section aria-labelledby="cancel-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="cancel-heading" className="mb-3 font-medium">
            Cancel plan
          </h2>
          <ActionForm action={cancelPlanAction.bind(null, store.id)} className="flex flex-wrap gap-3">
            {billing.cancelAtPeriodEnd ? (
              <SubmitButton name="when" value="undo" variant="secondary">
                Keep the plan
              </SubmitButton>
            ) : (
              <SubmitButton name="when" value="period_end" variant="secondary">
                Cancel at the end of the period
              </SubmitButton>
            )}
            <SubmitButton name="when" value="now" variant="secondary">
              Cancel now
            </SubmitButton>
          </ActionForm>
        </section>
      )}

      {mode && (
        <PlanDiscount
          discount={billing.discount}
          apply={applyStoreDiscountAction.bind(null, store.slug)}
          remove={null}
          canEdit
        />
      )}

      <section aria-labelledby="fee-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="fee-heading" className="mb-1 font-medium">
          Fee per sale
        </h2>
        <p className="mb-3 text-sm text-muted">
          Now {formatBps(billing.feeBps)}
          {billing.saleFeeBpsOverride !== null ? " (the store's own fee)" : onPlan ? " (from its plan)" : " (the default)"}.
          Set a fee for this store only, or leave it empty to use its plan&apos;s.
        </p>
        <ActionForm action={setStoreFeeAction.bind(null, store.id)} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Own fee (%)
            <input
              name="fee"
              inputMode="decimal"
              defaultValue={billing.saleFeeBpsOverride === null ? "" : String(billing.saleFeeBpsOverride / 100)}
              className={`${control} w-32`}
            />
          </label>
          <SubmitButton>Save fee</SubmitButton>
        </ActionForm>
      </section>
      <section aria-labelledby="invoices-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="invoices-heading" className="mb-3 font-medium">
          Invoices
        </h2>
        <InvoiceList storeSlug={store.slug} invoices={invoices} date={date} />
      </section>

      <section aria-labelledby="people-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 id="people-heading" className="mb-3 font-medium">
          People
        </h2>
        {people.length === 0 ? (
          <p className="text-muted">Nobody runs the store yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((person) => (
              <li key={person.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/platform/customers/${person.id}`} className="underline">
                  {person.name || person.email}
                </Link>
                <span className="text-muted capitalize">{person.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
