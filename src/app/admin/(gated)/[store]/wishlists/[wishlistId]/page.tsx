import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { CustomerBar, storeCustomerBar } from "@/components/admin/customer-bar";
import { CartAddTable, variantText } from "@/components/admin/wishlist-admin";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/permissions";
import { customerSummary } from "@/server/customer-admin";
import { getStoreWishlist, listCartAdds } from "@/server/wishlist-admin";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";


export const metadata: Metadata = { title: "Wishlist" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * One shopper's list (D36): whose it is, what is in it now, and what went
 * from it to the cart and whether it was bought. The shopper's own: the
 * admin only looks.
 */
export default async function WishlistPage({ params }: PageProps<"/admin/[store]/wishlists/[wishlistId]">) {
  const { store: slug, wishlistId } = await params;
  const gated = await requirePermission(slug, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(wishlistId).success) notFound();
  const market = store.markets[0] ?? null;
  const list = await getStoreWishlist(store.id, wishlistId, market);
  if (!list) notFound();
  const [customer, adds] = await Promise.all([
    list.owner ? customerSummary(store.id, list.owner.customerId) : null,
    listCartAdds(store.id, { wishlistId }),
  ]);
  const locale = market?.locale ?? "nb-NO";
  const lang = adminLangOf(gated.account.adminLocale);
  const t = adminText(lang, "bookings").wishlists;
  const w = t.list;
  const dateLocale = lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale;
  const base = `/admin/${store.slug}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const totalMinor = list.items.reduce((sum, i) => sum + (i.priceMinor ?? 0) * i.quantity, 0);
  const currency = list.items.find((i) => i.currency)?.currency;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/wishlists`, label: t.title }}
        title={<>{list.name}</>}
        description={<>{countWords(list.items.length, t.items)}{currency && totalMinor > 0 && ` · ${fillWords(w.today, { amount: formatMoney(totalMinor, currency, locale) })}`} · {fillWords(w.made, { date: date(list.createdAt) })} ·{" "}{list.keepAfterCart ? w.stay : w.leave}</>}
      />

      {customer ? (
        <CustomerBar customer={storeCustomerBar(store.slug, customer, locale)} />
      ) : (
        <section aria-label={w.shopper} className={`p-4 text-sm ${CARD_CLASS}`}>
          <p className="font-medium">{w.guest}</p>
          <p className="text-muted">{w.guestHint}</p>
        </section>
      )}

      <section aria-labelledby="items" className={card}>
        <h2 id="items" className="mb-3 text-title text-ink">{w.inList}</h2>
        {list.items.length === 0 ? (
          <p className="text-sm text-muted">{w.empty}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {list.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- product thumbnails are already small
                  <img src={item.image} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded border border-line object-cover" />
                ) : (
                  <span aria-hidden="true" className="size-12 shrink-0 rounded bg-sunken" />
                )}
                <span className="min-w-0 flex-1">
                  <Link href={`${base}/products/${item.productId}`} className="font-medium underline-offset-2 hover:underline">
                    {item.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {item.variant
                      ? variantText(item.variant.options, item.variant.sku)
                      : item.variants > 1
                        ? w.noVariant
                        : w.oneVariant}
                    {item.productStatus !== "active" && ` · ${w.notForSale}`}
                  </span>
                  <span className="block text-xs text-muted">
                    {fillWords(w.saved, { date: date(item.savedAt) })}
                    {item.available !== null && (item.available > 0 ? ` · ${fillWords(w.inStock, { n: item.available })}` : ` · ${w.outOfStock}`)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {item.quantity > 1 && <span className="block text-xs text-muted">{item.quantity} ×</span>}
                  {item.priceMinor !== null && item.currency ? (
                    <>
                      {!item.variant && item.variants > 1 && <span className="text-xs text-muted">{w.from} </span>}
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
        <h2 id="to-cart" className="mb-1 text-title text-ink">{w.toPurchase}</h2>
        <p className="mb-3 text-sm text-muted">{w.toPurchaseHint}</p>
        {adds.length === 0 ? (
          <p className="text-sm text-muted">{w.nothingToCart}</p>
        ) : (
          <CartAddTable words={t} dateLocale={dateLocale} rows={adds} storeSlug={store.slug} locale={locale} showList={false} showCustomer={!customer} />
        )}
      </section>
    </div>
  );
}
