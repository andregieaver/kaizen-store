"use client";

import { useActionState } from "react";

import { CheckoutTerms } from "@/components/checkout-terms";
import { markStepChange } from "@/components/exchange/step-focus";
import { termsKey, useTicked } from "@/components/terms-choice";
import { payHeld, type TermsDisplay } from "@/lib/checkout-terms";

import { confirmExchangeAction, declineExchangeAction, startExchangePaymentAction, type ExchangeAnswerState } from "./actions";

/** The words of each problem a press can answer with. */
export type ExchangeProblemWords = Record<NonNullable<ExchangeAnswerState["problem"]>, string>;

/**
 * The two answers of a proposed exchange (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): the store's terms sentence exactly as the checkout draws it
 * (`CheckoutTerms`, a tick box in `checkbox` mode that holds the button until ticked), **Confirm the exchange** (the customer's own express agreement, CRD
 * Art. 13(1)) and **No thanks, refund me instead**. Nothing is charged by either. The tick is a plain form field, checked again by the server. Like the pay
 * links' forms, a client component of a page with a secret in its address: no zod, no server module besides its own actions, nothing stored in the browser.
 */
export function ConfirmForm({
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
  display: TermsDisplay | null;
  template: string;
  newTab: string;
  labels: { confirm: string; decline: string; working: string };
  problems: ExchangeProblemWords;
}) {
  const [confirmed, confirm, confirming] = useActionState(
    (previous: ExchangeAnswerState, form: FormData) => {
      markStepChange();
      return confirmExchangeAction(store, market, token, previous, form);
    },
    { problem: null },
  );
  const [declined, decline, declining] = useActionState((): Promise<ExchangeAnswerState> => {
    markStepChange();
    return declineExchangeAction(store, market, token);
  }, { problem: null });
  const ticked = useTicked(termsKey(store, market));
  const problem = confirmed.problem ?? declined.problem;
  const pending = confirming || declining;
  return (
    <div className="flex flex-col gap-3" data-exchange-answer>
      <form action={confirm} aria-busy={confirming} className="flex flex-col gap-3">
        {display && <CheckoutTerms store={store} market={market} display={display} template={template} newTab={newTab} />}
        <input type="hidden" name="terms" value={ticked ? "1" : ""} />
        {problem && (
          <p role="alert" className="text-sm">
            {problems[problem]}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || payHeld(display, ticked)}
          className="inline-flex min-h-12 items-center justify-center button-primary px-6 font-medium disabled:opacity-50"
        >
          {confirming ? labels.working : labels.confirm}
        </button>
      </form>
      <form action={decline} aria-busy={declining}>
        <button type="submit" disabled={pending} className="min-h-11 underline disabled:opacity-50">
          {declining ? labels.working : labels.decline}
        </button>
      </form>
    </div>
  );
}

/**
 * The pay step (`Δ > 0`, after the return was processed): one button with the amount, which opens Stripe's own hosted page. Stripe.js is never loaded here.
 */
export function ExchangePayForm({
  store,
  market,
  token,
  labels,
  problems,
}: {
  store: string;
  market: string;
  token: string;
  labels: { pay: string; paying: string; note: string };
  problems: ExchangeProblemWords;
}) {
  const [state, action, pending] = useActionState((): Promise<ExchangeAnswerState> => startExchangePaymentAction(store, market, token), { problem: null });
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-3" data-exchange-pay>
      {state.problem && (
        <p role="alert" className="text-sm">
          {problems[state.problem]}
        </p>
      )}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center button-primary px-6 font-medium disabled:opacity-50">
        {pending ? labels.paying : labels.pay}
      </button>
      <p className="text-sm text-muted">{labels.note}</p>
    </form>
  );
}
