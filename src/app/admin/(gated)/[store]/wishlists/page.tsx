import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { moneyByCurrency } from "@/components/admin/customer-bar";
import { WishlistTabs } from "@/components/admin/wishlist-admin";
import { requirePermission } from "@/server/permissions";
import { listStoreWishlists, mostWishedProducts, wishlistFigures } from "@/server/wishlist-admin";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Wishlists" };

/**
 * Every shopper's wishlists (D36), most recently changed first: whose, how
 * much is in them, and how much went to the cart and was bought.
 */
export default async function WishlistsPage({ params, searchParams }: PageProps<"/admin/[store]/wishlists">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const customerId = typeof query.customer === "string" && z.uuid().safeParse(query.customer).success ? query.customer : null;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "bookings").wishlists;
  const dateLocale = lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale;
  const [lists, figures, top] = await Promise.all([
    listStoreWishlists(store.id, { q, customerId }),
    wishlistFigures(store.id),
    mostWishedProducts(store.id, locale),
  ]);
  const base = `/admin/${store.slug}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const conversion = figures.toCart > 0 ? Math.round((figures.bought / figures.toCart) * 100) : null;
  const forCustomer = customerId ? lists[0]?.owner : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />
      <WishlistTabs storeSlug={store.slug} current="lists" words={w} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [w.figures.lists, String(figures.lists), countWords(figures.shoppers, w.figures.shoppers)],
          [w.figures.saved, String(figures.savedItems), null],
          [w.figures.toCart, String(figures.toCart), w.figures.fromList],
          [w.figures.bought, String(figures.bought), [conversion !== null && `${conversion} %`, moneyByCurrency(figures.boughtMinor, locale)].filter(Boolean).join(" · ") || null],
        ].map(([label, value, note]) => (
          <div key={label} className={`flex flex-col gap-1 p-4 ${CARD_CLASS}`}>
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-medium">{value}</span>
            {note && <span className="text-xs text-muted">{note}</span>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <form role="search" className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="wishlist-search">
              {w.search}
            </label>
            <input
              id="wishlist-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={w.search}
              className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
            />
            <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
              {w.searchButton}
            </button>
            {(q || customerId) && (
              <Link href={`${base}/wishlists`} className="flex min-h-10 items-center px-2 text-sm underline">
                {w.showAll}
              </Link>
            )}
          </form>
          {customerId && (
            <p className="text-sm">
              {w.listsOf}{" "}
              <Link href={`${base}/customers/${customerId}`} className="font-medium underline">
                {forCustomer ? forCustomer.name || forCustomer.email : w.thisCustomer}
              </Link>
            </p>
          )}

          {lists.length === 0 ? (
            <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
              {q || customerId ? w.noMatch : w.none}
            </p>
          ) : (
            <Card compact>
              <List label={w.title}>
                {lists.map((list) => (
                  <ListRow key={list.id}>
                    <RowLead
                      title={list.name}
                      href={`${base}/wishlists/${list.id}`}
                      sub={
                        list.owner ? (
                          <Link href={`${base}/customers/${list.owner.customerId}`} className="underline-offset-2 hover:underline">
                            {list.owner.name || list.owner.email}
                          </Link>
                        ) : (
                          w.guest
                        )
                      }
                    />
                    <RowFact className="hidden md:block">
                      {fillWords(w.toCartBought, { cart: list.toCart, bought: list.bought })}
                    </RowFact>
                    <RowFact className="hidden lg:block">{fillWords(w.changed, { date: date(list.updatedAt) })}</RowFact>
                    <RowAmount>{countWords(list.items, w.items)}</RowAmount>
                  </ListRow>
                ))}
              </List>
            </Card>
          )}
        </div>

        <Card title={w.most} className="h-fit" compact>
          {top.length === 0 ? (
            <p className="text-sm text-muted">{w.nothingSaved}</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {top.map((p) => (
                <li key={p.productId} className="flex items-baseline justify-between gap-2">
                  <Link href={`${base}/products/${p.productId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {countWords(p.lists, w.lists)}
                    {p.bought > 0 && ` · ${fillWords(w.bought, { n: p.bought })}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
