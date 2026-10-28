"use client";

import { useState, type ComponentType } from "react";

import { expressCheckoutAction, type ExpressState } from "@/app/s/[store]/[market]/cart/actions";
import type { CheckoutAppearance } from "@/lib/checkout-appearance";
import type { TermsDisplay } from "@/lib/checkout-terms";

import type { ExpressPanelProps } from "./express-panel";

/** The express area's words, drawn by the server in the shopper's language (D212: never `t()` here). */
export type ExpressLabels = {
  title: string;
  hint: string;
  start: string;
  loading: string;
  /** "This pays for everything in your cart ({n} items)." */
  forCart: string;
  noWallet: string;
  toCart: string;
  /** The checkout's own words the panel uses. */
  delivery: Record<"postal_code" | "changed" | "no_shipping" | "checkFailed", string>;
  termsHint: string;
  termsFailed: string;
};

/** The store's terms as the checkout shows them (D158), drawn above the wallet buttons. */
export type ExpressTerms = { display: TermsDisplay; template: string; newTab: string };

/** What the area draws with, worked out on the server (`expressAreaFor()`): its words, the terms and Stripe's look from the theme (D337). */
export type ExpressSetup = { labels: ExpressLabels; terms: ExpressTerms | null; look: CheckoutAppearance };

/**
 * The express area (wave 10 unit J, D373) on a product page (`variantId`: the chosen variant, put in the cart on the press) or in the cart
 * (none). Until it is pressed it is a plain button and nothing of Stripe's is loaded: the press asks the server for the order's session
 * (`expressCheckoutAction()`, the checkout's own path) and only then loads the panel with Stripe's Express Checkout Element
 * (`express-panel.tsx`, a script of its own), so a product page's first scripts stay as they were.
 */
export function ExpressArea({
  store,
  market,
  variantId = null,
  disabled = false,
  labels,
  terms = null,
  look,
}: {
  store: string;
  market: string;
  variantId?: string | null;
  disabled?: boolean;
  labels: ExpressLabels;
  terms?: ExpressTerms | null;
  look: CheckoutAppearance;
}) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "problem">("idle");
  const [state, setState] = useState<ExpressState | null>(null);
  const [Panel, setPanel] = useState<ComponentType<ExpressPanelProps> | null>(null);

  const press = async () => {
    setPhase("loading");
    try {
      const [loaded, answer] = await Promise.all([
        import("./express-panel"),
        expressCheckoutAction(store, market, variantId ? { variantId, quantity: 1 } : null),
      ]);
      setState(answer);
      if (answer.ok) {
        setPanel(() => loaded.ExpressPanel);
        setPhase("ready");
      } else setPhase("problem");
    } catch {
      setState({ ok: false, message: labels.noWallet, cartHref: "" });
      setPhase("problem");
    }
  };

  return (
    <section aria-label={labels.title} data-express className="flex w-full flex-col gap-2">
      {phase === "ready" && state?.ok && Panel ? (
        <Panel store={store} market={market} start={state} labels={labels} terms={terms} look={look} />
      ) : (
        <>
          <button
            type="button"
            onClick={press}
            disabled={disabled || phase === "loading"}
            aria-describedby={`express-hint-${store}`}
            className="min-h-11 rounded-button border border-border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === "loading" ? labels.loading : labels.start}
          </button>
          <p id={`express-hint-${store}`} className="text-xs text-muted">
            {labels.hint}
          </p>
          {phase === "problem" && state && !state.ok && (
            <p role="alert" className="text-sm">
              {state.message}{" "}
              {state.cartHref && (
                // A full page load: the cart is a pay route (D158).
                <a href={state.cartHref} className="underline">
                  {labels.toCart}
                </a>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
