import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatBps, PLAN_INTERVALS, priceLabel, type PlanInterval } from "@/lib/plans";
import { formatPriceInput } from "@/lib/product-input";
import { listPlans, planCurrencies, type Plan } from "@/server/billing";
import { platformModes } from "@/server/stripe";

import { savePlanAction, syncPlansAction } from "../actions";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Plans" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const INTERVAL_LABEL: Record<PlanInterval, string> = { month: "Per month", year: "Per year" };

/** Kaizen's plans for stores: tiers, prices and fees, kept in step with Stripe. */
export default async function PlansPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [plans, currencies] = await Promise.all([listPlans(), planCurrencies()]);
  const modes = platformModes();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Plans</h1>
          <p className="max-w-2xl text-sm text-muted">
            What stores pay Kaizen: a price per month or year (excluding VAT; Norwegian stores are
            charged 25 % MVA on top) and a fee on each of their sales. Saving copies the plan to
            Stripe. A changed price applies to new subscriptions; stores on the old price keep it
            until you move them.
          </p>
        </div>
        <ActionForm action={syncPlansAction} successMessage="Plans are up to date in Stripe." className="flex flex-col items-end gap-1">
          <SubmitButton disabled={modes.length === 0}>Sync to Stripe</SubmitButton>
          <p className="text-sm text-muted">
            {modes.length === 0
              ? "Needs Kaizen's Stripe keys"
              : modes
                  .map((mode) => `${plans.filter((plan) => plan.sync[mode]?.synced).length} of ${plans.length} plans in Stripe (${mode})`)
                  .join(" · ")}
          </p>
        </ActionForm>
      </div>

      {modes.length === 0 && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          Kaizen&apos;s Stripe keys are not set, so plans are saved here only. Once the keys are in
          place (Platform → Stripe), press Sync to Stripe: each plan becomes a Stripe product with
          a monthly and a yearly price in every currency.
        </p>
      )}

      {plans.map((plan) => (
        <section
          key={plan.id}
          aria-labelledby={`plan-${plan.id}`}
          className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`plan-${plan.id}`} className="font-medium">
              {plan.name}
              {!plan.active && <span className="ml-2 text-sm font-normal text-muted">(archived)</span>}
            </h2>
            <p className="text-sm text-muted">
              {plan.stores === 1 ? "1 store" : `${plan.stores} stores`} · {formatBps(plan.saleFeeBps)} per sale ·{" "}
              {modes.map((mode) => {
                const sync = plan.sync[mode];
                return (
                  <span key={mode} className={sync?.error ? "text-red-700 dark:text-red-400" : ""}>
                    {sync?.synced ? `in Stripe (${mode})` : sync?.error ? `Stripe (${mode}): ${sync.error}` : `not in Stripe (${mode}) yet`}{" "}
                  </span>
                );
              })}
            </p>
          </div>
          <ActionForm action={savePlanAction.bind(null, plan.id)} className="flex flex-col gap-4">
            <PlanFields plan={plan} currencies={currencies} />
            <div>
              <SubmitButton>Save plan</SubmitButton>
            </div>
          </ActionForm>
          <OldPrices plan={plan} />
        </section>
      ))}

      <section aria-labelledby="new-plan" className="flex flex-col gap-4 rounded-lg border border-dashed border-border bg-background p-5">
        <h2 id="new-plan" className="font-medium">
          New plan
        </h2>
        <ActionForm action={savePlanAction.bind(null, null)} replaceOnSuccess className="flex flex-col gap-4">
          <PlanFields plan={null} currencies={currencies} position={plans.length} />
          <div>
            <SubmitButton>Create plan</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </>
  );
}

function PlanFields({ plan, currencies, position = 0 }: { plan: Plan | null; currencies: string[]; position?: number }) {
  const id = plan?.id ?? "new";
  const current = (currency: string, interval: PlanInterval) =>
    plan?.prices.find((p) => p.active && p.currency === currency && p.interval === interval);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input name="name" required defaultValue={plan?.name ?? ""} placeholder="e.g. Basic" className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fee per sale (%)
          <input
            name="fee"
            required
            inputMode="decimal"
            defaultValue={plan ? String(plan.saleFeeBps / 100) : "0"}
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Order
          <input
            name="position"
            type="number"
            min={0}
            defaultValue={plan?.position ?? position}
            aria-describedby={`position-hint-${id}`}
            className={control}
          />
          <span id={`position-hint-${id}`} className="font-normal text-muted">
            Lowest tier first
          </span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Description
        <textarea
          name="description"
          rows={2}
          defaultValue={plan?.description ?? ""}
          placeholder="What the plan includes. Shown to store owners and on Stripe invoices."
          className={`${control} py-2`}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Price, excluding VAT</legend>
        <p className="mb-2 text-sm text-muted">Leave a field empty to not offer that price.</p>
        <table className="text-sm">
          <thead>
            <tr>
              <th scope="col" className="pr-4 text-left font-normal text-muted">
                <span className="sr-only">Currency</span>
              </th>
              {PLAN_INTERVALS.map((interval) => (
                <th key={interval} scope="col" className="pr-4 text-left font-normal text-muted">
                  {INTERVAL_LABEL[interval]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currencies.map((currency) => (
              <tr key={currency}>
                <th scope="row" className="pr-4 text-left font-medium">
                  {currency}
                </th>
                {PLAN_INTERVALS.map((interval) => {
                  const price = current(currency, interval);
                  return (
                    <td key={interval} className="py-1 pr-4">
                      <input
                        name={`price:${currency}:${interval}`}
                        inputMode="decimal"
                        aria-label={`${INTERVAL_LABEL[interval]} in ${currency}`}
                        defaultValue={price ? formatPriceInput(price.amountMinor, currency) : ""}
                        className={`${control} w-32`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={plan?.active ?? true} className="size-4" />
        Offered to stores (uncheck to archive; stores on it keep it)
      </label>
    </>
  );
}

function OldPrices({ plan }: { plan: Plan }) {
  const old = plan.prices.filter((price) => !price.active && price.stores > 0);
  if (old.length === 0) return null;
  return (
    <p className="text-sm text-muted">
      Older prices still paid by stores:{" "}
      {old
        .map(
          (price) =>
            `${priceLabel(price.amountMinor, price.currency, price.interval)} (${price.stores === 1 ? "1 store" : `${price.stores} stores`})`,
        )
        .join(", ")}
      . Move them on the store&apos;s page under Stores.
    </p>
  );
}
