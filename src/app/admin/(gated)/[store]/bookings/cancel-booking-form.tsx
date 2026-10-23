"use client";

import { useAdminText } from "@/components/admin/admin-text";

import { cancelBookingAction } from "./actions";

/** Cancels a confirmed booking from the store's calendars, telling the customer when asked. */
export function CancelBookingForm({ storeSlug, bookingId }: { storeSlug: string; bookingId: string }) {
  const w = useAdminText("bookings").cancel;
  return (
    <details className="text-left">
      <summary className="cursor-pointer text-right text-muted underline">{w.menu}</summary>
      <form
        action={cancelBookingAction.bind(null, storeSlug, bookingId)}
        className="mt-2 flex max-w-xs flex-col gap-2 rounded-md border border-line p-3"
      >
        <p className="text-muted">{w.body}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="notify" defaultChecked className="size-4" />
          {w.notify}
        </label>
        <button type="submit" className="min-h-10 rounded-pill border border-edge px-3 font-medium">
          {w.submit}
        </button>
      </form>
    </details>
  );
}
