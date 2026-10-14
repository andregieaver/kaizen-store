import { describe, expect, it } from "vitest";

import { deliveryOffer, standardShippingMinor, type MethodTerms } from "./shipping-methods";

/** Adversarial review (money lens, D237 4.3): the refund cap is the cheapest standard delivery the shopper was OFFERED (CRD Art. 13(2)). */
const view = { conversion: { factor: 1, step: 1 } };
const standard: MethodTerms = {
  id: "m1",
  label: "Standard",
  position: 0,
  active: true,
  freeOverMinor: null,
  estimate: null,
  rates: [{ zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900 }],
};

describe("standard delivery kept on the order when methods price the basket", () => {
  it("is never a fallback flat rate the shopper was not offered", () => {
    const flat = { amountMinor: 4900, freeOverMinor: null };
    const offer = deliveryOffer({
      physical: true,
      subscription: false,
      view,
      flat,
      methods: [standard],
      parts: [{ profileId: null, weightGrams: 500, valueMinor: 20000 }],
      basketValueMinor: 20000,
      zoneId: null,
    });
    // The flat rate is not offered: the method prices the basket (4.1 point 3).
    expect(offer.ship.map((d) => d.kind)).toEqual(["method"]);
    // So the cheapest standard delivery offered is 99 kr, and a whole withdrawal refunds the 99 kr paid.
    expect(standardShippingMinor(offer)).toBe(9900);
  });
});
