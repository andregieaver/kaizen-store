import { describe, expect, it } from "vitest";

import {
  applyDiscount,
  availability,
  GENERATED_ALPHABET,
  generatedCode,
  reaches,
  normalizeCode,
  platformDiscountSummary,
  storeDiscountInput,
  type DiscountLine,
  type StoreDiscount,
} from "./discounts";

const base: StoreDiscount = {
  id: "d1",
  code: "SOMMER",
  kind: "percent",
  percent: 20,
  amounts: {},
  minSubtotals: {},
  productIds: null,
  recurring: false,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  oncePerCustomer: false,
  active: true,
  termIds: [],
  minQuantity: null,
  tierIds: [],
  customerIds: [],
  uniqueCodes: false,
};

const line = (key: string, unitMinor: number, quantity = 1, extra: Partial<DiscountLine> = {}): DiscountLine => ({
  key,
  productId: `p-${key}`,
  unitMinor,
  quantity,
  todayMinor: unitMinor * quantity,
  recurring: false,
  ...extra,
});

const context = { now: new Date("2026-06-01T12:00:00Z"), used: 0, usedByCustomer: 0, signedIn: false, marketCode: "NO" };

describe("normalizeCode", () => {
  it("ignores case and spaces", () => {
    expect(normalizeCode(" sommer 25 ")).toBe("SOMMER25");
  });
});

describe("availability", () => {
  it("checks the switch, dates, uses and sign-in", () => {
    expect(availability(base, context)).toBeNull();
    expect(availability({ ...base, active: false }, context)).toBe("inactive");
    expect(availability({ ...base, startsAt: "2026-07-01T00:00:00Z" }, context)).toBe("not_started");
    expect(availability({ ...base, endsAt: "2026-06-01T12:00:00Z" }, context)).toBe("ended");
    expect(availability({ ...base, usageLimit: 3 }, { ...context, used: 3 })).toBe("used_up");
    expect(availability({ ...base, oncePerCustomer: true }, context)).toBe("sign_in");
    expect(availability({ ...base, oncePerCustomer: true }, { ...context, signedIn: true, usedByCustomer: 1 })).toBe(
      "already_used",
    );
    expect(availability({ ...base, kind: "fixed", amounts: { SE: 5000 } }, context)).toBe("market");
  });
});

describe("applyDiscount", () => {
  it("takes a percentage off each unit", () => {
    const result = applyDiscount(base, { marketCode: "NO", lines: [line("a", 24900, 2), line("b", 12900)], shippingMinor: 9900 });
    expect(result).toEqual({
      ok: true,
      applied: { lines: { a: 9960, b: 2580 }, shippingMinor: 0, totalMinor: 12540, renewalUnits: {} },
    });
  });

  it("only touches the products it is for", () => {
    const result = applyDiscount({ ...base, productIds: ["p-b"] }, {
      marketCode: "NO",
      lines: [line("a", 24900), line("b", 12900)],
      shippingMinor: 0,
    });
    expect(result.ok && result.applied.lines).toEqual({ b: 2580 });
    expect(applyDiscount({ ...base, productIds: ["p-x"] }, { marketCode: "NO", lines: [line("a", 100)], shippingMinor: 0 })).toEqual({
      ok: false,
      problem: "not_applicable",
    });
  });

  it("spreads a fixed amount in proportion, adding up exactly, never below zero", () => {
    const fixed = { ...base, kind: "fixed" as const, amounts: { NO: 10000 } };
    const result = applyDiscount(fixed, { marketCode: "NO", lines: [line("a", 10001), line("b", 20002), line("c", 3)], shippingMinor: 0 });
    if (!result.ok) throw new Error(result.problem);
    expect(Object.values(result.applied.lines).reduce((s, v) => s + v, 0)).toBe(10000);
    expect(result.applied.lines.b).toBeGreaterThan(result.applied.lines.a);
    const small = applyDiscount(fixed, { marketCode: "NO", lines: [line("a", 4900)], shippingMinor: 9900 });
    expect(small.ok && small.applied).toMatchObject({ lines: { a: 4900 }, totalMinor: 4900 });
  });

  it("gives free shipping today, and only when there is shipping", () => {
    const free = { ...base, kind: "free_shipping" as const };
    expect(applyDiscount(free, { marketCode: "NO", lines: [line("a", 100)], shippingMinor: 9900 })).toMatchObject({
      ok: true,
      applied: { shippingMinor: 9900, totalMinor: 9900 },
    });
    expect(applyDiscount(free, { marketCode: "NO", lines: [line("a", 100)], shippingMinor: 0 })).toEqual({
      ok: false,
      problem: "not_applicable",
    });
  });

  it("needs the minimum order", () => {
    const min = { ...base, minSubtotals: { NO: 50000 } };
    expect(applyDiscount(min, { marketCode: "NO", lines: [line("a", 49999)], shippingMinor: 0 })).toEqual({
      ok: false,
      problem: "minimum",
    });
    expect(applyDiscount(min, { marketCode: "SE", lines: [line("a", 100)], shippingMinor: 0 }).ok).toBe(true);
  });

  it("lowers a subscription's renewals too when the percentage recurs, even in a free trial", () => {
    const recurring = { ...base, recurring: true };
    const sub = line("s", 11610, 2, { recurring: true });
    expect(applyDiscount(recurring, { marketCode: "NO", lines: [sub], shippingMinor: 0 })).toEqual({
      ok: true,
      applied: { lines: { s: 4644 }, shippingMinor: 0, totalMinor: 4644, renewalUnits: { s: 9288 } },
    });
    const trial = line("s", 11610, 1, { recurring: true, todayMinor: 0 });
    expect(applyDiscount(recurring, { marketCode: "NO", lines: [trial], shippingMinor: 0 })).toEqual({
      ok: true,
      applied: { lines: {}, shippingMinor: 0, totalMinor: 0, renewalUnits: { s: 9288 } },
    });
    // Without recurring, a trial has nothing to take off today.
    expect(applyDiscount(base, { marketCode: "NO", lines: [trial], shippingMinor: 0 }).ok).toBe(false);
  });
});

