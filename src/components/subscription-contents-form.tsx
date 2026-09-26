"use client";

import { useActionState } from "react";

export type ContentsLine = {
  id: string;
  title: string;
  quantity: number;
  variantId: string | null;
  choices: { variantId: string; label: string; price: string }[];
};

type State = { failed: boolean; saved?: boolean };

/**
 * Changes what a subscription's next deliveries hold (D29): per line,
 * another variant, another quantity, or removed. Shared by the shopper's
 * page and the admin; the action decides who may.
 */
export function SubscriptionContentsForm({
  lines,
  action,
  maxQuantity,
  labels,
}: {
  lines: ContentsLine[];
  action: (state: State, form: FormData) => Promise<State>;
  maxQuantity: number;
  labels: {
    variant: string;
    quantity: string;
    remove: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
  };
}) {
  const [state, formAction, pending] = useActionState(action, { failed: false });
  return (
    <form action={formAction} className="flex flex-col gap-4" aria-busy={pending}>
      <ul className="flex flex-col divide-y divide-border">
        {lines.map((line) => {
          const current = line.choices.some((c) => c.variantId === line.variantId);
          return (
            <li key={line.id} className="flex flex-col gap-3 py-3 first:pt-0">
              <input type="hidden" name="line" value={line.id} />
              <p className="font-medium">{line.title}</p>
              <div className="flex flex-wrap items-end gap-3">
                {line.choices.length > 1 || !current ? (
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {labels.variant}
                    <select
                      name={`variant:${line.id}`}
                      defaultValue={line.variantId ?? undefined}
                      className="min-h-11 rounded-md border border-border bg-background px-3"
                    >
                      {!current && line.variantId && <option value={line.variantId}>{line.title}</option>}
                      {line.choices.map((choice) => (
                        <option key={choice.variantId} value={choice.variantId}>
                          {choice.label} · {choice.price}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <input type="hidden" name={`variant:${line.id}`} value={line.variantId ?? ""} />
                )}
                <label className="flex w-24 flex-col gap-1 text-sm">
                  {labels.quantity}
                  <input
                    type="number"
                    name={`quantity:${line.id}`}
                    defaultValue={line.quantity}
                    min={1}
                    max={maxQuantity}
                    required
                    inputMode="numeric"
                    className="min-h-11 rounded-md border border-border bg-background px-3"
                  />
                </label>
                {lines.length > 1 && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name={`remove:${line.id}`} className="size-5" />
                    {labels.remove}
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 button-primary px-5 font-medium disabled:opacity-40"
        >
          {pending ? labels.saving : labels.save}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {state.failed ? labels.failed : state.saved && !pending ? labels.saved : ""}
        </p>
      </div>
    </form>
  );
}
