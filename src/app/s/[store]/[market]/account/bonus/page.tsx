import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { BonusAccountView } from "@/components/bonus-account-view";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { shopperBonus } from "@/server/bonus";
import { getCustomer, listCustomerOrders } from "@/server/customers";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account/bonus">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My bonus credits (D130): the customer's balance, how the program works and the history. A plain page inside My
 * account (like My company): signed out, or in a store without the program, it is My account's own page instead. The
 * customer only ever sees their own credits: the id comes from their session, never from the address.
 */
export default function AccountBonusPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountBonus params={params} />
      </Suspense>
    </div>
  );
}

async function AccountBonus({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  const [bonus, orders] = await Promise.all([
    shopperBonus({ storeId: store.id, market }, customer.id),
    listCustomerOrders(store.id, customer.id),
  ]);
  if (!bonus.enabled) redirect(`${base}/account`);
  return (
    <BonusAccountView
      bonus={bonus}
      m={t(market.lang)}
      locale={market.locale}
      base={base}
      orderIds={Object.fromEntries(orders.map((order) => [order.number, order.id]))}
    />
  );
}
