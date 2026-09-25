import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { moneyByCurrency } from "@/components/admin/customer-bar";
import { WishlistTabs } from "@/components/admin/wishlist-admin";
import { requireMember } from "@/server/auth";
import { listStoreWishlists, mostWishedProducts, wishlistFigures } from "@/server/wishlist-admin";

export const metadata: Metadata = { title: "Wishlists" };

/**
 * Every shopper's wishlists (D36), most recently changed first: whose, how
 * much is in them, and how much went to the cart and was bought.
 */
export default async function WishlistsPage({ params, searchParams }: PageProps<"/admin/[store]/wishlists">) {
  const { store } = await requireMember((await params).store);
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
      <div>
        <h1 className="text-2xl font-semibold">Wishlists</h1>
        <p className="text-sm text-muted">
          What shoppers have saved with the heart, signed in or not, and what went from their lists to the cart and was bought.
        </p>
      </div>
      <WishlistTabs storeSlug={store.slug} current="lists" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Lists", String(figures.lists), `${figures.shoppers === 1 ? "1 shopper" : `${figures.shoppers} shoppers`}`],
          ["Saved items", String(figures.savedItems), null],
          ["Put in the cart", String(figures.toCart), "from a list"],
          ["Bought", String(figures.bought), [conversion !== null && `${conversion} %`, moneyByCurrency(figures.boughtMinor, locale)].filter(Boolean).join(" · ") || null],
        ].map(([label, value, note]) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-semibold">{value}</span>
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
              className="min-h-10 w-full max-w-sm rounded-md border border-border bg-background px-3 text-sm"
            />
            <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
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
            <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
              {q || customerId ? "No list matches." : "No wishlists yet. They show here once a shopper taps a heart."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-4 py-2 font-medium">List</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Shopper</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Items</th>
                    <th scope="col" className="hidden px-4 py-2 text-right font-medium md:table-cell">To cart</th>
                    <th scope="col" className="hidden px-4 py-2 text-right font-medium md:table-cell">Bought</th>
                    <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((list) => (
                    <tr key={list.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`${base}/wishlists/${list.id}`} className="font-medium underline-offset-2 hover:underline">
                          {list.name}
                        </Link>
                        <span className="block text-xs text-muted sm:hidden">
                          {list.owner ? list.owner.name || list.owner.email : "Guest"}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2 sm:table-cell">
                        {list.owner ? (
                          <Link href={`${base}/customers/${list.owner.customerId}`} className="underline">
                            {list.owner.name || list.owner.email}
                          </Link>
                        ) : (
                          <span className="text-muted">Guest, not signed in</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{list.items}</td>
                      <td className="hidden px-4 py-2 text-right md:table-cell">{list.toCart}</td>
                      <td className="hidden px-4 py-2 text-right md:table-cell">{list.bought}</td>
                      <td className="hidden px-4 py-2 whitespace-nowrap lg:table-cell">{date(list.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <section aria-labelledby="most-wished" className="h-fit rounded-lg border border-border bg-background p-5">
          <h2 id="most-wished" className="mb-3 font-medium">Most wished for</h2>
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
        </section>
      </div>
    </div>
  );
}
