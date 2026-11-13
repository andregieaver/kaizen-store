import { describe, expect, it } from "vitest";

import { e164Phone, normalisePhone } from "./phone";

describe("a phone number a person is reached on (e164Phone, D237's driver)", () => {
  it("reads a national number in the market's country, with or without its trunk 0, and spaces, dots or dashes", () => {
    expect(e164Phone("912 34 567", "NO")).toBe("+4791234567");
    expect(e164Phone("070-123 45 67", "SE")).toBe("+46701234567");
    expect(e164Phone("20.12.34.56", "DK")).toBe("+4520123456");
    expect(e164Phone("(0)30 1234567", "DE")).toBe("+49301234567");
  });

  it("reads a number given with its country code, with + or 00, from any country", () => {
    expect(e164Phone("+47 912 34 567", "SE")).toBe("+4791234567");
    expect(e164Phone("0046 70 123 45 67", "NO")).toBe("+46701234567");
    expect(e164Phone("+1 415 555 0100", "NO")).toBe("+14155550100");
  });

  it("refuses what is not a phone number", () => {
    for (const typed of ["", "   ", "abc", "912 34 567 ext 2", "+47 12", "1234", "+47+91234567", `+47${"1".repeat(30)}`]) {
      expect(e164Phone(typed, "NO"), typed).toBeNull();
    }
    // A national number needs a country whose calling code is known.
    expect(e164Phone("912 34 567", null)).toBeNull();
    expect(e164Phone("912 34 567", "US")).toBeNull();
  });

  it("is what SMS marketing reads too, which texts only the countries a store may text", () => {
    expect(normalisePhone("912 34 567", "NO")).toBe("+4791234567");
    expect(normalisePhone("+1 415 555 0100", "NO")).toBeNull();
  });
});
