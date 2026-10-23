import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { CartAddTable, WishlistTabs } from "@/components/admin/wishlist-admin";
import { requirePermission } from "@/server/permissions";
import { listCartAdds } from "@/server/wishlist-admin";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "From wishlist to purchase" };

const FILTERS = [{ key: "all" }, { key: "bought" }, { key: "not_bought" }] as const;

/**
 * The record of items put in the cart from a wishlist (D36), newest first,
 * each followed to the order the cart became: bought, awaiting payment,
 * still in the cart, taken out, or left behind.
 */
export default async function WishlistActivityPage({ params, searchParams }: PageProps<"/admin/[store]/wishlists/activity">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const raw = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === raw)?.key ?? "all";
  const rows = await listCartAdds(store.id, { outcome: show === "all" ? undefined : show });
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "bookings").wishlists;
  const base = `/admin/${store.slug}/wishlists/activity`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.activity.description}
      />
      <WishlistTabs storeSlug={store.slug} current="activity" words={w} />

      <nav aria-label={w.activity.filter} className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? base : `${base}?show=${f.key}`}
            aria-current={f.key === show ? "page" : undefined}
            className="rounded-full border border-line px-3 py-1 aria-[current=page]:border-brand aria-[current=page]:font-medium"
          >
            {w.activity.filters[f.key]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {show === "all"
            ? w.activity.none
            : w.activity.nothing}
        </p>
      ) : (
        <div className={`px-4 ${CARD_CLASS}`}>
          <CartAddTable rows={rows} storeSlug={store.slug} locale={locale} words={w} dateLocale={lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale} />
        </div>
      )}
      {rows.length === 200 && <p className="text-sm text-muted">{w.activity.latest}</p>}
    </div>
  );
}
