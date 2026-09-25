"use client";

import { useActionState } from "react";

import { checkoutCodeAction, type CheckoutCodeState } from "@/app/s/[store]/[market]/checkout/actions";

/**
 * The discount code in the checkout's summary (D38): a field for a code,
 * or the code in use with a way to take it off. A code that does not apply
 * is explained here and changes nothing; one that does updates the order.
 */
export function CheckoutCodeForm({
  store,
  market,
  code,
  labels,
}: {
  store: string;
  market: string;
  /** The code on the order, if any. */
  code: string | null;
  labels: { label: string; code: string; apply: string; remove: string; applying: string };
}) {
  const [state, action, pending] = useActionState(
    (previous: CheckoutCodeState, form: FormData) => checkoutCodeAction(store, market, previous, form),
    { problem: null, tried: "" },
  );

  if (code) {
    return (
      <form action={action} className="flex items-center justify-between gap-2">
        <input type="hidden" name="intent" value="remove" />
        <span className="rounded-full border border-border px-3 py-1 text-sm font-medium">
          <span className="sr-only">{labels.code}: </span>
          {code}
        </span>
        <button type="submit" disabled={pending} className="min-h-11 px-2 text-sm underline disabled:opacity-50">
          {pending ? labels.applying : labels.remove}
          <span className="sr-only">: {code}</span>
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-1">
      <label htmlFor="checkout-code" className="text-sm">
        {labels.label}
      </label>
      <div className="flex gap-2">
        <input
          // A new input after each try keeps what the shopper typed when the code did not apply.
          key={state.tried}
          id="checkout-code"
          name="code"
          defaultValue={state.tried}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          required
          aria-invalid={state.problem ? true : undefined}
          aria-describedby={state.problem ? "checkout-code-problem" : undefined}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 uppercase"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md border border-foreground px-4 text-sm font-medium disabled:opacity-50"
        >
          {pending ? labels.applying : labels.apply}
        </button>
      </div>
      {state.problem && (
        <p id="checkout-code-problem" role="alert" className="text-sm">
          {state.problem}
        </p>
      )}
    </form>
  );
}
