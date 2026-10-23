import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatBps, PLAN_INTERVALS, priceLabel, type PlanInterval } from "@/lib/plans";
import { formatPriceInput } from "@/lib/product-input";
import { listPlans, planCurrencies, type Plan } from "@/server/billing";
import { platformModes } from "@/server/stripe";

import { savePlanAction, syncPlansAction } from "../actions";
import { requirePlatformAdmin } from "@/server/auth";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

export const metadata: Metadata = { title: "Plans" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
type W = PlatformMessages["plans"];
const intervalLabel = (w: W, interval: PlanInterval) => (interval === "month" ? w.perMonth : w.perYear);
const storesText = (w: W, n: number) => (n === 1 ? w.oneStore : fillWords(w.stores, { n }));

/** Kaizen's plans for stores: tiers, prices and fees, kept in step with Stripe. */
export default async function PlansPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").plans;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const intervals = adminText(lang, "billing").intervals;
  const [plans, currencies] = await Promise.all([listPlans(), planCurrencies()]);
  const modes = platformModes();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title={w.title}
          description={<>{w.description}{" "}<Link href="/admin/platform/plans/features" className="underline">{w.sayIncludes}</Link>.</>}
        />
        <ActionForm action={syncPlansAction} successMessage={w.synced} className="flex flex-col items-end gap-1">
          <SubmitButton disabled={modes.length === 0}>{w.sync}</SubmitButton>
          <p className="text-sm text-muted">
            {modes.length === 0
              ? w.needsKeys
              : modes
                  .map((mode) => fillWords(w.inStripeCount, { n: plans.filter((plan) => plan.sync[mode]?.synced).length, total: plans.length, mode }))
                  .join(" · ")}
          </p>
        </ActionForm>
      </div>

      {modes.length === 0 && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {w.noKeys}
        </p>
      )}

      {plans.map((plan) => (
        <section
          key={plan.id}
          aria-labelledby={`plan-${plan.id}`}
          className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`plan-${plan.id}`} className="text-title text-ink">
              {plan.name}
              {!plan.active && <span className="ml-2 text-sm font-normal text-muted">{w.archived}</span>}
            </h2>
            <p className="text-sm text-muted">
              {storesText(w, plan.stores)} · {fillWords(w.perSale, { fee: formatBps(plan.saleFeeBps, locale) })} ·{" "}
              {modes.map((mode) => {
                const sync = plan.sync[mode];
                return (
                  <span key={mode} className={sync?.error ? "text-danger-text" : ""}>
                    {sync?.synced ? fillWords(w.inStripe, { mode }) : sync?.error ? fillWords(w.stripeError, { mode, error: sync.error }) : fillWords(w.notInStripe, { mode })}{" "}
                  </span>
                );
              })}
            </p>
          </div>
          <ActionForm action={savePlanAction.bind(null, plan.id)} className="flex flex-col gap-4">
            <PlanFields plan={plan} currencies={currencies} w={w} />
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
          <OldPrices plan={plan} w={w} intervals={intervals} />
        </section>
      ))}

      <section aria-labelledby="new-plan" className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
        <h2 id="new-plan" className="text-title text-ink">
          {w.newPlan}
        </h2>
        <ActionForm action={savePlanAction.bind(null, null)} replaceOnSuccess className="flex flex-col gap-4">
          <PlanFields plan={null} currencies={currencies} position={plans.length} w={w} />
          <div>
            <SubmitButton>{w.create}</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </>
  );
}

function PlanFields({ plan, currencies, position = 0, w }: { plan: Plan | null; currencies: string[]; position?: number; w: W }) {
  const id = plan?.id ?? "new";
  const current = (currency: string, interval: PlanInterval) =>
    plan?.prices.find((p) => p.active && p.currency === currency && p.interval === interval);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input name="name" required defaultValue={plan?.name ?? ""} placeholder={w.namePlaceholder} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.fee}
          <input
            name="fee"
            required
            inputMode="decimal"
            defaultValue={plan ? String(plan.saleFeeBps / 100) : "0"}
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.order}
          <input
            name="position"
            type="number"
            min={0}
            defaultValue={plan?.position ?? position}
            aria-describedby={`position-hint-${id}`}
            className={control}
          />
          <span id={`position-hint-${id}`} className="font-normal text-muted">
            {w.orderHint}
          </span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.descriptionField}
        <textarea
          name="description"
          rows={2}
          defaultValue={plan?.description ?? ""}
          placeholder={w.descriptionPlaceholder}
          className={`${control} py-2`}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{w.price}</legend>
        <p className="mb-2 text-sm text-muted">{w.priceNote}</p>
        <table className="text-sm">
          <thead>
            <tr>
              <th scope="col" className="pr-4 text-left font-normal text-muted">
                <span className="sr-only">{w.currency}</span>
              </th>
              {PLAN_INTERVALS.map((interval) => (
                <th key={interval} scope="col" className="pr-4 text-left font-normal text-muted">
                  {intervalLabel(w, interval)}
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
                        aria-label={fillWords(w.priceIn, { interval: intervalLabel(w, interval), currency })}
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
        {w.offered}
      </label>
    </>
  );
}

function OldPrices({ plan, w, intervals }: { plan: Plan; w: W; intervals: Record<PlanInterval, string> }) {
  const old = plan.prices.filter((price) => !price.active && price.stores > 0);
  if (old.length === 0) return null;
  return (
    <p className="text-sm text-muted">
      {w.older}{" "}
      {old
        .map(
          (price) =>
            `${priceLabel(price.amountMinor, price.currency, price.interval, intervals)} (${storesText(w, price.stores)})`,
        )
        .join(", ")}
      . {w.moveThem}
    </p>
  );
}
