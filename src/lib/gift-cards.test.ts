import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GENERATED_ALPHABET } from "./discounts";
import { formatGiftCode, GIFT_CODE_ALPHABET, GIFT_CODE_LENGTH, giftCardsPay, giftCodeLast4, looksLikeGiftCode, makeGiftCode, normaliseGiftCode } from "./gift-cards";

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

describe("what gift cards pay (D300 F3)", () => {
  const card = (id: string, balanceMinor: number, usable = true) => ({ id, balanceMinor, usable });

  it("pays in the order added, each up to its balance, the rest for another way", () => {
    expect(giftCardsPay([card("a", 30_000), card("b", 50_000)], 60_000)).toEqual({
      parts: [
        { id: "a", amountMinor: 30_000, afterMinor: 0 },
        { id: "b", amountMinor: 30_000, afterMinor: 20_000 },
      ],
      paidMinor: 60_000,
      restMinor: 0,
    });
    expect(giftCardsPay([card("a", 30_000)], 50_000)).toEqual({ parts: [{ id: "a", amountMinor: 30_000, afterMinor: 0 }], paidMinor: 30_000, restMinor: 20_000 });
  });

  it("never pays more than is due, and a card that cannot pay keeps its balance", () => {
    expect(giftCardsPay([card("a", 100_000), card("b", 10_000)], 40_000).parts).toEqual([
      { id: "a", amountMinor: 40_000, afterMinor: 60_000 },
      { id: "b", amountMinor: 0, afterMinor: 10_000 },
    ]);
    expect(giftCardsPay([card("a", 10_000, false), card("b", 10_000)], 15_000)).toEqual({
      parts: [
        { id: "a", amountMinor: 0, afterMinor: 10_000 },
        { id: "b", amountMinor: 10_000, afterMinor: 0 },
      ],
      paidMinor: 10_000,
      restMinor: 5_000,
    });
  });

  it("pays nothing for nothing due, and none of an empty card", () => {
    expect(giftCardsPay([card("a", 10_000)], 0)).toEqual({ parts: [{ id: "a", amountMinor: 0, afterMinor: 10_000 }], paidMinor: 0, restMinor: 0 });
    expect(giftCardsPay([card("a", 0)], 5_000).restMinor).toBe(5_000);
    expect(giftCardsPay([], 5_000)).toEqual({ parts: [], paidMinor: 0, restMinor: 5_000 });
  });

  it("leave at least the smallest charge when anything is left to pay, the last card giving back first", () => {
    expect(giftCardsPay([card("a", 30_000), card("b", 19_900)], 50_000, 300)).toEqual({
      parts: [
        { id: "a", amountMinor: 30_000, afterMinor: 0 },
        { id: "b", amountMinor: 19_700, afterMinor: 200 },
      ],
      paidMinor: 49_700,
      restMinor: 300,
    });
    // Paid in full, or nothing left: no floor.
    expect(giftCardsPay([card("a", 60_000)], 50_000, 300).restMinor).toBe(0);
    // Less than the floor in all: the cards pay nothing, the provider takes it all.
    expect(giftCardsPay([card("a", 150)], 200, 300)).toMatchObject({ paidMinor: 0, restMinor: 200 });
  });
});
