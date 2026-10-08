import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { emptyForm, orderInfoOf } from "@/lib/withdraw-form";
import { getCustomer } from "@/server/customers";
import { resolveAfterSaleShop } from "@/server/shop";
import { lookupWithdrawableOrder } from "@/server/withdrawals";

import { WithdrawFlow } from "./withdraw-flow";

type Props = PageProps<"/s/[store]/[market]/withdraw">;

/** A working page, not for search engines: it holds an order's details when opened from one. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const one = (value: string | string[] | undefined): string => (typeof value === "string" ? value.slice(0, 200) : "");

/**
 * The withdrawal function (D153, `docs/returns.md`): always reachable (the footer, every order email, the order page and My
 * account), a plain route in the store's own look. Opened from an order's own link (`?order=…&key=…`, the key being what
 * the order page itself needs) or by a signed-in customer, it already lists the order's lines; otherwise it asks for the
 * name, email and order number. Sets no cookie and stores nothing in the browser.
 */
export default function WithdrawPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Withdraw params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Withdraw({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang).returns;
  const query = await searchParams;
  const orderNumber = one(query.order);
  const key = one(query.key) || null;
  const customer = await getCustomer(store.id);
  // The order's lines are shown only to a visitor who has shown the order is theirs: its key, or being signed in as its customer.
  const view =
    orderNumber && (key || customer)
      ? await lookupWithdrawableOrder(store.id, { orderNumber, orderKey: key ?? undefined }, { customerId: customer?.id ?? null })
      : null;
  const initial = emptyForm(
    { name: customer?.name ?? "", email: view?.email ?? customer?.email ?? "", orderNumber },
    view ? key : null,
    view ? orderInfoOf(view) : null,
  );
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading tracking-tight">{m.title}</h1>
        <p>{m.intro}</p>
        <p className="text-sm text-muted">{m.rights}</p>
      </div>
      <WithdrawFlow
        storeSlug={store.slug}
        marketSlug={market.slug}
        lang={market.lang}
        locale={market.locale}
        base={marketPath(store.slug, market.slug)}
        storeName={store.details.legalName ?? store.name}
        contactEmail={store.details.contactEmail ?? null}
        initial={initial}
      />
    </>
  );
}
