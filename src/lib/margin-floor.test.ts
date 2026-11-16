import { describe, expect, it } from "vitest";

import { autonomyDecision, readAutonomy } from "./autopilot-autonomy";
import { lowestMargin, marginFloorProblem, marginPercent } from "./margin-floor";

describe("a margin", () => {
  it("is measured on the price without VAT", () => {
    // 250 with 25 % VAT is 200 net; a cost of 150 leaves 25 %.
    expect(marginPercent({ priceMinor: 25_000, vatRate: 0.25, costMinor: 15_000 })).toBeCloseTo(25);
    expect(marginPercent({ priceMinor: 10_000, vatRate: 0, costMinor: 12_000 })).toBeCloseTo(-20);
    expect(marginPercent({ priceMinor: 0, vatRate: 0.25, costMinor: 100 })).toBeNull();
    expect(marginPercent({ priceMinor: Number.NaN, vatRate: 0.25, costMinor: 100 })).toBeNull();
  });

  it("is the lowest of all after an offer, and unknown with nothing to measure", () => {
    const rows = [
      { priceMinor: 25_000, vatRate: 0.25, costMinor: 15_000 },
      { priceMinor: 12_500, vatRate: 0.25, costMinor: 5_000 },
    ];
    expect(lowestMargin(rows)).toBeCloseTo(25);
    // 20 % off: 160 net against 150 is 6.25 %.
    expect(lowestMargin(rows, 20)).toBeCloseTo(6.25);
    expect(lowestMargin([])).toBeNull();
  });

  it("breaks the floor below it, and when it cannot be measured", () => {
    expect(marginFloorProblem(9.9, 10)).toContain("9.9 %");
    expect(marginFloorProblem(10, 10)).toBeNull();
    expect(marginFloorProblem(null, 10)).toContain("could not be measured");
    expect(marginFloorProblem(null, null)).toBeNull();
  });
});

describe("the margin floor in the autopilot's decisions", () => {
  const settings = readAutonomy({ levels: { catalogue: "auto", marketing: "auto" }, budgets: { marginFloorPercent: 15, discountPercent: 50 } });

  it("asks for a price or an offer that leaves a product under the floor", () => {
    expect(autonomyDecision(settings, "set_prices", "public", { priceChangePercent: 5, lowestMarginPercent: 20 })).toMatchObject({ run: true });
    expect(autonomyDecision(settings, "set_prices", "public", { priceChangePercent: 5, lowestMarginPercent: 12 })).toMatchObject({ run: false, why: expect.stringContaining("15 %") });
    expect(autonomyDecision(settings, "create_discount", "public", { discountPercent: 30, lowestMarginPercent: 4 })).toMatchObject({ run: false });
    expect(autonomyDecision(settings, "create_campaign", "public", { discountPercent: 30 })).toMatchObject({ run: false, why: expect.stringContaining("could not be measured") });
  });

  it("lets free shipping through, and holds nothing without a floor", () => {
    expect(autonomyDecision(settings, "create_discount", "public", { discountPercent: 0, marginUntouched: true })).toMatchObject({ run: true });
    const noFloor = readAutonomy({ levels: { catalogue: "auto" } });
    expect(autonomyDecision(noFloor, "set_prices", "public", { priceChangePercent: 5 })).toMatchObject({ run: true });
  });
});
