"use client";

import { useActionState } from "react";

import { startEditPaymentAction, type ChangeLinkState } from "./actions";

/** The words of each problem the button can answer with. */
export type ChangeProblemWords = Record<NonNullable<ChangeLinkState["problem"]>, string>;

/**
 * The pay button of a change's pay link (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4): one button with the checkout's label and the difference, which sends the customer to Stripe's
 * own page. Nothing is ticked (the order's acceptance of the terms stands), Stripe.js is never loaded here and nothing is stored in the browser. A problem is announced (`role="alert"`).
 * Like the cart, this is a client component of a page that carries a secret in its address: it imports no zod and no server module besides its own action.
 */
export function ChangeForm({
  store,
  market,
  token,
  labels,
  problems,
}: {
  store: string;
  market: string;
  token: string;
  labels: { pay: string; paying: string; stripeNote: string };
  problems: ChangeProblemWords;
}) {
  const [state, action, pending] = useActionState((): Promise<ChangeLinkState> => startEditPaymentAction(store, market, token), { problem: null });
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-3">
      {state.problem && (
        <p role="alert" className="text-sm">
          {problems[state.problem]}
        </p>
      )}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center button-primary px-6 font-medium disabled:opacity-50">
        {pending ? labels.paying : labels.pay}
      </button>
      <p className="text-sm text-muted">{labels.stripeNote}</p>
    </form>
  );
}
