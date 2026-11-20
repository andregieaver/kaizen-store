import { describe, expect, it } from "vitest";

import { anchorFor, changePercent, priceTuningDecision, type PriceChangeFacts } from "./price-tuning";

const facts = (over: Partial<PriceChangeFacts> = {}): PriceChangeFacts => ({ currentMinor: 20000, toMinor: 22000, anchorMinor: 20000, foundingMinor: null, autonomyPaused: false, ...over });

describe("the AI's price tuning (D854)", () => {
  it("works out a change in percent to one decimal", () => {
    expect(changePercent(19900, 22900)).toBe(15.1);
    expect(changePercent(20000, 18000)).toBe(-10);
    expect(changePercent(0, 100)).toBe(100);
  });

  it("measures from the price a person last set, not the AI's last step", () => {
    // The AI moved 200 to 220 from a person's 200: while 220 is on offer, the anchor stays 200.
    expect(anchorFor({ toMinor: 22000, anchorMinor: 20000 }, 22000)).toBe(20000);
    // A person changed it to 250 since: 250 is the anchor.
    expect(anchorFor({ toMinor: 22000, anchorMinor: 20000 }, 25000)).toBe(25000);
    expect(anchorFor(null, 20000)).toBe(20000);
  });

  it("refuses everything when off, and what could never be a price", () => {
    expect(priceTuningDecision({ level: "off", rangePercent: 20 }, facts())).toMatchObject({ kind: "refuse" });
    expect(priceTuningDecision({ level: "auto", rangePercent: 20 }, facts({ toMinor: 0 }))).toMatchObject({ kind: "refuse", reason: "A price must be more than nothing." });
    expect(priceTuningDecision({ level: "auto", rangePercent: 20 }, facts({ toMinor: 20000 }))).toMatchObject({ kind: "refuse", reason: "That is the price now." });
    expect(priceTuningDecision({ level: "auto", rangePercent: 20 }, facts({ toMinor: 15000, foundingMinor: 15000 }))).toMatchObject({ kind: "refuse" });
  });

  it("asks for every change when it proposes", () => {
    expect(priceTuningDecision({ level: "propose", rangePercent: 20 }, facts())).toMatchObject({ kind: "ask" });
  });

  it("runs on its own within the range of the anchor, and asks beyond it or while paused", () => {
    const auto = { level: "auto" as const, rangePercent: 20 };
    expect(priceTuningDecision(auto, facts())).toEqual({ kind: "run" });
    expect(priceTuningDecision(auto, facts({ toMinor: 24000 }))).toEqual({ kind: "run" });
    // 220 now, from a person's 200: 250 is 25 % from 200, so it asks, though it is under 20 % from 220.
    expect(priceTuningDecision(auto, facts({ currentMinor: 22000, toMinor: 25000 }))).toMatchObject({ kind: "ask" });
    expect(priceTuningDecision(auto, facts({ toMinor: 15000 }))).toMatchObject({ kind: "ask" });
    expect(priceTuningDecision(auto, facts({ autonomyPaused: true }))).toMatchObject({ kind: "ask", why: "Every AI acting on its own is paused." });
  });
});
