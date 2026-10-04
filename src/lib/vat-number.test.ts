import { describe, expect, it } from "vitest";

import {
  EU_COUNTRIES,
  EU_VAT_PREFIXES,
  countryOfVatPrefix,
  formatVatNumber,
  isEuMemberCountry,
  normaliseVatNumber,
  sameVatNumber,
  vatNumberProblemText,
  vatPrefixOf,
} from "./vat-number";

const ok = (country: string | null, input: string) => {
  const r = normaliseVatNumber(country, input);
  if (!r.ok) throw new Error(`expected ok, got ${r.problem}`);
  return r;
};

describe("the EU's countries and prefixes", () => {
  it("has the 27 member states, Greece's prefix being EL and Norway outside", () => {
    expect(EU_COUNTRIES).toHaveLength(27);
    expect(EU_VAT_PREFIXES).toHaveLength(27);
    expect(EU_VAT_PREFIXES).toContain("EL");
    expect(EU_VAT_PREFIXES).not.toContain("GR");
    expect(isEuMemberCountry("GR")).toBe(true);
    expect(isEuMemberCountry("de")).toBe(true);
    expect(isEuMemberCountry("NO")).toBe(false);
    expect(isEuMemberCountry("GB")).toBe(false);
    expect(isEuMemberCountry(null)).toBe(false);
    expect(vatPrefixOf("GR")).toBe("EL");
    expect(vatPrefixOf("se")).toBe("SE");
    expect(countryOfVatPrefix("EL")).toBe("GR");
  });
});

describe("normaliseVatNumber", () => {
  it("takes the prefix typed, in any case, with spaces, dots and dashes", () => {
    expect(ok(null, "de 123 456 789")).toMatchObject({ number: "DE123456789", prefix: "DE", body: "123456789", country: "DE", inEu: true });
    expect(ok(null, "DE-123.456.789").number).toBe("DE123456789");
    expect(ok("SE", "se556677889901").number).toBe("SE556677889901");
  });

  it("takes the prefix from the country when none is typed", () => {
    expect(ok("DE", "123456789")).toMatchObject({ number: "DE123456789", country: "DE" });
    expect(ok("GR", "123456789")).toMatchObject({ number: "EL123456789", prefix: "EL", country: "GR" });
  });

  it("writes Greece as EL whether typed EL or GR", () => {
    expect(ok(null, "EL123456789").number).toBe("EL123456789");
    expect(ok(null, "GR 123456789")).toMatchObject({ number: "EL123456789", country: "GR", inEu: true });
  });

  it("does not take the first letters of a number for a prefix when they are not one", () => {
    expect(ok("ES", "B12345678").number).toBe("ESB12345678");
    expect(ok("AT", "U12345678").number).toBe("ATU12345678");
    expect(ok(null, "ATU12345678")).toMatchObject({ prefix: "AT", body: "U12345678" });
  });

  it("knows the shapes of the countries' numbers", () => {
    for (const number of [
      "NL123456789B01", "IE1234567FA", "IE1A23456B", "FR12345678901", "FRXX123456789", "CY12345678X", "LT123456789",
      "LT123456789012", "DK12345678", "FI12345678", "PL1234567890", "SE556677889901",
    ]) {
      expect(ok(null, number).number).toBe(number);
    }
  });

  it("refuses the wrong shape, characters and empty input, with the reason", () => {
    expect(normaliseVatNumber(null, "")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseVatNumber(null, "  . - ")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseVatNumber(null, "123456789")).toEqual({ ok: false, problem: "no_country" });
    expect(normaliseVatNumber("DE", "12345")).toEqual({ ok: false, problem: "shape" });
    expect(normaliseVatNumber(null, "DE12345678A")).toEqual({ ok: false, problem: "shape" });
    expect(normaliseVatNumber(null, "SE55667788990")).toEqual({ ok: false, problem: "shape" });
    expect(normaliseVatNumber("DE", "12 34 ü 6789")).toEqual({ ok: false, problem: "characters" });
    expect(normaliseVatNumber("DE", "<script>")).toEqual({ ok: false, problem: "characters" });
    expect(normaliseVatNumber("DE", "1".repeat(13))).toEqual({ ok: false, problem: "characters" });
  });

  it("recognises non-EU prefixes and marks them as not in the EU", () => {
    expect(ok(null, "NO123456789MVA")).toMatchObject({ number: "NO123456789MVA", prefix: "NO", inEu: false });
    expect(ok(null, "GB123456789")).toMatchObject({ prefix: "GB", inEu: false });
    expect(ok(null, "XI123456789")).toMatchObject({ prefix: "XI", country: "XI", inEu: false });
  });

  it("never throws, whatever is typed", () => {
    for (const text of ["", " ", "\n", "💥", "DE", "DE ", "%%", "a".repeat(500), "null", "undefined"]) {
      expect(() => normaliseVatNumber("DE", text)).not.toThrow();
    }
    expect(normaliseVatNumber(undefined, "DE")).toEqual({ ok: false, problem: "no_country" });
  });
});

describe("formatting and comparing", () => {
  it("shows the prefix apart", () => {
    expect(formatVatNumber("SE556677889901")).toBe("SE 556677889901");
    expect(formatVatNumber("not a number")).toBe("not a number");
  });

  it("compares numbers ignoring spaces and case", () => {
    expect(sameVatNumber("se 5566 77889901", "SE556677889901")).toBe(true);
    expect(sameVatNumber("SE556677889901", "DE123456789")).toBe(false);
    expect(sameVatNumber(null, "SE556677889901")).toBe(false);
  });

  it("has a sentence for every problem", () => {
    for (const p of ["empty", "no_country", "characters", "shape"] as const) expect(vatNumberProblemText(p).length).toBeGreaterThan(5);
  });
});
