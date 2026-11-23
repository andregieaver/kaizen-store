import { describe, expect, it } from "vitest";

import { aiMayTakeOne, beyondOf, billExtras, extrasNotice, extrasTotal, type ExtraLine } from "./extras";

/** The first price sheet in NOK: 100 AI-handled conversations at 4.00 kr beyond; three people in Work at 50 kr and in Deals at 80 kr. */
const desk: ExtraLine = { extensionId: "support_desk", unit: "ai_conversation", used: 137, included: 100, unitMinor: 400 };
const work: ExtraLine = { extensionId: "work", unit: "person", used: 5, included: 3, unitMinor: 5000 };
const deals: ExtraLine = { extensionId: "deals", unit: "person", used: 2, included: 3, unitMinor: 8000 };

describe("use beyond the allowances (D880)", () => {
  it("bills each unit beyond its allowance at its price, and nothing without a limit", () => {
    const billed = billExtras([desk, work, deals], null);
    expect(billed.map((b) => [b.beyond, b.quantity, b.amountMinor])).toEqual([
      [37, 37, 14800],
      [2, 2, 10000],
      [0, 0, 0],
    ]);
    expect(extrasTotal(billed)).toBe(24800);
    expect(beyondOf({ used: 900, included: null })).toBe(0);
  });

  it("stops at the owner's cap, cutting a line to the whole units that fit", () => {
    // 200 kr cap: the desk's 37 conversations (148 kr) fit; Work gets one person (50 kr) of two, leaving 2 kr.
    const billed = billExtras([desk, work], 20000);
    expect(billed.map((b) => b.quantity)).toEqual([37, 1]);
    expect(extrasTotal(billed)).toBe(19800);
    expect(extrasTotal(billExtras([desk], 0))).toBe(0);
  });

  it("lets the AI take one more only while it fits under the cap", () => {
    expect(aiMayTakeOne([desk], null)).toBe(true);
    expect(aiMayTakeOne([{ ...desk, used: 99 }], 0)).toBe(true);
    // 37 beyond (148 kr) and one more is 152 kr.
    expect(aiMayTakeOne([desk], 15200)).toBe(true);
    expect(aiMayTakeOne([desk], 15199)).toBe(false);
    // Everything else of the period counts too: Work's two people (100 kr) leave no room under 200 kr.
    expect(aiMayTakeOne([desk, work], 20000)).toBe(false);
  });

  it("tells the owner at 80 % and once use goes beyond", () => {
    expect(extrasNotice({ used: 79, included: 100 })).toBe("fine");
    expect(extrasNotice({ used: 80, included: 100 })).toBe("near");
    expect(extrasNotice({ used: 101, included: 100 })).toBe("beyond");
    expect(extrasNotice({ used: 5, included: null })).toBe("fine");
  });
});
