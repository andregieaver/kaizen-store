import { describe, expect, it } from "vitest";

import { vatIncluded } from "./checkout";
import {
  DRAFT_PROBLEMS,
  blockingProblems,
  draftProblemText,
  draftProblems,
  hasCustomPrice,
  looksLikeEmail,
  percentOff,
  priceDraft,
  rateShipping,
  repriceForMarket,
  shareAmount,
  type DraftLineInput,
  type DraftPricingInput,
  type DraftTaxBasket,
  type DraftTaxOutcome,
} from "./draft-order";
import { DRAFT_PRICE_MAX_MINOR } from "./order-limits";
import { basketShipping } from "./subscriptions";
import { reliefFor } from "./vat-relief";

/** The tax decision of a cart, from the same building blocks `decideTax()` uses (`reliefFor()` over `vatIncluded()`); a standard or a reverse-charge treatment. */
function taxWith(opts: { shippingRate?: number; reverseCharge?: boolean } = {}) {
  return (basket: DraftTaxBasket): DraftTaxOutcome => {
    const shippingRate = opts.shippingRate ?? 0.25;
    const result = reliefFor({
      lines: basket.lines.map((l) => ({ key: l.key, totalMinor: l.totalMinor, rate: l.rate })),
      shippingMinor: basket.shippingMinor,
      shippingRate,
      reverseCharge: opts.reverseCharge ?? false,
    });
    return { taxMinor: result.taxMinor, reliefMinor: result.reliefMinor, shippingRate, decision: { kind: opts.reverseCharge ? "reverse_charge" : "standard", reverseCharge: opts.reverseCharge ?? false }, result };
  };
}

const line = (key: string, unit: number, quantity = 1, over: Partial<DraftLineInput> = {}): DraftLineInput => ({ key, kind: "goods", unitPriceMinor: unit, quantity, rate: 0.25, physical: true, ...over });
const input = (lines: DraftLineInput[], over: Partial<DraftPricingInput> = {}): DraftPricingInput => ({
  lines,
  discount: null,
  shipping: { kind: "rate", rate: { amountMinor: 5900, freeOverMinor: null } },
  currency: "NOK",
  ...over,
});
const price = (i: DraftPricingInput, tax = taxWith()) => priceDraft(i, tax);

