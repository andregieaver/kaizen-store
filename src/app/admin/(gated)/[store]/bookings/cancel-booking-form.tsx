import { cancelBookingAction } from "./actions";

/** Cancels a confirmed booking from the store's calendars, telling the customer when asked. */
export function CancelBookingForm({ storeSlug, bookingId }: { storeSlug: string; bookingId: string }) {
  return (
    <details className="text-left">
      <summary className="cursor-pointer text-right text-muted underline">Cancel…</summary>
      <form
        action={cancelBookingAction.bind(null, storeSlug, bookingId)}
        className="mt-2 flex max-w-xs flex-col gap-2 rounded-md border border-border p-3"
      >
        <p className="text-muted">The time becomes free again. Refund the payment from the order if you should.</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="notify" defaultChecked className="size-4" />
          Email the customer
        </label>
        <button type="submit" className="min-h-10 rounded-md border border-border px-3 font-medium">
          Cancel this booking
        </button>
      </form>
    </details>
  );
}
