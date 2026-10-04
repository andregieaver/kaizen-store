import { describe, expect, it } from "vitest";

import { orderVatByRate, vatRowsWhenMixed } from "./order-vat";

const base = { vatKind: "standard" as const, shippingVatRate: 0.25 };

describe("an order's VAT per rate", () => {
  it("groups the lines' VAT by rate and gives the rest to the shipping's rate", () => {
    const order = {
      ...base,
      taxMinor: 2_000 + 130 + 500,
      lines: [
        { taxRate: 0.25, taxMinor: 1_000 },
        { taxRate: 0.25, taxMinor: 1_000 },
        { taxRate: 0.15, taxMinor: 130 },
        { taxRate: 0, taxMinor: 0 },
      ],
    };
    // Shipping's 500 at 25 %: the standard rate has all of the lines' 2000 and the shipping's 500.
    expect(orderVatByRate(order)).toEqual([
      { rate: 0.25, taxMinor: 2_500 },
      { rate: 0.15, taxMinor: 130 },
    ]);
    expect(orderVatByRate(order).reduce((sum, r) => sum + r.taxMinor, 0)).toBe(order.taxMinor);
  });

  it("is only listed for more than one rate", () => {
    expect(vatRowsWhenMixed({ ...base, taxMinor: 1_000, lines: [{ taxRate: 0.25, taxMinor: 1_000 }] })).toEqual([]);
    expect(vatRowsWhenMixed({ ...base, taxMinor: 1_100, lines: [{ taxRate: 0.25, taxMinor: 1_000 }, { taxRate: 0.15, taxMinor: 100 }] })).toHaveLength(2);
  });

  it("is a rate of nothing for exempt lines and nothing for a reverse-charge order", () => {
    expect(orderVatByRate({ ...base, taxMinor: 0, lines: [{ taxRate: 0, taxMinor: 0 }] })).toEqual([]);
    expect(orderVatByRate({ ...base, vatKind: "reverse_charge", taxMinor: 0, lines: [{ taxRate: 0.19, taxMinor: 0 }] })).toEqual([]);
  });

  it("puts shipping at its own rate when that is not a line's", () => {
    const rows = orderVatByRate({ ...base, shippingVatRate: 0.19, taxMinor: 1_000 + 190, lines: [{ taxRate: 0.07, taxMinor: 1_000 }] });
    expect(rows).toEqual([
      { rate: 0.19, taxMinor: 190 },
      { rate: 0.07, taxMinor: 1_000 },
    ]);
  });
});
