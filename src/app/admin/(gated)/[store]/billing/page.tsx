import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PlanDiscount } from "@/components/admin/plan-discount";
import { PlanFeatureTable } from "@/components/plan-feature-table";
import { formatMoney } from "@/lib/money";
import { formatBps, isOnPlan, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requireOwnerRole } from "@/server/permissions";
import { getFeatureMatrix } from "@/server/plan-features";
import { planRemindersOn, planRemindersOptedOut } from "@/server/plan-reminders";
import { billingMode, completePlanCheckout, getStoreBilling, listPlans, type Plan, type StoreBilling } from "@/server/billing";
import { Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { PURCHASE_STATUS_WORDS, priceText } from "@/lib/theme-prices";
import { storeThemePurchases, type ThemePurchase } from "@/server/theme-prices";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { BillingMessages } from "@/lib/admin-messages/billing.en";
import { PeaksForm, UsageDays, UsageLines } from "@/components/admin/usage-limits";
import { storePeaks } from "@/server/capacity-events";
import { addPeakAction, removePeakAction } from "./peak-actions";
import { storeUsageLines, usageDays } from "@/server/usage";

/** A share of a sale in the admin's language: `formatBps()`'s English, or the number written the language's way ("2,5 %"). */
const feeText = (bps: number, locale: string) => (locale.startsWith("en") ? formatBps(bps) : `${(bps / 100).toLocaleString(locale, { maximumFractionDigits: 2 })} %`);

import {
  applyPlanDiscountAction,
  choosePlanAction,
  openBillingPortalAction,
  ownerCancelPlanAction,
  planRemindersOptOutAction,
  removePlanDiscountAction,
} from "../../actions";

export const metadata: Metadata = { title: "Billing" };

/** The store's plan with Kaizen: choose or change it, its fee per sale, and Kaizen's invoices. */
export default async function BillingPage({ params, searchParams }: PageProps<"/admin/[store]/billing">) {
  const staffer = await requireOwnerRole((await params).store);
  const { store, account } = staffer;
  const { checkout } = await searchParams;
  // Back from Stripe Checkout: record the new plan now rather than waiting for the webhook.
  if (typeof checkout === "string") await completePlanCheckout(store.id, checkout);

  const [billing, plans, matrix, themes, usage, usageByDay, peaks] = await Promise.all([
    getStoreBilling(store.id),
    listPlans(),
    getFeatureMatrix(),
    storeThemePurchases(store.id),
    storeUsageLines(store.id),
    usageDays(store.id),
    storePeaks(store.id),
  ]);
  const isOwner = memberCan(staffer, "owner");
  const [reminders, optedOut] = await Promise.all([planRemindersOn(), planRemindersOptedOut(account.id)]);
  const mode = billingMode();
  const onPlan = isOnPlan(billing?.status) && billing?.mode === mode;
  const current = plans.find((plan) => plan.id === billing?.planId);
  const inNorway = (store.details.country ?? "NO") === "NO";
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "billing");
  const w = words.page;
  const cw = adminText(lang, "capacity");
  const moneyLocale = lang === "en" ? "nb-NO" : locale;

  // Prices in the store's own currency, else in the first one the plans have.
  const storeCurrency = mainCurrency(store);
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const currency = offered.some((plan) => plan.prices.some((p) => p.active && p.currency === storeCurrency))
    ? storeCurrency
    : (offered.flatMap((plan) => plan.prices).find((p) => p.active)?.currency ?? storeCurrency);

  // A code waiting for the plan to be chosen: the plans show what they cost with it.
  const waiting = billing?.discount && !billing.discount.appliedAt ? billing.discount : null;
  const codeField = (
    <PlanDiscount
      discount={billing?.discount ?? null}
      apply={applyPlanDiscountAction.bind(null, store.slug)}
      remove={removePlanDiscountAction.bind(null, store.slug)}
      canEdit={isOwner}
      words={words}
      locale={moneyLocale}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={fillWords(w.description, { store: store.name })} />

      <Card title={<>{onPlan && billing?.planName ? fillWords(w.yourPlan, { name: billing.planName }) : w.noPlan}</>} className="text-sm" compact>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {onPlan && billing?.price && (
            <>
              <dt className="text-muted">{w.price}</dt>
              <dd>
                {fillWords(w.priceLine, {
                  price:
                    lang === "en"
                      ? priceLabel(billing.price.amountMinor, billing.price.currency, billing.price.interval)
                      : `${formatMoney(billing.price.amountMinor, billing.price.currency, moneyLocale)} / ${words.intervals[billing.price.interval]}`,
                })}
              </dd>
              <dt className="text-muted">{w.status}</dt>
              <dd>{(lang === "en" ? SUBSCRIPTION_LABELS : words.statuses)[billing.status ?? ""] ?? billing.status}</dd>
              {billing.currentPeriodEnd && (
                <>
                  <dt className="text-muted">{billing.cancelAtPeriodEnd ? w.ends : w.renews}</dt>
                  <dd>{billing.currentPeriodEnd.slice(0, 10)}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-muted">{w.fee}</dt>
          <dd>{fillWords(w.feeLine, { fee: feeText(billing?.feeBps ?? 0, locale) })}</dd>
        </dl>
        {mode === "test" && <p className="mt-3 text-muted">{w.testMode}</p>}
      </Card>

      <Card title={cw.usage.title} description={cw.usage.description} compact>
        <div className="grid gap-4">
          <UsageLines lines={usage} words={cw} locale={locale} plansHref="#plans-heading" />
          <UsageDays days={usageByDay} words={cw} locale={locale} />
        </div>
      </Card>

      <Card title={cw.peaks.title} description={cw.peaks.description} compact>
        <PeaksForm peaks={peaks} words={cw} add={addPeakAction.bind(null, store.slug)} remove={(id) => removePeakAction.bind(null, store.slug, id)} />
      </Card>

      {/* On a running plan a code applies at once; otherwise it goes with the plan chosen below (D38). */}
      {mode && onPlan && (isOwner || billing?.discount) && codeField}

      {offered.length > 0 && mode && (
        <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="plans-heading" className="text-title text-ink">
              {onPlan ? w.changePlan : w.choosePlan}
            </h2>
            <p className="text-sm text-muted">
              {w.pricesExclude}
              {inNorway ? w.norwayVat : ""}
              {lang === "en" ? "." : ""} {w.yearlyCheaper} {onPlan ? w.changeApplies : w.payByCard}
            </p>
            {!isOwner && <p className="text-sm text-muted">{w.ownerOnly}</p>}
          </div>
          {!onPlan && (isOwner || billing?.discount) && codeField}
          {!onPlan && isOwner && reminders && (
            <form action={planRemindersOptOutAction.bind(null, store.slug, !optedOut)} className="text-sm text-muted">
              {optedOut ? w.noReminders : w.mayRemind}
              <button type="submit" className="underline hover:text-ink">
                {optedOut ? w.sendReminders : w.stopReminders}
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
                  words={words}
                  locale={locale}
                  moneyLocale={moneyLocale}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {offered.length > 0 && matrix.features.some((feature) => feature.planIds.length > 0) && (
        <section aria-labelledby="compare-heading" className="flex flex-col gap-3">
          <h2 id="compare-heading" className="text-title text-ink">
            {w.compare}
          </h2>
          <PlanFeatureTable matrix={matrix} planIds={offered.map((plan) => plan.id)} current={onPlan ? billing?.planId : null} />
        </section>
      )}

      {themes.length > 0 && <ThemePurchases purchases={themes} words={words} lang={lang} />}

      {onPlan && isOwner && (
        <Card title={w.invoicesTitle} compact>
          <p className="mb-4 text-sm text-muted">{w.invoicesNote}</p>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={openBillingPortalAction.bind(null, store.slug)}>
              <SubmitButton>{w.invoicesButton}</SubmitButton>
            </ActionForm>
            <ActionForm action={ownerCancelPlanAction.bind(null, store.slug)}>
              {billing?.cancelAtPeriodEnd ? (
                <SubmitButton name="when" value="undo" variant="secondary">
                  {w.keepPlan}
                </SubmitButton>
              ) : (
                <SubmitButton name="when" value="period_end" variant="secondary">
                  {w.cancelEnd}
                </SubmitButton>
              )}
            </ActionForm>
          </div>
        </Card>
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
  words,
  locale,
  moneyLocale,
}: {
  plan: Plan;
  currency: string;
  currentPriceId: string | null;
  currentPosition: number | null;
  storeSlug: string;
  disabled: boolean;
  /** A code waiting for the plan to be chosen (D38). */
  discount: NonNullable<StoreBilling["discount"]> | null;
  words: BillingMessages;
  locale: string;
  moneyLocale: string;
}) {
  const w = words.card;
  const monthly = plan.prices.find((p) => p.active && p.currency === currency && p.interval === "month");
  const yearly = plan.prices.find((p) => p.active && p.currency === currency && p.interval === "year");
  const isCurrent = plan.prices.some((p) => p.id === currentPriceId);
  const saving = monthly && yearly ? Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100) : 0;
  const verb =
    currentPosition === null ? w.verbs.choose : plan.position > currentPosition ? w.verbs.upgrade : plan.position < currentPosition ? w.verbs.downgrade : w.verbs.switch;

  const button = (price: typeof monthly, interval: "yearly" | "monthly") => {
    const label = w[interval];
    return (
    price &&
    (price.id === currentPriceId ? (
      <p className="flex min-h-10 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium">
        {fillWords(w.current, { label })}
      </p>
    ) : (
      <SubmitButton name="priceId" value={price.id} disabled={disabled} variant={interval === "yearly" ? "primary" : "secondary"}>
        {verb} · {label}
      </SubmitButton>
    ))
    );
  };

  return (
    <article
      aria-labelledby={`card-${plan.id}`}
      className={`flex h-full flex-col gap-4 rounded-panel border bg-card p-5 ${isCurrent ? "border-brand" : "border-line"}`}
    >
      <div>
        <h3 id={`card-${plan.id}`} className="text-body-strong text-ink">
          {plan.name}
        </h3>
        {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
      </div>
      <div className="text-sm">
        {monthly && (
          <p>
            <span className="text-xl font-medium">{formatMoney(monthly.amountMinor, currency, moneyLocale)}</span>
            {w.perMonth}
          </p>
        )}
        {yearly && (
          <p className="text-muted">
            {fillWords(w.orYear, { price: formatMoney(yearly.amountMinor, currency, moneyLocale) })}
            {saving > 0 ? fillWords(w.save, { n: saving }) : ""}
          </p>
        )}
        {discount && (monthly || yearly) && (
          <WithCode discount={discount} currency={currency} monthly={monthly?.amountMinor} yearly={yearly?.amountMinor} words={words} moneyLocale={moneyLocale} />
        )}
        <p className="mt-2">{fillWords(w.feePerSale, { fee: feeText(plan.saleFeeBps, locale) })}</p>
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
  words,
  moneyLocale,
}: {
  discount: NonNullable<StoreBilling["discount"]>;
  currency: string;
  monthly: number | undefined;
  yearly: number | undefined;
  words: BillingMessages;
  moneyLocale: string;
}) {
  const w = words.card;
  const off = (minor: number) =>
    discount.kind === "percent"
      ? Math.round((minor * (100 - discount.percent)) / 100)
      : Math.max(0, minor - (discount.amounts[currency.toLowerCase()] ?? minor));
  // A fixed amount in another currency does not apply to this price.
  if (discount.kind === "fixed" && discount.amounts[currency.toLowerCase()] === undefined) return null;
  const how =
    discount.duration === "once" ? w.once : discount.duration === "repeating" ? countWords(discount.durationMonths ?? 0, w.months) : w.forever;
  const price = (minor: number) => formatMoney(off(minor), currency, moneyLocale);
  const [before, after] = w.withCode.split("{code}");
  return (
    <p className="mt-2 rounded-md bg-sunken px-2 py-1">
      {before}
      <span className="font-mono font-medium">{discount.code}</span>
      {after}{" "}
      {[monthly !== undefined && fillWords(w.perMonthShort, { price: price(monthly) }), yearly !== undefined && fillWords(w.perYearShort, { price: price(yearly) })]
        .filter(Boolean)
        .join(w.or)}
      , {how}
    </p>
  );
}

/**
 * The premium themes the store has or owes (D286): each paid once, without VAT, when it went live on the open store (one chosen before the
 * store opened is paid when it opens), invoiced by Kaizena Flow like the plan.
 */
function ThemePurchases({ purchases, words, lang }: { purchases: ThemePurchase[]; words: BillingMessages; lang: "en" | "nb" }) {
  const w = words.themes;
  return (
    <Card title={w.title} description={w.description} compact>
      <List label={w.list}>
        {purchases.map((purchase) => {
          const status = { ...PURCHASE_STATUS_WORDS[purchase.status], ...(lang === "en" ? {} : { words: w.statuses[purchase.status] }) };
          return (
            <ListRow key={purchase.id}>
              <RowLead
                title={purchase.title}
                sub={purchase.paidAt ? fillWords(w.paid, { date: purchase.paidAt.slice(0, 10) }) : fillWords(w.chosen, { date: purchase.createdAt.slice(0, 10) })}
              />
              <RowFact sub={w.exclVat}>{purchase.status === "granted" ? w.included : priceText(purchase.price, lang === "en" ? "en" : ADMIN_LANG_FACTS[lang].locale)}</RowFact>
              <Chip signal={status.signal} dot>
                {status.words}
              </Chip>
              {purchase.invoiceUrl && (
                <RowActions>
                  <a
                    href={purchase.invoiceUrl}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm underline underline-offset-2"
                  >
                    {w.invoice}
                    {purchase.invoiceNumber && ` ${purchase.invoiceNumber}`}
                    <span className="sr-only">{fillWords(w.newWindow, { title: purchase.title })}</span>
                  </a>
                </RowActions>
              )}
            </ListRow>
          );
        })}
      </List>
    </Card>
  );
}
