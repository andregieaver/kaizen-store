import { describe, expect, it } from "vitest";

import type { BonusEntry, CartBonus } from "./bonus";
import {
  creditsInputValue,
  creditsMode,
  creditsNet,
  creditsRequest,
  earnPercentText,
  earnedText,
  parseCreditsAmount,
  pendingParts,
} from "./bonus-shopper";
import { withoutVat } from "./b2b";

const cart = (over: Partial<CartBonus> = {}): CartBonus => ({
  enabled: true,
  signedIn: true,
  availableMinor: 5000,
  pendingMinor: 0,
  pendingAvailableAt: null,
  maxUsableMinor: 3000,
  usingMinor: 0,
  willEarnMinor: 250,
  earnPercent: 5,
  pendingDays: 14,
  ...over,
});

describe("which state the credits control is in", () => {
  it("is off when the program is off, and for a guest only while something can be earned", () => {
    expect(creditsMode(cart({ enabled: false }))).toBe("off");
    expect(creditsMode(cart({ signedIn: false }))).toBe("guest");
    expect(creditsMode(cart({ signedIn: false, earnPercent: 0 }))).toBe("off");
  });

  it("is the control for a customer who can use credits, or is using some", () => {
    expect(creditsMode(cart())).toBe("use");
    expect(creditsMode(cart({ maxUsableMinor: 0, usingMinor: 1000 }))).toBe("use");
  });

  it("is only notes when nothing can be used", () => {
    expect(creditsMode(cart({ maxUsableMinor: 0 }))).toBe("note");
    expect(creditsMode(cart({ maxUsableMinor: 0, availableMinor: 0, pendingMinor: 800, willEarnMinor: 0 }))).toBe(
      "note",
    );
    expect(creditsMode(cart({ maxUsableMinor: 0, availableMinor: 0, pendingMinor: 0, willEarnMinor: 0 }))).toBe("off");
  });
});

describe("an amount typed in the credits form", () => {
  it("is read with a point or a comma, in whole or minor units", () => {
    expect(parseCreditsAmount("10", "EUR")).toBe(1000);
    expect(parseCreditsAmount("10.5", "EUR")).toBe(1050);
    expect(parseCreditsAmount(" 10,50 ", "NOK")).toBe(1050);
    expect(parseCreditsAmount("0,05", "SEK")).toBe(5);
    expect(parseCreditsAmount(",5", "SEK")).toBe(50);
    expect(parseCreditsAmount("1 200", "DKK")).toBe(120000);
    expect(parseCreditsAmount("10.", "EUR")).toBe(1000);
  });

  it("is refused when it is not one amount, has too many decimals or is not safe", () => {
    for (const text of ["", "abc", "1.000,50", "-5", "10 kr", "1.234", "9".repeat(20)]) {
      expect(parseCreditsAmount(text, "EUR"), text).toBeNull();
    }
    // Extra zeros are no more precision.
    expect(parseCreditsAmount("1.500", "EUR")).toBe(150);
  });

  it("is shown in the input in the locale's decimal mark, empty for none", () => {
    expect(creditsInputValue(0, "EUR", "nb-NO")).toBe("");
    expect(creditsInputValue(1000, "EUR", "nb-NO")).toBe("10");
    expect(creditsInputValue(1050, "NOK", "nb-NO")).toBe("10,50");
    expect(creditsInputValue(1050, "EUR", "en-IE")).toBe("10.50");
    expect(creditsInputValue(123456, "EUR", "en-IE")).toBe("1234.56");
  });
});

describe("what the credits form asks for", () => {
  const ask = (over: Partial<Parameters<typeof creditsRequest>[0]>) =>
    creditsRequest({ intent: "apply", use: true, amountText: "", maxUsableMinor: 3000, currency: "EUR", ...over });

  it("is the amount typed, up to what can be used", () => {
    expect(ask({ amountText: "10" })).toEqual({ ok: true, amountMinor: 1000, clamped: false });
    expect(ask({ amountText: "30" })).toEqual({ ok: true, amountMinor: 3000, clamped: false });
    expect(ask({ amountText: "45,50" })).toEqual({ ok: true, amountMinor: 3000, clamped: true });
  });

  it("is all that can be used for the button, and for a ticked box with no amount", () => {
    expect(ask({ intent: "all", amountText: "1" })).toEqual({ ok: true, amountMinor: 3000, clamped: false });
    expect(ask({ amountText: "  " })).toEqual({ ok: true, amountMinor: 3000, clamped: false });
  });

  it("is none for an unticked box or a remove, whatever is typed", () => {
    expect(ask({ use: false, amountText: "10" })).toEqual({ ok: true, amountMinor: 0, clamped: false });
    expect(ask({ intent: "remove" })).toEqual({ ok: true, amountMinor: 0, clamped: false });
    expect(ask({ amountText: "0" })).toEqual({ ok: true, amountMinor: 0, clamped: false });
  });

  it("is refused when the amount is not one, or nothing can be used", () => {
    expect(ask({ amountText: "ten" })).toEqual({ ok: false, reason: "invalid" });
    expect(ask({ amountText: "5", maxUsableMinor: 0 })).toEqual({ ok: false, reason: "nothing" });
    expect(ask({ intent: "all", maxUsableMinor: 0 })).toEqual({ ok: false, reason: "nothing" });
    expect(ask({ amountText: "", maxUsableMinor: 0 })).toEqual({ ok: false, reason: "nothing" });
  });
});

