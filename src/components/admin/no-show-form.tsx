"use client";

import { useActionState } from "react";

import { noShowAction, type NoShowState } from "@/app/admin/(gated)/[store]/bookings/actions";

const initial: NoShowState = { ok: false, message: null };

/**
 * Marks a past booking as a no-show (D66); with a fee to charge, a tick
 * charges it to the card saved with the deposit. Nothing is charged
 * without that tick.
 */
export function NoShowForm({ storeSlug, bookingId, feeLabel }: { storeSlug: string; bookingId: string; feeLabel: string | null }) {
  const [state, action, pending] = useActionState(noShowAction.bind(null, storeSlug, bookingId), initial);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const charge = (event.currentTarget.elements.namedItem("charge") as HTMLInputElement | null)?.checked;
        if (charge && feeLabel && !window.confirm(`Charge ${feeLabel} to the customer's card?`)) event.preventDefault();
      }}
      className="mt-2 flex max-w-xs flex-col gap-2 rounded-md border border-border p-3 text-left"
    >
      <p className="text-muted">The customer did not come.</p>
      {feeLabel && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="charge" defaultChecked className="size-4" />
          Charge the no-show fee, {feeLabel}, to the saved card
        </label>
      )}
      <button type="submit" disabled={pending} className="min-h-10 rounded-md border border-border px-3 font-medium disabled:opacity-50">
        {pending ? "Saving …" : "Mark as no-show"}
      </button>
      {state.message && (
        <p role="status" className={state.ok ? "" : "text-red-700 dark:text-red-400"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
