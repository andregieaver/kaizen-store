import { describe, expect, it } from "vitest";

import { replacementCapProblem, replacementLines, type LostRow } from "./replacements";

const row = (over: Partial<LostRow> = {}): LostRow => ({
  orderLineId: "l1",
  variantId: "v1",
  sku: "MUG",
  title: "Mug",
  quantity: 1,
  lineQuantity: 3,
  unitPriceMinor: 20000,
  lineTotalMinor: 54000,
  taxRate: 0.25,
  taxCode: "txcd_99999999",
  withdrawalExclusion: "none",
  unitCostMinor: 6000,
  measure: null,
  listPriceMinor: null,
  policy: "deny",
  ...over,
});

describe("a lost parcel's replacement lines (B3, D679)", () => {
  it("takes each line once over its parcels, never more than the order had, at what the customer paid for those units", () => {
    const lines = replacementLines([row({ quantity: 2 }), row({ quantity: 2 }), row({ orderLineId: "l2", variantId: null })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ variantId: "v1", quantity: 3, valueMinor: 54000 });
    expect(replacementLines([row()])[0].valueMinor).toBe(18000);
  });

  it("waits without a cap, in another currency and past the cap", () => {
    const money = (minor: number) => `${minor / 100} kr`;
    const f = { valueMinor: 18000, currency: "NOK", mainCurrency: "NOK", money };
    expect(replacementCapProblem({ ...f, capMinor: null })).toMatch(/No cap/);
    expect(replacementCapProblem({ ...f, currency: "SEK", capMinor: 50000 })).toMatch(/in SEK/);
    expect(replacementCapProblem({ ...f, capMinor: 10000 })).toBe("The goods sent again are worth 180 kr, more than the 100 kr a replacement may be worth.");
    expect(replacementCapProblem({ ...f, capMinor: 18000 })).toBeNull();
  });
});
