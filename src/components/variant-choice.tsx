"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { AddToCart, type AddToCartLabels } from "./add-to-cart";
import { AddToDelivery, type AddToDeliveryLabels } from "./add-to-delivery";
import { Dropdown } from "./dropdown";
import { showVariantPicture, type VariantPicture } from "./variant-picture";
import { announceVariant } from "./variant-selected";

type Choice = [string, (id: string) => void];

const ChosenVariant = createContext<Choice | null>(null);

/**
 * The variant chosen on a product page, shared by its picker and the phone's
 * bottom bar, so both add the same one; choosing one shows its picture in
 * the gallery (D82).
 */
export function VariantChoice({
  initial,
  productId,
  pictures,
  children,
}: {
  initial: string;
  productId: string;
  pictures: Record<string, VariantPicture | null>;
  children: ReactNode;
}) {
  const choice = useState(initial);
  const chosen = choice[0];
  useEffect(() => showVariantPicture(productId, pictures[chosen] ?? null), [productId, pictures, chosen]);
  useEffect(() => announceVariant(productId, chosen), [productId, chosen]);
  return <ChosenVariant.Provider value={choice}>{children}</ChosenVariant.Provider>;
}

/** The page's chosen variant, or one of the component's own outside a `VariantChoice`. */
export function useVariantChoice(fallback: string): Choice {
  const shared = useContext(ChosenVariant);
  const own = useState(fallback);
  return shared ?? own;
}

/** A variant as the product page offers it, with its price drawn by the server (the store's VAT display, plans). */
export type OfferedVariant = {
  id: string;
  label: string;
  image: { url: string; alt: string } | null;
  /** In stock, low stock, sold out or instant download. */
  note: string;
  available: boolean;
  /** The full price, with its VAT label and 30-day reference. */
  price: ReactNode;
  /** The amount alone, for the dropdown. */
  amount: ReactNode;
};

/**
 * A product's variants to buy: one dropdown with each variant's picture,
 * stock and price, then the chosen one's price and Add to cart. A single
 * variant is shown as it is.
 */
export function VariantPurchase({
  variants,
  store,
  market,
  cartHref,
  openCart,
  labels,
  delivery,
}: {
  variants: OfferedVariant[];
  store: string;
  market: string;
  cartHref: string;
  openCart: boolean;
  labels: AddToCartLabels & { chooseVariant: string };
  /** Weekly deliveries (D102): the variants that can go on the list, and where the list is. */
  delivery?: { variants: string[]; listHref: string; labels: AddToDeliveryLabels };
}) {
  const [chosen, setChosen] = useVariantChoice(variants[0]?.id ?? "");
  const variant = variants.find((v) => v.id === chosen) ?? variants[0];
  if (!variant) return null;
  const several = variants.length > 1;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      {several && (
        <Dropdown
          label={labels.chooseVariant}
          value={variant.id}
          onChange={setChosen}
          options={variants.map((v) => ({
            value: v.id,
            label: v.label,
            note: v.note,
            image: v.image,
            detail: v.amount,
            disabled: !v.available,
          }))}
        />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {!several && variant.image && (
            // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
            <img src={variant.image.url} alt={variant.image.alt} className="size-12 rounded-md bg-surface object-cover" />
          )}
          <div>
            {!several && variant.label && <p>{variant.label}</p>}
            <p className="text-sm text-muted">{variant.note}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {variant.price}
          {/* A new variant starts without the last one's outcome. */}
          <AddToCart
            key={variant.id}
            store={store}
            market={market}
            cartHref={cartHref}
            variantId={variant.id}
            disabled={!variant.available}
            openCart={openCart}
            labels={labels}
          />
          {delivery?.variants.includes(variant.id) && (
            <AddToDelivery key={`delivery-${variant.id}`} store={store} market={market} variantId={variant.id} listHref={delivery.listHref} labels={delivery.labels} />
          )}
        </div>
      </div>
    </div>
  );
}
