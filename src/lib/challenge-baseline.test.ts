import { describe, expect, it } from "vitest";

import { baselineSchema, changedCosts, costFingerprintText, mayFreeze, type Baseline } from "./challenge-baseline";

const baseline: Baseline = {
  frozenAt: "2027-01-02T10:00:00.000Z",
  frozenBy: "11111111-1111-4111-8111-111111111111",
  currency: "NOK",
  costs: { paymentFeeBps: 240, paymentFeeFixedMinor: 0, shippingCostMinor: 6900, handlingCostMinor: 2500 },
  adMoney: 60_000,
  variantsWithCost: 2,
  variantsWithoutCost: 1,
  costFingerprint: "a".repeat(64),
};

describe("the challenge's baseline (E7, D648)", () => {
  it("is read back as it was kept", () => {
    expect(baselineSchema.parse(baseline)).toEqual(baseline);
    expect(baselineSchema.safeParse({ ...baseline, costFingerprint: "x" }).success).toBe(false);
  });

  it("fingerprints every variant's cost in id order, whatever order they come in", () => {
    const a = costFingerprintText([{ id: "b", costMinor: 100 }, { id: "a", costMinor: null }]);
    const b = costFingerprintText([{ id: "a", costMinor: null }, { id: "b", costMinor: 100 }]);
    expect(a).toBe(b);
    expect(a).toBe("a:-\nb:100");
    expect(costFingerprintText([{ id: "a", costMinor: 0 }, { id: "b", costMinor: 100 }])).not.toBe(a);
  });

  it("names the frozen cost estimates the store changed since", () => {
    expect(changedCosts(baseline, baseline.costs)).toEqual([]);
    expect(changedCosts(baseline, { ...baseline.costs, shippingCostMinor: 5900, handlingCostMinor: 0 })).toEqual([
      "the shipping cost per order",
      "the handling and packaging cost per order",
    ]);
  });

  it("is frozen only before Day 1", () => {
    expect(mayFreeze("2027-01-04", "2027-01-03")).toBe(true);
    expect(mayFreeze("2027-01-04", "2027-01-04")).toBe(false);
    expect(mayFreeze("2027-01-04", "2027-02-01")).toBe(false);
  });
});
