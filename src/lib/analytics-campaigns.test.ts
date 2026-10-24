import { describe, expect, it } from "vitest";

import { campaignLink, campaignRows } from "./analytics-campaigns";

describe("campaigns (D303 I3)", () => {
  it("shows CAC and ROAS only where spend was entered", () => {
    const [withSpend, without] = campaignRows([
      { source: "facebook", campaign: "spring", sessions: 200, orders: 10, revenueMinor: 500_00, newCustomers: 5, spendMinor: 100_00 },
      { source: "newsletter", campaign: "october", sessions: 50, orders: 5, revenueMinor: 250_00, newCustomers: 2, spendMinor: 0 },
    ]);
    expect(withSpend).toMatchObject({ conversion: 0.05, cacMinor: 20_00, roas: 5 });
    expect(without).toMatchObject({ conversion: 0.1, cacMinor: null, roas: null });
  });

  it("builds a store's own address with tags, and says its channel", () => {
    const own = ["https://shop.example"];
    expect(campaignLink({ address: "https://shop.example/no/p/mug?size=l", source: "Facebook", medium: "paid_social", campaign: "Spring Sale" }, own)).toEqual({
      url: "https://shop.example/no/p/mug?size=l&utm_source=facebook&utm_medium=paid_social&utm_campaign=spring+sale",
      channel: "paid_social",
    });
    expect(campaignLink({ address: "https://shop.example/", source: "news", medium: "email", campaign: "oct" }, own)?.channel).toBe("email");
    expect(campaignLink({ address: "https://evil.example/", source: "x", medium: "email", campaign: "y" }, own)).toBeNull();
    expect(campaignLink({ address: "https://shop.example/", source: "", medium: "email", campaign: "y" }, own)).toBeNull();
  });
});
