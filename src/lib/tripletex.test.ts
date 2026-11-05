import { describe, expect, it } from "vitest";

import {
  AMOUNT_MAX_MINOR,
  clipText,
  decimalOf,
  EXTERNAL_NUMBER_MAX,
  externalVoucherNumber,
  minorOf,
  norwegianOrgNumber,
  readPastedToken,
  TRIPLETEX_BASE,
  tokenHint,
} from "./tripletex";

/** Made-up tokens, put together here so secret scanners do not take them for real ones. */
const API_TOKEN = ["tlxr", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF123_-xyz"].join("_");
const EMPLOYEE_TOKEN = ["eyJ0b2tlbklkIjoxMjM0NTYsInRva2VuIjoi", "YWJjZGVmIn0="].join("");

describe("the token an owner pastes", () => {
  it("tells the company's own API token from an employee token", () => {
    expect(readPastedToken(API_TOKEN)).toEqual({ ok: true, kind: "api_token", mode: "live", token: API_TOKEN });
    expect(readPastedToken(EMPLOYEE_TOKEN)).toEqual({ ok: true, kind: "employee_token", mode: "live", token: EMPLOYEE_TOKEN });
  });

  it("knows a test environment token by its prefix, and keeps the prefix", () => {
    expect(readPastedToken(`test-${API_TOKEN}`)).toEqual({ ok: true, kind: "api_token", mode: "test", token: `test-${API_TOKEN}` });
    expect(readPastedToken(`test-${EMPLOYEE_TOKEN}`)).toMatchObject({ ok: true, kind: "employee_token", mode: "test" });
  });

  it("takes what a person copies: spaces, a line break, quotes, or the label in front", () => {
    for (const pasted of [`  ${API_TOKEN}\n`, `"${API_TOKEN}"`, `'${API_TOKEN}'`, `Token: ${API_TOKEN}`, `API token\n${API_TOKEN}`]) {
      expect(readPastedToken(pasted), pasted).toMatchObject({ ok: true, token: API_TOKEN });
    }
  });

  it("refuses what is not a token", () => {
    expect(readPastedToken("   ")).toEqual({ ok: false, problem: "empty" });
    for (const pasted of ["abc", "https://tripletex.no/execute/apiAccess", "tlxr_<script>alert(1)</script>xxxxxxxxxx", "test-short", "x".repeat(4001)]) {
      expect(readPastedToken(pasted).ok, pasted).toBe(false);
    }
  });

  it("shows only the prefix and the last four characters", () => {
    expect(tokenHint(API_TOKEN)).toBe("tlxr_…-xyz");
    expect(tokenHint(`test-${API_TOKEN}`)).toBe("test-tlxr_…-xyz");
    expect(tokenHint(EMPLOYEE_TOKEN)).toBe("…In0=");
    expect(tokenHint(API_TOKEN)).not.toContain("eyJ");
  });

  it("has two fixed addresses, both https on Tripletex's own hosts", () => {
    expect(Object.values(TRIPLETEX_BASE).map((u) => new URL(u).host)).toEqual(["tripletex.no", "api-test.tripletex.tech"]);
    expect(Object.values(TRIPLETEX_BASE).every((u) => u.startsWith("https://"))).toBe(true);
  });
});

describe("the external voucher number", () => {
  const STORE = "1a2b3c4d-0000-4000-8000-000000000001";

  it("is the store's first eight hex digits and the document's number", () => {
    expect(externalVoucherNumber(STORE, "W-1042")).toBe("kf/1a2b3c4d/W-1042");
    expect(externalVoucherNumber(STORE, " WCN-3 ")).toBe("kf/1a2b3c4d/WCN-3");
  });

  it("marks a deliberate second posting, and is the same every time", () => {
    expect(externalVoucherNumber(STORE, "W-1042", 2)).toBe("kf/1a2b3c4d/W-1042#2");
    expect(externalVoucherNumber(STORE, "W-1042")).toBe(externalVoucherNumber(STORE, "W-1042", 1));
  });

  it("stays within Tripletex's 70 characters, and refuses what would not", () => {
    expect(externalVoucherNumber(STORE, "x".repeat(50), 99).length).toBeLessThanOrEqual(EXTERNAL_NUMBER_MAX);
    expect(() => externalVoucherNumber(STORE, "x".repeat(70))).toThrow(RangeError);
    expect(() => externalVoucherNumber(STORE, "")).toThrow(RangeError);
    expect(() => externalVoucherNumber("not-a-uuid", "W-1")).toThrow(RangeError);
    expect(() => externalVoucherNumber(STORE, "W-1", 0)).toThrow(RangeError);
  });
});

describe("amounts", () => {
  it("writes minor units as the exact decimal", () => {
    expect(decimalOf(1999)).toBe(19.99);
    expect(decimalOf(1)).toBe(0.01);
    expect(decimalOf(-1)).toBe(-0.01);
    expect(decimalOf(0)).toBe(0);
    expect(decimalOf(1_500_000)).toBe(15000);
    expect(decimalOf(99_999_999_999)).toBe(999999999.99);
    expect(JSON.stringify(decimalOf(-1_234_567))).toBe("-12345.67");
  });

  it("prints back what it was given, for every amount it takes", () => {
    const samples = [7, 10, 99, 100, 101, 999, 1005, 123456789, AMOUNT_MAX_MINOR - 1, AMOUNT_MAX_MINOR];
    for (let n = 0; n < 5000; n += 1) samples.push(Math.floor(Math.random() * AMOUNT_MAX_MINOR));
    for (const n of samples) {
      for (const minor of [n, -n]) {
        const text = JSON.stringify(decimalOf(minor));
        const whole = Math.trunc(Math.abs(minor) / 100);
        const cents = Math.abs(minor) % 100;
        const expected = `${minor < 0 && minor !== 0 ? "-" : ""}${whole}${cents === 0 ? "" : `.${String(cents).padStart(2, "0").replace(/0$/, "")}`}`;
        expect(text, String(minor)).toBe(expected);
        expect(minorOf(decimalOf(minor))).toBe(minor);
      }
    }
  });

  it("takes only whole minor units within the limit", () => {
    expect(() => decimalOf(1.5)).toThrow(RangeError);
    expect(() => decimalOf(AMOUNT_MAX_MINOR + 1)).toThrow(RangeError);
    expect(() => decimalOf(Number.NaN)).toThrow(RangeError);
  });

  it("reads Tripletex's amounts back, and nothing that is not one", () => {
    expect(minorOf(150.25)).toBe(15025);
    expect(minorOf(-3000)).toBe(-300000);
    expect(minorOf(1.005)).toBeNull();
    expect(minorOf("150")).toBeNull();
    expect(minorOf(null)).toBeNull();
  });
});

describe("texts and numbers", () => {
  it("keeps texts on one line and short", () => {
    expect(clipText("Konsulent\ntimer\t oktober")).toBe("Konsulent timer oktober");
    expect(clipText("a".repeat(150)).length).toBe(100);
    expect(clipText("a".repeat(150)).endsWith("…")).toBe(true);
  });

  it("reads a Norwegian organisation number the ways people write it", () => {
    expect(norwegianOrgNumber("912 345 678")).toBe("912345678");
    expect(norwegianOrgNumber("NO912345678MVA")).toBe("912345678");
    expect(norwegianOrgNumber("912.345.678")).toBe("912345678");
    expect(norwegianOrgNumber("SE5561234567")).toBeNull();
    expect(norwegianOrgNumber("")).toBeNull();
    expect(norwegianOrgNumber(null)).toBeNull();
  });
});
