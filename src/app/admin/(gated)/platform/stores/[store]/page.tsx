import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CustomerBar } from "@/components/admin/customer-bar";
import { DesignProfilePanel } from "@/components/admin/design-profile-panel";
import { designPreviewPath } from "@/lib/design-presets";
import { latestDesignUse, listDesigns } from "@/server/design-presets";
import { InvoiceList } from "@/components/admin/plan-invoices";
import { PlanDiscount } from "@/components/admin/plan-discount";
import { formatBps, isOnPlan, priceLabel } from "@/lib/plans";
import { mainCurrency } from "@/lib/markets";
import { billingMode, getStoreBilling, listPlans, listStoreInvoices } from "@/server/billing";
import { listStorePeople } from "@/server/platform-customers";
import { closureBlockers } from "@/lib/store-closure";
import { storeObligations, storeState } from "@/server/store-closure";
import { getStore } from "@/server/stores";

import { applyStoreDiscountAction, assignPlanAction, cancelPlanAction, setStoreFeeAction } from "../../actions";
import { requirePlatformAdmin } from "@/server/auth";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { LimitOverridesCard } from "@/components/admin/limit-overrides";
import { storeLimits } from "@/server/limits";
import { storeOverrides } from "@/server/limits-admin";
import { removeLimitOverrideAction, setLimitOverrideAction } from "./limit-actions";

import { applyDesignToStoreAction, restoreDesignForStoreAction } from "../../themes/actions";
import { closeStoreForPlatformAction, detachDryRunAction, reopenStoreForPlatformAction, suspendStoreAction } from "./actions";