describe("credits without VAT for a business", () => {
  it("are spread over the goods by value, each at its own rate, and add up the same however they are split", () => {
    // 100 credits over two lines of equal value, at 25% and 0%.
    const parts = [
      { minor: 5000, rate: 0.25 },
      { minor: 5000, rate: 0 },
    ];
    expect(creditsNet(10000, parts)).toBe(withoutVat(5000, 0.25) + 5000);
    expect(creditsNet(0, parts)).toBe(0);
    expect(creditsNet(500, [])).toBe(0);
  });

  it("keep every minor unit: what cannot be shared evenly goes to the largest line", () => {
    const parts = [
      { minor: 100, rate: 0 },
      { minor: 100, rate: 0 },
      { minor: 100, rate: 0 },
    ];
    expect(creditsNet(100, parts)).toBe(100);
  });
});

describe("what an order earned", () => {
  const words = {
    money: (minor: number) => `€${minor / 100}`,
    date: (iso: string) => iso.slice(0, 10),
    line: (amount: string, date: string) => `earned ${amount} from ${date}`,
    ready: (amount: string) => `earned ${amount} ready`,
  };
  const now = new Date("2026-09-30T12:00:00Z");

  it("says nothing for an order that earned none, or a guest's", () => {
    expect(earnedText(null, words, now)).toBeNull();
    expect(earnedText({ usedMinor: 500, earnedMinor: 0, availableAt: null }, words, now)).toBeNull();
  });

  it("says from when, while the credits are pending, and that they are ready after", () => {
    expect(earnedText({ usedMinor: 0, earnedMinor: 250, availableAt: "2026-10-14T00:00:00Z" }, words, now)).toBe(
      "earned €2.5 from 2026-10-14",
    );
    expect(earnedText({ usedMinor: 0, earnedMinor: 250, availableAt: "2026-09-01T00:00:00Z" }, words, now)).toBe(
      "earned €2.5 ready",
    );
    expect(earnedText({ usedMinor: 0, earnedMinor: 250, availableAt: null }, words, now)).toBe("earned €2.5 ready");
  });
});

describe("what is pending and from when", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const entry = (
    id: string,
    amountMinor: number,
    availableAt: string | null,
    kind: BonusEntry["kind"] = "earn",
  ): BonusEntry => ({
    id,
    kind,
    amountMinor,
    at: "2026-09-20T10:00:00Z",
    availableAt,
    expiresAt: null,
    orderNumber: null,
    orderId: null,
    note: "",
  });

  it("groups grants that are not usable yet by day, soonest first", () => {
    const parts = pendingParts(
      [
        entry("a", 300, "2026-10-20T08:00:00Z"),
        entry("b", 200, "2026-10-10T08:00:00Z"),
        entry("c", 100, "2026-10-10T18:00:00Z"),
        entry("d", 900, "2026-09-01T00:00:00Z"), // already usable
        entry("e", 500, null),
        entry("f", -400, "2026-10-01T00:00:00Z", "redeem"),
      ],
      600,
      now,
    );
    expect(parts.map((p) => [p.availableAt.slice(0, 10), p.amountMinor])).toEqual([
      ["2026-10-10", 300],
      ["2026-10-20", 300],
    ]);
  });

  it("never lists more than the balance says is pending, taking the excess off the latest", () => {
    const parts = pendingParts(
      [entry("a", 300, "2026-10-20T08:00:00Z"), entry("b", 300, "2026-10-10T08:00:00Z")],
      400,
      now,
    );
    expect(parts.map((p) => p.amountMinor)).toEqual([300, 100]);
    expect(pendingParts([entry("a", 300, "2026-10-20T08:00:00Z")], 0, now)).toEqual([]);
  });
});

describe("the percentage back", () => {
  it("reads in the locale's decimal mark", () => {
    expect(earnPercentText(5, "nb-NO")).toBe("5");
    expect(earnPercentText(2.5, "nb-NO")).toBe("2,5");
    expect(earnPercentText(2.5, "en-IE")).toBe("2.5");
  });
});
