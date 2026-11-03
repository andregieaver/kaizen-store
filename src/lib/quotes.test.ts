import { describe, expect, it } from "vitest";

import { checkQuoteReply, checkQuoteRequest, DEFAULT_QUOTE_FIELDS, quotableLine, quoteFor, quoteOffered, quoteRequestPlace, QUOTE_LINES_MAX, QUOTE_NOTE_MAX } from "./quotes";

const VARIANT = "0b0d6c8a-7d3e-4c55-9f4e-0c7a1c2e3f40";
const OTHER = "1b0d6c8a-7d3e-4c55-9f4e-0c7a1c2e3f41";

const request = (over: Record<string, unknown> = {}) => ({
  store: "demo",
  market: "no",
  from: "product",
  lines: [{ variantId: VARIANT, quantity: 2 }],
  name: "Kari Nordmann",
  email: "kari@example.com",
  phone: "",
  company: "",
  note: "",
  website: "",
  elapsed: 5000,
  block: null,
  ...over,
});

describe("who is offered a quote (D431)", () => {
  it("follows the store's setting, and business only for a business buyer", () => {
    expect(quoteOffered("off", { business: true })).toBe(false);
    expect(quoteOffered("everyone", { business: false })).toBe(true);
    expect(quoteOffered("business", { business: false })).toBe(false);
    expect(quoteOffered("business", { business: true })).toBe(true);
  });

  it("always offers a product priced on request, as its only way, whatever the setting", () => {
    expect(quoteFor({ priceOnRequest: true }, false, undefined)).toBe("only");
    expect(quoteFor({ priceOnRequest: true }, true, "beside")).toBe("only");
    expect(quoteFor({ priceOnRequest: false }, false, "instead")).toBeNull();
    expect(quoteFor({ priceOnRequest: false }, true, undefined)).toBe("beside");
    expect(quoteFor({ priceOnRequest: false }, true, "instead")).toBe("instead");
  });

  it("asks a quote of a cart only for goods sent by post and bought once", () => {
    expect(quotableLine({ delivery: "physical", plan: null, booking: null, giftCard: null })).toBe(true);
    expect(quotableLine({ delivery: "digital", plan: null, booking: null })).toBe(false);
    expect(quotableLine({ delivery: "physical", plan: { id: "p" }, booking: null })).toBe(false);
    expect(quotableLine({ delivery: "physical", plan: null, booking: { kind: "stay" } })).toBe(false);
    expect(quotableLine({ delivery: "physical", plan: null, booking: null, giftCard: { key: "x" } })).toBe(false);
  });
});

