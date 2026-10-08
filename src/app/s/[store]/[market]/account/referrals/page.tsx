import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ReferralsAccountView } from "@/components/referrals-account-view";
import { affiliateLink } from "@/lib/affiliate-link";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { shopperReferrals } from "@/server/affiliates";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

type Props = PageProps<"/s/[store]/[market]/account/referrals">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Refer a friend (D131): the customer's own link and what it has done, in the store's terms. A plain page inside My account
 * (like My bonus credits): signed out, or in a store without the program, it is My account's own page instead. The first
 * visit makes the customer's code; the id comes from their session, never from the address.
 */
export default async function AccountReferralsPage({ params }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/referrals");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountReferrals params={params} />
      </Suspense>
    </div>
  );
}

async function AccountReferrals({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  const referrals = await shopperReferrals({ storeId: store.id, market }, customer.id);
  if (!referrals.enabled) redirect(`${base}/account`);
  return (
    <ReferralsAccountView
      referrals={referrals}
      link={referrals.code ? affiliateLink(store.slug, referrals.code) : null}
      m={t(market.lang)}
      locale={market.locale}
      base={base}
    />
  );
}
