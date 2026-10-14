import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { moneyByCurrency } from "@/components/admin/customer-bar";
import { WishlistTabs } from "@/components/admin/wishlist-admin";
import { requirePermission } from "@/server/permissions";
import { listStoreWishlists, mostWishedProducts, wishlistFigures } from "@/server/wishlist-admin";
import { Card, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

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
  const [lists, figures, top] = await Promise.all([
    listStoreWishlists(store.id, { q, customerId }),
    wishlistFigures(store.id),
    mostWishedProducts(store.id, locale),
  ]);
  const base = `/admin/${store.slug}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const conversion = figures.toCart > 0 ? Math.round((figures.bought / figures.toCart) * 100) : null;
  const forCustomer = customerId ? lists[0]?.owner : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wishlists"
        description={<>What shoppers have saved with the heart, signed in or not, and what went from their lists to the cart and was bought.</>}
      />
      <WishlistTabs storeSlug={store.slug} current="lists" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Lists", String(figures.lists), `${figures.shoppers === 1 ? "1 shopper" : `${figures.shoppers} shoppers`}`],
          ["Saved items", String(figures.savedItems), null],
          ["Put in the cart", String(figures.toCart), "from a list"],
          ["Bought", String(figures.bought), [conversion !== null && `${conversion} %`, moneyByCurrency(figures.boughtMinor, locale)].filter(Boolean).join(" · ") || null],
        ].map(([label, value, note]) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border border-line bg-card p-4">
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
              Search by list, customer or product
            </label>
            <input
              id="wishlist-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search by list, customer or product"
              className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
            />
            <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
              Search
            </button>
            {(q || customerId) && (
              <Link href={`${base}/wishlists`} className="flex min-h-10 items-center px-2 text-sm underline">
                Show every list
              </Link>
            )}
          </form>
          {customerId && (
            <p className="text-sm">
              Lists of{" "}
              <Link href={`${base}/customers/${customerId}`} className="font-medium underline">
                {forCustomer ? forCustomer.name || forCustomer.email : "this customer"}
              </Link>
            </p>
          )}

          {lists.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
              {q || customerId ? "No list matches." : "No wishlists yet. They show here once a shopper taps a heart."}
            </p>
          ) : (
            <Card compact>
              <List label="Wish lists">
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
                          "Guest, not signed in"
                        )
                      }
                    />
                    <RowFact className="hidden md:block">
                      {list.toCart} to cart · {list.bought} bought
                    </RowFact>
                    <RowFact className="hidden lg:block">Changed {date(list.updatedAt)}</RowFact>
                    <RowAmount>{list.items === 1 ? "1 item" : `${list.items} items`}</RowAmount>
                  </ListRow>
                ))}
              </List>
            </Card>
          )}
        </div>

        <Card title="Most wished for" className="h-fit" compact>
          {top.length === 0 ? (
            <p className="text-sm text-muted">Nothing saved yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {top.map((p) => (
                <li key={p.productId} className="flex items-baseline justify-between gap-2">
                  <Link href={`${base}/products/${p.productId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {p.lists === 1 ? "1 list" : `${p.lists} lists`}
                    {p.bought > 0 && ` · ${p.bought} bought`}
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
