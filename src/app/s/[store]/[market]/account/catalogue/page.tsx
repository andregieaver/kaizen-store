import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { accountsShown } from "@/lib/customer-accounts";
import { optionLabel, t } from "@/lib/i18n";
import { shown } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { lineMax, ruleWords } from "@/lib/quantity-rules";
import { marketPath } from "@/lib/paths";
import { getCustomer } from "@/server/customers";
import { buyerCatalogue } from "@/server/price-lists";
import { resolveSellingShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { addFromCatalogueAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/catalogue">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Your catalogue (wave 6 unit C3, D321): the goods an exclusive price list makes the signed-in buyer's, with their price and Add to cart. Read per
 * request; product pages stay cached for everyone, so an exclusive product has no page of its own.
 */
export default async function CataloguePage({ params }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/catalogue");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Catalogue params={params} />
      </Suspense>
    </div>
  );
}

async function Catalogue({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) notFound();
  // Customer accounts off (D365): the account's own pages are not there.
  if (!accountsShown(shop.store)) notFound();
  const { store, market } = shop;
  const account = marketPath(store.slug, market.slug, "/account");
  const customer = await getCustomer(store.id);
  if (!customer) redirect(account);
  const messages = t(market.lang);
  const m = messages.buyerCatalogue;
  const items = await buyerCatalogue(store.id, customer.id, market.code, market.locale);
  const money = (nativeMinor: number) => formatMoney(shown(market, nativeMinor), market.currency, market.locale);

  return (
    <>
      <div>
        <Link href={account} className="text-sm underline">
          ← {messages.account.title}
        </Link>
        <h1 className="mt-2 text-3xl font-heading tracking-tight">{m.title}</h1>
        <p className="text-muted">{m.intro}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted">{m.empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.productId} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" width={56} height={56} className="size-14 rounded-md object-cover" />
                )}
                <h2 className="font-heading text-lg">{item.title}</h2>
              </div>
              <ul className="divide-y divide-border">
                {item.variants.map((variant) => {
                  const label = optionLabel(messages, variant.options) || item.title;
                  const price = variant.listMinor ?? variant.marketMinor;
                  return (
                    <li key={variant.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block">{label}</span>
                        <span className="block text-sm text-muted">
                          {variant.listMinor !== null ? `${messages.yourPrice}: ` : ""}
                          {money(price)} · {variant.sku}
                        </span>
                        {ruleWords(variant.rule, messages.quantityRule) && <span className="block text-sm text-muted">{ruleWords(variant.rule, messages.quantityRule)}</span>}
                      </span>
                      {variant.available ? (
                        <form action={addFromCatalogueAction.bind(null, store.slug, market.slug, variant.id)} className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`q-${variant.id}`}>
                            {m.quantity}, {label}
                          </label>
                          <input id={`q-${variant.id}`} name="quantity" type="number" min={variant.rule.min} max={lineMax(variant.rule)} step={variant.rule.step} defaultValue={variant.rule.min} className="min-h-11 w-20 rounded-button border border-border px-2" />
                          <button type="submit" className="button-primary min-h-11 rounded-button px-4">
                            {m.add}
                          </button>
                        </form>
                      ) : (
                        <span className="text-sm text-muted">{m.soldOut}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
