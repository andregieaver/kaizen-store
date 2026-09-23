"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addToCart, type AddToCartState } from "@/app/[market]/cart/actions";

export type AddToCartLabels = {
  addToCart: string;
  adding: string;
  added: string;
  capped: string;
  unavailable: string;
  tryAgain: string;
  goToCart: string;
};

const initial: AddToCartState = { outcome: "idle", quantity: 0 };

export function AddToCart({
  market,
  variantId,
  disabled,
  labels,
}: {
  market: string;
  variantId: string;
  disabled: boolean;
  labels: AddToCartLabels;
}) {
  const [state, action, pending] = useActionState(addToCart, initial);
  const message =
    state.outcome === "added"
      ? labels.added
      : state.outcome === "capped"
        ? labels.capped
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "error"
            ? labels.tryAgain
            : null;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
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
          <Link href={`/${market}/cart`} className="underline">
            {labels.goToCart}
          </Link>
        )}
      </p>
    </form>
  );
}
