import { describe, expect, it } from "vitest";

import { SHIPPING_VAT_RULES, SHIPPING_VAT_RULE_LABELS, parseShippingVatRule, shippingRate } from "./shipping-vat";

const STANDARD = 0.25;

describe("shippingRate", () => {
  it("is the standard rate under the standard rule, whatever the goods", () => {
    for (const goods of [[], [0.25], [0.15], [0.15, 0.25], [0], [0, 0.12]]) {
      expect(shippingRate("standard", goods, STANDARD)).toBe(STANDARD);
    }
  });

  describe("follows_goods", () => {
    it("takes the rate all taxable goods share", () => {
      expect(shippingRate("follows_goods", [0.15], STANDARD)).toBe(0.15);
      expect(shippingRate("follows_goods", [0.15, 0.15, 0.15], STANDARD)).toBe(0.15);
      expect(shippingRate("follows_goods", [0.25, 0.25], STANDARD)).toBe(0.25);
    });

    it("ignores exempt lines when the taxable ones agree", () => {
      expect(shippingRate("follows_goods", [0, 0.15], STANDARD)).toBe(0.15);
      expect(shippingRate("follows_goods", [0.12, 0, 0.12], STANDARD)).toBe(0.12);
    });

    it("takes the standard rate when taxable goods differ", () => {
      expect(shippingRate("follows_goods", [0.15, 0.25], STANDARD)).toBe(STANDARD);
      expect(shippingRate("follows_goods", [0.12, 0.15, 0], 0.2)).toBe(0.2);
    });

    it("is 0 when all the goods are exempt, and the standard rate with no goods lines", () => {
      expect(shippingRate("follows_goods", [0], STANDARD)).toBe(0);
      expect(shippingRate("follows_goods", [0, 0], STANDARD)).toBe(0);
      expect(shippingRate("follows_goods", [], STANDARD)).toBe(STANDARD);
    });
  });

  describe("highest", () => {
    it("takes the highest rate among the goods, never below zero", () => {
      expect(shippingRate("highest", [0.15, 0.25, 0.12], 0.2)).toBe(0.25);
      expect(shippingRate("highest", [0.15], STANDARD)).toBe(0.15);
      expect(shippingRate("highest", [0, 0.12], STANDARD)).toBe(0.12);
      expect(shippingRate("highest", [0], STANDARD)).toBe(0);
      expect(shippingRate("highest", [-0.1], STANDARD)).toBe(0);
    });

    it("can be above the standard rate and takes the standard rate with no goods", () => {
      expect(shippingRate("highest", [0.27], 0.25)).toBe(0.27);
      expect(shippingRate("highest", [], STANDARD)).toBe(STANDARD);
    });
  });
});

describe("the rules", () => {
  it("are three, each with a label, and anything else is standard", () => {
    expect(SHIPPING_VAT_RULES).toEqual(["standard", "follows_goods", "highest"]);
    for (const rule of SHIPPING_VAT_RULES) expect(SHIPPING_VAT_RULE_LABELS[rule].label.length).toBeGreaterThan(3);
    expect(parseShippingVatRule("highest")).toBe("highest");
    expect(parseShippingVatRule("bogus")).toBe("standard");
    expect(parseShippingVatRule(undefined)).toBe("standard");
  });
});
