import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { accountsShown } from "@/lib/customer-accounts";
import { ACCOUNT_ORDER_STATES, accountOrdersQuery, parseAccountOrderParams } from "@/lib/account-orders";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { findCustomerOrders, getCustomer } from "@/server/customers";
import { resolveAfterSaleShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

type Props = PageProps<"/s/[store]/[market]/account/orders">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Finding an order in My account (wave 5 unit J2, D304): the signed-in customer's own orders, searched, filtered by state and paged. */
export default async function AccountOrdersPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/orders");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Orders params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Orders({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  // What was sold stays reachable while the shop is off (D178): an after-sale page.
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  // Customer accounts off (D365): the account's own pages are not there.
  if (!accountsShown(shop.store)) notFound();
  const { store, market } = shop;
  const account = marketPath(store.slug, market.slug, "/account");
  const customer = await getCustomer(store.id);
  if (!customer) redirect(account);
  const query = parseAccountOrderParams(await searchParams);
  const { orders, next } = await findCustomerOrders(store.id, customer.id, query);
  const texts = t(market.lang);
  const a = texts.account;
  const m = a.orderList;
  const page = marketPath(store.slug, market.slug, "/account/orders");
  const text = query.search.words.map((w) => w.raw).join(" ");
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const stateWords = { open: m.open, sent: m.sent, delivered: m.delivered, returned: m.returned };
  const chip = (on: boolean) => `rounded-button border px-3 py-1 text-sm ${on ? "border-foreground" : "border-border"}`;

  return (
    <>
      <div>
        <Link href={account} className="text-sm underline">
          ← {a.title}
        </Link>
        <h1 className="mt-2 text-3xl font-heading tracking-tight">{m.title}</h1>
      </div>
      <form action={page} method="get" role="search" className="flex flex-wrap items-end gap-2">
        {query.state && <input type="hidden" name="state" value={query.state} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {m.search}
          <input name="q" type="search" defaultValue={text} maxLength={100} placeholder={m.searchHint} className="min-h-11 w-full rounded-md border border-border bg-background px-3" />
        </label>
        <button className="button-primary rounded-button min-h-11 px-4">{m.find}</button>
      </form>
      <nav aria-label={m.title} className="flex flex-wrap gap-2">
        <Link href={`${page}${accountOrdersQuery({ text, state: null })}`} className={chip(!query.state)} aria-current={!query.state ? "page" : undefined}>
          {m.all}
        </Link>
        {ACCOUNT_ORDER_STATES.map((state) => (
          <Link key={state} href={`${page}${accountOrdersQuery({ text, state })}`} className={chip(query.state === state)} aria-current={query.state === state ? "page" : undefined}>
            {stateWords[state]}
          </Link>
        ))}
      </nav>
      {orders.length === 0 ? (
        <p className="text-muted">{text || query.state || query.after ? m.none : a.noOrders}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`${account}/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 hover:bg-surface">
                <span>
                  <span className="font-medium">{a.order(order.number)}</span>
                  <span className="block text-sm text-muted">
                    {date(order.placedAt)} · {a.items(order.items)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block">{formatMoney(order.totalMinor, order.currency, market.locale)}</span>
                  <span className="block text-sm text-muted">{a.status[order.status] ?? order.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Link href={`${page}${accountOrdersQuery({ text, state: query.state, after: next })}`} className="self-start underline">
          {m.more}
        </Link>
      )}
    </>
  );
}
