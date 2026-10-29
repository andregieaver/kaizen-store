import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { BonusAccountView } from "@/components/bonus-account-view";
import { BonusRewardsSection } from "@/components/bonus-rewards-section";
import { accountsShown } from "@/lib/customer-accounts";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { shopperBonus } from "@/server/bonus";
import { customerBirthday, redeemedCodes, shopperRewards } from "@/server/bonus-rewards";
import { getCustomer, listCustomerOrders } from "@/server/customers";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { birthdayAction, redeemRewardAction } from "../actions";

type Props = PageProps<"/s/[store]/[market]/account/bonus">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My bonus credits (D130): the customer's balance, how the program works and the history. A plain page inside My
 * account (like My company): signed out, or in a store without the program, it is My account's own page instead. The
 * customer only ever sees their own credits: the id comes from their session, never from the address.
 */
export default async function AccountBonusPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/bonus");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountBonus params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AccountBonus({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  // Customer accounts off (D365): the account's own pages are not there.
  if (!accountsShown(shop.store)) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  const here = { storeId: store.id, market };
  const [bonus, orders, rewards, codes, birthday, query] = await Promise.all([
    shopperBonus(here, customer.id),
    listCustomerOrders(store.id, customer.id),
    shopperRewards(here, customer.id),
    redeemedCodes(here, customer.id),
    customerBirthday(store.id, customer.id),
    searchParams,
  ]);
  if (!bonus.enabled) redirect(`${base}/account`);
  const outcome = query.reward === "ok" ? "ok" : query.reward === "failed" ? "failed" : null;
  return (
    <>
    <BonusAccountView
      bonus={bonus}
      m={t(market.lang)}
      locale={market.locale}
      base={base}
      orderIds={Object.fromEntries(orders.map((order) => [order.number, order.id]))}
    />
    <BonusRewardsSection
      rewards={rewards}
      codes={codes}
      birthday={birthday}
      birthdayMinor={bonus.birthdayMinor}
      currency={bonus.currency}
      locale={market.locale}
      m={t(market.lang)}
      outcome={outcome}
      redeem={redeemRewardAction.bind(null, store.slug, market.slug)}
      saveBirthday={birthdayAction.bind(null, store.slug, market.slug)}
    />
    </>
  );
}
