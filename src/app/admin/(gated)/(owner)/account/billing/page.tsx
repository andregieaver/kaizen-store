import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { money } from "@/lib/control-center";
import { requireAccount } from "@/server/auth";
import {
  accountCurrency,
  boughtExtensions,
  completeAccountCheckout,
  getAccountBilling,
  listAccountInvoices,
  type AccountBilling,
} from "@/server/account-billing";
import { ownedStores } from "@/server/ai-usage";
import { listPlans, listStoreBilling, type StoreBilling } from "@/server/billing";
import { ownedAccount } from "@/server/privacy-officers";
import { Card, CARD_CLASS, EmptyState, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { BillingMessages } from "@/lib/admin-messages/billing.en";
import type { ScreensMessages } from "@/lib/admin-messages/screens.en";
import { BILLING_WORDS } from "@/lib/admin-words/billing";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";

import { accountPortalAction, cancelAccountPlanAction, chooseAccountPlanAction } from "../actions";

export const metadata: Metadata = { title: "Billing" };


/** A plan's cost per month, for adding up plans of different intervals. */
const monthly = (price: NonNullable<StoreBilling["price"]>) => Math.round(price.interval === "year" ? price.amountMinor / 12 : price.amountMinor);

/**
 * The plans of every store the account owns in one place (D107): what each
 * costs, whether it is paid, when it renews, and Kaizen's fee on its sales;
 * a store's own page (Billing in its admin) changes the plan. An account billed
 * through its account (D748 E4) has its one plan here first, changed here.
 */
export default async function OwnerBillingPage({ searchParams }: PageProps<"/admin/account/billing">) {
  await connection();
  const account = await requireAccount();
  const own = await ownedAccount(account.id);
  const { checkout } = await searchParams;
  if (own && typeof checkout === "string") await completeAccountCheckout(own.id, checkout);
  const billedByAccount = own ? await getAccountBilling(own.id) : null;
  const lang = adminLangOf(account.adminLocale);
  const b = BILLING_WORDS[lang];
  const w = SCREENS_WORDS[lang].ownerBilling;
  const per = (price: NonNullable<StoreBilling["price"]>) =>
    fillWords(w.per, { price: money(price.amountMinor, price.currency), interval: b.intervals[price.interval as keyof typeof b.intervals] ?? price.interval });
  const owned = await ownedStores(account.id);
  const bySlug = new Map((await listStoreBilling()).map((b) => [b.slug, b]));
  const rows = owned.flatMap((s) => bySlug.get(s.slug) ?? []);

  const costs = new Map<string, number>();
  for (const row of rows) if (row.price && ["active", "trialing", "past_due"].includes(row.status ?? "")) costs.set(row.price.currency, (costs.get(row.price.currency) ?? 0) + monthly(row.price));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={billedByAccount ? w.account.description : w.description} />
      {billedByAccount && <AccountPlan billing={billedByAccount} words={w.account} b={b} per={per} lang={lang} />}
      {rows.length === 0 ? (
        <EmptyState title={w.none} />
      ) : (
        <>
          {!billedByAccount && (
          <StatGrid>
            {[...costs].map(([currency, minor]) => (
              <Stat key={currency} label={fillWords(w.perMonth, { currency })} value={money(minor, currency)} sub={w.yearlyCounted} />
            ))}
            <Stat label={w.withoutPlan} value={rows.filter((r) => !r.status || ["canceled", "incomplete", "incomplete_expired"].includes(r.status)).length} />
          </StatGrid>
          )}
          <Section id="plans-heading" title={w.plans}>
            <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
              {rows.map((row) => (
                <li key={row.slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <span className="min-w-40 flex-1">
                    <span className="block font-medium">{row.name}</span>
                    <span className="block text-muted">{row.planName ?? w.noPlan}{row.price ? ` · ${per(row.price)}` : ""}</span>
                  </span>
                  <span className={row.status && ["past_due", "unpaid"].includes(row.status) ? "font-medium text-danger-text" : "text-muted"}>{row.status ? (b.statuses[row.status] ?? row.status) : w.noPlan}</span>
                  <span className="text-muted">
                    {row.currentPeriodEnd ? fillWords(row.cancelAtPeriodEnd ? w.ends : w.renews, { date: adminDate(row, row.currentPeriodEnd, "day", lang) }) : ""}
                  </span>
                  <span className="text-muted">{fillWords(w.fee, { fee: (row.feeBps / 100).toFixed(row.feeBps % 100 === 0 ? 0 : 1) })}</span>
                  {!row.byAccount && (
                    <Link href={`/admin/${row.slug}/billing`} className="underline">
                      {w.manage}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}


/** An account billed through its account (D748 E4): its one plan, what it pays for, a change of plan, the latest invoices and Stripe's page. */
async function AccountPlan({
  billing,
  words,
  b,
  per,
  lang,
}: {
  billing: AccountBilling;
  words: ScreensMessages["ownerBilling"]["account"];
  b: BillingMessages;
  per: (price: NonNullable<StoreBilling["price"]>) => string;
  lang: AdminLang;
}) {
  const [plans, currency, extensions, invoices] = await Promise.all([
    listPlans(),
    accountCurrency(billing.organisationId),
    boughtExtensions(billing.organisationId),
    listAccountInvoices(billing.organisationId, 5),
  ]);
  const running = ["trialing", "active", "past_due"].includes(billing.status ?? "");
  const offered = plans.filter((plan) => plan.active).flatMap((plan) => {
    const prices = plan.prices.filter((price) => price.active && price.currency === currency);
    return prices.length > 0 ? [{ plan, prices }] : [];
  });
  return (
    <>
      <Card title={running && billing.planName ? fillWords(words.title, { plan: billing.planName }) : words.none} className="text-sm" compact>
        <div className="flex flex-col gap-3">
          {running && billing.price && (
            <p>
              {fillWords(words.line, { price: money(billing.price.amountMinor, billing.price.currency), interval: b.intervals[billing.price.interval] })}
              {" · "}
              {b.statuses[billing.status ?? ""] ?? billing.status}
              {billing.currentPeriodEnd && ` · ${billing.cancelAtPeriodEnd ? b.page.ends : b.page.renews} ${adminDate(PLATFORM_TIME_ZONE, billing.currentPeriodEnd, "day", lang)}`}
            </p>
          )}
          <p className="text-muted">{words.stores}</p>
          {extensions.length > 0 && (
            <div>
              <p className="font-medium">{words.extensions}</p>
              <ul className="list-disc pl-5">
                {extensions.map((e) => (
                  <li key={e.extensionId}>
                    {e.endedAt ? fillWords(words.extensionEnds, { name: e.name, size: e.size, date: adminDate(PLATFORM_TIME_ZONE, e.endedAt, "day", lang) }) : [
                          e.bundle ? fillWords(words.extensionInBundle, { name: e.name, bundle: e.bundle }) : fillWords(words.extensionLine, { name: e.name, size: e.size }),
                          ...(e.foundingEndsAt ? [fillWords(words.extensionFounding, { date: adminDate(PLATFORM_TIME_ZONE, e.foundingEndsAt, "day", lang) })] : []),
                        ].join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {billing.customerAccount && (
              <ActionForm action={accountPortalAction}>
                <SubmitButton variant="secondary">{b.page.invoicesButton}</SubmitButton>
              </ActionForm>
            )}
            {running && billing.subscriptionId && (
              <ActionForm action={cancelAccountPlanAction}>
                <SubmitButton name="when" value={billing.cancelAtPeriodEnd ? "undo" : "period_end"} variant="secondary">
                  {billing.cancelAtPeriodEnd ? b.page.keepPlan : b.page.cancelEnd}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      </Card>
      {offered.length > 0 && (
        <Section id="account-plans-heading" title={words.plans}>
          <p className="text-sm text-muted">{words.plansNote}</p>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {offered.map(({ plan, prices }) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="min-w-40 flex-1 font-medium">{plan.name}</span>
                {prices.map((price) =>
                  running && price.id === billing.priceId ? (
                    <span key={price.id} className="text-muted">
                      {words.current} · {per(price)}
                    </span>
                  ) : (
                    <ActionForm key={price.id} action={chooseAccountPlanAction}>
                      <SubmitButton name="priceId" value={price.id} variant={price.interval === "year" ? "primary" : "secondary"}>
                        {per(price)}
                      </SubmitButton>
                    </ActionForm>
                  ),
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section id="account-invoices-heading" title={words.invoices}>
        {invoices === null ? (
          <p className="text-sm text-muted">{words.invoicesUnreachable}</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted">{words.noInvoices}</p>
        ) : (
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="flex-1">
                  {fillWords(words.invoiceLine, { number: invoice.number ?? invoice.id, date: adminDate(PLATFORM_TIME_ZONE, invoice.createdAt, "day", lang), total: money(invoice.totalMinor, invoice.currency) })}
                </span>
                <span className="text-muted">{b.statuses[invoice.status] ?? invoice.status}</span>
                {invoice.hostedUrl && (
                  <a href={invoice.hostedUrl} className="underline" target="_blank" rel="noreferrer">
                    {words.openInvoice}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