describe("checkQuoteRequest", () => {
  it("cleans a request and keeps empty fields as null", () => {
    const checked = checkQuoteRequest(request({ name: "  Kari \u0007Nordmann ", note: "  Ten of these, please.  " }));
    expect(checked).toMatchObject({ ok: true, value: { name: "Kari  Nordmann", note: "Ten of these, please.", phone: null, company: null, from: "product" } });
  });

  it("is not a request at all without a store, a market view or a source", () => {
    expect(checkQuoteRequest(null)).toBeNull();
    expect(checkQuoteRequest([])).toBeNull();
    expect(checkQuoteRequest(request({ store: "Not a slug" }))).toBeNull();
    expect(checkQuoteRequest(request({ market: "norway!" }))).toBeNull();
    expect(checkQuoteRequest(request({ from: "basket" }))).toBeNull();
  });

  it("always needs the email address, whatever the form asks", () => {
    expect(checkQuoteRequest(request({ email: "" }))).toEqual({ ok: false, problems: { email: "required" } });
    expect(checkQuoteRequest(request({ email: "kari@" }))).toEqual({ ok: false, problems: { email: "invalid" } });
  });

  it("asks the fields as the form sets them: hidden ones are dropped, required ones needed", () => {
    const fields = { name: "hidden" as const, phone: "required" as const, company: "required" as const, note: "required" as const };
    expect(checkQuoteRequest(request(), fields)).toEqual({ ok: false, problems: { phone: "required", company: "required", note: "required" } });
    const ok = checkQuoteRequest(request({ phone: "+47 22 33 44 55", company: "Nordmann AS", note: "Hi" }), fields);
    expect(ok).toMatchObject({ ok: true, value: { name: null, phone: "+47 22 33 44 55", company: "Nordmann AS", note: "Hi" } });
    expect(checkQuoteRequest(request({ phone: "call me" }))).toEqual({ ok: false, problems: { phone: "invalid" } });
  });

  it("refuses a note that is too long rather than cutting it", () => {
    expect(checkQuoteRequest(request({ note: "x".repeat(QUOTE_NOTE_MAX + 1) }))).toEqual({ ok: false, problems: { note: "too_long" } });
  });

  it("needs a product's lines, each a variant and a whole quantity, and adds up the same variant", () => {
    expect(checkQuoteRequest(request({ lines: [] }))).toEqual({ ok: false, problems: { lines: "required" } });
    expect(checkQuoteRequest(request({ lines: [{ variantId: "nope", quantity: 1 }] }))).toEqual({ ok: false, problems: { lines: "invalid" } });
    expect(checkQuoteRequest(request({ lines: [{ variantId: VARIANT, quantity: 0 }] }))).toEqual({ ok: false, problems: { lines: "invalid" } });
    expect(checkQuoteRequest(request({ lines: [{ variantId: VARIANT, quantity: 1.5 }] }))).toEqual({ ok: false, problems: { lines: "invalid" } });
    const many = Array.from({ length: QUOTE_LINES_MAX + 1 }, () => ({ variantId: VARIANT, quantity: 1 }));
    expect(checkQuoteRequest(request({ lines: many }))).toEqual({ ok: false, problems: { lines: "invalid" } });
    const same = checkQuoteRequest(request({ lines: [{ variantId: VARIANT, quantity: 2 }, { variantId: OTHER, quantity: 1 }, { variantId: VARIANT, quantity: 3 }] }));
    expect(same).toMatchObject({ ok: true, value: { lines: [{ variantId: VARIANT, quantity: 5 }, { variantId: OTHER, quantity: 1 }] } });
  });

  it("takes no lines from the browser for a cart: the server reads the cart itself", () => {
    expect(checkQuoteRequest(request({ from: "cart", lines: [{ variantId: VARIANT, quantity: 99 }] }))).toMatchObject({ ok: true, value: { lines: [] } });
  });

  it("keeps the robot signals and the part as given", () => {
    const checked = checkQuoteRequest(request({ website: "spam.example", elapsed: -5, block: "abc_1" }));
    expect(checked).toMatchObject({ ok: true, value: { website: "spam.example", elapsed: 0, block: "abc_1" } });
    expect(checkQuoteRequest(request({ block: "<script>" }))).toMatchObject({ ok: true, value: { block: null } });
  });

  it("defaults to a required name, the rest optional", () => {
    expect(DEFAULT_QUOTE_FIELDS).toEqual({ name: "required", phone: "optional", company: "optional", note: "optional" });
    expect(checkQuoteRequest(request({ name: "" }))).toEqual({ ok: false, problems: { name: "required" } });
  });
});

describe("checkQuoteReply", () => {
  it("needs a short reply, refused when empty or too long", () => {
    expect(checkQuoteReply("  We cannot deliver this many before March. ")).toEqual({ ok: true, value: "We cannot deliver this many before March." });
    expect(checkQuoteReply("   ")).toEqual({ ok: false, problem: "required" });
    expect(checkQuoteReply(undefined)).toEqual({ ok: false, problem: "required" });
    expect(checkQuoteReply("x".repeat(1001))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("quoteRequestPlace", () => {
  it("reads where a request is for before its fields are known", () => {
    expect(quoteRequestPlace(request({ block: "part-1" }))).toEqual({ store: "demo", market: "no", block: "part-1" });
    expect(quoteRequestPlace({ store: "demo" })).toBeNull();
    expect(quoteRequestPlace("demo")).toBeNull();
  });
});
