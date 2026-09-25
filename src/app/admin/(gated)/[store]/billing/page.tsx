import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PlanDiscount } from "@/components/admin/plan-discount";
import { formatMoney } from "@/lib/money";
import { formatBps, isOnPlan, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { requireMember } from "@/server/auth";
import { planRemindersOn, planRemindersOptedOut } from "@/server/plan-reminders";
import { billingMode, completePlanCheckout, getStoreBilling, listPlans, type Plan, type StoreBilling } from "@/server/billing";

import {
  applyPlanDiscountAction,
  choosePlanAction,
  openBillingPortalAction,
  ownerCancelPlanAction,
  planRemindersOptOutAction,
  removePlanDiscountAction,
} from "../../actions";

export const metadata: Metadata = { title: "Plan" };

/** The store's plan with Kaizen: choose or change it, its fee per sale, and Kaizen's invoices. */
export default async function BillingPage({ params, searchParams }: PageProps<"/admin/[store]/billing">) {
  const { store, role, account } = await requireMember((await params).store);
  const { checkout } = await searchParams;
  // Back from Stripe Checkout: record the new plan now rather than waiting for the webhook.
  if (typeof checkout === "string") await completePlanCheckout(store.id, checkout);

  const [billing, plans] = await Promise.all([getStoreBilling(store.id), listPlans()]);
  const isOwner = role === "owner";
  const [reminders, optedOut] = await Promise.all([planRemindersOn(), planRemindersOptedOut(account.id)]);
  const mode = billingMode();
  const onPlan = isOnPlan(billing?.status) && billing?.mode === mode;
  const current = plans.find((plan) => plan.id === billing?.planId);
  const inNorway = (store.details.country ?? "NO") === "NO";

  // Prices in the store's own currency, else in NOK.
  const storeCurrency = store.markets[0]?.currency ?? "NOK";
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const currency = offered.some((plan) => plan.prices.some((p) => p.active && p.currency === storeCurrency))
    ? storeCurrency
    : "NOK";

  // A code waiting for the plan to be chosen: the plans show what they cost with it.
  const waiting = billing?.discount && !billing.discount.appliedAt ? billing.discount : null;
  const codeField = (
    <PlanDiscount
      discount={billing?.discount ?? null}
      apply={applyPlanDiscountAction.bind(null, store.slug)}
      remove={removePlanDiscountAction.bind(null, store.slug)}
      canEdit={isOwner}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="text-sm text-muted">
          What {store.name} pays Kaizen. Each store has its own plan.
        </p>
      </div>

      <section aria-labelledby="plan-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 id="plan-heading" className="mb-3 font-medium">
          {onPlan && billing?.planName ? `Your plan: ${billing.planName}` : "No plan yet"}
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
                  <dt className="text-muted">{billing.cancelAtPeriodEnd ? "Ends" : "Renews"}</dt>
                  <dd>{billing.currentPeriodEnd.slice(0, 10)}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-muted">Kaizen&apos;s fee</dt>
          <dd>{formatBps(billing?.feeBps ?? 0)} of each sale, taken when the shopper pays</dd>
        </dl>
        {mode === "test" && <p className="mt-3 text-muted">Kaizen is in test mode: no real money is charged.</p>}
      </section>

      {/* On a running plan a code applies at once; otherwise it goes with the plan chosen below (D38). */}
      {mode && onPlan && (isOwner || billing?.discount) && codeField}

      {offered.length > 0 && mode && (
        <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="plans-heading" className="font-medium">
              {onPlan ? "Change plan" : "Choose a plan"}
            </h2>
            <p className="text-sm text-muted">
              Prices exclude VAT{inNorway ? "; 25 % MVA is added" : ""}. Paying yearly costs less.{" "}
              {onPlan
                ? "A change applies at once: the difference is credited or charged on your next invoice."
                : "You pay by card on Stripe's secure page, and can change or cancel at any time."}
            </p>
            {!isOwner && <p className="text-sm text-muted">Only an owner of the store can change its plan.</p>}
          </div>
          {!onPlan && (isOwner || billing?.discount) && codeField}
          {!onPlan && isOwner && reminders && (
            <form action={planRemindersOptOutAction.bind(null, store.slug, !optedOut)} className="text-sm text-muted">
              {optedOut
                ? "Kaizen sends you no reminders about plans you start paying for. "
                : "If you go to pay and do not finish, Kaizen may email you a reminder. "}
              <button type="submit" className="underline hover:text-foreground">
                {optedOut ? "Send me reminders" : "Do not send me reminders"}
              </button>
            </form>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {offered.map((plan) => (
              <li key={plan.id}>
                <PlanCard
                  plan={plan}
                  currency={currency}
                  currentPriceId={onPlan ? billing?.priceId ?? null : null}
                  currentPosition={onPlan ? current?.position ?? null : null}
                  storeSlug={store.slug}
                  disabled={!isOwner}
                  discount={onPlan ? null : waiting}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {onPlan && isOwner && (
        <section aria-labelledby="manage-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="manage-heading" className="mb-1 font-medium">
            Invoices and payment
          </h2>
          <p className="mb-4 text-sm text-muted">
            See all of Kaizen&apos;s invoices, pay an open one, or change the card you pay with.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={openBillingPortalAction.bind(null, store.slug)}>
              <SubmitButton>Invoices and payment details</SubmitButton>
            </ActionForm>
            <ActionForm action={ownerCancelPlanAction.bind(null, store.slug)}>
              {billing?.cancelAtPeriodEnd ? (
                <SubmitButton name="when" value="undo" variant="secondary">
                  Keep my plan
                </SubmitButton>
              ) : (
                <SubmitButton name="when" value="period_end" variant="secondary">
                  Cancel at the end of the period
                </SubmitButton>
              )}
            </ActionForm>
          </div>
        </section>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  currency,
  currentPriceId,
  currentPosition,
  storeSlug,
  disabled,
  discount,
}: {
  plan: Plan;
  currency: string;
  currentPriceId: string | null;
  currentPosition: number | null;
  storeSlug: string;
  disabled: boolean;
  /** A code waiting for the plan to be chosen (D38). */
  discount: NonNullable<StoreBilling["discount"]> | null;
}) {
  const monthly = plan.prices.find((p) => p.active && p.currency === currency && p.interval === "month");
  const yearly = plan.prices.find((p) => p.active && p.currency === currency && p.interval === "year");
  const isCurrent = plan.prices.some((p) => p.id === currentPriceId);
  const saving = monthly && yearly ? Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100) : 0;
  const verb =
    currentPosition === null ? "Choose" : plan.position > currentPosition ? "Upgrade" : plan.position < currentPosition ? "Downgrade" : "Switch";

  const button = (price: typeof monthly, label: string) =>
    price &&
    (price.id === currentPriceId ? (
      <p className="flex min-h-10 items-center justify-center rounded-md border border-foreground px-4 text-sm font-medium">
        Current plan · {label}
      </p>
    ) : (
      <SubmitButton name="priceId" value={price.id} disabled={disabled} variant={label === "yearly" ? "primary" : "secondary"}>
        {verb} · {label}
      </SubmitButton>
    ));

  return (
    <article
      aria-labelledby={`card-${plan.id}`}
      className={`flex h-full flex-col gap-4 rounded-lg border bg-background p-5 ${isCurrent ? "border-foreground" : "border-border"}`}
    >
      <div>
        <h3 id={`card-${plan.id}`} className="text-lg font-semibold">
          {plan.name}
        </h3>
        {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
      </div>
      <div className="text-sm">
        {monthly && (
          <p>
            <span className="text-xl font-semibold">{formatMoney(monthly.amountMinor, currency, "nb-NO")}</span> / month
          </p>
        )}
        {yearly && (
          <p className="text-muted">
            or {formatMoney(yearly.amountMinor, currency, "nb-NO")} / year{saving > 0 ? ` (save ${saving} %)` : ""}
          </p>
        )}
        {discount && (monthly || yearly) && (
          <WithCode discount={discount} currency={currency} monthly={monthly?.amountMinor} yearly={yearly?.amountMinor} />
        )}
        <p className="mt-2">{formatBps(plan.saleFeeBps)} Kaizen fee per sale</p>
      </div>
      <ActionForm action={choosePlanAction.bind(null, storeSlug)} className="mt-auto flex flex-col gap-2">
        {button(yearly, "yearly")}
        {button(monthly, "monthly")}
      </ActionForm>
    </article>
  );
}

/** What a plan costs with the code waiting for it, and for how long. */
function WithCode({
  discount,
  currency,
  monthly,
  yearly,
}: {
  discount: NonNullable<StoreBilling["discount"]>;
  currency: string;
  monthly: number | undefined;
  yearly: number | undefined;
}) {
  const off = (minor: number) =>
    discount.kind === "percent"
      ? Math.round((minor * (100 - discount.percent)) / 100)
      : Math.max(0, minor - (discount.amounts[currency.toLowerCase()] ?? minor));
  // A fixed amount in another currency does not apply to this price.
  if (discount.kind === "fixed" && discount.amounts[currency.toLowerCase()] === undefined) return null;
  const how =
    discount.duration === "once"
      ? "on the first payment"
      : discount.duration === "repeating"
        ? `for ${discount.durationMonths} ${discount.durationMonths === 1 ? "month" : "months"}`
        : "for as long as the plan runs";
  const price = (minor: number) => formatMoney(off(minor), currency, "nb-NO");
  return (
    <p className="mt-2 rounded-md bg-surface px-2 py-1">
      With <span className="font-mono font-medium">{discount.code}</span>:{" "}
      {[monthly !== undefined && `${price(monthly)} / month`, yearly !== undefined && `${price(yearly)} / year`]
        .filter(Boolean)
        .join(" or ")}
      , {how}
    </p>
  );
}
