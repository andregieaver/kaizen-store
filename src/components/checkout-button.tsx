"use client";

import { useActionState } from "react";

import { checkoutAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import type { CheckoutProblem } from "@/server/checkout";

export type CheckoutLabels = {
  checkout: string;
  startingPayment: string;
  problems: Record<CheckoutProblem, string>;
};

/**
 * Sends the shopper to payment; stays put and explains if that is not
 * possible. With `consent`, the shopper first agrees that downloads start at
 * once and end the right of withdrawal (D24).
 */
export function CheckoutButton({
  store,
  market,
  disabled,
  labels,
  consent,
}: {
  store: string;
  market: string;
  disabled: boolean;
  labels: CheckoutLabels;
  consent?: string;
}) {
  const [state, action, pending] = useActionState(
    async (_: CheckoutState, form: FormData): Promise<CheckoutState> =>
      checkoutAction(store, market, form.get("digitalConsent") === "on"),
    { problem: null },
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {consent && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="digitalConsent" required className="mt-0.5 size-4 shrink-0" />
          {consent}
        </label>
      )}
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
