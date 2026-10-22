import type { ReactNode } from "react";

import type { OrderActionState } from "@/app/admin/(gated)/[store]/orders/actions";
import type { FormState } from "@/components/admin/action-form";
import { bookedCarrierName, undoneLine, undoWarnings } from "@/lib/shipment-undo";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";
import { fillWords } from "@/lib/admin-fill";

import { EmailAgainButton, UndoParcel } from "./parcel-buttons";

/** A parcel as the order page lists it (D174 2.1). */
export type ShipmentItem = {
  id: string;
  createdAt: string;
  carrier: string;
  /** Booked through a carrier's connection (D134), whose tracking the page can follow. */
  carrierId: string | null;
  trackingNumber: string;
  trackingUrl: string | null;
  hasLabel: boolean;
  /** Recorded before parcels named their lines: counts as everything sent. */
  legacy: boolean;
  lines: { lineId: string; sku: string; title: string; quantity: number }[];
  /** A parcel, or a handover (D237): collected at the store's place, or taken out by its own driver. Absent means a parcel. */
  method?: "parcel" | "pickup" | "local";
  /** Staff took "sent" back (D174 follow-up): when, by whom and why. An undone parcel stays listed, muted, and counts nowhere. */
  undone: { at: string; by: string | null; reason: string | null } | null;
};

/**
 * The order's parcels in the order they were recorded (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1): the date, carrier and tracking (linked), what is in each, its
 * packing slip, its label when a carrier booked it, and *Email again*. A parcel recorded before parcels named their items says it counts as everything sent. `when` writes a
 * date for staff; `status` draws where a tracked parcel is now (the carrier's own answer, streamed in by the page). A parcel that stands can be undone (`undo`, D174
 * follow-up: *Undo "sent"*, with the warnings first); an undone one stays listed, struck through and muted, with when, by whom and why, and offers nothing. English: the admin.
 */
export function ShipmentList({
  shipments,
  base,
  when,
  emailAgain,
  status,
  undo = null,
  receiptRecorded = false,
  words = orderEn.parcels,
}: {
  /** The `order` catalogue's `parcels` words in the account's language (D312 A4). */
  words?: OrderMessages["parcels"];
  shipments: ShipmentItem[];
  /** The order's admin address (`/admin/{store}/orders/{orderId}`). */
  base: string;
  when: (iso: string) => string;
  /** The bound action that emails a parcel again, or null when the person may not (or the order has no email). */
  emailAgain: ((shipmentId: string) => () => Promise<OrderActionState>) | null;
  status?: (shipment: ShipmentItem) => ReactNode;
  /** The bound action that undoes a parcel, or null when the person may not (or nothing can be undone: a copied or unpaid order). */
  undo?: ((shipmentId: string) => (state: FormState, form: FormData) => Promise<FormState>) | null;
  /** The order has a recorded receipt, which undoing clears (the warning says so). */
  receiptRecorded?: boolean;
}) {
  if (shipments.length === 0) return null;
  const w = words;
  return (
    <ol className="mb-4 flex flex-col gap-3 text-sm" aria-label={w.label}>
      {shipments.map((s, index) =>
        s.undone ? (
          <li key={s.id} className="rounded-md border border-dashed border-line p-3 text-muted" data-undone="">
            <p className="font-medium">
              <s>{fillWords(w.parcel, { n: index + 1 })}</s> <span className="font-normal">{fillWords(w.notSentAfterAll, { when: when(s.createdAt) })}</span>
            </p>
            <p>
              <s>
                {s.carrier || w.parcelWord} {s.trackingNumber && <span className="font-mono">{s.trackingNumber}</span>}
              </s>
            </p>
            {s.lines.length > 0 && !s.legacy && (
              <ul className="mt-1 flex flex-col gap-0.5" aria-label={fillWords(w.wasIn, { n: index + 1 })}>
                {s.lines.map((line) => (
                  <li key={line.lineId}>
                    <s>
                      <span className="tabular-nums">{line.quantity}</span> × {line.title}
                    </s>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs">{undoneLine(s.undone, when, w)}</p>
          </li>
        ) : (
          <li key={s.id} className="rounded-md border border-line p-3">
            <p className="font-medium">
              {fillWords(w.parcel, { n: index + 1 })} <span className="font-normal text-muted">· {when(s.createdAt)}</span>
            </p>
            {s.method === "pickup" || s.method === "local" ? (
              <p>{s.method === "pickup" ? w.collected : w.driver}</p>
            ) : (
            <p>
              {s.carrier || w.parcelWord} {s.trackingNumber && <span className="font-mono">{s.trackingNumber}</span>}{" "}
              {s.trackingUrl && (
                <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {w.track}
                </a>
              )}
            </p>
            )}
            {status?.(s)}
            {s.legacy ? (
              <p className="text-xs text-muted">{w.legacy}</p>
            ) : (
              s.lines.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5" aria-label={fillWords(w.in, { n: index + 1 })}>
                  {s.lines.map((line) => (
                    <li key={line.lineId}>
                      <span className="tabular-nums">{line.quantity}</span> × {line.title}
                      {line.sku && <span className="font-mono text-xs text-muted"> {line.sku}</span>}
                    </li>
                  ))}
                </ul>
              )
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {(!s.legacy || s.lines.length > 0) && (
                <a href={`${base}/packing-slip?shipment=${s.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {w.packingSlip}
                </a>
              )}
              {s.hasLabel && (
                <a href={`${base}/label/${s.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {w.printLabel}
                </a>
              )}
              {emailAgain && s.method !== "pickup" && s.method !== "local" && <EmailAgainButton send={emailAgain(s.id)} />}
            </p>
            {undo && (
              <div className="mt-2">
                <UndoParcel
                  undo={undo(s.id)}
                  index={index + 1}
                  warnings={undoWarnings({ bookedWith: bookedCarrierName(s.carrierId), units: s.lines.reduce((sum, l) => sum + l.quantity, 0), receiptRecorded }, w)}
                />
              </div>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
