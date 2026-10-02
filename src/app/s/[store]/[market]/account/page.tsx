import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { resolveShop } from "@/server/shop";
import { getCustomer } from "@/server/customers";

import { AccountSection } from "./account-section";

type Props = PageProps<"/s/[store]/[market]/account">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My account (D28): signing in, then the customer's orders, subscriptions,
 * details and password in one place. The store's own pages for it (D113),
 * built in the page builder, where chosen: one for shoppers who are not
 * signed in (the sign-in page), one for My account (which, signed out, is the
 * sign-in form); else the standard page.
 */
export default function AccountPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <AccountRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountRoute({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const account = (
    <RolePage store={store} market={market} ab={shop.ab} role="account" route={{ part: "account", query: searchParams }}>
      <AccountSection store={store} market={market} query={searchParams} />
    </RolePage>
  );
  if (await getCustomer(store.id)) return account;
  return (
    <RolePage store={store} market={market} ab={shop.ab} role="sign_in" route={{ part: "sign_in", query: searchParams }}>
      {account}
    </RolePage>
  );
}
