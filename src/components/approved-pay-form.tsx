"use client";

import { CheckoutTerms } from "@/components/checkout-terms";
import { termsKey, useTicked } from "@/components/terms-choice";
import { payHeld, type TermsDisplay } from "@/lib/checkout-terms";

/**
 * *Pay now* for a company's approved order (D321 C.2): the store's terms sentence as the checkout draws it (a link, or a tick that must be ticked), and a
 * button posting to the server action, which records the terms and sends the buyer to Stripe's own page. The tick is a plain field (`terms`).
 */
export function ApprovedPayForm({
  store,
  market,
  display,
  template,
  newTab,
  label,
  action,
}: {
  store: string;
  market: string;
  display: TermsDisplay | null;
  template: string;
  newTab: string;
  label: string;
  action: (form: FormData) => Promise<void>;
}) {
  const ticked = useTicked(termsKey(store, market));
  return (
    <form action={action} className="flex flex-col gap-2">
      {display && <CheckoutTerms store={store} market={market} display={display} template={template} newTab={newTab} />}
      <input type="hidden" name="terms" value={ticked ? "1" : ""} />
      <div>
        <button type="submit" disabled={payHeld(display, ticked)} className="button-primary min-h-11 rounded-button px-4 disabled:opacity-50">
          {label}
        </button>
      </div>
    </form>
  );
}
