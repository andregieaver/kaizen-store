import { describe, expect, it } from "vitest";

import { lineWithdrawal, shippingCost, stripeLocale, vatIncluded } from "./checkout";

describe("vatIncluded", () => {
  it("finds the VAT inside a VAT-inclusive price", () => {
    expect(vatIncluded(24900, 0.25)).toBe(4980);
    expect(vatIncluded(10000, 0.19)).toBe(1597);
    expect(vatIncluded(12900, 0.255)).toBe(2621);
    expect(vatIncluded(5000, 0)).toBe(0);
  });
});

describe("shippingCost", () => {
  it("charges the flat rate below the free-shipping threshold", () => {
    const rate = { amountMinor: 9900, freeOverMinor: 99900 };
    expect(shippingCost(99899, rate)).toBe(9900);
    expect(shippingCost(99900, rate)).toBe(0);
    expect(shippingCost(500, { amountMinor: 4900, freeOverMinor: null })).toBe(4900);
  });
});

describe("stripeLocale", () => {
  it("uses the shopper's language where Stripe has it", () => {
    expect(stripeLocale("nb")).toBe("nb");
    expect(stripeLocale("ga")).toBe("auto");
  });
});

describe("lineWithdrawal", () => {
  it("marks downloads as digital content, and never a shipped item", () => {
    expect(lineWithdrawal("digital", "none")).toBe("digital_content");
    expect(lineWithdrawal("physical", "digital_content")).toBe("none");
    expect(lineWithdrawal("physical", "custom_made")).toBe("custom_made");
  });
});