describe("pricing a draft without a discount", () => {
  it("adds the goods, the market's shipping and the VAT as a cart does", () => {
    const p = price(input([line("a", 12999, 3), line("b", 4950, 1, { rate: 0.15 })]));
    expect(p.ok).toBe(true);
    expect(p.subtotalMinor).toBe(12999 * 3 + 4950);
    expect(p.shippingMinor).toBe(5900);
    expect(p.discountMinor).toBe(0);
    expect(p.totalMinor).toBe(p.subtotalMinor + 5900);
    expect(p.taxMinor).toBe(vatIncluded(12999 * 3, 0.25) + vatIncluded(4950, 0.15) + vatIncluded(5900, 0.25));
    expect(p.dueNowMinor).toBe(p.totalMinor);
    expect(p.lines.map((l) => [l.goodsMinor, l.discountMinor, l.totalMinor, l.taxMinor])).toEqual([
      [38997, 0, 38997, vatIncluded(38997, 0.25)],
      [4950, 0, 4950, vatIncluded(4950, 0.15)],
    ]);
    expect(p.vatPerRate.map((r) => r.rate)).toEqual([0.25, 0.15]);
  });

  it("agrees with the cart for the same goods: subtotal, shipping, VAT and total, in a krone market and a euro view", () => {
    const cases: { currency: string; unit: number; qty: number; rate: { amountMinor: number; freeOverMinor: number | null } }[] = [
      { currency: "NOK", unit: 24900, qty: 2, rate: { amountMinor: 5900, freeOverMinor: 50000 } },
      { currency: "NOK", unit: 24900, qty: 1, rate: { amountMinor: 5900, freeOverMinor: 50000 } },
      // The same goods in a euro view: the prices and the rate are shown amounts in euro cents, odd ones.
      { currency: "EUR", unit: 2137, qty: 3, rate: { amountMinor: 504, freeOverMinor: 4274 } },
      { currency: "EUR", unit: 2137, qty: 1, rate: { amountMinor: 504, freeOverMinor: 4274 } },
    ];
    for (const c of cases) {
      const lines = [line("a", c.unit, c.qty), line("b", 999, 1, { rate: 0.15 })];
      const draft = price(input(lines, { currency: c.currency, shipping: { kind: "rate", rate: c.rate } }));
      // What cartSummary() does: shipping by basketShipping() on the lines' totals before discounts, VAT per line and on shipping, total = subtotal + shipping.
      const cartLines = lines.map((l) => ({ totalMinor: l.unitPriceMinor * l.quantity, delivery: "physical" as const, recurring: false }));
      const subtotal = cartLines.reduce((s, l) => s + l.totalMinor, 0);
      const shipping = basketShipping(cartLines, c.rate).first;
      const tax = lines.reduce((s, l) => s + vatIncluded(l.unitPriceMinor * l.quantity, l.rate), 0) + vatIncluded(shipping, 0.25);
      expect([draft.subtotalMinor, draft.shippingMinor, draft.taxMinor, draft.totalMinor], `${c.currency} x${c.qty}`).toEqual([subtotal, shipping, tax, subtotal + shipping]);
    }
  });

  it("charges no shipping for a basket with nothing to ship, whatever the choice", () => {
    const p = price(input([line("svc", 20000, 1, { kind: "custom", physical: false })], { shipping: { kind: "custom", amountMinor: 9900 } }));
    expect(p.shippingMinor).toBe(0);
    expect(p.totalMinor).toBe(20000);
    expect(price(input([line("svc", 20000, 1, { physical: false })], { shipping: { kind: "rate", rate: null } })).ok).toBe(true);
  });

  it("charges the market's rate, nothing for free shipping and what staff typed for a price they set", () => {
    const goods = [line("a", 10000)];
    expect(price(input(goods)).shippingMinor).toBe(5900);
    expect(price(input(goods, { shipping: { kind: "free" } })).shippingMinor).toBe(0);
    expect(price(input(goods, { shipping: { kind: "custom", amountMinor: 12345 } })).shippingMinor).toBe(12345);
    expect(price(input(goods, { shipping: { kind: "custom", amountMinor: 0 } })).shippingMinor).toBe(0);
  });

  it("makes shipping free over the market's limit, counting every line as the cart does, and exactly at the limit", () => {
    const rate = { amountMinor: 5900, freeOverMinor: 50000 };
    expect(price(input([line("a", 49999)], { shipping: { kind: "rate", rate } })).shippingMinor).toBe(5900);
    expect(price(input([line("a", 50000)], { shipping: { kind: "rate", rate } })).shippingMinor).toBe(0);
    // A custom service item counts towards the limit, as a service line does in a cart.
    expect(price(input([line("a", 30000), line("svc", 20000, 1, { kind: "custom", physical: false })], { shipping: { kind: "rate", rate } })).shippingMinor).toBe(0);
  });

  it("keeps a custom price as the price charged, with no discount anywhere", () => {
    // A catalogue line listed at 9,000 sold at a custom 5,000: the price is 5,000 and the order shows no reduction.
    const p = price(input([line("a", 5000, 2)]));
    expect(p.lines[0]).toMatchObject({ unitPriceMinor: 5000, goodsMinor: 10000, discountMinor: 0, staffDiscountMinor: 0, totalMinor: 10000 });
    expect(p.discountMinor).toBe(0);
    expect(p.staffDiscountMinor).toBe(0);
  });

  it("prices a line at 0 and a draft whose goods are 0 but whose shipping is not", () => {
    const p = price(input([line("a", 0, 5)]));
    expect(p.ok).toBe(true);
    expect(p.subtotalMinor).toBe(0);
    expect(p.totalMinor).toBe(5900);
  });
});

