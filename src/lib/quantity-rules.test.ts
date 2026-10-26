import { describe, expect, it } from "vitest";

import { settleQuantity } from "./cart";
import { MAX_LINE_QUANTITY, PLAIN_RULE, fitQuantity, lineMax, nextQuantity, quantityProblem, ruleOf, ruleWords } from "./quantity-rules";

const sixes = { min: 6, max: null, step: 6 };
const twelveBySix = { min: 12, max: 48, step: 6 };
const words = { min: (n: number) => `At least ${n}`, max: (n: number) => `At most ${n}`, step: (n: number) => `In multiples of ${n}` };

describe("quantity rules (D323)", () => {
  it("keeps the plain rule's line of 1 to 20", () => {
    expect(lineMax(PLAIN_RULE)).toBe(MAX_LINE_QUANTITY);
    expect(quantityProblem(1, PLAIN_RULE)).toBeNull();
    expect(quantityProblem(20, PLAIN_RULE)).toBeNull();
    expect(quantityProblem(21, PLAIN_RULE)).toEqual({ kind: "max", n: 20 });
    expect(quantityProblem(0, PLAIN_RULE)).toEqual({ kind: "min", n: 1 });
  });

  it("gives a rule without a maximum twenty steps from its minimum, at most 9,999", () => {
    expect(lineMax(sixes)).toBe(6 + 19 * 6);
    expect(lineMax(twelveBySix)).toBe(48);
    expect(lineMax({ min: 5000, max: null, step: 1000 })).toBe(9000);
    expect(lineMax({ min: 9999, max: null, step: 1 })).toBe(9999);
  });

  it("says what is wrong: below the minimum, between steps, above the maximum", () => {
    expect(quantityProblem(6, twelveBySix)).toEqual({ kind: "min", n: 12 });
    expect(quantityProblem(15, twelveBySix)).toEqual({ kind: "step", n: 6 });
    expect(quantityProblem(54, twelveBySix)).toEqual({ kind: "max", n: 48 });
    expect(quantityProblem(18, twelveBySix)).toBeNull();
  });

  it("adds the minimum to an empty line and whole steps after, putting a broken line right", () => {
    expect(nextQuantity(0, 1, sixes)).toBe(6);
    expect(nextQuantity(6, 1, sixes)).toBe(12);
    expect(nextQuantity(0, 1, twelveBySix)).toBe(12);
    expect(nextQuantity(12, 1, twelveBySix)).toBe(18);
    expect(nextQuantity(5, 1, sixes)).toBe(6);
    expect(nextQuantity(0, 10, sixes)).toBe(12);
    expect(nextQuantity(2, 1, PLAIN_RULE)).toBe(3);
  });

  it("cuts down to what the rule and the stock allow, never below the minimum", () => {
    expect(fitQuantity(30, 20, sixes)).toBe(18);
    expect(fitQuantity(30, 11, twelveBySix)).toBe(0);
    expect(fitQuantity(60, 1000, twelveBySix)).toBe(48);
    expect(fitQuantity(5, 5, PLAIN_RULE)).toBe(5);
  });

  it("settles a cart line by the rule, as the cart did without one", () => {
    expect(settleQuantity(2, 10)).toEqual({ quantity: 2, outcome: "added" });
    expect(settleQuantity(25, 100)).toEqual({ quantity: 20, outcome: "capped" });
    expect(settleQuantity(12, 100, sixes)).toEqual({ quantity: 12, outcome: "added" });
    expect(settleQuantity(12, 10, sixes)).toEqual({ quantity: 6, outcome: "capped" });
    expect(settleQuantity(12, 5, sixes)).toEqual({ quantity: 0, outcome: "unavailable" });
  });

  it("reads a row, falling back to the plain rule for one the database would refuse", () => {
    expect(ruleOf({ min_quantity: 12, max_quantity: 48, quantity_step: 6 })).toEqual(twelveBySix);
    expect(ruleOf({ min_quantity: 1, max_quantity: null, quantity_step: 1 })).toEqual(PLAIN_RULE);
    expect(ruleOf({})).toEqual(PLAIN_RULE);
    expect(ruleOf({ min_quantity: 5, max_quantity: null, quantity_step: 6 })).toEqual(PLAIN_RULE);
  });

  it("words a rule, leaving out what the step already says", () => {
    expect(ruleWords(PLAIN_RULE, words)).toBeNull();
    expect(ruleWords(sixes, words)).toBe("In multiples of 6");
    expect(ruleWords(twelveBySix, words)).toBe("At least 12 · In multiples of 6 · At most 48");
    expect(ruleWords({ min: 3, max: null, step: 1 }, words)).toBe("At least 3");
  });
});
