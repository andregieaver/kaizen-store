"use client";

import { useActionState, useId, useState } from "react";

import { CREDITS_IDLE, type CreditsState } from "@/lib/bonus-shopper";

/**
 * The credits control in the cart and at checkout (D130): a box to use bonus credits, the amount, and a button for all
 * that can be used. It is a plain form posting to a server action, so it works without JavaScript too; the result
 * is said in a polite live region that is always there, so a screen reader hears it.
 */
export function BonusCreditsForm({
  action,
  using,
  defaultAmount,
  limits,
  labels,
  initial = CREDITS_IDLE,
}: {
  action: (state: CreditsState, form: FormData) => Promise<CreditsState>;
  /** Credits are in use on the cart now. */
  using: boolean;
  /** What is in use, as the input shows it (empty for none). */
  defaultAmount: string;
  /** "You have … available; you can use up to … on this order.", worked out by the server. */
  limits: string;
  labels: { use: string; amount: string; all: string; apply: string; applying: string };
  /** What the form says before anything is sent (nothing, unless a page shows an earlier answer). */
  initial?: CreditsState;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, initial);
  const [checked, setChecked] = useState(using);
  const [amount, setAmount] = useState(defaultAmount);
  // When the cart changes (the server answered), the form shows what is now in use.
  const [seen, setSeen] = useState(`${using}:${defaultAmount}`);
  if (seen !== `${using}:${defaultAmount}`) {
    setSeen(`${using}:${defaultAmount}`);
    setChecked(using);
    setAmount(defaultAmount);
  }
  const problem = state.status === "problem";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor={`${id}-use`} className="flex min-h-11 items-center gap-2 text-sm">
        <input
          id={`${id}-use`}
          type="checkbox"
          name="use"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="size-5"
        />
        {labels.use}
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-amount`} className="text-sm">
          {labels.amount}
        </label>
        <input
          id={`${id}-amount`}
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={12}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-describedby={`${id}-limits ${id}-result`}
          aria-invalid={problem ? true : undefined}
          className="min-h-11 w-full min-w-0 rounded-md border border-border bg-background px-3"
        />
      </div>
      <p id={`${id}-limits`} className="text-sm text-muted">
        {limits}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="intent"
          value="apply"
          disabled={pending}
          className="min-h-11 rounded-md border border-foreground px-4 text-sm font-medium disabled:opacity-50"
        >
          {pending ? labels.applying : labels.apply}
        </button>
        <button
          type="submit"
          name="intent"
          value="all"
          disabled={pending}
          className="min-h-11 rounded-md border border-border px-4 text-sm disabled:opacity-50"
        >
          {labels.all}
        </button>
      </div>
      <p id={`${id}-result`} role="status" aria-live="polite" data-status={state.status} className="min-h-5 text-sm">
        {state.message}
      </p>
    </form>
  );
}
