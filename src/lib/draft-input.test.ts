import { describe, expect, it } from "vitest";

import {
  MANUAL_METHOD_LABELS,
  MANUAL_PAYMENT_METHODS,
  draftInput,
  draftLineInput,
  draftPaidOutsideInput,
  draftSendInput,
  draftTagProblems,
  formatPercentBps,
  manualRefundInput,
  parsePercentBps,
} from "./draft-input";
import { parsePrice } from "./product-input";

const ID = "0b8c2d44-5f3e-4a62-9d11-2f6a8c1e7b90";
const base = { version: 1, marketSlug: "no", lines: [] };

describe("a typed percent", () => {
  it("reads 0.01 to 100 with at most two decimals, a comma or a point, as basis points", () => {
    expect(["10", "10,5", "10.50", "0,01", "0.25", "100", "12,34", " 7 % ", `1${String.fromCharCode(0xa0)}`].map(parsePercentBps)).toEqual([1000, 1050, 1050, 1, 25, 10000, 1234, 700, 100]);
  });

  it("refuses 0, over 100, more decimals, and what is not a number", () => {
    for (const v of ["0", "0,00", "100,01", "101", "1,234", "abc", "", "-5", "1e2", "10,5,5"]) expect(parsePercentBps(v), v).toBeNull();
  });

  it("writes basis points back as the field's text", () => {
    expect([1, 25, 1000, 1050, 1234, 10000].map(formatPercentBps)).toEqual(["0,01", "0,25", "10", "10,5", "12,34", "100"]);
    for (const bps of [1, 7, 99, 100, 1050, 9999, 10000]) expect(parsePercentBps(formatPercentBps(bps))).toBe(bps);
  });
});

describe("the draft as the editor sends it", () => {
  it("accepts a draft with lines, a discount, shipping and notes, and cleans the texts", () => {
    const parsed = draftInput.parse({
      ...base,
      customerId: ID,
      email: " kari@example.com ",
      phone: "",
      shippingAddress: { name: "Kari", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      companyName: "Fixture AS",
      noteToBuyer: "  Thank you!\r\n\r\n\r\n\r\nBest, Ola  ",
      internalNote: null,
      tags: ["vip", "rush"],
      discount: { kind: "percent", value: "10", label: " Friends and family " },
      shipping: { kind: "custom", price: "99,00" },
      lines: [
        { kind: "goods", variantId: ID, quantity: 2, price: null },
        { kind: "custom", title: " Installation ", quantity: 1, price: "1 250,00", vatCategory: "standard" },
      ],
    });
    expect(parsed.email).toBe("kari@example.com");
    expect(parsed.phone).toBeNull();
    expect(parsed.noteToBuyer).toBe("Thank you!\n\nBest, Ola");
    expect(parsed.internalNote).toBeNull();
    expect(parsed.discount).toEqual({ kind: "percent", value: "10", label: "Friends and family" });
    expect(parsed.lines[1].title).toBe("Installation");
    expect(parsePrice(parsed.lines[1].price!, "NOK")).toBe(125000);
    expect(parsePrice((parsed.shipping as { price: string }).price, "NOK")).toBe(9900);
  });

  it("fills the defaults: no discount, the market's rate, no lines, empty addresses", () => {
    const parsed = draftInput.parse(base);
    expect(parsed.discount).toBeNull();
    expect(parsed.shipping).toEqual({ kind: "rate" });
    expect(parsed.lines).toEqual([]);
    expect(parsed.shippingAddress).toEqual({ name: null, line1: null, line2: null, postalCode: null, city: null, country: null });
    expect(parsed.tags).toEqual([]);
  });

  it("refuses a market that is not an address, a version of 0 and a customer that is not an id", () => {
    expect(draftInput.safeParse({ ...base, marketSlug: "Norway" }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, marketSlug: "no-en-eur" }).success).toBe(true);
    expect(draftInput.safeParse({ ...base, version: 0 }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, customerId: "kari" }).success).toBe(false);
  });

  it("refuses a note to the buyer over 500 characters and says by how much, and one with too many lines: never cut", () => {
    const long = draftInput.safeParse({ ...base, noteToBuyer: "x".repeat(520) });
    expect(long.success).toBe(false);
    expect(JSON.stringify(long.error?.issues)).toContain("20 characters too long");
    const lines = draftInput.safeParse({ ...base, noteToBuyer: Array.from({ length: 14 }, (_, i) => `l${i}`).join("\n") });
    expect(lines.success).toBe(false);
    expect(draftInput.safeParse({ ...base, noteToBuyer: "x".repeat(500) }).success).toBe(true);
    expect(draftInput.safeParse({ ...base, internalNote: "x".repeat(1001) }).success).toBe(false);
  });

  it("holds at most 100 lines and 250 tags", () => {
    const goods = { kind: "goods", variantId: ID, quantity: 1 };
    expect(draftInput.safeParse({ ...base, lines: Array.from({ length: 100 }, () => goods) }).success).toBe(true);
    expect(draftInput.safeParse({ ...base, lines: Array.from({ length: 101 }, () => goods) }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, tags: Array.from({ length: 251 }, (_, i) => `t${i}`) }).success).toBe(false);
  });

  it("needs a discount a name the buyer sees, and a custom shipping a price", () => {
    expect(draftInput.safeParse({ ...base, discount: { kind: "amount", value: "50", label: "" } }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, discount: { kind: "amount", value: "50", label: "x".repeat(61) } }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, shipping: { kind: "custom" } }).success).toBe(false);
    expect(draftInput.safeParse({ ...base, shipping: { kind: "free" } }).success).toBe(true);
  });
});

