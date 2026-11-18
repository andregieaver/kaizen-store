"use client";

import { useActionState } from "react";

import { CheckoutTerms } from "@/components/checkout-terms";
import { termsKey, useTicked } from "@/components/terms-choice";
import { payHeld, type TermsDisplay } from "@/lib/checkout-terms";

import { startDraftPaymentAction, type PayLinkState } from "./actions";

/** The words of each problem the button can answer with; `null` where the page is drawn afresh and says it itself. */
export type PayProblemWords = Record<NonNullable<PayLinkState["problem"]>, string>;

/**
 * The pay button of a draft order's pay link (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): the store's terms sentence exactly as the checkout draws it (`CheckoutTerms`: a link, or a link with a tick
 * box that must be ticked, held until it is), and one button with the checkout's label that sends the buyer to Stripe's own page. The tick is a plain form field (`terms`), so the press works as a form post and the
 * server checks it again; the acceptance is recorded by the server before Stripe is opened. Stripe.js is never loaded here and nothing is stored in the browser.
 * Like the cart, this is a client component of a page that carries a secret in its address: it imports no zod and no server module besides its own action.
 */
export function PayForm({
  store,
  market,
  token,
  display,
  template,
  newTab,
  labels,
  problems,
}: {
  store: string;
  market: string;
  token: string;
  /** The store's terms at checkout, or null when it shows none (`off`, or no page chosen). */
  display: TermsDisplay | null;
  template: string;
  newTab: string;
  labels: { pay: string; paying: string; stripeNote: string };
  problems: PayProblemWords;
}) {
  const [state, action, pending] = useActionState((previous: PayLinkState, form: FormData) => startDraftPaymentAction(store, market, token, previous, form), { problem: null });
  const key = termsKey(store, market);
  const ticked = useTicked(key);
  return (
    <form action={action} className="flex flex-col gap-3">
      {display && <CheckoutTerms store={store} market={market} display={display} template={template} newTab={newTab} />}
      <input type="hidden" name="terms" value={ticked ? "1" : ""} />
      {state.problem && (
        <p role="alert" className="text-sm">
          {problems[state.problem]}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || payHeld(display, ticked)}
        className="inline-flex min-h-12 items-center justify-center button-primary px-6 font-medium disabled:opacity-50"
      >
        {pending ? labels.paying : labels.pay}
      </button>
      <p className="text-sm text-muted">{labels.stripeNote}</p>
    </form>
  );
}
