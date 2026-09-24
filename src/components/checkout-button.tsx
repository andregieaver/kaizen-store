"use client";

import { useActionState } from "react";

import { checkoutAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import type { CheckoutProblem } from "@/server/checkout";

export type CheckoutLabels = {
  checkout: string;
  startingPayment: string;
  problems: Record<CheckoutProblem, string>;
};

/** Sends the shopper to payment; stays put and explains if that is not possible. */
export function CheckoutButton({
  store,
  market,
  disabled,
  labels,
}: {
  store: string;
  market: string;
  disabled: boolean;
  labels: CheckoutLabels;
}) {
  const [state, action, pending] = useActionState(
    async (): Promise<CheckoutState> => checkoutAction(store, market),
    { problem: null },
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={disabled || pending}
        className="min-h-12 rounded-full bg-foreground px-4 font-medium text-background disabled:opacity-40"
      >
        {pending ? labels.startingPayment : labels.checkout}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.problem && labels.problems[state.problem]}
      </p>
    </form>
  );
}
