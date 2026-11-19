import Image from "next/image";
import Link from "next/link";

import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { recommendForCart } from "@/server/recommend";
import { tileFacts } from "@/server/shop-tiles";
import type { Store } from "@/server/stores";

import { AddToCart } from "./add-to-cart";
import { Price } from "./price";

/**
 * *Goes well with* (D559): products that go with what is in the shopper's cart, from the recommendations engine anchored on the cart
 * (`recommendForCart()`: upsells, cross-sells and accessories by the owner's rules, never what is already in it), each with a button to add
 * it when it is bought without choosing anything first (the tile's own facts, `tileFacts()`), else a link to its page. Read per request,
 * so its caller wraps it in `<Suspense>`; nothing for an empty cart or when nothing goes with it. Bare, as the cart's pieces are.
 */
export async function CartUpsell({ store, market, m, limit = 3, compact = false }: { store: Store; market: Market; m: Messages; limit?: number; compact?: boolean }) {
  const items = await recommendForCart(store, market, limit);
  if (items.length === 0) return null;
  // One unit at a time: an addition beside the cart, whose own lines then change the quantity.
  const { facts } = await tileFacts(store.id, market, items.map((item) => item.id));
  const cart = marketPath(store.slug, market.slug, "/cart");
  return (
    <section aria-labelledby="cart-upsell" className="flex min-w-0 flex-col gap-3" data-cart-upsell="">
      <h2 id="cart-upsell" className="font-medium">
        {m.shopNotes.goesWith}
      </h2>
      <ul className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {items.map((item) => {
          const buy = facts[item.id]?.buy ?? null;
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-3">
              {item.image && (
                <Image
                  src={item.image.url}
                  alt=""
                  width={160}
                  height={160}
                  unoptimized
                  className={`${compact ? "size-16" : "size-20"} shrink-0 rounded-md bg-surface object-cover`}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={item.href} className="font-medium underline-offset-2 hover:underline">
                  {item.title}
                </Link>
                {item.note && <p className="text-xs text-muted">{item.note}</p>}
                {item.price && <Price price={item.price.view} locale={market.locale} m={m} from={item.price.from} />}
                <div className="[&_form]:items-start [&_form>div]:justify-start">
                  {buy ? (
                    <AddToCart
                      store={store.slug}
                      market={market.slug}
                      cartHref={cart}
                      variantId={buy.variantId}
                      disabled={false}
                      labels={{ addToCart: m.addToCart, adding: m.adding, added: m.added, capped: m.capped, unavailable: m.unavailable, planConflict: m.planConflict, tryAgain: m.tryAgain, goToCart: m.goToCart }}
                    />
                  ) : (
                    <Link href={item.href} className="text-sm underline">
                      {m.viewProduct}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
