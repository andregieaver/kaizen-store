import { describe, expect, it } from "vitest";

import { grantsInsights, insightsDue, METRICS, parseInsights, parseMediaPage } from "./social-insights";

const since = new Date("2026-09-01T00:00:00Z");

describe("an Instagram account's posts and their figures (D870 S1.2)", () => {
  it("reads a page of posts on or after the start, sorts each into feed, reel or story, and follows the next page", () => {
    const page = parseMediaPage(
      {
        data: [
          { id: "111", caption: "  New  mugs\nare in ", media_type: "IMAGE", media_product_type: "FEED", permalink: "https://www.instagram.com/p/abc/", timestamp: "2026-11-20T10:00:00+0000" },
          { id: "222", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://evil.example/x", timestamp: "2026-10-01T10:00:00+0000" },
          { id: "not-a-number", timestamp: "2026-10-01T10:00:00+0000" },
        ],
        paging: { next: "https://graph.instagram.com/v22.0/me/media?after=x" },
      },
      since,
    );
    expect(page.items).toEqual([
      { id: "111", caption: "New mugs are in", kind: "feed", mediaType: "IMAGE", permalink: "https://www.instagram.com/p/abc/", at: "2026-11-20T10:00:00.000Z" },
      { id: "222", caption: "", kind: "reel", mediaType: "VIDEO", permalink: "", at: "2026-10-01T10:00:00.000Z" },
    ]);
    expect(page.next).toBe("https://graph.instagram.com/v22.0/me/media?after=x");
  });

  it("stops at the first older post, and follows no page on another host", () => {
    const old = parseMediaPage({ data: [{ id: "1", timestamp: "2026-08-01T00:00:00+0000" }], paging: { next: "https://graph.instagram.com/next" } }, since);
    expect(old).toEqual({ items: [], next: null });
    expect(parseMediaPage({ data: [], paging: { next: "https://evil.example/next" } }, since).next).toBeNull();
    expect(parseMediaPage(null, since)).toEqual({ items: [], next: null });
  });

  it("reads each metric's count, from values or a total, and leaves out what is not a count", () => {
    expect(
      parseInsights({
        data: [
          { name: "reach", values: [{ value: 1200 }] },
          { name: "saved", values: [{ value: 14 }] },
          { name: "total_interactions", total_value: { value: 87 } },
          { name: "likes", values: [{ value: -3 }] },
          { name: "follows", values: [{ value: 2 }] },
        ],
      }),
    ).toEqual({ reach: 1200, views: null, likes: null, comments: null, saves: 14, shares: null, interactions: 87 });
  });

  it("asks a story only for what a story has", () => {
    expect(METRICS.story).not.toContain("likes");
    expect(METRICS.feed).toContain("saved");
  });

  it("reads again after a day, and knows the insights permission when the token carries it", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(insightsDue(null, now)).toBe(true);
    expect(insightsDue(new Date("2026-11-25T00:00:00Z"), now)).toBe(false);
    expect(insightsDue(new Date("2026-11-24T11:00:00Z"), now)).toBe(true);
    expect(grantsInsights("instagram_business_basic,instagram_business_manage_insights")).toBe(true);
    expect(grantsInsights(["instagram_business_basic"])).toBe(false);
    expect(grantsInsights(undefined)).toBe(false);
  });
});
