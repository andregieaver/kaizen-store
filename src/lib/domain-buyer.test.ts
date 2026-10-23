import { describe, expect, it } from "vitest";

import { CONSENT_TEXT, currencyForCountry, nameNeedsReview, newAccountRoom, vatFor, withVat } from "./domain-buyer";

describe("the VAT a domain invoice carries (D317 decision 1)", () => {
  it("is Norwegian MVA for anyone in Norway", () => {
    expect(vatFor({ kind: "consumer", country: "no" })).toMatchObject({ ok: true, vatKind: "mva", ratePercent: 25 });
    expect(vatFor({ kind: "business", country: "NO", vatNumber: "NO123456789MVA" })).toMatchObject({ ok: true, vatKind: "mva" });
  });

  it("refuses consumers outside Norway, never charging the wrong VAT", () => {
    expect(vatFor({ kind: "consumer", country: "SE" })).toEqual({ ok: false, problem: "consumer_country" });
    expect(vatFor({ kind: "consumer", country: "US" })).toEqual({ ok: false, problem: "consumer_country" });
  });

  it("reverse-charges an EU business with a number for its own country, and is outside the scope for one outside the EU", () => {
    expect(vatFor({ kind: "business", country: "DE", vatNumber: "DE 123 456 789" })).toMatchObject({ ok: true, vatKind: "reverse_charge", vatNumber: "DE123456789" });
    expect(vatFor({ kind: "business", country: "DE" })).toEqual({ ok: false, problem: "vat_number_needed" });
    expect(vatFor({ kind: "business", country: "DE", vatNumber: "FR12345678901" })).toMatchObject({ ok: false });
    expect(vatFor({ kind: "business", country: "US" })).toMatchObject({ ok: true, vatKind: "outside_scope", ratePercent: 0 });
  });

  it("adds VAT half up in minor units", () => {
    expect(withVat(10_000, 25)).toBe(12_500);
    expect(withVat(1, 25)).toBe(1);
    expect(withVat(2, 25)).toBe(3);
    expect(withVat(10_000, 0)).toBe(10_000);
  });
});

describe("what a buyer without a store pays in", () => {
  it("follows their country among the priced currencies, else euro", () => {
    expect(currencyForCountry("NO", ["NOK", "EUR"])).toBe("NOK");
    expect(currencyForCountry("SE", ["NOK", "EUR"])).toBe("EUR");
    expect(currencyForCountry("DE", ["NOK"])).toBeNull();
  });
});

describe("the consent before registration starts", () => {
  it("is in English and Norwegian and names the right of withdrawal", () => {
    expect(CONSENT_TEXT.en).toMatch(/right to withdraw/);
    expect(CONSENT_TEXT.nb).toMatch(/angreretten/);
  });
});

describe("names a person looks at first (D317 10)", () => {
  it("catches the words phishing favours and brands hidden in longer words", () => {
    expect(nameNeedsReview("paypal-help.com")).toBe("paypal");
    expect(nameNeedsReview("secure-login.shop")).not.toBeNull();
    expect(nameNeedsReview("mypaypalhelp.com")).toBe("paypal");
    expect(nameNeedsReview("vipps.shop")).toBe("vipps");
  });

  it("leaves ordinary names alone", () => {
    expect(nameNeedsReview("display.com")).toBeNull();
    expect(nameNeedsReview("nordisk-kaffe.shop")).toBeNull();
    expect(nameNeedsReview("navigate.com")).toBeNull();
  });
});

describe("a new account's room", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  it("is three domains in the first thirty days, unless it renewed one or has a store", () => {
    const young = new Date("2026-10-20T12:00:00Z");
    expect(newAccountRoom({ createdAt: young, bought: 2, renewedOrStore: false }, now)).toBe(true);
    expect(newAccountRoom({ createdAt: young, bought: 3, renewedOrStore: false }, now)).toBe(false);
    expect(newAccountRoom({ createdAt: young, bought: 3, renewedOrStore: true }, now)).toBe(true);
    expect(newAccountRoom({ createdAt: new Date("2026-09-01T00:00:00Z"), bought: 9, renewedOrStore: false }, now)).toBe(true);
  });
});
