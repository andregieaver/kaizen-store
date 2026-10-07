/**
 * Undoing a parcel (wave 3, run 3, D174 follow-up, `docs/wave-3-fulfilment.md` "Undoing a parcel"): the words staff read before and after taking "sent" back. Pure, so
 * the order page, the action and their tests say one thing. English: the admin. The rules themselves are `commerce.undo_shipment()`'s (`undoShipment()`).
 */

import { carrierInfo } from "./shipping-carriers";

/** The name of the carrier a parcel was booked with through its connection (D134 to D138), or null when it was recorded by hand. */
export const bookedCarrierName = (carrierId: string | null | undefined): string | null => (carrierId ? (carrierInfo(carrierId)?.name ?? carrierId) : null);

/** What the confirmation says before a parcel is undone: what happens, and what Kaizen does NOT do. */
export function undoWarnings(parcel: { bookedWith: string | null; units: number; receiptRecorded: boolean }): string[] {
  const units = parcel.units > 0 ? `its ${parcel.units} ${parcel.units === 1 ? "unit goes" : "units go"} back to what is still to send` : "its items go back to what is still to send";
  return [
    `The parcel stays in the history, marked undone, and ${units}. A sent order becomes partly sent or not sent again.`,
    ...(parcel.bookedWith ? [`The booking with ${parcel.bookedWith} is not cancelled: cancel it with ${parcel.bookedWith} yourself.`] : []),
    "The customer is not emailed. Tell them yourself if they were told it was on its way.",
    ...(parcel.receiptRecorded ? ["The recorded receipt date is cleared: goods that were not sent were not received. Record it again when they arrive."] : []),
  ];
}

/** What staff read after a parcel was undone. */
export function undoneMessage(done: { units: number; deliveredWas: string | null; bookedWith: string | null }): string {
  const units = done.units > 0 ? ` ${done.units} ${done.units === 1 ? "unit is" : "units are"} to send again.` : "";
  const receipt = done.deliveredWas ? " The recorded receipt was cleared." : "";
  const carrier = done.bookedWith ? ` The booking with ${done.bookedWith} was not cancelled: cancel it with ${done.bookedWith} yourself.` : "";
  return `The parcel is undone.${units}${receipt}${carrier} The customer was not emailed: tell them yourself if they need to know.`;
}

/** How an undone parcel is described in the list: "Undone 7 Oct 2026, 10:12 by kari@example.com: Wrong parcel". */
export function undoneLine(undone: { at: string; by: string | null; reason: string | null }, when: (iso: string) => string): string {
  return `Undone ${when(undone.at)}${undone.by ? ` by ${undone.by}` : ""}${undone.reason ? `: ${undone.reason}` : ""}`;
}
