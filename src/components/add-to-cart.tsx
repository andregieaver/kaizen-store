"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { trackShop } from "@/lib/shop-events";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";

import { AffiliateField } from "./affiliate-field";
import { RecommendField } from "./recommend-field";
import { useOpenCartAfterAdd } from "./cart-drawer";
import { useChosenPlan } from "./purchase-options";
import { trackedItem, useShopTrack } from "./shop-track";
import { useKeepFocus } from "./keep-focus";

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

const initial: AddToCartState = { outcome: "idle", quantity: 0 };

export function AddToCart({
  store,
  market,
  cartHref,
  variantId,
  disabled,
  labels,
  openCart = false,
  capped,
}: {
  store: string;
  market: string;
  cartHref: string;
  variantId: string;
  disabled: boolean;
  labels: AddToCartLabels;
  /** Open the slide-out cart on phones once added (D64). */
  openCart?: boolean;
  /** What to say when the line is at the most a line may hold, where "all the stock we have" would be untrue (a variant on backorder, D172). */
  capped?: string;
}) {
  const [state, action, pending] = useActionState(addToCart, initial);
  const keepFocus = useKeepFocus(pending);
  useOpenCartAfterAdd(openCart, cartHref, state);
  const plan = useChosenPlan();
  const track = useShopTrack();
  // What was asked for, so the tags hear the units added (D303 I1), once the server accepted them.
  const asked = useRef(1);
  useEffect(() => {
    if (state.outcome !== "added") return;
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
      <input type="hidden" name="quantity" value="1" />
      <AffiliateField store={store} />
      <RecommendField />
      {plan && <input type="hidden" name="sellingPlanId" value={plan.id} />}
      <button
        type="submit"
        disabled={disabled || pending}
        className="min-h-11 button-primary px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? labels.adding : labels.addToCart}
      </button>
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
