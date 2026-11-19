import { describe, expect, it } from "vitest";

import { experimentCard, type CardInput } from "./experiment-card";
import { verdictOf, type VariantFigures } from "./experiment-results";
import { experimentsEn } from "@/lib/admin-messages/experiments.en";

const now = new Date("2026-11-16T12:00:00Z");

const rate = (key: string, visitors: number, conversions: number): VariantFigures => ({ key, name: key, visitors, conversions, money: null });

/** A running test of adding to the cart, its verdict worked out as the store does. */
function running(figures: VariantFigures[], days: number, over: Partial<CardInput> = {}): CardInput {
  const verdict = verdictOf({ words: experimentsEn, goal: "cart", figures, splitP: 0.5, days, minVisitors: 0, minDays: 14, currency: "NOK", locale: "nb-NO" });
  return { status: "running", goal: "cart", minDays: 14, minVisitors: 0, results: { figures, days, verdict }, now, timeZone: "Europe/Oslo", ...over };
}

describe("experimentCard", () => {
  it("calls a test with a clear winner one with an answer, and the next step is to use it", () => {
    const card = experimentCard(running([rate("a", 2400, 218), rate("b", 2380, 279)], 16));
    expect(card.state).toBe("answer");
    expect(card.next).toBe("use");
    expect(card.best).toBe("b");
    expect(card.showFigures).toBe(true);
    expect(card.progress).toMatchObject({ reached: true, share: 1, readyAround: null });
    const [b] = card.comparisons;
    expect(b.side).toBe("better");
    expect(b.low).toBeGreaterThan(0);
    expect(b.relative!).toBeGreaterThan(b.low!);
    expect(b.high!).toBeGreaterThan(b.relative!);
    // 4,780 visitors over 16 days is about 2,091 a week; B adds 2.64 points of them: about 55 more a week who add to the cart.
    expect(card.impact).toMatchObject({ key: "b", perWeek: 55 });
    expect(card.impact!.low).toBeGreaterThan(0);
    expect(card.impact!.low).toBeLessThan(55);
    expect(card.impact!.high).toBeGreaterThan(55);
  });

  it("works out what everyone seeing the winner would mean only for a rate goal with a better version", () => {
    expect(experimentCard(running([rate("a", 2400, 218), rate("b", 2380, 251)], 16)).impact).toBeNull();
    expect(experimentCard(running([rate("a", 152, 14), rate("b", 148, 12)], 3)).impact).toBeNull();
  });

  it("never shows a range above no change beside a verdict of no clear difference (the screenshot's 96 %)", () => {
    // B ahead by 16 %, a one-sided chance of about 96 %: not enough for the verdict's two-sided 95 % range.
    const input = running([rate("a", 2400, 218), rate("b", 2380, 251)], 16);
    expect(input.results!.verdict.kind).toBe("even");
    const card = experimentCard(input);
    expect(card.state).toBe("answer");
    expect(card.next).toBe("keep_original");
    expect(card.comparisons[0].chanceBetter).toBeGreaterThan(0.95);
    expect(card.comparisons[0].side).toBe("unsure");
    expect(card.comparisons[0].low!).toBeLessThan(0);
  });

  it("keeps the figures back while it is too early, and says when it is likely ready", () => {
    const card = experimentCard(running([rate("a", 152, 14), rate("b", 148, 12)], 3));
    expect(card.state).toBe("learning");
    expect(card.next).toBe("wait");
    expect(card.showFigures).toBe(false);
    // 200 visitors are needed and B has had 148 in 3 days (about 49 a day): the 14 days are later, 11 days from now.
    expect(card.progress).toMatchObject({ days: 3, minDays: 14, visitors: 148, minVisitors: 200, reached: false, readyAround: "2026-11-27" });
    expect(card.progress.share).toBeCloseTo(3 / 14);
  });

  it("waits for visitors when the days are done, at the pace so far", () => {
    const card = experimentCard(running([rate("a", 100, 9), rate("b", 98, 11)], 14));
    expect(card.progress.reached).toBe(false);
    // 102 more for B at 7 a day: 15 days.
    expect(card.progress.readyAround).toBe("2026-12-01");
  });

  it("gives the day it is likely ready on the store's calendar, east and west of UTC (D812)", () => {
    // 23:30 UTC on 16 November: already 17 November in Auckland, still 16 November in New York. Eleven days on.
    const late = new Date("2026-11-16T23:30:00Z");
    const ready = (timeZone: string) => experimentCard(running([rate("a", 152, 14), rate("b", 148, 12)], 3, { now: late, timeZone })).progress.readyAround;
    expect(ready("Pacific/Auckland")).toBe("2026-11-28");
    expect(ready("America/New_York")).toBe("2026-11-27");
    expect(ready("UTC")).toBe("2026-11-27");
  });

  it("has no date to give before anyone has been counted", () => {
    const card = experimentCard(running([rate("a", 0, 0), rate("b", 0, 0)], 0));
    expect(card.progress.readyAround).toBeNull();
    expect(card.comparisons).toEqual([]);
  });

  it("sends a broken split to a new test, and shows no figures", () => {
    const figures = [rate("a", 3000, 270), rate("b", 1000, 110)];
    const verdict = verdictOf({ words: experimentsEn, goal: "cart", figures, splitP: 0.00001, days: 20, minVisitors: 0, minDays: 14, currency: "NOK", locale: "nb-NO" });
    const card = experimentCard({ status: "running", goal: "cart", minDays: 14, minVisitors: 0, results: { figures, days: 20, verdict }, now, timeZone: "Europe/Oslo" });
    expect(card).toMatchObject({ state: "broken", next: "start_again", showFigures: false });
  });

  it("asks a draft to start, and a stopped test that is still too early to keep the original", () => {
    expect(experimentCard({ status: "draft", goal: "orders", minDays: 14, minVisitors: 0, results: null, now, timeZone: "Europe/Oslo" })).toMatchObject({ state: "draft", next: "start", showFigures: false });
    const stopped = experimentCard({ ...running([rate("a", 152, 14), rate("b", 148, 12)], 3), status: "stopped" });
    expect(stopped).toMatchObject({ state: "learning", next: "keep_original", progress: { readyAround: null } });
  });

  it("compares each of several versions at the stricter level the verdict uses", () => {
    const two = experimentCard(running([rate("a", 3000, 270), rate("b", 3000, 330)], 21));
    const three = experimentCard(running([rate("a", 3000, 270), rate("b", 3000, 330), rate("c", 3000, 270)], 21));
    expect(three.comparisons[0].low!).toBeLessThan(two.comparisons[0].low!);
  });
});
