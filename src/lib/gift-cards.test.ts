import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GENERATED_ALPHABET } from "./discounts";
import { formatGiftCode, GIFT_CODE_ALPHABET, GIFT_CODE_LENGTH, giftCodeLast4, looksLikeGiftCode, makeGiftCode, normaliseGiftCode } from "./gift-cards";

describe("gift card codes (D300)", () => {
  it("use the generated discount codes' alphabet, without look-alikes", () => {
    expect(GIFT_CODE_ALPHABET).toBe(GENERATED_ALPHABET);
    expect(GIFT_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("are sixteen characters of it, each equally likely", () => {
    const code = makeGiftCode((n) => randomBytes(n));
    expect(code).toHaveLength(GIFT_CODE_LENGTH);
    expect([...code].every((c) => GIFT_CODE_ALPHABET.includes(c))).toBe(true);
    // Bytes over the last whole multiple of the alphabet are skipped, so a source giving only those never decides a character.
    let calls = 0;
    const skewed = makeGiftCode((n) => (calls++ === 0 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(0)));
    expect(skewed).toBe("A".repeat(GIFT_CODE_LENGTH));
  });

  it("read what a person typed loosely, and refuse what cannot be one", () => {
    expect(normaliseGiftCode(" abcd-efgh hjkm.npqr ")).toBe("ABCDEFGHHJKMNPQR");
    expect(looksLikeGiftCode("abcd-efgh-hjkm-npqr")).toBe(true);
    expect(looksLikeGiftCode("ABCD-EFGH-HJKM-NPQ")).toBe(false);
    expect(looksLikeGiftCode("ABCD-EFGH-HJKM-NPQ0")).toBe(false);
  });

  it("show in groups of four, and by their last four", () => {
    expect(formatGiftCode("ABCDEFGHJKMNPQRS")).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(giftCodeLast4("ABCDEFGHJKMNPQRS")).toBe("PQRS");
  });
});
