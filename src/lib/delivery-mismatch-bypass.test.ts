import { describe, expect, it } from "vitest";

import { postalMismatch } from "./delivery-options";

/**
 * Security review (D237 2.4 point 4, 2.7): the pay press's postal-code gate is only a client-side call to `deliveryReadyAction()`, which fails open on a
 * network error. An order paid without a delivery postal code is priced at Rest of country (or the flat rate); the spec promises that the mismatch flag
 * then tells staff when Stripe's address belongs to a dearer zone ("The hosted-page fallback ... the mismatch flag (2.7) tells staff when the address
 * belongs to a dearer zone"). These fail: an order priced without a code is never flagged.
 */
describe("postalMismatch for an order priced without a postal code", () => {
  const zoneOf = (code: string) => (code.startsWith("50") ? "zone-bergen" : null);

  it("flags a method priced at Rest of country when the address is in a zone", () => {
    const method = { kind: "method" as const, methodId: "m", label: "Standard", zone: null, postalCode: null, estimate: null };
    expect(postalMismatch(method, "NO", "5003", { zoneOf })).not.toBeNull();
  });

  it("keeps a method priced at Rest of country with an address in Rest of country unflagged", () => {
    const method = { kind: "method" as const, methodId: "m", label: "Standard", zone: null, postalCode: null, estimate: null };
    expect(postalMismatch(method, "NO", "0150", { zoneOf })).toBeNull();
  });

  it("flags the flat rate priced without a code only when the address is in a zone a method prices", () => {
    const flat = { kind: "flat" as const, label: "Shipping", postalCode: null };
    expect(postalMismatch(flat, "NO", "5003", { zoneOf, pricedZoneOf: zoneOf })).toEqual({ priced: null, address: "5003" });
    expect(postalMismatch(flat, "NO", "5003", { zoneOf, pricedZoneOf: () => null })).toBeNull();
    expect(postalMismatch({ ...flat, postalCode: "5001" }, "NO", "5003", { zoneOf, pricedZoneOf: zoneOf })).toBeNull();
  });

  it("never flags pickup, nor a local area or carrier service without a priced code", () => {
    const local = { kind: "local" as const, label: "Local", areaId: "a", name: "Oslo", postalCode: "", info: "" };
    expect(postalMismatch(local, "NO", "5003", { areaCovers: () => false })).toBeNull();
  });
});