describe("a line", () => {
  it("is goods with a variant, or a custom item with a title, a price and a VAT category", () => {
    expect(draftLineInput.safeParse({ kind: "goods", variantId: ID, quantity: 1 }).success).toBe(true);
    expect(draftLineInput.safeParse({ kind: "goods", quantity: 1 }).success).toBe(false);
    expect(draftLineInput.safeParse({ kind: "custom", title: "Fee", quantity: 1, price: "10", vatCategory: "standard" }).success).toBe(true);
    for (const missing of ["title", "price", "vatCategory"]) {
      const custom: Record<string, unknown> = { kind: "custom", title: "Fee", quantity: 1, price: "10", vatCategory: "standard" };
      delete custom[missing];
      expect(draftLineInput.safeParse(custom).success, missing).toBe(false);
    }
  });

  it("holds a quantity of 1 to 9,999 and a title of at most 120 characters", () => {
    const goods = { kind: "goods", variantId: ID };
    expect([0, 1, 9999, 10000, 1.5].map((quantity) => draftLineInput.safeParse({ ...goods, quantity }).success)).toEqual([false, true, true, false, false]);
    expect(draftLineInput.safeParse({ kind: "custom", title: "x".repeat(121), quantity: 1, price: "1", vatCategory: "standard" }).success).toBe(false);
  });
});

describe("sending, paying outside and refunding outside", () => {
  it("sends with a validity of 1 to 30 days or the store's default, and a link to share without an email", () => {
    expect(draftSendInput.parse({ version: 3 })).toEqual({ version: 3, createLink: false });
    expect(draftSendInput.parse({ version: 3, validDays: 30, createLink: true })).toEqual({ version: 3, validDays: 30, createLink: true });
    expect([0, 31, 1.5].map((validDays) => draftSendInput.safeParse({ version: 1, validDays }).success)).toEqual([false, false, false]);
  });

  it("records a payment outside with a method that is one of three and an optional reference of at most 200 characters", () => {
    expect(MANUAL_PAYMENT_METHODS).toEqual(["bank_transfer", "cash", "other"]);
    for (const m of MANUAL_PAYMENT_METHODS) expect(MANUAL_METHOD_LABELS[m].length).toBeGreaterThan(2);
    expect(draftPaidOutsideInput.parse({ version: 2, method: "cash" })).toEqual({ version: 2, method: "cash", reference: null });
    expect(draftPaidOutsideInput.parse({ version: 2, method: "bank_transfer", reference: " KID 12345 " }).reference).toBe("KID 12345");
    expect(draftPaidOutsideInput.safeParse({ version: 2, method: "card" }).success).toBe(false);
    expect(draftPaidOutsideInput.safeParse({ version: 2 }).success).toBe(false);
    expect(draftPaidOutsideInput.safeParse({ version: 2, method: "cash", reference: "x".repeat(201) }).success).toBe(false);
  });

  it("records a refund outside with an amount and a reason, restocking by default", () => {
    expect(manualRefundInput.parse({ amount: "100,00", reason: "Returned" })).toEqual({ amount: "100,00", reason: "Returned", restock: true });
    expect(manualRefundInput.safeParse({ amount: "100", reason: "" }).success).toBe(false);
    expect(manualRefundInput.safeParse({ amount: "", reason: "x" }).success).toBe(false);
  });

  it("checks typed tags once and says which is not valid", () => {
    expect(draftTagProblems(["vip", "late"])).toBeNull();
    expect(draftTagProblems(["vip", "a,b"])).toContain("a,b");
    expect(draftTagProblems(["x".repeat(41)])).not.toBeNull();
  });
});
