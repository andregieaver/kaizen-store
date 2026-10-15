import { describe, expect, it } from "vitest";

import { exchangeAgreementInput, exchangeBuilderInput, exchangeWishInput } from "./exchange-input";
import { cleanExchangeWish } from "./exchange-input-browser";
import { EXCHANGE_LINES_MAX, EXCHANGE_QUANTITY_MAX, EXCHANGE_WISH_NOTE_MAX } from "./exchange-limits";

const variantId = "6f1f7a3e-0d7f-4b5e-9a4c-1f2e3d4c5b6a";
const address = { name: "Kari Nordmann", street: "Storgata 5", postalCode: "0182", city: "Oslo", country: "no" };

describe("the builder's input", () => {
  it("takes replacements, a shipping choice and the delivery address", () => {
    const r = exchangeBuilderInput.safeParse({ lines: [{ variantId, quantity: 2, unitPriceMinor: 12900 }], shipping: { kind: "free" }, deliveryAddress: address });
    expect(r.success && r.data.deliveryAddress.country).toBe("NO");
    expect(exchangeBuilderInput.safeParse({ lines: [{ variantId, quantity: 1, unitPriceMinor: 0 }], shipping: { kind: "set", amountMinor: 4900 }, deliveryAddress: address }).success).toBe(true);
  });

  it("refuses no lines, too many, a bad quantity, a price that is not minor units and an unknown shipping kind", () => {
    const parse = (over: Record<string, unknown>) => exchangeBuilderInput.safeParse({ lines: [{ variantId, quantity: 1, unitPriceMinor: 100 }], shipping: { kind: "free" }, deliveryAddress: address, ...over }).success;
    expect(parse({ lines: [] })).toBe(false);
    expect(parse({ lines: Array.from({ length: EXCHANGE_LINES_MAX + 1 }, () => ({ variantId, quantity: 1, unitPriceMinor: 1 })) })).toBe(false);
    expect(parse({ lines: [{ variantId, quantity: EXCHANGE_QUANTITY_MAX + 1, unitPriceMinor: 1 }] })).toBe(false);
    expect(parse({ lines: [{ variantId, quantity: 0, unitPriceMinor: 1 }] })).toBe(false);
    expect(parse({ lines: [{ variantId, quantity: 1, unitPriceMinor: 1.5 }] })).toBe(false);
    expect(parse({ lines: [{ variantId: "nope", quantity: 1, unitPriceMinor: 1 }] })).toBe(false);
    expect(parse({ shipping: { kind: "express" } })).toBe(false);
    expect(parse({ shipping: { kind: "set", amountMinor: -1 } })).toBe(false);
    expect(parse({ deliveryAddress: { ...address, country: "Norway" } })).toBe(false);
    expect(parse({ deliveryAddress: { ...address, street: "  " } })).toBe(false);
  });
});

describe("staff's record of the customer's agreement", () => {
  it("is how it came, the day and a short note; never the customer's own web press", () => {
    expect(exchangeAgreementInput.safeParse({ channel: "phone", day: "2026-10-15", note: "Called at 14:00" }).success).toBe(true);
    expect(exchangeAgreementInput.safeParse({ channel: "web", day: "2026-10-15" }).success).toBe(false);
    expect(exchangeAgreementInput.safeParse({ channel: "email", day: "15.10.2026" }).success).toBe(false);
    expect(exchangeAgreementInput.safeParse({ channel: "email", day: "2026-10-15", note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("the customer's wish", () => {
  it("is plain text, cleaned, refused when empty or too long, never cut", () => {
    expect(cleanExchangeWish("  Size M instead‮ ")).toEqual({ ok: true, note: "Size M instead" });
    expect(cleanExchangeWish("   ")).toEqual({ ok: false, problem: "empty" });
    expect(cleanExchangeWish(42)).toEqual({ ok: false, problem: "empty" });
    expect(cleanExchangeWish("x".repeat(EXCHANGE_WISH_NOTE_MAX))).toMatchObject({ ok: true });
    expect(cleanExchangeWish("x".repeat(EXCHANGE_WISH_NOTE_MAX + 1))).toEqual({ ok: false, problem: "too_long", over: 1 });
  });

  it("is read on the server by the browser's own check", () => {
    expect(exchangeWishInput.safeParse({ note: " Blue one " })).toEqual({ success: true, data: { note: "Blue one" } });
    expect(exchangeWishInput.safeParse({ note: "" }).success).toBe(false);
  });
});
