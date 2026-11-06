"use client";

import { useActionState } from "react";

import { noShowAction, type NoShowState } from "@/app/admin/(gated)/[store]/bookings/actions";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

const initial: NoShowState = { ok: false, message: null };

/**
 * Marks a past booking as a no-show (D66); with a fee to charge, a tick
 * charges it to the card saved with the deposit. Nothing is charged
 * without that tick.
 */
export function NoShowForm({ storeSlug, bookingId, feeLabel }: { storeSlug: string; bookingId: string; feeLabel: string | null }) {
  const w = useAdminText("bookings").noShow;
  const [state, action, pending] = useActionState(noShowAction.bind(null, storeSlug, bookingId), initial);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const charge = (event.currentTarget.elements.namedItem("charge") as HTMLInputElement | null)?.checked;
        if (charge && feeLabel && !window.confirm(fillWords(w.confirm, { fee: feeLabel }))) event.preventDefault();
      }}
      className="mt-2 flex max-w-xs flex-col gap-2 rounded-md border border-line p-3 text-left"
    >
      <p className="text-muted">{w.didNotCome}</p>
      {feeLabel && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="charge" defaultChecked className="size-4" />
          {fillWords(w.charge, { fee: feeLabel })}
        </label>
      )}
      <button type="submit" disabled={pending} className="min-h-10 rounded-pill border border-edge px-3 font-medium disabled:opacity-50">
        {pending ? w.saving : w.mark}
      </button>
      {state.message && (
        <p role="status" className={state.ok ? "" : "text-danger-text"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
