"use client";

import { loadStripe, type Appearance, type StripeElementLocale } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  ContactDetailsElement,
  ExpressCheckoutElement,
  PaymentElement,
  ShippingAddressElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

export type CheckoutFormLabels = {
  contact: string;
  delivery: string;
  payment: string;
  /** "Pay 249,00 kr". */
  pay: string;
  paying: string;
  loading: string;
  unavailable: string;
  secure: string;
  expired: string;
  backToCart: string;
  seeOrder: string;
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Stripe's form in the storefront's own colours (globals.css), light or dark. */
function appearance(dark: boolean): Appearance {
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: dark ? "#ededed" : "#171717",
      colorBackground: dark ? "#0a0a0a" : "#ffffff",
      colorText: dark ? "#ededed" : "#171717",
      colorTextSecondary: dark ? "#a3a3a3" : "#525252",
      colorDanger: dark ? "#f87171" : "#b91c1c",
      fontFamily: FONT,
      fontSizeBase: "16px",
      borderRadius: "6px",
    },
  };
}

const noSubscribe = () => () => {};

/**
 * Kaizen's checkout form (decision D22): Stripe's contact, address, express
 * and payment Elements for the order's Checkout Session, on the store's own
 * Stripe account. Card details go from the shopper's browser straight to
 * Stripe. Paying takes the shopper to the order page (the session's return
 * address); a problem is shown here.
 */
export function CheckoutForm({
  publishableKey,
  stripeAccount,
  clientSecret,
  locale,
  ships,
  labels,
  links,
}: {
  publishableKey: string;
  stripeAccount: string;
  clientSecret: string;
  locale: string;
  /** Something to ship: ask for the delivery address (not for downloads only). */
  ships: boolean;
  labels: CheckoutFormLabels;
  /** The cart, and the order page (for a session paid meanwhile). */
  links: { cart: string; order: string };
}) {
  // Stripe runs in the browser only; the server sends the waiting state.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = useSyncExternalStore(
    noSubscribe,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const stripe = useMemo(
    () => (inBrowser ? loadStripe(publishableKey, { stripeAccount, locale: locale as StripeElementLocale }) : null),
    [inBrowser, publishableKey, stripeAccount, locale],
  );
  if (!stripe) return <Waiting label={labels.loading} />;
  return (
    <CheckoutElementsProvider
      stripe={stripe}
      options={{ clientSecret, elementsOptions: { appearance: appearance(dark), loader: "auto" } }}
    >
      <Form labels={labels} links={links} ships={ships} />
    </CheckoutElementsProvider>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-12 animate-pulse rounded-md bg-surface" />
      <div className="h-40 animate-pulse rounded-md bg-surface" />
      <div className="h-56 animate-pulse rounded-md bg-surface" />
    </div>
  );
}

function Form({
  labels,
  links,
  ships,
}: {
  labels: CheckoutFormLabels;
  links: { cart: string; order: string };
  ships: boolean;
}) {
  const state = useCheckoutElements();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [express, setExpress] = useState(false);
  const problemRef = useRef<HTMLParagraphElement>(null);

  if (state.type === "loading") return <Waiting label={labels.loading} />;
  if (state.type === "error") {
    return (
      <p role="alert" className="rounded-md border border-border p-4">
        {labels.unavailable}
      </p>
    );
  }
  const { checkout } = state;
  // Paid in another tab, or Stripe closed the session: nothing to pay here.
  if (checkout.status.type === "complete") {
    return (
      <p role="status">
        <a href={links.order} className="underline">
          {labels.seeOrder}
        </a>
      </p>
    );
  }
  if (checkout.status.type === "expired") {
    return (
      <p role="alert" className="flex flex-col gap-2">
        {labels.expired}{" "}
        <a href={links.cart} className="underline">
          {labels.backToCart}
        </a>
      </p>
    );
  }

  const fail = (message: string) => {
    setProblem(message);
    setBusy(false);
    requestAnimationFrame(() => problemRef.current?.focus());
  };

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    // On success Stripe takes the shopper to the order page.
    const result = await checkout.confirm();
    if (result.type === "error") fail(result.error.message);
  };

  return (
    <form onSubmit={pay} className="flex flex-col gap-8" aria-busy={busy}>
      {/* Apple Pay, Google Pay, Link and the like: shown only when the shopper's device offers one. */}
      <div hidden={!express}>
        <ExpressCheckoutElement
          onReady={(event) => setExpress(Boolean(event.availablePaymentMethods))}
          onConfirm={async (event) => {
            setProblem(null);
            const result = await checkout.confirm({ expressCheckoutConfirmEvent: event });
            if (result.type === "error") fail(result.error.message);
          }}
        />
      </div>

      <section aria-labelledby="contact-heading" className="flex flex-col gap-3">
        <h2 id="contact-heading" className="text-lg font-medium">
          {labels.contact}
        </h2>
        <ContactDetailsElement />
      </section>

      {ships && (
        <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
          <h2 id="delivery-heading" className="text-lg font-medium">
            {labels.delivery}
          </h2>
          <ShippingAddressElement />
        </section>
      )}

      <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
        <h2 id="payment-heading" className="text-lg font-medium">
          {labels.payment}
        </h2>
        <PaymentElement options={{ layout: { type: "accordion", radios: "if_multiple", spacedAccordionItems: false } }} />
        <p className="text-sm text-muted">{labels.secure}</p>
      </section>

      <div className="flex flex-col gap-3">
        <p ref={problemRef} tabIndex={-1} role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
          {problem}
        </p>
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded-full bg-foreground px-4 font-medium text-background disabled:opacity-40"
        >
          {busy ? labels.paying : labels.pay}
        </button>
      </div>
    </form>
  );
}
