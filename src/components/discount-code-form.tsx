"use client";

import { useActionState } from "react";

import { applyCodeAction, removeCodeAction, type CodeState } from "@/app/s/[store]/[market]/cart/actions";

/**
 * The cart's discount code (D31): a field to enter one, or the code on the
 * cart with a way to take it off. Whether it applies is said by the cart,
 * which checks it against the basket.
 */
export function DiscountCodeForm({
  store,
  market,
  code,
  problem,
  labels,
}: {
  store: string;
  market: string;
  /** The code on the cart, if any. */
  code: string | null;
  /** Why the code on the cart does not apply, in the shopper's language. */
  problem: string | null;
  labels: { code: string; apply: string; remove: string; applying: string };
}) {
  const [, apply, pending] = useActionState(
    (state: CodeState, form: FormData) => applyCodeAction(store, market, state, form),
    { tried: null },
  );
  if (code) {
    return (
      <div className="flex flex-col gap-1">
        <form action={removeCodeAction.bind(null, store, market)} className="flex items-center justify-between gap-2">
          <span className="rounded-full border border-border px-3 py-1 text-sm font-medium">
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
      </div>
    );
  }
  return (
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
    </form>
  );
}
