"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";

import { useChosenPlan } from "./purchase-options";

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
}: {
  store: string;
  market: string;
  cartHref: string;
  variantId: string;
  disabled: boolean;
  labels: AddToCartLabels;
}) {
  const [state, action, pending] = useActionState(addToCart, initial);
  const plan = useChosenPlan();
  const message =
    state.outcome === "added"
      ? labels.added
      : state.outcome === "capped"
        ? labels.capped
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "plan_conflict"
            ? labels.planConflict
            : state.outcome === "error"
            ? labels.tryAgain
            : null;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="store" value={store} />
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      {plan && <input type="hidden" name="sellingPlanId" value={plan.id} />}
      <button
        type="submit"
        disabled={disabled || pending}
        className="min-h-11 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
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
