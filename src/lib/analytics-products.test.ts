import { describe, expect, it } from "vitest";

import { allocateRefund, paretoSummary, productTable, type ProductRow } from "./analytics-products";

const row = (id: string, over: Partial<ProductRow> = {}): ProductRow => ({
  productId: id,
  name: `Product ${id}`,
  revenueMinor: 0,
  units: 0,
  orders: 0,
  cogsMinor: null,
  knownCostRevenueMinor: 0,
  refundsMinor: 0,
  ...over,
});

describe("productTable", () => {
  const rows = [
    row("c", { revenueMinor: 10_000, units: 10, orders: 8, cogsMinor: 6000, knownCostRevenueMinor: 10_000, refundsMinor: 1000 }),
    row("a", { revenueMinor: 60_000, units: 40, orders: 30, cogsMinor: 20_000, knownCostRevenueMinor: 60_000, refundsMinor: 0 }),
    row("b", { revenueMinor: 30_000, units: 20, orders: 15, cogsMinor: null, refundsMinor: 3000 }),
  ];
  const table = productTable(rows, { revenueMinor: 110_000 });

  it("ranks by revenue", () => {
    expect(table.rows.map((r) => [r.productId, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("works out each product's figures", () => {
    const [a, b, c] = table.rows;
    expect(a).toMatchObject({ netRevenueMinor: 60_000, profitMinor: 40_000, refundRate: 0, costCoverage: 1 });
    expect(a.margin).toBeCloseTo(40_000 / 60_000, 10);
    expect(c).toMatchObject({ netRevenueMinor: 9000, profitMinor: 3000 });
    expect(c.margin).toBeCloseTo(1 / 3, 10);
    expect(c.refundRate).toBeCloseTo(0.1, 10);
    expect(b.refundRate).toBeCloseTo(0.1, 10);
  });

  it("gives profit no figure, not zero, where no cost is known", () => {
    const b = table.rows[1];
    expect(b.profitMinor).toBeNull();
    expect(b.margin).toBeNull();
    expect(b.profitShare).toBeNull();
    expect(b.costCoverage).toBe(0);
  });

  it("shares revenue so it adds up to one, with a cumulative curve", () => {
    expect(table.rows.map((r) => r.revenueShare)).toEqual([0.6, 0.3, 0.1]);
    expect(table.rows.map((r) => r.cumulativeShare)).toEqual([0.6, 0.9, 1]);
    expect(table.rows.reduce((s, r) => s + (r.revenueShare ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("shares only the profit that is known", () => {
    // 40 000 and 3 000 of 43 000.
    const [a, , c] = table.rows;
    expect(a.profitShare).toBeCloseTo(40_000 / 43_000, 10);
    expect(c.profitShare).toBeCloseTo(3000 / 43_000, 10);
  });

  it("totals the table and says how much of revenue it covers", () => {
    expect(table.totals).toEqual({ revenueMinor: 100_000, refundsMinor: 4000, units: 70, cogsMinor: 26_000, profitMinor: 43_000 });
    // The rest of 110 000 is shipping income and lines with no product.
    expect(table.shareOfRevenue).toBeCloseTo(100_000 / 110_000, 10);
  });

  it("breaks ties by name, then id, so the order is stable", () => {
    const t = productTable([row("2", { name: "B", revenueMinor: 100 }), row("1", { name: "A", revenueMinor: 100 }), row("0", { name: "A", revenueMinor: 100 })], { revenueMinor: 300 });
    expect(t.rows.map((r) => r.productId)).toEqual(["0", "1", "2"]);
    expect(t.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("is empty without products", () => {
    const t = productTable([], { revenueMinor: 0 });
    expect(t.rows).toEqual([]);
    expect(t.totals).toEqual({ revenueMinor: 0, refundsMinor: 0, units: 0, cogsMinor: 0, profitMinor: null });
    expect(t.shareOfRevenue).toBeNull();
  });

  it("has no shares when nothing was sold", () => {
    const t = productTable([row("a"), row("b")], { revenueMinor: 0 });
    expect(t.rows.every((r) => r.revenueShare === null && r.cumulativeShare === null && r.refundRate === null && r.costCoverage === null)).toBe(true);
  });

  it("has no profit share when the profit is a loss in total", () => {
    const t = productTable([row("a", { revenueMinor: 1000, cogsMinor: 2000, knownCostRevenueMinor: 1000 }), row("b", { revenueMinor: 500, cogsMinor: 100, knownCostRevenueMinor: 500 })], { revenueMinor: 1500 });
    expect(t.totals.profitMinor).toBe(-600);
    expect(t.rows.every((r) => r.profitShare === null)).toBe(true);
    expect(t.rows[0].profitMinor).toBe(-1000 + 0); // revenue 1000 − cost 2000
    expect(t.rows[0].margin).toBeCloseTo(-1, 10);
  });

  it("has no margin on a product refunded in full", () => {
    const t = productTable([row("a", { revenueMinor: 1000, refundsMinor: 1000, cogsMinor: 400, knownCostRevenueMinor: 1000 })], { revenueMinor: 1000 });
    expect(t.rows[0].profitMinor).toBe(-400);
    expect(t.rows[0].margin).toBeNull();
    expect(t.rows[0].refundRate).toBe(1);
  });

  it("reports partial cost coverage per product", () => {
    const t = productTable([row("a", { revenueMinor: 1000, cogsMinor: 300, knownCostRevenueMinor: 600 })], { revenueMinor: 1000 });
    expect(t.rows[0].costCoverage).toBe(0.6);
  });

  it("does not change its input", () => {
    const input = [row("b", { revenueMinor: 1 }), row("a", { revenueMinor: 2 })];
    productTable(input, { revenueMinor: 3 });
    expect(input.map((r) => r.productId)).toEqual(["b", "a"]);
  });
});

describe("paretoSummary", () => {
  const make = (revenues: number[]) =>
    productTable(
      revenues.map((r, i) => row(String(i), { revenueMinor: r })),
      { revenueMinor: revenues.reduce((a, b) => a + b, 0) },
    );

  it("counts the smallest set reaching 80 % of revenue", () => {
    // Ten products: the first two make exactly 80 of 100.
    const s = paretoSummary(make([50, 30, 5, 5, 4, 2, 1, 1, 1, 1]))!;
    expect(s.topCount).toBe(2);
    expect(s.products).toBe(10);
    expect(s.topShareOfProducts).toBeCloseTo(0.2, 10);
    expect(s.revenueShare).toBeCloseTo(0.8, 10);
    expect(s.text).toBe("20 % of products make 80 % of revenue");
  });

  it("goes on until the threshold is reached, not before", () => {
    const s = paretoSummary(make([40, 30, 9, 8, 7, 6]))!;
    // 40 + 30 = 70 < 80; + 9 = 79 < 80; + 8 = 87.
    expect(s.topCount).toBe(4);
    expect(s.revenueShare).toBeCloseTo(0.87, 10);
    expect(s.text).toBe("67 % of products make 87 % of revenue");
  });

  it("reaches the threshold exactly", () => {
    expect(paretoSummary(make([80, 5, 5, 5, 5]))!.topCount).toBe(1);
  });

  it("takes one product that makes everything", () => {
    const s = paretoSummary(make([100, 0, 0, 0, 0, 0]))!;
    expect(s.products).toBe(1);
    expect(s.topCount).toBe(1);
    expect(s.text).toBeNull();
  });

  it("has all products when sales are even", () => {
    const s = paretoSummary(make([10, 10, 10, 10, 10]))!;
    expect(s.topCount).toBe(4);
    expect(s.text).toBe("80 % of products make 80 % of revenue");
  });

  it("says nothing about a handful of products", () => {
    const s = paretoSummary(make([50, 30, 20]))!;
    expect(s.topCount).toBe(2);
    expect(s.text).toBeNull();
  });

  it("is null without revenue or products, and ignores products with none", () => {
    expect(paretoSummary(make([]))).toBeNull();
    expect(paretoSummary(make([0, 0]))).toBeNull();
    expect(paretoSummary(make([100, 0, 0, 0]))!.products).toBe(1);
  });

  it("takes a plain list of rows and another threshold", () => {
    const table = make([50, 30, 10, 5, 5]);
    expect(paretoSummary(table.rows, 0.5)!.topCount).toBe(1);
    expect(paretoSummary(table, 0.5)!.threshold).toBe(0.5);
    expect(paretoSummary(table.rows, 1)!.topCount).toBe(5);
  });
});

describe("allocateRefund", () => {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it("splits by what each line was sold for", () => {
    expect(allocateRefund(1000, [{ amountMinor: 3000 }, { amountMinor: 1000 }])).toEqual([750, 250]);
    expect(allocateRefund(500, [{ amountMinor: 100 }])).toEqual([500]);
  });

  it("always adds up exactly (largest remainder)", () => {
    const parts = allocateRefund(100, [{ amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 1 }]);
    expect(sum(parts)).toBe(100);
    // 33.33 each: the one extra unit goes to the first line.
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateRefund(2, [{ amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 1 }])).toEqual([1, 1, 0]);
    expect(allocateRefund(1, [{ amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 1 }])).toEqual([1, 0, 0]);
  });

  it("gives the extra units to the biggest fractions", () => {
    // 10 over 5, 3, 2 (of 10): exact 5, 3, 2.
    expect(allocateRefund(10, [{ amountMinor: 5 }, { amountMinor: 3 }, { amountMinor: 2 }])).toEqual([5, 3, 2]);
    // 7 over 1, 1, 8 (of 10): 0.7, 0.7, 5.6 → floors 0, 0, 5 leave 2; fractions .7 .7 .6 → first two.
    expect(allocateRefund(7, [{ amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 8 }])).toEqual([1, 1, 5]);
    // 5 over 1, 2 (of 3): 1.67, 3.33 → floors 1, 3 leave 1 for the bigger fraction (the first).
    expect(allocateRefund(5, [{ amountMinor: 1 }, { amountMinor: 2 }])).toEqual([2, 3]);
  });

  it("sums exactly over many shapes", () => {
    for (const refund of [0, 1, 7, 99, 100, 12_345, 999_999]) {
      for (const lines of [[1], [1, 1], [3, 5, 7], [1, 1, 1, 1, 1, 1, 1], [100, 1], [0, 5, 0, 5], [999, 1, 333]]) {
        const parts = allocateRefund(refund, lines.map((amountMinor) => ({ amountMinor })));
        expect(sum(parts), JSON.stringify([refund, lines])).toBe(refund);
        expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
      }
    }
  });

  it("gives free lines nothing when others were paid for", () => {
    expect(allocateRefund(100, [{ amountMinor: 0 }, { amountMinor: 50 }, { amountMinor: 0 }])).toEqual([0, 100, 0]);
    expect(allocateRefund(5, [{ amountMinor: 0 }, { amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 0 }])).toEqual([0, 3, 2, 0]);
  });

  it("spreads over free lines evenly rather than losing the refund", () => {
    expect(allocateRefund(100, [{ amountMinor: 0 }, { amountMinor: 0 }])).toEqual([50, 50]);
    expect(allocateRefund(101, [{ amountMinor: 0 }, { amountMinor: 0 }])).toEqual([51, 50]);
  });

  it("treats negative and broken amounts as free", () => {
    expect(allocateRefund(100, [{ amountMinor: -50 }, { amountMinor: 50 }, { amountMinor: NaN }])).toEqual([0, 100, 0]);
  });

  it("allocates nothing to no lines and zero to a zero refund", () => {
    expect(allocateRefund(100, [])).toEqual([]);
    expect(allocateRefund(0, [{ amountMinor: 1 }, { amountMinor: 2 }])).toEqual([0, 0]);
    expect(allocateRefund(0, [{ amountMinor: 1 }]).every((n) => Object.is(n, 0))).toBe(true);
  });

  it("splits a negative refund the same way, negative", () => {
    expect(allocateRefund(-100, [{ amountMinor: 1 }, { amountMinor: 1 }, { amountMinor: 1 }])).toEqual([-34, -33, -33]);
  });

  it("stays exact with huge amounts, where a float would not", () => {
    // refund × weight is over 2^53 here.
    const big = 900_000_000_000;
    const parts = allocateRefund(big, [{ amountMinor: big }, { amountMinor: big - 1 }, { amountMinor: 7 }]);
    expect(sum(parts)).toBe(big);
    expect(parts.every(Number.isSafeInteger)).toBe(true);
  });

  it("refuses a refund that is not a whole number", () => {
    expect(() => allocateRefund(10.5, [{ amountMinor: 1 }])).toThrow(RangeError);
    expect(() => allocateRefund(NaN, [{ amountMinor: 1 }])).toThrow(RangeError);
  });
});