export const metadata: Metadata = { title: "Store plan" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** One store's plan with Kaizen: start, change or cancel it, and its fee. */
export default async function PlatformStorePage({ params }: PageProps<"/admin/platform/stores/[store]">) {
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").store;
  const t = adminText(lang, "platform");
  const billingWords = adminText(lang, "billing");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const roleWord = (role: string) => (adminText(lang, "staff").roles as Record<string, string>)[role] ?? role;
  const store = await getStore((await params).store);
  if (!store) notFound();
  const [billing, plans, people, invoices] = await Promise.all([
    getStoreBilling(store.id),
    listPlans(),
    listStorePeople(store.id),
    listStoreInvoices(store.id, 12),
  ]);
  const [state, obligations, designs, latestDesign, limits, overrides] = await Promise.all([
    storeState(store.id),
    storeObligations(store.id),
    listDesigns(),
    latestDesignUse(store.id),
    storeLimits(store.id),
    storeOverrides(store.id),
  ]);
  const blockers = closureBlockers(obligations, adminText(lang, "settings").close);
  const owner = people.find((p) => p.role === "owner");
  const date = (iso: string) => new Date(iso).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  if (!billing) notFound();
  const mode = billingMode();
  const onPlan = isOnPlan(billing.status);
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const currency = mainCurrency(store);
  const suggested =
    billing.priceId ??
    offered.flatMap((plan) => plan.prices).find((p) => p.active && p.currency === currency && p.interval === "month")?.id;

  return (
    <>
      <div>
        <p className="text-sm">
          <Link href="/admin/platform/stores" className="underline">
            {w.stores}
          </Link>
        </p>
        <PageHeader
          title={<>{store.name}</>}
          description={<>{billing.ownerEmail ?? w.noOwner} · {store.details.country ?? w.noCountry} ·{" "}<Link href={`/admin/${store.slug}`} className="underline">{w.openAdmin}</Link></>}
        />
        </div>

      {owner && (
        <CustomerBar
          words={adminText(lang, "customers")}
          customer={{
            href: `/admin/platform/customers/${owner.id}`,
            name: owner.name,
            email: owner.email,
            avatarPath: owner.avatarPath,
            account: "verified",
            badge: fillWords(w.ownerOf, { store: store.name }),
            facts: [people.length === 1 ? w.alone : fillWords(w.people, { n: people.length })],
          }}
        />
      )}

      <Card title={w.currentPlan} className="text-sm" compact>
        {billing.planName && billing.status ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted">{w.plan}</dt>
            <dd>
              {billing.planName}
              {billing.price && ` · ${priceLabel(billing.price.amountMinor, billing.price.currency, billing.price.interval, billingWords.intervals)}`}
            </dd>
            <dt className="text-muted">{w.status}</dt>
            <dd>
              {billingWords.statuses[billing.status] ?? billing.status}
              {billing.cancelAtPeriodEnd && w.endsAtPeriodEnd}
              {billing.mode === "test" && w.testMode}
            </dd>
            {billing.currentPeriodEnd && billing.status !== "canceled" && (
              <>
                <dt className="text-muted">{billing.cancelAtPeriodEnd ? w.ends : w.nextInvoice}</dt>
                <dd>{billing.currentPeriodEnd.slice(0, 10)}</dd>
              </>
            )}
            {billing.subscriptionId && (
              <>
                <dt className="text-muted">{w.inStripe}</dt>
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
          <p>{w.noPlan}</p>
        )}
      </Card>

      <Card title={onPlan ? w.changePlan : w.startAPlan} compact>
        {!mode ? (
          <p className="text-sm text-muted">{w.noKeys}</p>
        ) : offered.length === 0 ? (
          <p className="text-sm text-muted">
            {w.noPlans}{" "}
            <Link href="/admin/platform/plans" className="underline">
              {w.createOne}
            </Link>
            .
          </p>
        ) : (
          <ActionForm action={assignPlanAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {onPlan
                ? w.changeNow
                : (store.details.country ?? "NO") === "NO"
                  ? w.invoiceNo
                  : w.invoiceAbroad}
              {mode === "test" && w.testNote}
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.planAndPrice}
              <select name="priceId" required defaultValue={suggested} className={control}>
                {offered.map((plan) => (
                  <optgroup key={plan.id} label={fillWords(w.perSale, { plan: plan.name, fee: formatBps(plan.saleFeeBps, locale) })}>
                    {plan.prices
                      .filter((price) => price.active)
                      .map((price) => (
                        <option key={price.id} value={price.id}>
                          {plan.name} · {priceLabel(price.amountMinor, price.currency, price.interval, billingWords.intervals)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {!onPlan && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.trialDays}
                <input name="trialDays" type="number" min={0} max={730} defaultValue={0} className={`${control} w-32`} />
              </label>
            )}
            <div>
              <SubmitButton>{onPlan ? w.changePlan : w.startPlan}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>

      {onPlan && (
        <Card title={w.cancelPlan} compact>
          <ActionForm action={cancelPlanAction.bind(null, store.id)} className="flex flex-wrap gap-3">
            {billing.cancelAtPeriodEnd ? (
              <SubmitButton name="when" value="undo" variant="secondary">
                {w.keepPlan}
              </SubmitButton>
            ) : (
              <SubmitButton name="when" value="period_end" variant="secondary">
                {w.cancelAtEnd}
              </SubmitButton>
            )}
            <SubmitButton name="when" value="now" variant="secondary">
              {w.cancelNow}
            </SubmitButton>
          </ActionForm>
        </Card>
      )}

      {mode && (
        <PlanDiscount
          discount={billing.discount}
          apply={applyStoreDiscountAction.bind(null, store.slug)}
          remove={null}
          canEdit
          words={billingWords}
        />
      )}

      <Card title={w.fee} compact>
        <p className="mb-3 text-sm text-muted">
          {fillWords(w.feeNow, { fee: formatBps(billing.feeBps, locale) })}
          {billing.saleFeeBpsOverride !== null ? w.feeOwn : onPlan ? w.feePlan : w.feeDefault}.{" "}
          {w.feeNote}
        </p>
        <ActionForm action={setStoreFeeAction.bind(null, store.id)} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.ownFee}
            <input
              name="fee"
              inputMode="decimal"
              defaultValue={billing.saleFeeBpsOverride === null ? "" : String(billing.saleFeeBpsOverride / 100)}
              className={`${control} w-32`}
            />
          </label>
          <SubmitButton>{w.saveFee}</SubmitButton>
        </ActionForm>
      </Card>
      <LimitOverridesCard
        limits={limits.limits}
        overrides={overrides}
        words={adminText(lang, "capacity")}
        locale={locale}
        set={setLimitOverrideAction.bind(null, store.id, owner?.id ?? null)}
        remove={(id) => removeLimitOverrideAction.bind(null, store.id, id)}
      />
      <Card title={fillWords(w.storeStatus, { status: t.storeStatus[state?.status ?? store.status] })} className="flex flex-col gap-3 text-sm" compact>
        {state?.reason && <p className="text-muted">{fillWords(w.reasonOnFile, { reason: state.reason })}</p>}
        {state && state.status !== "active" ? (
          <ActionForm action={reopenStoreForPlatformAction.bind(null, store.id)} className="flex flex-col gap-2" successMessage={w.reopened}>
            <p className="text-muted">{w.reopenNote}</p>
            <div>
              <SubmitButton>{w.reopen}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <>
            {blockers.length > 0 && (
              <ul className="list-disc pl-5 text-muted">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <ActionForm action={suspendStoreAction.bind(null, store.id)} className="flex flex-col gap-2" successMessage={w.suspended}>
              <label className="flex flex-col gap-1 font-medium">
                {w.suspendLabel}
                <textarea name="reason" required minLength={5} maxLength={500} rows={2} placeholder={w.whyEmailed} className={`${control} py-2`} />
              </label>
              <div>
                <SubmitButton>{w.suspend}</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={closeStoreForPlatformAction.bind(null, store.id)} className="flex flex-col gap-2" successMessage={w.closed}>
              <label className="flex flex-col gap-1 font-medium">
                {w.closeLabel}
                <textarea name="reason" required minLength={5} maxLength={500} rows={2} placeholder={w.whyEmailed} className={`${control} py-2`} />
              </label>
              {blockers.length > 0 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="force" />
                  {w.force}
                </label>
              )}
              <div>
                <SubmitButton>{w.close}</SubmitButton>
              </div>
            </ActionForm>
          </>
        )}
      </Card>
      <Card title={w.invoices} compact>
        <InvoiceList storeSlug={store.slug} invoices={invoices} date={date} words={t.invoiceList} />
      </Card>

      {/* Design profiles (D176): a platform admin applies one to any store, a store template's included (an unpublished one only there). */}
      <DesignProfilePanel
        designs={designs
          .filter((d) => d.readable && (d.published || store.starter))
          .map((d) => ({ ...d, previewHref: designPreviewPath(d.id, null, true) }))}
        latest={latestDesign}
        apply={applyDesignToStoreAction.bind(null, store.slug)}
        restore={restoreDesignForStoreAction.bind(null, store.slug)}
        canChange={store.status === "active"}
        closedNote={w.closedNote}
      />

      {/* The page migration of docs/theme-store.md 4.4 (D241): a dry run only in phase 1. */}
      <Card
        title={w.migration}
        description={w.migrationNote}
        className="text-sm"
        compact
      >
        <ActionForm action={detachDryRunAction.bind(null, store.id)}>
          <SubmitButton variant="secondary">{w.count}</SubmitButton>
        </ActionForm>
      </Card>

      <Card title={w.peopleTitle} className="text-sm" compact>
        {people.length === 0 ? (
          <p className="text-muted">{w.nobody}</p>
        ) : (
          <ul className="divide-y divide-line">
            {people.map((person) => (
              <li key={person.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/platform/customers/${person.id}`} className="underline">
                  {person.name || person.email}
                </Link>
                <span className="text-muted">{roleWord(person.role)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
