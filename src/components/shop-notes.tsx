import { cartView } from "@/app/s/[store]/[market]/cart/cart-contents";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import type { PriceView } from "@/lib/pricing";
import { freeShippingState, productSaving, type FreeShippingState } from "@/lib/shop-notes";
import { cartSavingOf, emptyFreeShipping } from "@/server/shop-notes";
import type { Store } from "@/server/stores";

/**
 * The shop's notes about a basket (D558), drawn on the cart, checkout, category and tag pages (`STORE_NOTES`) and as product parts. Read per
 * request (the cart is the shopper's), so each sits in its caller's `<Suspense>`; the cart's figures are `cartView()`'s, read once a request
 * with the cart's own pieces. Bare, as pieces are: the block's frame and spacing decide how it looks.
 */

/** How far the shopper's cart is from free shipping, with a bar; the threshold for an empty cart; nothing without a threshold. */
export async function FreeShippingNote({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  const state = view.empty
    ? await emptyFreeShipping(store.id, market)
    : freeShippingState(view.summary.checkout.shipping, view.summary.subtotal, view.summary.ships, false);
  return state ? <FreeShippingView state={state} currency={view.empty ? market.currency : view.cart.currency} market={market} m={m} /> : null;
}

export function FreeShippingView({ state, currency, market, m }: { state: FreeShippingState; currency: string; market: Market; m: Messages }) {
  const money = (minor: number) => formatMoney(minor, currency, market.locale, market.priceStyle);
  const w = m.shopNotes;
  if (state.kind === "empty") return <p className="text-sm" data-shop-note="free_shipping">{w.freeShippingFrom(money(state.thresholdMinor))}</p>;
  const percent = state.kind === "reached" ? 100 : state.percent;
  return (
    <div className="flex flex-col gap-2" data-shop-note="free_shipping" data-state={state.kind}>
      <p className="text-sm font-medium">{state.kind === "reached" ? w.freeShippingReached : w.freeShippingLeft(money(state.leftMinor))}</p>
      <div
        role="progressbar"
        aria-label={w.freeShippingBar}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-surface"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** What the shopper's cart saves today: reductions against the 30-day lowest prices and the cart's discounts; nothing when nothing is saved. */
export async function CartSavedNote({ store, market, m }: { store: Store; market: Market; m: Messages }) {
  const view = await cartView(store, market, m);
  if (view.empty) return null;
  const saving = await cartSavingOf(store.id, market, view.cart, view.summary.discountMinor);
  if (saving.totalMinor <= 0) return null;
  return <SavedView amount={view.net(saving.totalMinor)} note={m.shopNotes.savedCartNote} m={m} />;
}

/** What one product saves at its headline price, against its lowest price of the last 30 days; nothing when its price is no reduction. */
export function ProductSavedNote({ price, market, m }: { price: PriceView; market: Market; m: Messages }) {
  const saving = productSaving(price);
  if (saving <= 0) return null;
  return <SavedView amount={formatMoney(saving, price.currency, market.locale, market.priceStyle)} note={m.shopNotes.savedProductNote} m={m} />;
}

function SavedView({ amount, note, m }: { amount: string; note: string; m: Messages }) {
  return (
    <div className="flex flex-col gap-0.5" data-shop-note="you_saved">
      <p className="font-medium">{m.shopNotes.savedToday(amount)}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}
