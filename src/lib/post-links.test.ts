import { describe, expect, it } from "vitest";

import { campaignParams } from "./visit-beacon";
import { postContent, postLink, postRows } from "./post-links";

const own = ["https://shop.example"];

describe("post links (D870 S1.1)", () => {
  it("tags a store's page with the channel, social, the campaign and the post, and says it counts as organic social", () => {
    expect(postLink({ address: "https://shop.example/no/p/mug?size=l", channel: "instagram", post: "abc123", campaign: "Spring Sale" }, own)).toEqual({
      url: "https://shop.example/no/p/mug?size=l&utm_source=instagram&utm_medium=social&utm_campaign=spring+sale&utm_content=p-abc123",
      channel: "organic_social",
      content: "p-abc123",
    });
  });

  it("uses the campaign social without a theme, and bio for a profile's link", () => {
    const link = postLink({ address: "https://shop.example/", channel: "pinterest", post: "bio" }, own);
    expect(link?.url).toBe("https://shop.example/?utm_source=pinterest&utm_medium=social&utm_campaign=social&utm_content=bio");
    expect(link?.channel).toBe("organic_social");
  });

  it("refuses another site's address, an unknown channel and a malformed post reference", () => {
    expect(postLink({ address: "https://evil.example/", channel: "instagram", post: "abc123" }, own)).toBeNull();
    expect(postLink({ address: "https://shop.example/", channel: "myspace" as "instagram", post: "abc123" }, own)).toBeNull();
    expect(postLink({ address: "https://shop.example/", channel: "facebook", post: "Bob@example.com" }, own)).toBeNull();
    expect(postContent("abc")).toBeNull();
    expect(postContent("abcdef")).toBe("p-abcdef");
  });

  it("is read back by the visit beacon with its content", () => {
    const link = postLink({ address: "https://shop.example/no", channel: "tiktok", post: "x1y2z3" }, own)!;
    expect(campaignParams(new URL(link.url).search)).toEqual({ utm_source: "tiktok", utm_medium: "social", utm_campaign: "social", utm_content: "p-x1y2z3" });
  });
});

describe("post rows", () => {
  const base = { source: "instagram", campaign: "social", content: "p-abc123", sessions: 0, carts: 0, orders: 0, revenueMinor: 0, cogsMinor: 0, lineRevenueMinor: 0, knownLineRevenueMinor: 0 };

  it("gives conversion and a profit when every cost is known", () => {
    const [row] = postRows([{ ...base, sessions: 40, carts: 6, orders: 2, revenueMinor: 20_000, cogsMinor: 6_000, lineRevenueMinor: 18_000, knownLineRevenueMinor: 18_000 }]);
    expect(row).toMatchObject({ conversion: 0.05, costCoverage: 1, grossProfitMinor: 12_000 });
  });

  it("gives no profit while a line's cost is missing, and zero for a post that sold nothing", () => {
    const [partial, none] = postRows([
      { ...base, sessions: 10, orders: 1, revenueMinor: 10_000, cogsMinor: 2_000, lineRevenueMinor: 10_000, knownLineRevenueMinor: 5_000 },
      { ...base, content: "bio" },
    ]);
    expect(partial).toMatchObject({ costCoverage: 0.5, grossProfitMinor: null });
    expect(none).toMatchObject({ conversion: null, costCoverage: null, grossProfitMinor: 0 });
  });
});
