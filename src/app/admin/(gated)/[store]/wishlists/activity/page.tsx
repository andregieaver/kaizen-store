import type { Metadata } from "next";
import Link from "next/link";

import { CartAddTable, WishlistTabs } from "@/components/admin/wishlist-admin";
import { requireMember } from "@/server/auth";
import { listCartAdds } from "@/server/wishlist-admin";

export const metadata: Metadata = { title: "From wishlist to purchase" };

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "bought", label: "Bought" },
  { key: "not_bought", label: "Not bought" },
] as const;

/**
 * The record of items put in the cart from a wishlist (D36), newest first,
 * each followed to the order the cart became: bought, awaiting payment,
 * still in the cart, taken out, or left behind.
 */
export default async function WishlistActivityPage({ params, searchParams }: PageProps<"/admin/[store]/wishlists/activity">) {
  const { store } = await requireMember((await params).store);
  const raw = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === raw)?.key ?? "all";
  const rows = await listCartAdds(store.id, { outcome: show === "all" ? undefined : show });
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/wishlists/activity`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Wishlists</h1>
        <p className="text-sm text-muted">
          Every item a shopper put in the cart from one of their lists, and whether it was bought. An item counts as bought
          when the order it went into is paid.
        </p>
      </div>
      <WishlistTabs storeSlug={store.slug} current="activity" />

      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? base : `${base}?show=${f.key}`}
            aria-current={f.key === show ? "page" : undefined}
            className="rounded-full border border-border px-3 py-1 aria-[current=page]:border-foreground aria-[current=page]:font-semibold"
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          {show === "all"
            ? "Nothing has gone from a wishlist to the cart yet. It shows here the moment a shopper adds items from a list."
            : "Nothing here."}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-background px-4">
          <CartAddTable rows={rows} storeSlug={store.slug} locale={locale} />
        </div>
      )}
      {rows.length === 200 && <p className="text-sm text-muted">Showing the latest 200.</p>}
    </div>
  );
}
