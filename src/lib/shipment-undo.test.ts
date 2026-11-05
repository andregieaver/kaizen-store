import { describe, expect, it } from "vitest";

import { orderNb } from "./admin-messages/order.nb";
import { undoneMessage, undoWarnings } from "./shipment-undo";

const done = { units: 2, deliveredWas: null, bookedWith: "UPS" };

describe("undoing a parcel booked with a carrier (D458)", () => {
  it("warns that the booking is cancelled there too, for a carrier that cancels, and to cancel it yourself otherwise", () => {
    expect(undoWarnings({ bookedWith: "UPS", units: 2, receiptRecorded: false, cancels: true })[1]).toBe("The booking with UPS is cancelled there too, if it has not been handed over.");
    expect(undoWarnings({ bookedWith: "Helthjem", units: 2, receiptRecorded: false })[1]).toBe("The booking with Helthjem is not cancelled: cancel it with Helthjem yourself.");
  });

  it("says what the carrier answered", () => {
    expect(undoneMessage({ ...done, cancelled: { ok: true } })).toContain("The booking with UPS was cancelled.");
    expect(undoneMessage({ ...done, cancelled: { ok: false, problem: "already on its way" } })).toContain("UPS did not cancel the booking (already on its way): cancel it with UPS yourself.");
    expect(undoneMessage({ ...done, cancelled: null })).toContain("The booking with UPS was not cancelled: cancel it with UPS yourself.");
    expect(undoneMessage({ ...done, bookedWith: null })).not.toContain("booking");
    expect(undoneMessage({ ...done, cancelled: { ok: true } }, orderNb.parcels)).toContain("Bookingen hos UPS ble kansellert.");
  });
});