describe("the admin's input", () => {
  it("normalises the code and checks the dates and products", () => {
    expect(storeDiscountInput.parse({ code: "vår-25", kind: "percent", percent: "25" })).toMatchObject({
      code: "VÅR-25",
    });
  });
});

describe("platformDiscountSummary", () => {
  const money = (minor: number, currency: string) => `${minor / 100} ${currency}`;
  it("says what a plan's code gives, and for how long", () => {
    expect(platformDiscountSummary({ kind: "percent", percent: 20, amounts: {}, duration: "repeating", durationMonths: 3 }, money)).toBe(
      "20 % off for 3 months",
    );
    expect(platformDiscountSummary({ kind: "fixed", percent: 0, amounts: { nok: 10000 }, duration: "once", durationMonths: null }, money)).toBe(
      "100 NOK off the first payment",
    );
  });
});

describe("a percentage code on a line a campaign has reduced (D114)", () => {
  it("comes off what is left, not off whole units", () => {
    // Three at 100 with one free: 200 left. 20 % of 200 is 40.
    const reduced = line("a", 10000, 3, { todayMinor: 20000 });
    const result = applyDiscount(base, { marketCode: "NO", lines: [reduced, line("b", 5000)], shippingMinor: 0 });
    expect(result).toMatchObject({ ok: true, applied: { lines: { a: 4000, b: 1000 } } });
  });

  it("takes nothing from a free product", () => {
    const gift = line("g", 5000, 1, { todayMinor: 0 });
    const result = applyDiscount(base, { marketCode: "NO", lines: [gift, line("b", 5000)], shippingMinor: 0 });
    expect(result).toMatchObject({ ok: true, applied: { lines: { b: 1000 } } });
  });
});


describe("codes in depth (D299 E1)", () => {
  const now = new Date();
  const ctx = { now, used: 0, usedByCustomer: 0, signedIn: true, marketCode: "NO" };

  it("reach a product by its terms, beside chosen products, and everything with neither", () => {
    expect(reaches(base, "p1")).toBe(true);
    const byTerm = { ...base, productIds: null, termIds: ["t1"] };
    expect(reaches(byTerm, "p1", new Set(["p1"]))).toBe(true);
    expect(reaches(byTerm, "p2", new Set(["p1"]))).toBe(false);
    const both = { ...base, productIds: ["p3"], termIds: ["t1"] };
    expect(reaches(both, "p3", new Set())).toBe(true);
    const applied = applyDiscount(byTerm, { marketCode: "NO", lines: [line("a", 10000, 1, { productId: "p1" }), line("b", 10000, 1, { productId: "p2" })], shippingMinor: 0, reached: new Set(["p1"]) });
    expect(applied.ok && applied.applied.lines).toEqual({ a: 2000 });
  });

  it("need the least units of what they reach, bought once", () => {
    const three = { ...base, minQuantity: 3 };
    expect(applyDiscount(three, { marketCode: "NO", lines: [line("a", 10000, 2)], shippingMinor: 0 })).toEqual({ ok: false, problem: "minimum_quantity" });
    expect(applyDiscount(three, { marketCode: "NO", lines: [line("a", 10000, 2), line("b", 5000, 1)], shippingMinor: 0 }).ok).toBe(true);
    // A subscription does not count towards it.
    expect(applyDiscount(three, { marketCode: "NO", lines: [line("a", 10000, 2), line("s", 5000, 1, { recurring: true })], shippingMinor: 0 })).toEqual({ ok: false, problem: "minimum_quantity" });
  });

  it("are for chosen groups or customers only, telling a guest to sign in and anyone else it is not theirs", () => {
    const groups = { ...base, tierIds: ["g1"] };
    expect(availability(groups, { ...ctx, signedIn: false, customer: null })).toBe("sign_in");
    expect(availability(groups, { ...ctx, customer: { id: "c1", tierIds: ["g2"] } })).toBe("not_eligible");
    expect(availability(groups, { ...ctx, customer: { id: "c1", tierIds: ["g1"] } })).toBeNull();
    const named = { ...base, customerIds: ["c9"] };
    expect(availability(named, { ...ctx, customer: { id: "c9", tierIds: [] } })).toBeNull();
    expect(availability(named, { ...ctx, customer: { id: "c1", tierIds: [] } })).toBe("not_eligible");
  });

  it("make a generated code work once, whatever the code's own limits", () => {
    const limited = { ...base, uniqueCodes: true, usageLimit: 1, oncePerCustomer: true };
    expect(availability(limited, { ...ctx, used: 5, signedIn: false, itemUsed: 0 })).toBeNull();
    expect(availability(limited, { ...ctx, itemUsed: 1 })).toBe("used_up");
  });

  it("generate codes from an alphabet without look-alikes, after the prefix", () => {
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const codes = new Set(Array.from({ length: 200 }, () => generatedCode("sommer", random)));
    for (const code of codes) {
      expect(code).toMatch(/^SOMMER-[A-Z2-9]{8}$/);
      expect([...code.slice(7)].every((c) => GENERATED_ALPHABET.includes(c))).toBe(true);
      expect(code.slice(7)).not.toMatch(/[01OIL]/);
    }
    expect(codes.size).toBeGreaterThan(190);
    expect(generatedCode("", random)).toMatch(/^[A-Z2-9]{8}$/);
  });
});
