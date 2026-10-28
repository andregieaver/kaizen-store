"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { trackShop } from "@/lib/shop-events";
import { OPTIONS_FROM, buyableValues, nearestVariant, optionsOf } from "@/lib/variant-options";

import { TrackContext, trackedItem, type ShopTrack } from "./shop-track";

import { AddToCart, type AddToCartLabels } from "./add-to-cart";
import { AddToDelivery, type AddToDeliveryLabels } from "./add-to-delivery";
import { BackInStock, type BackInStockLabels } from "./back-in-stock";
import { Dropdown } from "./dropdown";
import { ExpressArea, type ExpressSetup } from "./express-area";
import { KlarnaMessage, type KlarnaSetup } from "./klarna-message";
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
  track = null,
  children,
}: {
  initial: string;
  productId: string;
  pictures: Record<string, VariantPicture | null>;
  /** The variants as the store's tags hear of them (D303 I1). */
  track?: ShopTrack | null;
  children: ReactNode;
}) {
  const choice = useState(initial);
  const chosen = choice[0];
  const viewed = useRef(new Set<string>());
  useEffect(() => showVariantPicture(productId, pictures[chosen] ?? null), [productId, pictures, chosen]);
  useEffect(() => announceVariant(productId, chosen), [productId, chosen]);
  // Each variant shown is one view, once.
  useEffect(() => {
    if (viewed.current.has(chosen)) return;
    const event = trackedItem(track, chosen, 1);
    if (!event) return;
    viewed.current.add(chosen);
    trackShop({ kind: "view_item", ...event });
  }, [track, chosen]);
  return (
    <TrackContext.Provider value={track}>
      <ChosenVariant.Provider value={choice}>{children}</ChosenVariant.Provider>
    </TrackContext.Provider>
  );
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
  /** Its option values (`{ Colour: "Red", Size: "M" }`), for a list per option (D320). */
  options: Record<string, string>;
  image: { url: string; alt: string } | null;
  /** In stock, low stock, sold out or instant download. */
  note: string;
  available: boolean;
  /** Said when the cart holds as many as one line may (set for a variant on backorder: its stock is no limit, D172). */
  capped?: string;
  /** Its price, as a place in the part's `prices`: one drawn per distinct price, so the page does not grow with each variant (D320). */
  priceIndex: number;
  /** Its price breaks (D323), as a place in the part's `breakTables`; none for a variant whose breaks lower nothing. */
  breakIndex?: number;
};

/** A price as the server drew it, once for every variant that has it. */
export type OfferedPrice = {
  /** The full price, with its VAT label and 30-day reference. */
  price: ReactNode;
  /** The amount alone, for the dropdown. */
  amount: ReactNode;
};

/**
 * A product's variants to buy: one dropdown with each variant's picture,
 * stock and price, then the chosen one's price and Add to cart, in a box.
 * A single variant is shown as it is, with no box: there is nothing to choose.
 * From `optionsFrom` variants (D320) each option is a dropdown of its own, a
 * value that makes no buyable variant with the others chosen marked
 * (`buyableValues()`), and choosing one moves to the nearest buyable variant.
 */
