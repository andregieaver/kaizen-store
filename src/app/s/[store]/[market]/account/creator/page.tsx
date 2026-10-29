import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CopyLinkButton } from "@/components/copy-link-button";
import { affiliateLink } from "@/lib/affiliate-link";
import { earnPercentText } from "@/lib/bonus-shopper";
import { accountsShown } from "@/lib/customer-accounts";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { creatorDashboard, creatorProgramOn } from "@/server/creators";
import { getCustomer } from "@/server/customers";
import { resolveSellingShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { applyCreatorAction } from "./actions";
import { CreatorApplyForm } from "./apply-form";

type Props = PageProps<"/s/[store]/[market]/account/creator">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The creator programme in My account (wave 11 unit G, D386): a signed-in customer applies here, and once approved sees their code, their
 * link, the visits to it and their orders by count and their money per currency, never who bought. The id is the session's.
 */
export default async function AccountCreatorPage({ params }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/creator");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountCreator params={params} />
      </Suspense>
    </div>
  );
}

async function AccountCreator({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop || !accountsShown(shop.store)) notFound();
  const { store, market } = shop;
  const m = t(market.lang);
  const c = m.creator;
  const base = marketPath(store.slug, market.slug);
  const [customer, on] = await Promise.all([getCustomer(store.id), creatorProgramOn(store.id)]);
  const page = customer ? await creatorDashboard(store.id, customer.id) : null;

  const header = (
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-heading">{c.title}</h1>
      <p>{c.intro}</p>
    </header>
  );
  if (!page) {
    if (!on) {
      return (
        <>
          {header}
          <p role="note">{c.notAvailable}</p>
        </>
      );
    }
    if (!customer) {
      return (
        <>
          {header}
          <p>
            <a href={`${base}/account`} className="underline">
              {c.signIn}
            </a>
          </p>
        </>
      );
    }
    return (
      <>
        {header}
        <CreatorApplyForm
          action={applyCreatorAction.bind(null, store.slug, market.slug)}
          words={{
            nameLabel: c.nameLabel,
            channelLabel: c.channelLabel,
            channelHint: c.channelHint,
            consent: c.consent,
            apply: c.apply,
            applied: c.applied,
            problems: c.problems,
          }}
        />
      </>
    );
  }

  const link = page.code ? affiliateLink(store.slug, page.code) : null;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, market.locale);
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(market.locale, { dateStyle: "medium" });
  return (
    <>
      {header}
      <p className="rounded-lg border border-border bg-surface p-4">
        <span className="font-medium">{c.status[page.status]}</span>
        {page.status === "declined" && <> · {c.declined}</>}
        {page.status === "stopped" && <> · {c.stopped}</>}
      </p>

      {link && page.code && (
        <section aria-labelledby="creator-link-heading" className="flex flex-col gap-2">
          <h2 id="creator-link-heading" className="text-xl font-heading">
            {c.linkLabel}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="creator-link"
              readOnly
              value={link}
              aria-labelledby="creator-link-heading"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <CopyLinkButton link={link} labels={{ copy: c.copy, copied: c.copied }} inputId="creator-link" />
          </div>
          <p>
            {c.codeLabel}: <span className="font-mono">{page.code}</span>
          </p>
          <p>{c.rate(earnPercentText(page.commissionBps / 100, market.locale))}</p>
          <p className="text-muted">{c.rules}</p>
        </section>
      )}

      {page.status !== "applied" && (
        <section aria-labelledby="creator-stats-heading" className="flex flex-col gap-3">
          <h2 id="creator-stats-heading" className="text-xl font-heading">
            {c.statsHeading}
          </h2>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-muted">{c.visits}</dt>
              <dd className="text-2xl">{page.visits}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{c.ordersEarned}</dt>
              <dd className="text-2xl">{page.orders.earned}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{c.ordersWaiting}</dt>
              <dd className="text-2xl">{page.orders.pending}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{c.ordersReversed}</dt>
              <dd className="text-2xl">{page.orders.reversed}</dd>
            </div>
          </dl>
        </section>
      )}

      {page.status !== "applied" && (
        <section aria-labelledby="creator-money-heading" className="flex flex-col gap-3">
          <h2 id="creator-money-heading" className="text-xl font-heading">
            {c.moneyHeading}
          </h2>
          {page.balances.length === 0 ? (
            <p>{c.noMoney}</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th scope="col" className="sr-only">
                    {c.moneyHeading}
                  </th>
                  <th scope="col">{c.earned}</th>
                  <th scope="col">{c.reversed}</th>
                  <th scope="col">{c.paid}</th>
                  <th scope="col">{c.owed}</th>
                </tr>
              </thead>
              <tbody>
                {page.balances.map((b) => (
                  <tr key={b.currency}>
                    <th scope="row">{b.currency}</th>
                    <td>{money(b.earnedMinor, b.currency)}</td>
                    <td>{money(b.reversedMinor, b.currency)}</td>
                    <td>{money(b.paidMinor, b.currency)}</td>
                    <td>{money(b.owedMinor, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {page.payouts.length > 0 && (
            <>
              <h3 className="text-lg font-heading">{c.payoutsHeading}</h3>
              <p className="text-sm text-muted">{c.payoutsNote}</p>
              <ul className="flex flex-col gap-1">
                {page.payouts.map((p, i) => (
                  <li key={`${p.paidOn}-${i}`}>
                    {day(p.paidOn)}: {money(p.amountMinor, p.currency)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
