"use client";

import { useState, useTransition } from "react";

import { cancelOwnBookingAction, moveOwnBookingAction } from "@/app/s/[store]/[market]/order/booking-actions";
import { appointmentWeekAction } from "@/app/s/[store]/[market]/p/actions";
import type { SlotWeek } from "@/lib/booking-slots";

import { AppointmentPicker, type AppointmentPickerLabels } from "./appointment-picker";

export type BookingChangesLabels = AppointmentPickerLabels & {
  changeTime: string;
  cancelBooking: string;
  confirmCancel: string;
  keepBooking: string;
  changeUntil: string;
  changeClosed: string;
  moved: string;
  cancelled: string;
  moveTo: string;
  /** "You get 267,00 kr back." for what cancelling now pays back, or null. */
  refundNote: string | null;
};

/**
 * A shopper's own booking on their order page (D66): change the time or
 * cancel while the appointment's rule allows, else say to get in touch.
 */
export function BookingChanges({
  store,
  market,
  orderId,
  sessionId,
  bookingId,
  productId,
  open,
  labels,
}: {
  store: string;
  market: string;
  orderId: string;
  /** The order page's key; null in My account, where the shopper is signed in. */
  sessionId: string | null;
  bookingId: string;
  productId: string;
  open: boolean;
  labels: BookingChangesLabels;
}) {
  const [mode, setMode] = useState<"idle" | "move" | "cancel">("idle");
  const [week, setWeek] = useState<SlotWeek | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const ids = { orderId, bookingId, sessionId };

  if (!open) return <p className="text-sm text-muted">{labels.changeClosed}</p>;
  const button = "min-h-11 rounded-button border border-border px-3 text-sm disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">{labels.changeUntil}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={mode === "move"}
          disabled={busy}
          onClick={() =>
            start(async () => {
              if (mode === "move") return setMode("idle");
              setWeek(week ?? (await appointmentWeekAction(store, market, { productId, from: null, resourceId: null })));
              setMode("move");
            })
          }
          className={button}
        >
          {labels.changeTime}
        </button>
        <button
          type="button"
          aria-expanded={mode === "cancel"}
          disabled={busy}
          onClick={() => setMode(mode === "cancel" ? "idle" : "cancel")}
          className={button}
        >
          {labels.cancelBooking}
        </button>
      </div>
      {mode === "move" && week && (
        <AppointmentPicker
          store={store}
          market={market}
          cartHref=""
          productId={productId}
          variants={[]}
          staff={[]}
          initial={week}
          labels={labels}
          reschedule={{
            move: (startsAt) => moveOwnBookingAction(store, market, { ...ids, startsAt }),
            labels: { moveTo: labels.moveTo, moved: labels.moved, closed: labels.changeClosed },
          }}
        />
      )}
      {mode === "cancel" && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-border p-3">
          {labels.refundNote && <p>{labels.refundNote}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await cancelOwnBookingAction(store, market, ids);
                  setMessage(
                    result.outcome === "done"
                      ? labels.cancelled
                      : result.outcome === "closed"
                        ? labels.changeClosed
                        : labels.tryAgain,
                  );
                  setMode("idle");
                })
              }
              className="min-h-11 button-primary px-3 text-sm font-medium disabled:opacity-40"
            >
              {labels.confirmCancel}
            </button>
            <button type="button" onClick={() => setMode("idle")} className={button}>
              {labels.keepBooking}
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
