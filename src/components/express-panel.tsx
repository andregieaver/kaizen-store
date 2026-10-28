"use client";

import { loadStripe, type StripeElementLocale } from "@stripe/stripe-js";
import { CheckoutElementsProvider, ExpressCheckoutElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";
import { useMemo, useRef, useState } from "react";

import { deliveryReadyAction } from "@/app/s/[store]/[market]/checkout/actions";
import { recordTermsAction } from "@/app/s/[store]/[market]/checkout/terms-actions";
import type { ExpressState } from "@/app/s/[store]/[market]/cart/actions";
import { stripeAppearance, stripeFonts, type CheckoutAppearance } from "@/lib/checkout-appearance";
import { payHeld, payStep } from "@/lib/checkout-terms";

import { CheckoutTerms } from "./checkout-terms";
import { useShowsDark } from "./color-mode-switch";
import type { ExpressLabels, ExpressTerms } from "./express-area";
import { termsKey, useTicked } from "./terms-choice";

export type ExpressPanelProps = {
  store: string;
  market: string;
  start: Extract<ExpressState, { ok: true }>;
  labels: ExpressLabels;
  terms: ExpressTerms | null;
  look: CheckoutAppearance;
};

/**
 * Stripe's Express Checkout Element over the order's Checkout Session (wave 10 unit J, D373), loaded only after the express area was pressed.
 * A wallet's press goes through the same steps as the checkout page's pay press (`CheckoutForm`): the delivery settled
 * (`deliveryReadyAction()`), the store's terms recorded with the order (`recordTermsAction()`, held while a box to tick is not ticked), then
 * Stripe's `confirm`, after which Stripe takes the shopper to the order page. No card field is ever drawn here: the wallet holds the card.
 */
export function ExpressPanel({ store, market, start, labels, terms, look }: ExpressPanelProps) {
  const dark = useShowsDark();
  const stripe = useMemo(
    () => loadStripe(start.publishableKey, { stripeAccount: start.stripeAccount, locale: start.locale as StripeElementLocale }),
    [start.publishableKey, start.stripeAccount, start.locale],
  );
  const fonts = useMemo(() => stripeFonts(look, window.location.origin), [look]);
  return (
    <CheckoutElementsProvider stripe={stripe} options={{ clientSecret: start.clientSecret, elementsOptions: { appearance: stripeAppearance(look, dark), fonts, loader: "auto" } }}>
      <Buttons store={store} market={market} start={start} labels={labels} terms={terms} />
    </CheckoutElementsProvider>
  );
}

function Buttons({ store, market, start, labels, terms }: Omit<ExpressPanelProps, "look">) {
  const state = useCheckoutElements();
  const ticked = useTicked(terms ? termsKey(store, market) : "");
  const held = payHeld(terms?.display ?? null, ticked);
  const [shown, setShown] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);

  const fail = (message: string) => {
    setProblem(message);
    requestAnimationFrame(() => problemRef.current?.focus());
  };

  if (state.type === "loading") return <p role="status" className="text-sm text-muted">{labels.loading}</p>;
  if (state.type === "error") return <p role="alert" className="text-sm">{labels.noWallet}</p>;
  const { checkout } = state;

  return (
    <div className="flex flex-col gap-2">
      {start.lines > 1 && <p className="text-sm">{labels.forCart.replace("{n}", String(start.lines))}</p>}
      {terms && <CheckoutTerms store={store} market={market} display={terms.display} template={terms.template} newTab={terms.newTab} />}
      <div hidden={shown === false}>
        <ExpressCheckoutElement
          onReady={(event) => setShown(Boolean(event.availablePaymentMethods))}
          onConfirm={async (event) => {
            setProblem(null);
            if (held) {
              event.paymentFailed();
              fail(labels.termsHint);
              return;
            }
            let ready: Awaited<ReturnType<typeof deliveryReadyAction>>;
            try {
              ready = await deliveryReadyAction(store, market);
            } catch {
              event.paymentFailed();
              fail(labels.delivery.checkFailed);
              return;
            }
            if (!ready.ok) {
              event.paymentFailed();
              fail(labels.delivery[ready.problem]);
              return;
            }
            const step = payStep(terms?.display ?? null);
            if (step.record) {
              const kept = await recordTermsAction(store, market).then((r) => r.ok, () => false);
              if (!kept && step.stopOnFailure) {
                event.paymentFailed();
                fail(labels.termsFailed);
                return;
              }
            }
            // On success Stripe takes the shopper to the order page.
            const result = await checkout.confirm({ expressCheckoutConfirmEvent: event });
            if (result.type === "error") fail(result.error.message);
          }}
        />
      </div>
      {shown === false && (
        <p role="status" className="text-sm">
          {labels.noWallet}
        </p>
      )}
      {held && terms && <p className="text-sm text-muted">{labels.termsHint}</p>}
      <p ref={problemRef} tabIndex={-1} role="alert" className="text-sm empty:hidden">
        {problem}
      </p>
    </div>
  );
}