describe("the staff discount", () => {
  it("takes a percent off each line, half up to the minor unit, and the order's discount is the sum of the lines'", () => {
    // 5 %: 1,001 gives 50.05 (50), 1,010 gives 50.5 (51, half up), 1,009 gives 50.45 (50).
    const p = price(input([line("a", 1001), line("b", 1010), line("c", 1009)], { discount: { kind: "percent", bps: 500, label: "Friend" }, shipping: { kind: "free" } }));
    expect(p.lines.map((l) => l.staffDiscountMinor)).toEqual([50, 51, 50]);
    expect(p.staffDiscountMinor).toBe(151);
    expect(p.discountMinor).toBe(151);
    expect(p.totalMinor).toBe(1001 + 1010 + 1009 - 151);
    expect(p.staffDiscountLabel).toBe("Friend");
  });

  it("rounds the percent boundary: 0.01 % and 100 %", () => {
    expect(percentOff(10000, 1)).toBe(1);
    expect(percentOff(4999, 1)).toBe(0);
    expect(percentOff(5000, 1)).toBe(1);
    expect(percentOff(12345, 10000)).toBe(12345);
    expect(percentOff(0, 5000)).toBe(0);
    // Exact in integers at the largest sums a draft can hold.
    const big = DRAFT_PRICE_MAX_MINOR * 9999;
    expect(percentOff(big, 3333)).toBe(Number((BigInt(big) * BigInt(3333) + BigInt(5000)) / BigInt(10000)));
  });

  it("takes 100 percent: the goods are free and a draft with free shipping has nothing to pay", () => {
    const p = price(input([line("a", 12345)], { discount: { kind: "percent", bps: 10000, label: "Gift" }, shipping: { kind: "free" } }));
    expect(p.lines[0].totalMinor).toBe(0);
    expect(p.totalMinor).toBe(0);
    expect(p.ok).toBe(false);
    expect(p.problems.map((x) => x.code)).toContain("total_zero");
  });

  it("shares an amount over the lines by the largest remainder, ties to the earlier line, so the lines add up exactly", () => {
    expect(shareAmount([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(shareAmount([1, 1, 1], 2)).toEqual([1, 1, 0]);
    expect(shareAmount([3, 7], 5)).toEqual([2, 3]);
    expect(shareAmount([3, 7], 4)).toEqual([1, 3]);
    expect(shareAmount([3, 7], 10)).toEqual([3, 7]);
    expect(shareAmount([5, 0, 5], 3)).toEqual([2, 0, 1]);
    expect(shareAmount([0, 0], 0)).toEqual([0, 0]);
  });

  it("never gives a line more than its goods, and the shares always add up to the amount (a property over many cases)", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 400; i++) {
      const goods = Array.from({ length: 1 + rnd(8) }, () => (rnd(5) === 0 ? 0 : rnd(100_000)));
      const total = goods.reduce((s, g) => s + g, 0);
      if (total === 0) continue;
      const amount = 1 + rnd(total);
      const shares = shareAmount(goods, amount);
      expect(shares.reduce((s, x) => s + x, 0), `${goods} / ${amount}`).toBe(amount);
      shares.forEach((s, j) => {
        expect(s, `${goods} / ${amount} line ${j}`).toBeGreaterThanOrEqual(0);
        expect(s, `${goods} / ${amount} line ${j}`).toBeLessThanOrEqual(goods[j]);
      });
      // A line with no goods gets nothing.
      goods.forEach((g, j) => g === 0 && expect(shares[j]).toBe(0));
    }
  });

  it("prices an amount discount: the order's discount is the amount, no VAT is lost and the label is kept", () => {
    const p = price(input([line("a", 10000, 1), line("b", 5000, 2, { rate: 0.15 })], { discount: { kind: "amount", minor: 3333, label: "Loyal customer" } }));
    expect(p.staffDiscountMinor).toBe(3333);
    expect(p.lines.reduce((s, l) => s + l.staffDiscountMinor, 0)).toBe(3333);
    expect(p.totalMinor).toBe(20000 - 3333 + 5900);
    // VAT is on what is left to pay, line by line and on the shipping.
    expect(p.taxMinor).toBe(p.lines.reduce((s, l) => s + vatIncluded(l.totalMinor, l.rate), 0) + vatIncluded(5900, 0.25));
    expect(p.staffDiscountLabel).toBe("Loyal customer");
  });

  it("refuses an amount over the goods, and takes an amount equal to them", () => {
    const over = price(input([line("a", 1000)], { discount: { kind: "amount", minor: 1001, label: "x" } }));
    expect(over.ok).toBe(false);
    expect(over.problems.map((x) => x.code)).toContain("discount_over_goods");
    const equal = price(input([line("a", 1000)], { discount: { kind: "amount", minor: 1000, label: "x" } }));
    expect(equal.lines[0].totalMinor).toBe(0);
    expect(equal.totalMinor).toBe(5900);
    expect(equal.ok).toBe(true);
  });

  it("judges free shipping before the discount, as the checkout does", () => {
    const rate = { amountMinor: 5900, freeOverMinor: 50000 };
    const p = price(input([line("a", 60000)], { shipping: { kind: "rate", rate }, discount: { kind: "percent", bps: 5000, label: "Half" } }));
    expect(p.shippingMinor).toBe(0);
    expect(p.totalMinor).toBe(30000);
  });

  it("never discounts shipping: the staff discount is on the goods only", () => {
    const p = price(input([line("a", 10000)], { discount: { kind: "percent", bps: 10000, label: "Free goods" } }));
    expect(p.shippingMinor).toBe(5900);
    expect(p.totalMinor).toBe(5900);
    expect(p.staffDiscountMinor).toBe(10000);
  });

  it("works in a euro view too: odd cents, three lines, a euro rate", () => {
    const p = price(input([line("a", 2137, 3), line("b", 999, 2, { rate: 0.15 }), line("c", 4999)], { currency: "EUR", discount: { kind: "percent", bps: 750, label: "Welcome" }, shipping: { kind: "rate", rate: { amountMinor: 504, freeOverMinor: 15000 } } }));
    const off = [percentOff(6411, 750), percentOff(1998, 750), percentOff(4999, 750)];
    expect(p.lines.map((l) => l.staffDiscountMinor)).toEqual(off);
    expect(p.totalMinor).toBe(6411 + 1998 + 4999 + 504 - off.reduce((s, x) => s + x, 0));
  });
});

describe("VAT, and the VAT not charged", () => {
  it("is the decision's: per line at its rate, shipping at the shipping rate", () => {
    const p = price(input([line("a", 10000, 1, { rate: 0.25 }), line("b", 10000, 1, { rate: 0 })]), taxWith({ shippingRate: 0.12 }));
    expect(p.lines.map((l) => l.taxMinor)).toEqual([vatIncluded(10000, 0.25), 0]);
    expect(p.taxMinor).toBe(vatIncluded(10000, 0.25) + vatIncluded(5900, 0.12));
    expect(p.tax?.shippingRate).toBe(0.12);
  });

  it("calls the decision with the lines after the staff discount and the shipping, once, never for a basket it cannot price", () => {
    const seen: DraftTaxBasket[] = [];
    priceDraft(input([line("a", 10000)], { discount: { kind: "percent", bps: 1000, label: "x" } }), (b) => {
      seen.push(b);
      return taxWith()(b);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].lines[0]).toMatchObject({ key: "a", totalMinor: 9000, rate: 0.25, booking: false, physical: true, recurring: false, host: false });
    expect(seen[0].shippingMinor).toBe(5900);
    expect(seen[0].fees).toEqual([]);
    expect(seen[0].currency).toBe("NOK");
    let called = 0;
    priceDraft(input([]), (b) => {
      called += 1;
      return taxWith()(b);
    });
    expect(called).toBe(0);
  });

  it("puts the VAT not charged into the order's discount, so the total still adds up (reverse charge)", () => {
    const p = price(input([line("a", 12500, 2)]), taxWith({ reverseCharge: true }));
    const relief = vatIncluded(25000, 0.25);
    const shippingRelief = vatIncluded(5900, 0.25);
    expect(p.reliefMinor).toBe(relief + shippingRelief);
    expect(p.discountMinor).toBe(relief + shippingRelief);
    expect(p.staffDiscountMinor).toBe(0);
    expect(p.lines[0]).toMatchObject({ reliefMinor: relief, discountMinor: relief, totalMinor: 25000 - relief, taxMinor: 0 });
    expect(p.totalMinor).toBe(25000 + 5900 - relief - shippingRelief);
    expect(p.taxMinor).toBe(0);
    // The lines and the shipping net of relief are the total.
    expect(p.lines[0].totalMinor + 5900 - shippingRelief).toBe(p.totalMinor);
  });

  it("keeps the staff discount apart from the relief when both are in play", () => {
    const p = price(input([line("a", 10000)], { discount: { kind: "percent", bps: 1000, label: "x" } }), taxWith({ reverseCharge: true }));
    expect(p.staffDiscountMinor).toBe(1000);
    expect(p.discountMinor).toBe(1000 + p.reliefMinor);
    expect(p.lines[0].discountMinor).toBe(1000 + p.lines[0].reliefMinor);
    expect(p.lines[0].goodsMinor - p.lines[0].discountMinor).toBe(p.lines[0].totalMinor);
  });

  it("makes every line and the order add up, in any mix (the database's own sums)", () => {
    for (const reverse of [false, true]) {
      const p = price(input([line("a", 3333, 3), line("b", 777, 7, { rate: 0.15 }), line("c", 1, 1, { rate: 0 })], { discount: { kind: "amount", minor: 4001, label: "x" } }), taxWith({ reverseCharge: reverse }));
      for (const l of p.lines) expect(l.goodsMinor - l.discountMinor, `${reverse}`).toBe(l.totalMinor);
      expect(p.subtotalMinor + p.shippingMinor - p.discountMinor).toBe(p.totalMinor);
      expect(p.lines.reduce((s, l) => s + l.discountMinor, 0) + (reverse ? vatIncluded(5900, 0.25) : 0)).toBe(p.discountMinor);
      expect(p.staffDiscountMinor).toBeLessThanOrEqual(p.discountMinor);
    }
  });
});

describe("what is refused, in words", () => {
  const codes = (p: { problems: { code: string }[] }) => p.problems.map((x) => x.code);

  it("refuses no lines and more than 100", () => {
    expect(codes(price(input([])))).toEqual(["no_lines"]);
    expect(codes(price(input(Array.from({ length: 101 }, (_, i) => line(`l${i}`, 100)))))).toEqual(["too_many_lines"]);
    expect(price(input(Array.from({ length: 100 }, (_, i) => line(`l${i}`, 100)))).ok).toBe(true);
  });

  it("refuses a quantity that is not 1 to 9,999 and a price that is negative, fractional or over the limit, naming the line", () => {
    for (const q of [0, -1, 1.5, 10_000, Number.NaN]) {
      const p = price(input([line("a", 100, q)]));
      expect(p.problems, String(q)).toEqual([{ code: "quantity_invalid", key: "a", blocking: true }]);
      expect(p.totalMinor).toBe(0);
    }
    for (const unit of [-1, 1.5, DRAFT_PRICE_MAX_MINOR + 1, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(codes(price(input([line("a", unit)]))), String(unit)).toContain("price_invalid");
    }
    expect(price(input([line("a", DRAFT_PRICE_MAX_MINOR, 9999)])).ok).toBe(true);
  });

  it("refuses a discount that is not a percent of 0.01 to 100, an amount of 0 or less, or has no name the buyer sees", () => {
    const bad = (discount: DraftPricingInput["discount"]) => codes(price(input([line("a", 10000)], { discount })));
    expect(bad({ kind: "percent", bps: 0, label: "x" })).toContain("discount_invalid");
    expect(bad({ kind: "percent", bps: 10001, label: "x" })).toContain("discount_invalid");
    expect(bad({ kind: "percent", bps: 12.5, label: "x" })).toContain("discount_invalid");
    expect(bad({ kind: "amount", minor: 0, label: "x" })).toContain("discount_invalid");
    expect(bad({ kind: "amount", minor: -5, label: "x" })).toContain("discount_invalid");
    expect(bad({ kind: "percent", bps: 500, label: "" })).toContain("discount_label_invalid");
    expect(bad({ kind: "percent", bps: 500, label: "   " })).toContain("discount_label_invalid");
    expect(bad({ kind: "percent", bps: 500, label: "x".repeat(61) })).toContain("discount_label_invalid");
    expect(bad({ kind: "percent", bps: 500, label: "x".repeat(60) })).toEqual([]);
  });

  it("refuses shipping that cannot be worked out: no rate for the market, a bad custom price", () => {
    expect(codes(price(input([line("a", 100)], { shipping: { kind: "rate", rate: null } })))).toEqual(["shipping_rate_missing"]);
    expect(codes(price(input([line("a", 100)], { shipping: { kind: "custom", amountMinor: -1 } })))).toEqual(["shipping_invalid"]);
    expect(codes(price(input([line("a", 100)], { shipping: { kind: "custom", amountMinor: 1.5 } })))).toEqual(["shipping_invalid"]);
  });

  it("refuses a total of nothing: nothing can be paid", () => {
    expect(codes(price(input([line("a", 0)], { shipping: { kind: "free" } })))).toEqual(["total_zero"]);
  });

  it("has words for every problem and tells a blocking one from a note", () => {
    for (const [code, text] of Object.entries(DRAFT_PROBLEMS)) expect(text.length, code).toBeGreaterThan(10);
    expect(draftProblemText("no_lines")).toBe("Add at least one line.");
    expect(blockingProblems([{ code: "backorder", blocking: false }, { code: "stock_short", blocking: true }])).toEqual([{ code: "stock_short", blocking: true }]);
  });
});

describe("what a draft needs that has nothing to do with money", () => {
  it("needs an email address that looks like one", () => {
    expect(draftProblems({ email: null, shippingAddress: {}, ships: false }).map((p) => p.code)).toEqual(["no_email"]);
    expect(draftProblems({ email: "  ", shippingAddress: {}, ships: false }).map((p) => p.code)).toEqual(["no_email"]);
    expect(draftProblems({ email: "kari@", shippingAddress: {}, ships: false }).map((p) => p.code)).toEqual(["invalid_email"]);
    expect(draftProblems({ email: "kari@example.com", shippingAddress: {}, ships: false })).toEqual([]);
    for (const e of ["a@b.c", "kari.nordmann+test@example.co.uk"]) expect(looksLikeEmail(e), e).toBe(true);
    for (const e of ["a b@c.d", "a@@b.c", "no-at.example.com", "a@b", ""]) expect(looksLikeEmail(e), e).toBe(false);
  });

  it("needs a shipping address when goods are shipped, and none when they are not", () => {
    const full = { line1: "Storgata 1", postalCode: "0155", city: "Oslo" };
    expect(draftProblems({ email: "a@b.no", shippingAddress: full, ships: true })).toEqual([]);
    expect(draftProblems({ email: "a@b.no", shippingAddress: { line1: "Storgata 1" }, ships: true }).map((p) => p.code)).toEqual(["no_shipping_address"]);
    expect(draftProblems({ email: "a@b.no", shippingAddress: null, ships: true }).map((p) => p.code)).toEqual(["no_shipping_address"]);
    expect(draftProblems({ email: "a@b.no", shippingAddress: {}, ships: false })).toEqual([]);
  });

  it("does not ship to another country than the market's: the VAT was decided for the market (review fix)", () => {
    const full = { line1: "Storgata 1", postalCode: "0155", city: "Oslo" };
    const base = { email: "a@b.no", ships: true, marketCode: "NO" };
    expect(draftProblems({ ...base, shippingAddress: { ...full, country: "NO" } })).toEqual([]);
    expect(draftProblems({ ...base, shippingAddress: { ...full, country: "no" } })).toEqual([]);
    expect(draftProblems({ ...base, shippingAddress: full })).toEqual([]);
    expect(draftProblems({ ...base, shippingAddress: { ...full, country: "SE" } }).map((p) => p.code)).toEqual(["shipping_country"]);
    // Nothing is shipped, so no address is held to the market.
    expect(draftProblems({ ...base, ships: false, shippingAddress: { country: "SE" } })).toEqual([]);
    expect(draftProblemText("shipping_country")).toMatch(/market/);
  });

  it("holds a custom item back from a private customer until a person decides the withdrawal of a service (review fix)", () => {
    const base = { email: "a@b.no", shippingAddress: {}, ships: false, customItems: true };
    expect(draftProblems(base).map((p) => p.code)).toEqual(["custom_consumer"]);
    expect(draftProblems({ ...base, business: true })).toEqual([]);
    expect(draftProblems({ ...base, customItems: false })).toEqual([]);
    expect(blockingProblems(draftProblems(base))).toHaveLength(1);
  });

  it("works out the market's shipping as basketShipping() does", () => {
    const lines = [line("a", 30000), line("svc", 20000, 1, { kind: "custom", physical: false })];
    expect(rateShipping(lines, [30000, 20000], { amountMinor: 5900, freeOverMinor: 50000 })).toBe(0);
    expect(rateShipping(lines, [30000, 19999], { amountMinor: 5900, freeOverMinor: 50000 })).toBe(5900);
  });
});

describe("changing a draft's market", () => {
  const goods = (key: string, unit: number, list: number | null) => ({ key, kind: "goods" as const, unitPriceMinor: unit, listPriceMinor: list });
  const custom = (key: string, unit: number) => ({ key, kind: "custom" as const, unitPriceMinor: unit, listPriceMinor: null });

  it("knows a custom price: a catalogue line whose price is not the list price it was added at", () => {
    expect(hasCustomPrice(goods("a", 5000, 9000))).toBe(true);
    expect(hasCustomPrice(goods("a", 9000, 9000))).toBe(false);
    expect(hasCustomPrice(custom("c", 5000))).toBe(false);
  });

  it("re-prices a line at the list price at the new market's list price, and says what changed", () => {
    const r = repriceForMarket([goods("a", 24900, 24900), goods("b", 1000, 1000)], { a: 2137, b: 1000 });
    expect(r.lines).toEqual([goods("a", 2137, 2137), goods("b", 1000, 1000)]);
    expect(r.changed).toEqual([{ key: "a", from: 24900, to: 2137 }]);
    expect(r.kept).toEqual([]);
    expect(r.unavailable).toEqual([]);
  });

  it("keeps a custom price and a custom item as typed, flags them, and learns the new list price", () => {
    const r = repriceForMarket([goods("a", 5000, 24900), custom("fee", 99900)], { a: 2137 });
    expect(r.lines).toEqual([goods("a", 5000, 2137), custom("fee", 99900)]);
    expect(r.kept).toEqual(["a", "fee"]);
    expect(r.changed).toEqual([]);
  });

  it("leaves a line the new market does not sell, and names it", () => {
    const r = repriceForMarket([goods("a", 24900, 24900), goods("b", 1000, 1000)], { a: null });
    expect(r.unavailable).toEqual(["a", "b"]);
    expect(r.lines).toEqual([goods("a", 24900, 24900), goods("b", 1000, 1000)]);
  });

  it("changes nothing when the market's prices are the same", () => {
    const r = repriceForMarket([goods("a", 24900, 24900)], { a: 24900 });
    expect(r.changed).toEqual([]);
    expect(r.lines[0].unitPriceMinor).toBe(24900);
  });
});
