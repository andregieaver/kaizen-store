import { describe, expect, it } from "vitest";

import { PLAIN_RULE, type QuantityRule } from "./quantity-rules";
import { canChooseQuantity, isQuantityPicker, pickerFor, snapQuantity, stepDown, stepUp, typedQuantity } from "./quantity-stepper";

// D430: the quantity chooser follows the variant's rule (D323).
const sixes: QuantityRule = { min: 12, max: 48, step: 6 };

describe("the − and + buttons", () => {
  it("step one at a time within the plain rule's 1 to 20", () => {
    expect(stepUp(1, PLAIN_RULE)).toBe(2);
    expect(stepUp(20, PLAIN_RULE)).toBe(20);
    expect(stepDown(2, PLAIN_RULE)).toBe(1);
    expect(stepDown(1, PLAIN_RULE)).toBe(1);
  });

  it("step by the rule's step between its minimum and maximum, and bring an odd number back onto a step", () => {
    expect(stepUp(12, sixes)).toBe(18);
    expect(stepUp(48, sixes)).toBe(48);
    expect(stepUp(5, sixes)).toBe(12);
    expect(stepUp(13, sixes)).toBe(18);
    expect(stepDown(18, sixes)).toBe(12);
    expect(stepDown(12, sixes)).toBe(12);
    expect(stepDown(13, sixes)).toBe(12);
    expect(stepDown(100, sixes)).toBe(48);
  });
});

describe("a typed quantity", () => {
  it("is a whole number or nothing", () => {
    expect(typedQuantity(" 7 ")).toBe(7);
    expect(typedQuantity("")).toBeNull();
    expect(typedQuantity("2.5")).toBeNull();
    expect(typedQuantity("-1")).toBeNull();
    expect(typedQuantity("abc")).toBeNull();
  });

  it("becomes the nearest quantity the rule allows", () => {
    expect(snapQuantity(0, PLAIN_RULE)).toBe(1);
    expect(snapQuantity(99, PLAIN_RULE)).toBe(20);
    expect(snapQuantity(14, sixes)).toBe(12);
    expect(snapQuantity(15, sixes)).toBe(18);
    expect(snapQuantity(1, sixes)).toBe(12);
    expect(snapQuantity(1000, sixes)).toBe(48);
    expect(snapQuantity(Number.NaN, sixes)).toBe(12);
  });
});

describe("where a product page offers the chooser", () => {
  it("takes the layout's choice over the store's, and none where hidden", () => {
    expect(pickerFor("buttons", undefined, "goods", PLAIN_RULE)).toBe("buttons");
    expect(pickerFor("buttons", "box", "goods", PLAIN_RULE)).toBe("box");
    expect(pickerFor("hidden", "buttons", "bundle", PLAIN_RULE)).toBe("buttons");
    expect(pickerFor("buttons", "hidden", "goods", PLAIN_RULE)).toBeNull();
  });

  it("offers none for bookings, stays, rentals and gift cards, nor where the rule fixes the quantity", () => {
    for (const kind of ["appointment", "stay", "rental", "gift_card"]) expect(pickerFor("buttons", undefined, kind, PLAIN_RULE)).toBeNull();
    const one: QuantityRule = { min: 1, max: 1, step: 1 };
    expect(canChooseQuantity(one)).toBe(false);
    expect(pickerFor("buttons", undefined, "goods", one)).toBeNull();
    expect(canChooseQuantity(sixes)).toBe(true);
  });

  it("knows the three choices only", () => {
    expect(["buttons", "box", "hidden"].every(isQuantityPicker)).toBe(true);
    expect(isQuantityPicker("slider")).toBe(false);
  });
});
