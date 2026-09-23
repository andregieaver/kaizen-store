import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { cartSubtotal, MAX_LINE_QUANTITY } from "@/lib/cart";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import { getMarket, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { getCart, type CartLine } from "@/server/cart";

import { updateCartLine } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[market]/cart">): Promise<Metadata> {
  const market = getMarket((await params).market);
  return market ? { title: t(market.slug).cart, robots: { index: false } } : {};
}

export default async function CartPage({ params }: PageProps<"/[market]/cart">) {
  const market = getMarket((await params).market);
  if (!market) notFound();
  const m = t(market.slug);

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{m.cart}</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <CartContents market={market} m={m} />
      </Suspense>
    </>
  );
}

async function CartContents({ market, m }: { market: Market; m: Messages }) {
  const cart = await getCart(market);

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p>{m.emptyCart}</p>
        <Link href={`/${market.slug}`} className="underline">
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
                  <Link href={`/${market.slug}/p/${line.handle}`} className="font-medium underline-offset-2 hover:underline">
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

      <aside aria-label={m.subtotal} className="flex h-fit flex-col gap-4 rounded-lg border border-border p-4">
        <p className="flex justify-between font-semibold">
          <span>{m.subtotal}</span>
          <span>{money(cartSubtotal(payable))}</span>
        </p>
        <p className="text-sm text-muted">
          {m.vatIncluded}. {m.shippingAtCheckout}
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="min-h-11 rounded-full bg-foreground px-4 font-medium text-background disabled:opacity-40"
          title={blocked ? m.noLongerAvailable : undefined}
        >
          {m.checkoutSoon}
        </button>
      </aside>
    </div>
  );
}
