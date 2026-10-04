import { describe, expect, it } from "vitest";

import { vatIncluded } from "./checkout";
import { carriesVat, reliefFor, vatPerRate, type ReliefInput } from "./vat-relief";

const basket = (over: Partial<ReliefInput> = {}): ReliefInput => ({
  lines: [
    { key: "a", totalMinor: 12_500, rate: 0.25 },
    { key: "b", totalMinor: 4_599, rate: 0.15 },
    { key: "c", totalMinor: 2_000, rate: 0 },
  ],
  shippingMinor: 4_900,
  shippingRate: 0.25,
  reverseCharge: false,
  ...over,
});

describe("reliefFor, the ordinary order", () => {
  it("has the VAT of every line and of the shipping, and no relief", () => {
    const r = reliefFor(basket());
    expect(r.lines.map((l) => l.taxMinor)).toEqual([2_500, 600, 0]);
    expect(r.lines.map((l) => l.totalMinor)).toEqual([12_500, 4_599, 2_000]);
    expect(r.shipping).toEqual({ rate: 0.25, totalMinor: 4_900, taxMinor: 980, reliefMinor: 0 });
    expect(r.taxMinor).toBe(2_500 + 600 + 980);
    expect(r.reliefMinor).toBe(0);
    expect(r.lines.every((l) => l.reliefMinor === 0)).toBe(true);
  });

  it("uses the rounding the order has always used", () => {
    for (const total of [1, 99, 100, 101, 999, 4_599, 12_345, 99_999]) {
      for (const rate of [0.06, 0.07, 0.12, 0.135, 0.19, 0.2, 0.21, 0.255]) {
        const r = reliefFor({ lines: [{ key: "x", totalMinor: total, rate }], shippingMinor: 0, shippingRate: 0.25, reverseCharge: false });
        expect(r.lines[0].taxMinor).toBe(vatIncluded(total, rate));
      }
    }
  });
});

describe("reliefFor, reverse charge", () => {
  const ordinary = reliefFor(basket());
  const reversed = reliefFor(basket({ reverseCharge: true }));

  it("takes every line's VAT off as relief and charges none", () => {
    expect(reversed.lines.map((l) => l.taxMinor)).toEqual([0, 0, 0]);
    expect(reversed.lines.map((l) => l.reliefMinor)).toEqual([2_500, 600, 0]);
    expect(reversed.lines.map((l) => l.totalMinor)).toEqual([10_000, 3_999, 2_000]);
    expect(reversed.shipping).toEqual({ rate: 0.25, totalMinor: 3_920, taxMinor: 0, reliefMinor: 980 });
    expect(reversed.taxMinor).toBe(0);
  });

  it("makes the total the ordinary total minus the ordinary tax, to the minor unit", () => {
    const sum = (r: typeof ordinary) => r.lines.reduce((s, l) => s + l.totalMinor, 0) + r.shipping.totalMinor;
    expect(sum(reversed)).toBe(sum(ordinary) - ordinary.taxMinor);
    expect(reversed.reliefMinor).toBe(ordinary.taxMinor);
  });

  it("holds for awkward amounts and rates, with no remainder to hand out", () => {
    for (let total = 1; total <= 3_000; total += 37) {
      for (const rate of [0.06, 0.07, 0.12, 0.135, 0.21, 0.255]) {
        const input = { lines: [{ key: "x", totalMinor: total, rate }, { key: "y", totalMinor: total + 3, rate: 0.19 }], shippingMinor: total * 2 + 1, shippingRate: rate, reverseCharge: false };
        const a = reliefFor(input);
        const b = reliefFor({ ...input, reverseCharge: true });
        const gross = total + (total + 3) + (total * 2 + 1);
        expect(b.lines.reduce((s, l) => s + l.totalMinor, 0) + b.shipping.totalMinor).toBe(gross - a.taxMinor);
        expect(b.reliefMinor).toBe(a.taxMinor);
      }
    }
  });

  it("keeps the rate that would have applied, so the relief per rate can be read", () => {
    expect(reversed.lines.map((l) => l.rate)).toEqual([0.25, 0.15, 0]);
  });

  it("has no relief on exempt goods and free shipping", () => {
    const r = reliefFor({ lines: [{ key: "a", totalMinor: 5_000, rate: 0 }], shippingMinor: 0, shippingRate: 0.25, reverseCharge: true });
    expect(r.reliefMinor).toBe(0);
    expect(r.taxMinor).toBe(0);
    expect(carriesVat(reliefFor({ lines: [{ key: "a", totalMinor: 5_000, rate: 0 }], shippingMinor: 0, shippingRate: 0.25, reverseCharge: false }))).toBe(false);
  });

  it("shipping follows its own rate", () => {
    const r = reliefFor(basket({ shippingRate: 0.15, reverseCharge: true }));
    expect(r.shipping.reliefMinor).toBe(vatIncluded(4_900, 0.15));
  });

  it("works in a currency with no decimals and with a euro view (amounts are just integers)", () => {
    // 1 250 JPY-like amounts and 10 000 HUF-like amounts: integers in, integers out
    const r = reliefFor({ lines: [{ key: "a", totalMinor: 125_000, rate: 0.27 }], shippingMinor: 150_000, shippingRate: 0.27, reverseCharge: true });
    expect(r.lines[0].totalMinor + r.shipping.totalMinor + r.reliefMinor).toBe(275_000);
    expect(Number.isInteger(r.reliefMinor)).toBe(true);
  });
});

describe("carriesVat and vatPerRate", () => {
  it("says whether there is any VAT in the order", () => {
    expect(carriesVat(reliefFor(basket()))).toBe(true);
    expect(carriesVat({ taxMinor: 0 })).toBe(false);
  });

  it("lists the VAT per rate, highest rate first, leaving out rates with nothing", () => {
    expect(vatPerRate(reliefFor(basket()), false)).toEqual([
      { rate: 0.25, taxMinor: 3_480 },
      { rate: 0.15, taxMinor: 600 },
    ]);
  });

  it("lists the relief per rate for a reverse-charge order", () => {
    expect(vatPerRate(reliefFor(basket({ reverseCharge: true })), true)).toEqual([
      { rate: 0.25, taxMinor: 3_480 },
      { rate: 0.15, taxMinor: 600 },
    ]);
    expect(vatPerRate(reliefFor(basket({ reverseCharge: true })), false)).toEqual([]);
  });
});
