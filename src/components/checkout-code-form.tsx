"use client";

import { useActionState } from "react";

import { checkoutCodeAction, type CheckoutCodeState } from "@/app/s/[store]/[market]/checkout/actions";

/**
 * The discount codes in the checkout's summary (D38, D299 E2): each code on
 * the cart with a way to take it off and, when it is not used, why; and a
 * field for another, up to five. A code that does not apply is explained
 * here and changes nothing; one that does updates the order.
 */
export function CheckoutCodeForm({
  store,
  market,
  codes,
  full,
  labels,
}: {
  store: string;
  market: string;
  /** The codes on the cart, in the order typed, each with why it is not used (null when it is). */
  codes: { code: string; problem: string | null }[];
  /** The words for a cart holding as many codes as it can. */
  full: string;
  labels: { label: string; code: string; apply: string; remove: string; applying: string };
}) {
  const [state, action, pending] = useActionState(
    (previous: CheckoutCodeState, form: FormData) => checkoutCodeAction(store, market, previous, form),
    { problem: null, tried: "" },
  );

  return (
    <div className="flex flex-col gap-2">
      {codes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {codes.map(({ code, problem }) => (
            <li key={code} className="flex flex-col gap-1">
              <form action={action} className="flex items-center justify-between gap-2">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="code" value={code} />
                <span className="rounded-button border border-border px-3 py-1 text-sm font-medium">
                  <span className="sr-only">{labels.code}: </span>
                  {code}
                </span>
                <button type="submit" disabled={pending} className="min-h-11 px-2 text-sm underline disabled:opacity-50">
                  {pending ? labels.applying : labels.remove}
                  <span className="sr-only">: {code}</span>
                </button>
              </form>
              {problem && <p className="text-sm">{problem}</p>}
            </li>
          ))}
        </ul>
      )}
      {/* Five codes at most (`CODES_MAX`, not imported: `lib/discounts` holds zod, kept off the pay routes). */}
      {codes.length >= 5 ? (
        <p className="text-sm text-muted">{full}</p>
      ) : (
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
      )}
    </div>
  );
}
