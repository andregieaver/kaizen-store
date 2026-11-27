"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import type { QuantityRule } from "@/lib/quantity-rules";
import { trackShop } from "@/lib/shop-events";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/(shop)/cart/actions";

import { AffiliateField } from "./affiliate-field";
import { RecommendField } from "./recommend-field";
import { useOpenCartAfterAdd } from "./cart-drawer";
import { setCart } from "./shopper-own";
import { useChosenPlan } from "./purchase-options";
import { trackedItem, useShopTrack } from "./shop-track";
import { useKeepFocus } from "./keep-focus";
import { useQuantityChoice } from "./quantity-choice";
import { QuantityStepper, type QuantityStepperLabels } from "./quantity-stepper";

export type AddToCartLabels = {
  addToCart: string;
  adding: string;
  added: string;
  capped: string;
  unavailable: string;
  /** The cart already has a subscription on another schedule. */
  planConflict: string;
  tryAgain: string;
  goToCart: string;
};

/**
 * The quantity a product page lets the shopper choose (D430): the variant's rule, − and + beside the number (`buttons`) or the number alone,
 * and the words. Absent, Add to cart puts in one, which the cart makes the rule's minimum (`nextQuantity()`).
 */
export type QuantityOffer = { rule: QuantityRule; buttons: boolean; labels: QuantityStepperLabels };

/**
 * Straight to payment, past the cart (D915): what pressing the button agrees to, said beside it (the owner's choice: the press is the agreement,
 * 27 November 2026). `byVariant`: a variant's own (a download's withdrawal); `byPlan`: a purchase option's renewals for a variant, keyed
 * `{variant}:{option}`. The server presses on to payment only where the whole basket may (`startDirect()`); else the shopper is shown the cart.
 */
export type DirectBuy = { lead: string; byVariant: Record<string, string[]>; byPlan: Record<string, string> };

const initial: AddToCartState = { outcome: "idle", quantity: 0 };

/** Adds, and puts the cart's new count in the header as the answer arrives, even if the tile that asked has left the page meanwhile (bloat review step 2.4). */
async function addAndCount(previous: AddToCartState, form: FormData): Promise<AddToCartState> {
  const result = await addToCart(previous, form);
  if (typeof result.count === "number") setCart(result.count);
  return result;
}

export function AddToCart({
  store,
  market,
  cartHref,
  redraw = false,
  variantId,
  disabled,
  labels,
  openCart = false,
  capped,
  quantity,
  direct,
}: {
  store: string;
  market: string;
  cartHref: string;
  /** The page draws the cart (a basket note, the cart's own upsells): the add redraws it (bloat review step 2.4). */
  redraw?: boolean;
  variantId: string;
  disabled: boolean;
  labels: AddToCartLabels;
  /** Open the slide-out cart on phones once added (D64). */
  openCart?: boolean;
  /** What to say when the line is at the most a line may hold, where "all the stock we have" would be untrue (a variant on backorder, D172). */
  capped?: string;
  /** How many to add, chosen by the shopper (D430); absent adds one. */
  quantity?: QuantityOffer;
  /** The product skips the cart (D915): the agreement said beside the button, and the press goes on to payment. */
  direct?: DirectBuy;
}) {
  const [state, action, pending] = useActionState(addAndCount, initial);
  const keepFocus = useKeepFocus(pending);
  useOpenCartAfterAdd(openCart, cartHref, state);
  const plan = useChosenPlan();
  const track = useShopTrack();
  // What the press agrees to (D915): the variant's own, and the chosen option's renewals for it.
  const agreed = direct ? [...(direct.byVariant[variantId] ?? []), ...(plan && direct.byPlan[`${variantId}:${plan.id}`] ? [direct.byPlan[`${variantId}:${plan.id}`]] : [])] : [];
  // What was asked for, so the tags hear the units added (D303 I1), once the server accepted them.
  const asked = useRef(1);
  // Straight to payment (D915): a full page load, as the payment page needs (PCI).
  useEffect(() => {
    if (state.outcome === "checkout" && state.to) window.location.assign(state.to);
  }, [state]);
  useEffect(() => {
    if (state.outcome !== "added" && state.outcome !== "checkout") return;
    const event = trackedItem(track, variantId, asked.current);
    if (event) trackShop({ kind: "add_to_cart", ...event });
  }, [state, track, variantId]);
  const message =
    state.outcome === "added"
      ? labels.added
      : state.outcome === "capped"
        ? (capped ?? labels.capped)
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "plan_conflict"
            ? labels.planConflict
            : state.outcome === "error"
            ? labels.tryAgain
            : null;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        keepFocus(event);
        asked.current = Math.max(1, Number(new FormData(event.currentTarget).get("quantity") ?? 1) || 1);
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="store" value={store} />
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="variantId" value={variantId} />
      {redraw && <input type="hidden" name="redraw" value="1" />}
      {!quantity && <input type="hidden" name="quantity" value="1" />}
      <AffiliateField store={store} />
      <RecommendField />
      {plan && <input type="hidden" name="sellingPlanId" value={plan.id} />}
      {direct && <input type="hidden" name="direct" value="1" />}
      {agreed.map((sentence) => (
        <input key={sentence} type="hidden" name="agreed" value={sentence} />
      ))}
      {direct && agreed.length > 0 && (
        <p className="max-w-sm text-right text-xs text-muted" data-direct-agreement="">
          {direct.lead} {agreed.join(" ")}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-end gap-2">
        {quantity && <ChosenQuantity variantId={variantId} offer={quantity} disabled={disabled} />}
        <button
          type="submit"
          disabled={disabled || pending}
          className="min-h-11 button-primary px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? labels.adding : labels.addToCart}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {message}{" "}
        {(state.outcome === "added" || state.outcome === "capped") && (
          <Link href={cartHref} className="underline">
            {labels.goToCart}
          </Link>
        )}
      </p>
    </form>
  );
}

/** The buy box's quantity chooser (D430), sharing its number with the phone's bar. */
function ChosenQuantity({ variantId, offer, disabled }: { variantId: string; offer: QuantityOffer; disabled: boolean }) {
  const [n, setN] = useQuantityChoice(variantId, offer.rule);
  return <QuantityStepper rule={offer.rule} value={n} onChange={setN} labels={offer.labels} buttons={offer.buttons} disabled={disabled} />;
}
