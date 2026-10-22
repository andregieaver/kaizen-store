import { countWords, fillWords } from "./admin-fill";
import { orderEn, type OrderMessages } from "./admin-messages/order.en";

/** The words the undo of a parcel is told in (D312 A4): the `order` catalogue's `parcels`, English unless given. */
type UndoWords = OrderMessages["parcels"];

/**
 * Undoing a parcel (wave 3, run 3, D174 follow-up, `docs/wave-3-fulfilment.md` "Undoing a parcel"): the words staff read before and after taking "sent" back. Pure, so
 * the order page, the action and their tests say one thing. English: the admin. The rules themselves are `commerce.undo_shipment()`'s (`undoShipment()`).
 */

import { carrierInfo } from "./shipping-carriers";

/** The name of the carrier a parcel was booked with through its connection (D134 to D138), or null when it was recorded by hand. */
export const bookedCarrierName = (carrierId: string | null | undefined): string | null => (carrierId ? (carrierInfo(carrierId)?.name ?? carrierId) : null);

/** What the confirmation says before a parcel is undone: what happens, and what Kaizen does NOT do. */
export function undoWarnings(parcel: { bookedWith: string | null; units: number; receiptRecorded: boolean }, w: UndoWords = orderEn.parcels): string[] {
  const units = parcel.units > 0 ? countWords(parcel.units, w.warnUnits) : w.warnItems;
  return [
    fillWords(w.warnStays, { units }),
    ...(parcel.bookedWith ? [fillWords(w.warnBooking, { carrier: parcel.bookedWith })] : []),
    w.warnEmail,
    ...(parcel.receiptRecorded ? [w.warnReceipt] : []),
  ];
}

/** What staff read after a parcel was undone. */
export function undoneMessage(done: { units: number; deliveredWas: string | null; bookedWith: string | null }, w: UndoWords = orderEn.parcels): string {
  const units = done.units > 0 ? countWords(done.units, w.undoneUnits) : "";
  const receipt = done.deliveredWas ? w.undoneReceipt : "";
  const carrier = done.bookedWith ? fillWords(w.undoneCarrier, { carrier: done.bookedWith }) : "";
  return fillWords(w.undoneMessage, { units, receipt, carrier });
}

/** How an undone parcel is described in the list: "Undone 7 Oct 2026, 10:12 by kari@example.com: Wrong parcel". */
export function undoneLine(undone: { at: string; by: string | null; reason: string | null }, when: (iso: string) => string, w: UndoWords = orderEn.parcels): string {
  return `${fillWords(w.undoneLine, { when: when(undone.at) })}${undone.by ? fillWords(w.undoneBy, { by: undone.by }) : ""}${undone.reason ? fillWords(w.undoneReason, { reason: undone.reason }) : ""}`;
}
