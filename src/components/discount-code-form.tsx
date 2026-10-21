"use client";

import { useActionState } from "react";

import { applyCodeAction, removeCodeAction, type CodeState } from "@/app/s/[store]/[market]/cart/actions";

/**
 * The cart's discount codes (D31, D299 E2): each code on the cart with a way
 * to take it off and, when it does not apply, why; and a field for another,
 * up to five. Whether they apply is said by the cart, which checks them
 * against the basket.
 */
export function DiscountCodeForm({
  store,
  market,
  codes,
  full,
  labels,
}: {
  store: string;
  market: string;
  /** The codes on the cart, in the order typed, each with why it does not apply (null when it does). */
  codes: { code: string; problem: string | null }[];
  /** The words for a cart holding as many codes as it can. */
  full: string;
  labels: { code: string; apply: string; remove: string; applying: string };
}) {
  const [state, apply, pending] = useActionState(
    (state: CodeState, form: FormData) => applyCodeAction(store, market, state, form),
    { tried: null },
  );
  return (
    <div className="flex flex-col gap-2">
      {codes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {codes.map(({ code, problem }) => (
            <li key={code} className="flex flex-col gap-1">
              <form action={removeCodeAction.bind(null, store, market, code)} className="flex items-center justify-between gap-2">
                <span className="rounded-button border border-border px-3 py-1 text-sm font-medium">
                  <span className="sr-only">{labels.code}: </span>
                  {code}
                </span>
                <button type="submit" className="min-h-11 px-2 text-sm underline">
                  {labels.remove}
                  <span className="sr-only">: {code}</span>
                </button>
              </form>
              {problem && (
                <p role="alert" className="text-sm">
                  {problem}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Five codes at most (`CODES_MAX`, not imported: `lib/discounts` holds zod, kept off the pay routes). */}
      {codes.length >= 5 ? (
        <p className="text-sm text-muted">{full}</p>
      ) : (
        <form action={apply} className="flex flex-col gap-1">
          <label htmlFor="discount-code" className="text-sm">
            {labels.code}
          </label>
          <div className="flex gap-2">
            <input
              id="discount-code"
              name="code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              required
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
          {state.full && (
            <p role="alert" className="text-sm">
              {full}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
