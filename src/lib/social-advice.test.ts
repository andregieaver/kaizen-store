import { describe, expect, it } from "vitest";

import { checkedWords, mainRecommendation, parseAdvice } from "./social-advice";
import { socialFacts } from "./social-facts";

const facts = socialFacts({
  store: { name: "Keramikkverkstedet", currency: "NOK", timeZone: "Europe/Oslo" },
  now: "2026-11-25T12:00:00Z",
  sales: { revenueMinor: 120_000, orders: 4, sessions: 300, previousRevenueMinor: 100_000, previousOrders: 5 },
  goals: [],
  products: [
    { id: "mug", title: "Mug", revenueMinor: 80_000, units: 3, margin: 0.55, stock: 20, isNew: false },
    { id: "bowl", title: "Bowl", revenueMinor: 0, units: 0, margin: null, stock: 8, isNew: true },
  ],
  social: null,
  taggedPosts: [],
  creator: { written: 0, copied: 0 },
  instagram: { state: "none" },
});
const TODAY = "2026-11-25";

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    verdicts: ["Sales are growing, but little of it comes from social media.", "The mug sells best and has stock to spare.", "Instagram is not connected, so its reach is unknown."],
    recommendations: [
      { title: "Connect Instagram", why: "So the adviser can see what your posts reach.", kind: "connect_instagram", productId: null, topic: "", channels: [] },
      { title: "Show the mug in use", why: "It sells best and earns the most per sale.", kind: "write", productId: "mug", topic: "", channels: ["instagram", "facebook", "myspace"] },
      { title: "Announce the new bowl", why: "It is new and has not sold yet.", kind: "write", productId: "bowl", topic: "", channels: ["pinterest"] },
    ],
    calendar: [
      { day: "2026-11-28", channel: "instagram", productId: "mug", idea: "The mug on a slow Sunday morning." },
      { day: "2026-11-26", channel: "pinterest", productId: "bowl", idea: "The bowl from above, on linen." },
      { day: "2026-12-20", channel: "facebook", productId: null, idea: "Too far ahead." },
      { day: "2026-11-27", channel: "tiktok", productId: "vase", idea: "A product the facts did not offer." },
    ],
    ...over,
  });

describe("the adviser's answer (D870 S1.4)", () => {
  it("keeps three verdicts, the recommendations it can act on and the calendar's next two weeks, in order", () => {
    const advice = parseAdvice(answer(), facts, TODAY)!;
    expect(advice.verdicts).toHaveLength(3);
    expect(advice.recommendations.map((r) => [r.kind, r.productId, r.channels])).toEqual([
      ["connect_instagram", null, []],
      ["write", "mug", ["instagram", "facebook"]],
      ["write", "bowl", ["pinterest"]],
    ]);
    // The day too far ahead is left out; the product the facts did not offer becomes no product.
    expect(advice.calendar.map((s) => [s.day, s.channel, s.productId])).toEqual([
      ["2026-11-26", "pinterest", "bowl"],
      ["2026-11-27", "tiktok", null],
      ["2026-11-28", "instagram", "mug"],
    ]);
    expect(mainRecommendation(advice)?.productId).toBe("mug");
  });

  it("drops a sentence with a figure, a claim or a word the brand avoids, and refuses an answer left with fewer than three verdicts", () => {
    const withFigure = answer({ verdicts: ["Sales rose 20 % this month.", "The mug sells best.", "Post more often.", "Instagram is not connected."] });
    expect(parseAdvice(withFigure, facts, TODAY)?.verdicts).toEqual(["The mug sells best.", "Post more often.", "Instagram is not connected."]);
    expect(parseAdvice(answer({ verdicts: ["Only today: last chance!", "The mug sells best.", "Post more often."] }), facts, TODAY)).toBeNull();
    expect(checkedWords("A cheap way to start.", 100, ["cheap"])).toBeNull();
    expect(parseAdvice("not json", facts, TODAY)).toBeNull();
  });

  it("keeps a write without a subject or a channel out, since nothing could be written from it", () => {
    const advice = parseAdvice(
      answer({ recommendations: [{ title: "Write something", why: "Because.", kind: "write", productId: "vase", topic: "", channels: ["instagram"] }] }),
      facts,
      TODAY,
    )!;
    expect(advice.recommendations).toEqual([]);
    expect(mainRecommendation(advice)).toBeNull();
  });
});
