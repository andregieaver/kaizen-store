import Link from "next/link";

import { WishlistView, type WishlistItemView } from "@/components/wishlist-view";
import { optionLabel, t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { StoreQuery } from "@/lib/store-parts";
import { formatMoney } from "@/lib/money";
import { canOffer } from "@/lib/stock-words";
import { shownAmount } from "@/lib/pricing";
import { getBuyer } from "@/server/b2b";
import { marketPath } from "@/lib/paths";
import { getProduct, getVariantStock } from "@/server/catalog";
import { getCustomer } from "@/server/customers";
import type { Store } from "@/server/stores";
import { getWishlistItems, listWishlists } from "@/server/wishlists";

/**
 * The shopper's wishlists (D34): one list at a time, with its items ready
 * for the cart, and the lists to move them between. The wishlist page shows
 * it, and so does a store's own page for it (D113).
 */
export function WishlistSection(props: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  return (
    <div className="flex flex-col gap-6">
      <Wishlist {...props} />
    </div>
  );
}

async function Wishlist({ store, market, query }: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  const m = t(market.lang);
  const w = m.wishlist;
  const base = marketPath(store.slug, market.slug);
  const [lists, customer, buyer] = await Promise.all([listWishlists(store.id), getCustomer(store.id), getBuyer(store)]);
  const wanted = (await query).list;
  const current = lists.find((l) => l.id === wanted) ?? lists[0] ?? null;

  const rows = current ? await getWishlistItems(store.id, current.id) : [];
  const products = await Promise.all(rows.map((row) => getProduct(store.id, market, row.handle)));
  const variantIds = products.flatMap((p) => p?.variants.map((v) => v.id) ?? []);
  // Units in stock, or a variant that keeps selling at zero with its days stated (D172); a download has no stock row to run out.
  const stock = await getVariantStock(store.id, variantIds);
  const items: WishlistItemView[] = rows.flatMap((row, i) => {
    const product = products[i];
    if (!product) return [];
    return [
      {
        id: row.id,
        title: product.title,
        href: `${base}/p/${product.handle}`,
        image: product.images[0] ? { url: product.images[0].thumbnailUrl, alt: product.images[0].alt || product.title } : null,
        variantId: row.variantId,
        quantity: row.quantity,
        subscriptionOnly: product.subscriptionOnly,
        booking: product.kind !== "goods",
        fromPrice: `${product.variants.length > 1 ? `${m.fromPrice} ` : ""}${formatMoney(
          Math.min(...product.variants.map((v) => shownAmount(v.price.amountMinor, v.price.vat, buyer))),
          product.variants[0]?.price.currency ?? market.currency,
          market.locale,
        )}`,
        variants: product.variants.map((v) => ({
          id: v.id,
          label: optionLabel(m, v.options) || product.title,
          price: formatMoney(shownAmount(v.price.amountMinor, v.price.vat, buyer), v.price.currency, market.locale),
          available: v.delivery !== "physical" || canOffer(stock.get(v.id)),
        })),
      },
    ];
  });

  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{w.title}</h1>
      {!customer && (
        <p className="text-sm text-muted">
          {w.signIn}{" "}
          <Link href={`${base}/account`} className="underline">
            {w.signInLink}
          </Link>
        </p>
      )}
      <WishlistView
        store={store.slug}
        market={market.slug}
        base={base}
        lists={lists.map((l) => ({ id: l.id, name: l.name, items: l.items }))}
        current={current ? { id: current.id, name: current.name, keepAfterCart: current.keepAfterCart } : null}
        items={items}
        labels={{
          noLists: w.noLists,
          empty: w.empty,
          lists: w.lists,
          newList: w.newList,
          listName: w.listName,
          create: w.create,
          rename: w.rename,
          saveName: w.saveName,
          cancel: w.cancel,
          deleteList: w.deleteList,
          deleteConfirm: current ? w.deleteConfirm(current.name) : "",
          selectAll: w.selectAll,
          addSelected: w.addSelected,
          addAll: w.addAll,
          moveTo: w.moveTo,
          move: w.move,
          removeSelected: w.removeSelected,
          remove: w.remove,
          afterCart: w.afterCart,
          keep: w.keep,
          clear: w.clear,
          variant: w.variant,
          chooseVariant: w.chooseVariant,
          needsVariant: w.needsVariant,
          subscription: w.subscription,
          booking: w.booking,
          capped: w.capped,
          quantity: m.quantity,
          soldOut: m.soldOut,
          addToCart: m.addToCart,
          goToCart: m.goToCart,
          itemCounts: lists.map((l) => m.account.items(l.items)),
          selectItems: items.map((item) => w.select(item.title)),
          selectedCounts: items.map((_, i) => w.selected(i + 1)),
        }}
      />
    </>
  );
}
