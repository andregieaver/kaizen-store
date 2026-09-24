import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CheckoutButton } from "@/components/checkout-button";
import { cartSubtotal, MAX_LINE_QUANTITY } from "@/lib/cart";
import { shippingCost } from "@/lib/checkout";
import { checkoutLabels } from "@/lib/checkout-labels";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { getCart, type CartLine } from "@/server/cart";
import { getCheckoutInfo } from "@/server/orders";
import { resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";

import { updateCartLine } from "./actions";

type Props = PageProps<"/s/[store]/[market]/cart">;

async function load(params: Props["params"]) {
  const { store, market } = await params;
  return resolveShop(store, market);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await load(params);
  return shop ? { title: t(shop.market.lang).cart, robots: { index: false } } : {};
}

export default async function CartPage({ params }: Props) {
  const shop = await load(params);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang);

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{m.cart}</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <CartContents store={store} market={market} m={m} />
      </Suspense>
    </>
  );
}

async function CartContents({
  store,
  market,
  m,
}: {
  store: Store;
  market: Market;
  m: Messages;
}) {
  const cart = await getCart({ storeId: store.id, market });
  const home = marketPath(store.slug, market.slug);

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p>{m.emptyCart}</p>
        <Link href={home} className="underline">
          {m.continueShopping}
        </Link>
      </div>
    );
  }

  const payable = cart.lines.filter(
    (line): line is CartLine & { unitPriceMinor: number } =>
      line.status !== "unavailable" && line.unitPriceMinor !== null,
  );
  const blocked = cart.lines.some((line) => line.status !== "ok");
  const checkout = await getCheckoutInfo(store.id, market.code);
  const subtotal = cartSubtotal(payable);
  const shipping = checkout.shipping ? shippingCost(subtotal, checkout.shipping) : null;
  const money = (minor: number) => formatMoney(minor, cart.currency, market.locale);

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
      <ul className="divide-y divide-border border-y border-border">
        {cart.lines.map((line) => (
          <li key={line.variantId} className="flex gap-4 py-4">
            {line.image && (
              <Image
                src={line.image.url}
                alt={line.image.alt}
                width={96}
                height={96}
                unoptimized
                className="size-24 shrink-0 rounded-md bg-surface object-cover"
              />
            )}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex justify-between gap-4">
                <div>
                  <Link href={`${home}/p/${line.handle}`} className="font-medium underline-offset-2 hover:underline">
                    {line.title}
                  </Link>
                  {Object.keys(line.options).length > 0 && (
                    <p className="text-sm text-muted">{optionLabel(m, line.options)}</p>
                  )}
                </div>
                {line.unitPriceMinor !== null && line.status !== "unavailable" && (
                  <p className="font-medium">{money(line.unitPriceMinor * line.quantity)}</p>
                )}
              </div>

              {line.status === "insufficient" && (
                <p role="alert" className="text-sm">{m.onlyAvailable(line.available)}</p>
              )}
              {line.status === "unavailable" && (
                <p role="alert" className="text-sm">{m.noLongerAvailable}</p>
              )}

              <div className="flex flex-wrap items-end gap-2">
                {line.status !== "unavailable" && (
                  <form action={updateCartLine} className="flex items-end gap-2">
                    <input type="hidden" name="store" value={store.slug} />
                  <input type="hidden" name="market" value={market.slug} />
                    <input type="hidden" name="variantId" value={line.variantId} />
                    <label className="flex flex-col text-sm">
                      {m.quantity}
                      <input
                        type="number"
                        name="quantity"
                        min={0}
                        max={MAX_LINE_QUANTITY}
                        defaultValue={line.quantity}
                        className="min-h-11 w-20 rounded-md border border-border bg-background px-2"
                      />
                    </label>
                    <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm">
                      {m.update}
                    </button>
                  </form>
                )}
                <form action={updateCartLine}>
                  <input type="hidden" name="store" value={store.slug} />
                  <input type="hidden" name="market" value={market.slug} />
                  <input type="hidden" name="variantId" value={line.variantId} />
                  <input type="hidden" name="quantity" value="0" />
                  <button type="submit" className="min-h-11 px-3 text-sm underline">
                    {m.remove}
                    <span className="sr-only">: {line.title}</span>
                  </button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside aria-label={m.subtotal} className="flex h-fit flex-col gap-3 rounded-lg border border-border p-4">
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between">
            <dt>{m.subtotal}</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          {shipping !== null && (
            <div className="flex justify-between">
              <dt>{m.shipping}</dt>
              <dd>{shipping === 0 ? m.freeShipping : money(shipping)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <dt>{m.total}</dt>
            <dd>{money(subtotal + (shipping ?? 0))}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          {m.vatIncluded}
          {shipping === null && ` · ${m.shippingAtCheckout}`}
        </p>
        {checkout.paymentsOn ? (
          <CheckoutButton
            store={store.slug}
            market={market.slug}
            disabled={blocked}
            labels={checkoutLabels(m)}
          />
        ) : (
          <p className="text-sm">{m.checkoutUnavailable}</p>
        )}
        {blocked && <p className="text-sm">{m.noLongerAvailable}</p>}
      </aside>
    </div>
  );
}