export function VariantPurchase({
  variants,
  prices,
  breakTables = [],
  optionsFrom = OPTIONS_FROM,
  store,
  market,
  cartHref,
  openCart,
  labels,
  delivery,
  notify,
  express,
  klarna,
}: {
  variants: OfferedVariant[];
  prices: OfferedPrice[];
  /** The price-break tables the server drew (D323), one per distinct table. */
  breakTables?: ReactNode[];
  /** From this many variants, a list per option (the buy part's setting). */
  optionsFrom?: number;
  store: string;
  market: string;
  cartHref: string;
  openCart: boolean;
  labels: AddToCartLabels & { chooseVariant: string; variantUnavailable?: string };
  /** Weekly deliveries (D102): the variants that can go on the list, and where the list is. */
  delivery?: { variants: string[]; listHref: string; labels: AddToDeliveryLabels };
  /** Back in stock (D298): the sold-out variants a shopper may ask to hear about, the signed-in customer's address, and the words. */
  notify?: { variants: string[]; email: string; labels: BackInStockLabels };
  /** Express checkout (D373): offered to this shopper, for the variants sent by post. */
  express?: ExpressSetup & { variants: string[] };
  /** Klarna's line under the price (D373), each price's amount by its place in `prices`. */
  klarna?: KlarnaSetup & { amounts: number[] };
}) {
  const [chosen, setChosen] = useVariantChoice(variants[0]?.id ?? "");
  const variant = variants.find((v) => v.id === chosen) ?? variants[0];
  if (!variant) return null;
  const several = variants.length > 1;
  const price = prices[variant.priceIndex];
  const options = several && variants.length >= optionsFrom ? optionsOf(variants.map(pickOf)) : [];
  return (
    <div className={several ? "flex flex-col gap-3 rounded-lg border border-border p-3" : "flex flex-col gap-3"}>
      {options.length > 0 ? (
        <OptionLists variants={variants} variant={variant} options={options} onChoose={setChosen} unavailable={labels.variantUnavailable ?? labels.unavailable} />
      ) : (
        several && (
          <Dropdown
            label={labels.chooseVariant}
            value={variant.id}
            onChange={setChosen}
            options={variants.map((v) => ({
              value: v.id,
              label: v.label,
              note: v.note,
              image: v.image,
              detail: prices[v.priceIndex]?.amount,
              disabled: !v.available,
            }))}
          />
        )
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
          {price?.price}
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
            capped={variant.capped}
          />
          {klarna && klarna.amounts[variant.priceIndex] !== undefined && (
            <KlarnaMessage key={`klarna-${variant.id}`} {...klarna} amountMinor={klarna.amounts[variant.priceIndex]} />
          )}
          {express?.variants.includes(variant.id) && variant.available && (
            <ExpressArea key={`express-${variant.id}`} store={store} market={market} variantId={variant.id} labels={express.labels} terms={express.terms} look={express.look} />
          )}
          {delivery?.variants.includes(variant.id) && (
            <AddToDelivery key={`delivery-${variant.id}`} store={store} market={market} variantId={variant.id} listHref={delivery.listHref} labels={delivery.labels} />
          )}
        </div>
      </div>
      {variant.breakIndex !== undefined && breakTables[variant.breakIndex]}
      {!variant.available && notify?.variants.includes(variant.id) && (
        <BackInStock key={`notify-${variant.id}`} store={store} market={market} variantId={variant.id} email={notify.email} labels={notify.labels} />
      )}
    </div>
  );
}

const pickOf = (v: OfferedVariant) => ({ id: v.id, options: v.options, buyable: v.available });

/**
 * A list per option (D320): the chosen variant's values, every value of each option listed, the ones that make no buyable variant with the
 * other values chosen marked and skipped (the chosen variant's own value stays choosable, so the list shows it). The gallery shows the variant's
 * picture, as with one list (`VariantChoice`).
 */
function OptionLists({
  variants,
  variant,
  options,
  onChoose,
  unavailable,
}: {
  variants: OfferedVariant[];
  variant: OfferedVariant;
  options: { name: string; values: string[] }[];
  onChoose: (id: string) => void;
  unavailable: string;
}) {
  const picks = variants.map(pickOf);
  const buyable = buyableValues(picks, variant.options);
  return (
    <div className="flex flex-col gap-3">
      {options.map((option) => (
        <Dropdown
          key={option.name}
          label={option.name}
          value={variant.options[option.name] ?? ""}
          onChange={(value) => {
            const next = nearestVariant(picks, { ...variant.options, [option.name]: value }, option.name);
            if (next) onChoose(next.id);
          }}
          options={option.values.map((value) => {
            const can = buyable[option.name]?.has(value) ?? false;
            return { value, label: value, note: can ? undefined : unavailable, disabled: !can && value !== variant.options[option.name] };
          })}
        />
      ))}
    </div>
  );
}
