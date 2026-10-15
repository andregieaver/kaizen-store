import { describe, expect, it } from "vitest";

import { BRING_RETURN_DEFAULT, BRING_RETURN_SERVICES, isBringReturnService, isBringUrl, parseReturnBooking, returnBookingBody } from "./bring";
import type { ReturnBookingRequest } from "./shipping-carriers";

/** Bring's return labels (D239 4.7): the request and the answer, against Booking v2 as documented (developer.bring.com/api/booking, read 2026-10-15). */

const request: ReturnBookingRequest = {
  returnReference: "1042-R1",
  serviceId: "9300",
  from: { name: "Kari Nordmann", street: "Storgata 5", postalCode: "0182", city: "Oslo", country: "no", email: "kari@example.com" },
  to: { name: "Butikken AS", street: "Lagerveien 1", postalCode: "0581", city: "Oslo", country: "NO", phone: "+4722000000", email: "post@butikken.no" },
  parcels: [{ weightGrams: 1250 }],
};

describe("the return booking's request", () => {
  it("books the return service from the shopper to the store on the store's customer number", () => {
    const body = returnBookingBody(request, "PARCELS_NORWAY-1000", new Date("2026-10-15T10:00:00Z"));
    const c = body.consignments[0];
    expect(body.schemaVersion).toBe(1);
    expect(c.product).toEqual({ id: "9300", customerNumber: "PARCELS_NORWAY-1000" });
    expect(c.parties.sender).toEqual({ name: "Kari Nordmann", addressLine: "Storgata 5", postalCode: "0182", city: "Oslo", countryCode: "NO", contact: { email: "kari@example.com" } });
    expect(c.parties.recipient).toMatchObject({ name: "Butikken AS", countryCode: "NO", contact: { phoneNumber: "+4722000000", email: "post@butikken.no" } });
    expect(c.packages).toEqual([{ weightInKg: 1.25 }]);
    expect(c.shippingDateTime).toBe("2026-10-15T11:00:00.000Z");
    // No phone is invented for the shopper (optional for return services), and no test flag is in the body (the header says it).
    expect(JSON.stringify(body)).not.toMatch(/phoneNumber":"?\+?47[0-9]*"?,?"email":"kari/);
    expect(JSON.stringify(body)).not.toMatch(/test/i);
  });

  it("knows its return services, with the default documented", () => {
    expect(BRING_RETURN_DEFAULT).toBe("9300");
    expect(BRING_RETURN_SERVICES.filter((s) => s.confirmed).map((s) => s.id)).toEqual(["9300"]);
    expect(isBringReturnService("9300")).toBe(true);
    expect(isBringReturnService("5800")).toBe(false);
  });
});

describe("the return booking's answer", () => {
  it("reads the numbers and keeps a label address only on Bring's own host", () => {
    const answer = (labels: string) => ({
      consignments: [{ confirmation: { consignmentNumber: "70438101015432" }, packages: [{ packageNumber: "370438101015432" }], links: { labels, tracking: "https://sporing.bring.no/sporing/70438101015432" } }],
    });
    expect(parseReturnBooking(answer("https://api.bring.com/labels/id/1.pdf"))).toEqual({
      ok: true,
      consignmentNumber: "70438101015432",
      trackingNumber: "370438101015432",
      trackingUrl: "https://sporing.bring.no/sporing/70438101015432",
      labelUrl: "https://api.bring.com/labels/id/1.pdf",
    });
    expect(parseReturnBooking(answer("https://evil.example/labels/1.pdf"))).toMatchObject({ ok: true, labelUrl: null });
    expect(parseReturnBooking(answer("https://api.bring.com.evil.example/1.pdf"))).toMatchObject({ ok: true, labelUrl: null });
  });

  it("says the documented refusals in plain sentences", () => {
    const refusal = (code: string) => ({ consignments: [{ errors: [{ code, messages: [{ message: "raw" }] }] }] });
    expect(parseReturnBooking(refusal("BOOK-INPUT-043"))).toEqual({
      ok: false,
      problem: "Bring says the store has no return agreement for this country or service. Ask Bring to add returns to your agreement, or paste a label address.",
    });
    expect(parseReturnBooking(refusal("BOOK-INPUT-083"))).toEqual({ ok: false, problem: "Bring does not know that return service." });
    expect(parseReturnBooking(refusal("BOOK-OTHER-001"))).toEqual({ ok: false, problem: "raw" });
    expect(parseReturnBooking({})).toEqual({ ok: false, problem: "Bring's answer had no shipment number." });
  });
});

describe("Bring's own addresses", () => {
  it("is https on api.bring.com only", () => {
    expect(isBringUrl("https://api.bring.com/booking/api/labels/1.pdf")).toBe(true);
    expect(isBringUrl("https://api.bring.com:443/x")).toBe(true);
    for (const bad of ["http://api.bring.com/x", "https://api.bring.com:8443/x", "https://user:pw@api.bring.com/x", "https://bring.com/x", "https://xapi.bring.com/x", "not a url", ""]) {
      expect([bad, isBringUrl(bad)]).toEqual([bad, false]);
    }
  });
});
