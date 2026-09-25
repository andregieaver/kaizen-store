import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CustomerBar, storeCustomerBar } from "@/components/admin/customer-bar";
import { CartAddTable, variantText } from "@/components/admin/wishlist-admin";
import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import { customerSummary } from "@/server/customer-admin";
import { getStoreWishlist, listCartAdds } from "@/server/wishlist-admin";

export const metadata: Metadata = { title: "Wishlist" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * One shopper's list (D36): whose it is, what is in it now, and what went
 * from it to the cart and whether it was bought. The shopper's own: the
 * admin only looks.
 */
export default async function WishlistPage({ params }: PageProps<"/admin/[store]/wishlists/[wishlistId]">) {
  const { store: slug, wishlistId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(wishlistId).success) notFound();
  const market = store.markets[0] ?? null;
  const list = await getStoreWishlist(store.id, wishlistId, market);
  if (!list) notFound();
  const [customer, adds] = await Promise.all([
    list.owner ? customerSummary(store.id, list.owner.customerId) : null,
    listCartAdds(store.id, { wishlistId }),
  ]);
  const locale = market?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const totalMinor = list.items.reduce((sum, i) => sum + (i.priceMinor ?? 0) * i.quantity, 0);
  const currency = list.items.find((i) => i.currency)?.currency;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`${base}/wishlists`} className="text-sm underline">
          Wishlists
        </Link>
        <h1 className="text-2xl font-semibold">{list.name}</h1>
        <p className="text-sm text-muted">
          {list.items.length === 1 ? "1 item" : `${list.items.length} items`}
          {currency && totalMinor > 0 && ` · ${formatMoney(totalMinor, currency, locale)} at today's prices`} · made {date(list.createdAt)} ·{" "}
          {list.keepAfterCart ? "items stay in the list when added to the cart" : "items leave the list when added to the cart"}
        </p>
      </div>

      {customer ? (
        <CustomerBar customer={storeCustomerBar(store.slug, customer, locale)} />
      ) : (
        <section aria-label="Shopper" className="rounded-lg border border-border bg-background p-4 text-sm">
          <p className="font-medium">A guest, not signed in</p>
          <p className="text-muted">
            The list is kept in the shopper&apos;s browser and joins their account if they sign in. Who they are shows below
            once they buy from it.
          </p>
        </section>
      )}

      <section aria-labelledby="items" className={card}>
        <h2 id="items" className="mb-3 font-medium">In the list</h2>
        {list.items.length === 0 ? (
          <p className="text-sm text-muted">The list is empty.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {list.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- product thumbnails are already small
                  <img src={item.image} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded border border-border object-cover" />
                ) : (
                  <span aria-hidden="true" className="size-12 shrink-0 rounded bg-surface" />
                )}
                <span className="min-w-0 flex-1">
                  <Link href={`${base}/products/${item.productId}`} className="font-medium underline-offset-2 hover:underline">
                    {item.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {item.variant
                      ? variantText(item.variant.options, item.variant.sku)
                      : item.variants > 1
                        ? "Variant not chosen yet"
                        : "No variant to choose"}
                    {item.productStatus !== "active" && " · no longer for sale"}
                  </span>
                  <span className="block text-xs text-muted">
                    Saved {date(item.savedAt)}
                    {item.available !== null && (item.available > 0 ? ` · ${item.available} in stock` : " · out of stock")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {item.quantity > 1 && <span className="block text-xs text-muted">{item.quantity} ×</span>}
                  {item.priceMinor !== null && item.currency ? (
                    <>
                      {!item.variant && item.variants > 1 && <span className="text-xs text-muted">from </span>}
                      {formatMoney(item.priceMinor, item.currency, locale)}
                    </>
                  ) : (
                    "–"
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="to-cart" className={card}>
        <h2 id="to-cart" className="mb-1 font-medium">From this list to purchase</h2>
        <p className="mb-3 text-sm text-muted">Each time the shopper put items from this list in the cart, and what came of it.</p>
        {adds.length === 0 ? (
          <p className="text-sm text-muted">Nothing from this list has gone to the cart yet.</p>
        ) : (
          <CartAddTable rows={adds} storeSlug={store.slug} locale={locale} showList={false} showCustomer={!customer} />
        )}
      </section>
    </div>
  );
}
