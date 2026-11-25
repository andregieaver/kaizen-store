import { describe, expect, it } from "vitest";

import { socialFacts, weekdayIn, type SocialFactsInput } from "./social-facts";

const NOW = "2026-11-25T12:00:00Z";
const base: SocialFactsInput = {
  store: { name: "Keramikkverkstedet", currency: "NOK", timeZone: "Europe/Oslo" },
  now: NOW,
  sales: { revenueMinor: 0, orders: 0, sessions: null, previousRevenueMinor: 0, previousOrders: 0 },
  goals: [],
  products: [],
  social: null,
  taggedPosts: [],
  creator: { written: 0, copied: 0 },
  instagram: { state: "none" },
};
const day = (n: number, hour = 10) => new Date(Date.parse(NOW) - n * 86_400_000 + (hour - 12) * 3_600_000).toISOString();

describe("the adviser's facts (D870 S1.3)", () => {
  it("for an empty store: zeros it has, nulls it cannot know, nothing to push, no Instagram", () => {
    expect(socialFacts(base)).toEqual({
      store: { name: "Keramikkverkstedet", currency: "NOK" },
      asOf: "2026-11-25",
      sales: { days: 28, revenueMinor: 0, orders: 0, sessions: null, revenueChange: null, ordersChange: null },
      goals: [],
      push: [],
      newProducts: [],
      social: null,
      taggedPosts: [],
      creator: { written: 0, copied: 0 },
      instagram: { state: "none" },
      facebook: { state: "none" },
    });
  });

  it("for a quiet store: a few sales, one product in stock to push, a new one, an account that is connected but not read", () => {
    const facts = socialFacts({
      ...base,
      sales: { revenueMinor: 120_000, orders: 4, sessions: 300, previousRevenueMinor: 100_000, previousOrders: 5 },
      products: [
        { id: "a", title: "Mug", revenueMinor: 80_000, units: 3, margin: 0.55, stock: 20, isNew: false },
        { id: "b", title: "Vase", revenueMinor: 40_000, units: 1, margin: 0.7, stock: 2, isNew: false },
        { id: "c", title: "Bowl", revenueMinor: 0, units: 0, margin: null, stock: 8, isNew: true },
      ],
      instagram: { state: "waiting" },
    });
    expect(facts.sales).toMatchObject({ revenueChange: 0.2, ordersChange: -0.2 });
    // The vase has the better margin but two left: a post would sell what is about to run out.
    expect(facts.push).toEqual([{ id: "a", title: "Mug", margin: 0.55, units: 3, stock: 20 }]);
    expect(facts.newProducts).toEqual([{ id: "c", title: "Bowl", stock: 8 }]);
    expect(facts.instagram).toEqual({ state: "waiting" });
  });

  it("for a busy store: social's share of visits and sales, the best tagged posts, and the Instagram account summed up", () => {
    const facts = socialFacts({
      ...base,
      sales: { revenueMinor: 2_000_000, orders: 80, sessions: 9_000, previousRevenueMinor: 1_600_000, previousOrders: 64 },
      social: { sessions: 1_800, orders: 12, revenueMinor: 300_000, allSessions: 9_000, allRevenueMinor: 2_000_000 },
      taggedPosts: [
        { source: "instagram", content: "p-aaaaaaaaaaaa", sessions: 120, orders: 2, revenueMinor: 50_000 },
        { source: "facebook", content: "p-bbbbbbbbbbbb", sessions: 300, orders: 5, revenueMinor: 90_000 },
        { source: "instagram", content: "bio", sessions: 80, orders: 0, revenueMinor: 0 },
        { source: "pinterest", content: "p-cccccccccccc", sessions: 10, orders: 0, revenueMinor: 0 },
      ],
      creator: { written: 9, copied: 6 },
      instagram: {
        state: "ready",
        username: "keramikk",
        posts: [
          // Tuesdays (25 Nov 2026 is a Wednesday): two feed posts reaching 1 000 and 1 400.
          { kind: "feed", postedAt: day(1), caption: "Mugs", reach: 1_000, likes: 80, saves: 20, shares: 4 },
          { kind: "feed", postedAt: day(8), caption: "Bowls", reach: 1_400, likes: 90, saves: 30, shares: 6 },
          // Fridays: two reels reaching 4 000 and 6 000.
          { kind: "reel", postedAt: day(5), caption: "Throwing a bowl", reach: 6_000, likes: 400, saves: 50, shares: 40 },
          { kind: "reel", postedAt: day(12), caption: "Glazing", reach: 4_000, likes: 300, saves: 0, shares: 10 },
          { kind: "story", postedAt: day(2), caption: "", reach: 500, likes: null, saves: null, shares: 1 },
        ],
      },
    });
    expect(facts.sales).toMatchObject({ revenueChange: 0.25, ordersChange: 0.25, sessions: 9_000 });
    expect(facts.social).toEqual({ sessions: 1_800, orders: 12, revenueMinor: 300_000, shareOfSessions: 0.2, shareOfRevenue: 0.15 });
    expect(facts.taggedPosts.map((p) => p.content)).toEqual(["p-bbbbbbbbbbbb", "p-aaaaaaaaaaaa", "bio"]);
    expect(facts.creator).toEqual({ written: 9, copied: 6 });
    const ig = facts.instagram;
    expect(ig.state).toBe("ready");
    if (ig.state !== "ready") return;
    expect(ig).toMatchObject({ username: "keramikk", posts: 5, postsPerWeek: 0.4, daysSinceLastPost: 1, bestWeekday: 5 });
    expect(ig.byKind).toEqual({ feed: { posts: 2, averageReach: 1_200 }, reel: { posts: 2, averageReach: 5_000 }, story: { posts: 1, averageReach: 500 } });
    // Saves over reach for the posts that have both: 100 of 12 400.
    expect(ig.savesPer100Reach).toBe(0.8);
    expect(ig.top.map((p) => p.caption)).toEqual(["Throwing a bowl", "Glazing", "Bowls"]);
  });

  it("sums up the Facebook Page: posts a week, average reach and what people did, the best weekday and posts (D870 S1.2b)", () => {
    const facts = socialFacts({
      ...base,
      facebook: {
        state: "ready",
        name: "Keramikkverkstedet",
        posts: [
          { postedAt: day(2), caption: "Bowls", reach: 900, interactions: 40 },
          { postedAt: day(9), caption: "Mugs", reach: 300, interactions: 10 },
          { postedAt: day(16), caption: "Vases", reach: 700, interactions: 25 },
        ],
      },
    });
    expect(facts.facebook).toMatchObject({ state: "ready", posts: 3, postsPerWeek: 0.2, daysSinceLastPost: 2, averageReach: 633, averageInteractions: 25 });
    expect(facts.facebook.state === "ready" && facts.facebook.top.map((p) => p.caption)).toEqual(["Bowls", "Vases", "Mugs"]);
    // Without read_insights there is no reach: the best posts are those people did most with.
    const noReach = socialFacts({ ...base, facebook: { state: "ready", name: "K", posts: [{ postedAt: day(2), caption: "A", reach: null, interactions: 3 }, { postedAt: day(3), caption: "B", reach: null, interactions: 9 }] } });
    expect(noReach.facebook).toMatchObject({ averageReach: null, averageInteractions: 6 });
    expect(noReach.facebook.state === "ready" && noReach.facebook.top.map((p) => p.caption)).toEqual(["B", "A"]);
    expect(socialFacts({ ...base, facebook: { state: "choose" } }).facebook).toEqual({ state: "choose" });
  });

  it("tells weekdays in the store's time zone", () => {
    expect(weekdayIn("2026-11-24T23:30:00Z", "Europe/Oslo")).toBe(3);
    expect(weekdayIn("2026-11-24T23:30:00Z", "UTC")).toBe(2);
  });
});
