import { describe, expect, it } from "vitest";

import { facebookAuthorizeUrl, grantsPageInsights, keptChoices, parsePageInsights, parsePagePosts, parsePages } from "./facebook-pages";

const since = new Date("2026-09-01T00:00:00Z");

describe("a store's Facebook Page (D870 S1.2b)", () => {
  it("asks Facebook Login for the Page's posts and figures, and its linked Instagram account's (unified login)", () => {
    const url = new URL(facebookAuthorizeUrl("123", "https://kaizenaflow.com/api/integrations/facebook/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v24.0/dialog/oauth");
    expect(url.searchParams.get("scope")).toBe("pages_show_list,pages_read_engagement,read_insights,instagram_basic,instagram_manage_insights,instagram_content_publish");
    expect(url.searchParams.get("state")).toBe("st");
    // On Facebook Login for Business the saved configuration holds the permissions: it is sent in their place.
    const business = new URL(facebookAuthorizeUrl("123", "https://kaizenaflow.com/api/integrations/facebook/callback", "st", "998877"));
    expect(business.searchParams.get("config_id")).toBe("998877");
    expect(business.searchParams.has("scope")).toBe(false);
  });

  it("reads the Pages the person manages, each with its token, and keeps only ids and names to choose among", () => {
    const pages = parsePages({ data: [{ id: "111", name: " Keramikk  verkstedet ", access_token: "t1" }, { id: "x", name: "Bad", access_token: "t" }, { id: "222", access_token: "" }] });
    expect(pages).toEqual([{ id: "111", name: "Keramikk verkstedet", token: "t1" }]);
    expect(keptChoices([{ id: "111", name: "A", token: "leak" }, { id: "bad", name: "B" }])).toEqual([{ id: "111", name: "A" }]);
  });

  it("says whether read_insights was granted", () => {
    expect(grantsPageInsights({ data: [{ permission: "pages_show_list", status: "granted" }, { permission: "read_insights", status: "granted" }] })).toBe(true);
    expect(grantsPageInsights({ data: [{ permission: "read_insights", status: "declined" }] })).toBe(false);
  });

  it("reads each post's reactions, comments and shares, and stops at the first post older than 90 days", () => {
    const page = parsePagePosts(
      {
        data: [
          {
            id: "111_1",
            message: "New bowls\nin the shop",
            created_time: "2026-11-20T10:00:00+0000",
            permalink_url: "https://www.facebook.com/111/posts/1",
            status_type: "added_photos",
            shares: { count: 4 },
            reactions: { summary: { total_count: 30 } },
            comments: { summary: { total_count: 6 } },
          },
          { id: "111_2", created_time: "2026-11-10T10:00:00+0000", permalink_url: "https://evil.example/x", reactions: { summary: { total_count: 2 } }, comments: { summary: { total_count: 0 } } },
          { id: "111_3", created_time: "2026-08-01T10:00:00+0000" },
        ],
        paging: { next: "https://graph.facebook.com/next" },
      },
      since,
    );
    expect(page.next).toBeNull();
    expect(page.items[0]).toMatchObject({ id: "111_1", caption: "New bowls in the shop", kind: "feed", figures: { likes: 30, comments: 6, shares: 4, interactions: 40, reach: null } });
    // Facebook leaves `shares` out of a post nobody shared; an address off Facebook is not kept.
    expect(page.items[1]).toMatchObject({ permalink: "", figures: { shares: 0, interactions: 2 } });
  });

  it("reads reach and views from the newer media-view metrics and the older impressions alike", () => {
    expect(parsePageInsights({ data: [{ name: "post_total_media_view_unique", values: [{ value: 900 }] }, { name: "post_media_view", values: [{ value: 1400 }] }] })).toEqual({ reach: 900, views: 1400 });
    expect(parsePageInsights({ data: [{ name: "post_impressions_unique", values: [{ value: 50 }] }] })).toEqual({ reach: 50, views: null });
  });
});
