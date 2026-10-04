import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CROCKFORD,
  RECOVERY_CODES_PER_SET,
  RECOVERY_CODE_LENGTH,
  formatCodes,
  formatRecoveryCode,
  generateRawCode,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from "./recovery-codes";

const real = (n: number) => new Uint8Array(randomBytes(n));
/** A source that gives the same bytes again and again, to pin the arithmetic. */
const fixed = (bytes: number[]) => () => Uint8Array.from(bytes);

describe("recovery codes (wave 1, 1f)", () => {
  it("uses Crockford's alphabet: 32 symbols, none of I, L, O or U", () => {
    expect(CROCKFORD).toHaveLength(32);
    expect(new Set(CROCKFORD).size).toBe(32);
    for (const letter of "ILOU") expect(CROCKFORD).not.toContain(letter);
  });

  it("is ten characters of it: fifty bits", () => {
    expect(RECOVERY_CODE_LENGTH * Math.log2(CROCKFORD.length)).toBe(50);
    for (let i = 0; i < 200; i++) {
      const code = generateRawCode(real);
      expect(code).toHaveLength(10);
      expect([...code].every((c) => CROCKFORD.includes(c))).toBe(true);
    }
  });

  it("takes the low five bits of each byte, so every symbol is as likely as another", () => {
    expect(generateRawCode(fixed([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("0123456789");
    expect(generateRawCode(fixed([32, 33, 255, 254, 31, 63, 95, 127, 159, 191]))).toBe("01ZYZZZZZZ");
    expect(() => generateRawCode(() => new Uint8Array(3))).toThrow(/ten random bytes/);
  });

  it("is shown as XXXXX-XXXXX", () => {
    expect(formatRecoveryCode("K7QM29WXDB")).toBe("K7QM2-9WXDB");
  });

  it("is read without regard to case, spaces, hyphens or look-alikes", () => {
    const expected = "K7QM29WXDB";
    for (const typed of ["K7QM2-9WXDB", "k7qm2-9wxdb", " K7QM2 9WXDB ", "k7qm29wxdb", "K7QM2–9WXDB", "K7QM2_9WXDB"]) expect(normaliseRecoveryCode(typed)).toBe(expected);
    // I and L are 1, O is 0 in Crockford's reading.
    expect(normaliseRecoveryCode("OILOI-LOILO")).toBe("0110110110");
    expect(normaliseRecoveryCode("00000-00000")).toBe("0000000000");
    expect(normaliseRecoveryCode("OOOOO-OOOOO")).toBe("0000000000");
  });

  it("refuses what cannot be a code", () => {
    for (const bad of ["", "K7QM2", "K7QM2-9WXDBX", "K7QM2-9WXD!", "U7QM2-9WXDB", "123456"]) expect([bad, normaliseRecoveryCode(bad)]).toEqual([bad, null]);
  });

  it("makes a set of ten different codes, each readable back", () => {
    const set = generateRecoveryCodes(real);
    expect(set).toHaveLength(RECOVERY_CODES_PER_SET);
    expect(new Set(set).size).toBe(10);
    for (const code of set) {
      expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
      expect(formatRecoveryCode(normaliseRecoveryCode(code)!)).toBe(code);
    }
  });

  it("fails loudly rather than make a set of repeated codes from poor randomness", () => {
    expect(() => generateRecoveryCodes(fixed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow(/different/);
  });

  it("is laid out to copy or print, one numbered code to a line, with what it is", () => {
    const text = formatCodes(["AAAAA-AAAAA", "BBBBB-BBBBB"], { account: "anna@example.com", madeOn: "3 October 2026" });
    expect(text).toContain("recovery codes for anna@example.com");
    expect(text).toContain("Made 3 October 2026");
    expect(text).toContain(" 1. AAAAA-AAAAA");
    expect(text).toContain(" 2. BBBBB-BBBBB");
    expect(text).toMatch(/works once/);
  });

  it("is told from the six digits of an authenticator app", () => {
    expect(looksLikeRecoveryCode("K7QM2-9WXDB")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("123 456")).toBe(false);
    expect(looksLikeRecoveryCode("hello")).toBe(false);
  });
});
