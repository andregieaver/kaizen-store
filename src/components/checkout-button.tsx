"use client";

import { useActionState } from "react";

import { checkoutAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import type { CheckoutProblem } from "@/server/checkout";

export type CheckoutLabels = {
  checkout: string;
  startingPayment: string;
  problems: Record<CheckoutProblem, string>;
};

/** What the shopper must agree to first: downloads (D24) or a subscription (D25). */
export type CheckoutConsents = { digital?: string; subscription?: string };

/**
 * Sends the shopper to payment; stays put and explains if that is not
 * possible. With `consents`, the shopper first ticks each one: that
 * downloads start at once and end the right of withdrawal, and the terms of
 * a subscription.
 */
export function CheckoutButton({
  store,
  market,
  disabled,
  labels,
  consents = {},
}: {
  store: string;
  market: string;
  disabled: boolean;
  labels: CheckoutLabels;
  consents?: CheckoutConsents;
}) {
  const [state, action, pending] = useActionState(
    async (_: CheckoutState, form: FormData): Promise<CheckoutState> =>
      checkoutAction(store, market, {
        digital: form.get("digitalConsent") === "on",
        subscription: form.get("subscriptionConsent") === "on",
      }),
    { problem: null },
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {(["subscription", "digital"] as const).map(
        (kind) =>
          consents[kind] && (
            <label key={kind} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={`${kind}Consent`} required className="mt-0.5 size-4 shrink-0" />
              {consents[kind]}
            </label>
          ),
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className="min-h-12 button-primary px-4 font-medium disabled:opacity-40"
      >
        {pending ? labels.startingPayment : labels.checkout}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.problem && labels.problems[state.problem]}
      </p>
    </form>
  );
}
