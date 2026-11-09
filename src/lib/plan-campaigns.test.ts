import { describe, expect, it } from "vitest";

import { campaignLasts, planCards, type PublicPlans } from "./plan-offer";
import { campaignCode, campaignFor, campaignPrice, campaignRuns, campaignsMeet, cardCampaignPrice, publicCampaign, type PlanCampaign } from "./plan-campaigns";

const winter: PlanCampaign = {
  id: "c1",
  code: "WINTER-AB12",
  name: "Winter offer",
  kind: "percent",
  percent: 50,
  amounts: {},
  duration: "repeating",
  durationMonths: 3,
  active: true,
  startsAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-30T22:59:59.000Z",
  planIds: [],
};

describe("timed plan prices (D524)", () => {
  it("runs from its start to its end while switched on", () => {
    expect(campaignRuns(winter, new Date("2026-10-31T23:00:00Z"))).toBe(false);
    expect(campaignRuns(winter, new Date("2026-11-15T12:00:00Z"))).toBe(true);
    expect(campaignRuns(winter, new Date("2026-11-30T23:00:00Z"))).toBe(false);
    expect(campaignRuns({ ...winter, active: false }, new Date("2026-11-15T12:00:00Z"))).toBe(false);
  });

  it("applies to its plans in a currency it gives in, the latest started first", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const fixed: PlanCampaign = { ...winter, id: "c2", kind: "fixed", percent: 0, amounts: { nok: 10_000 }, planIds: ["pro"], startsAt: "2026-11-10T00:00:00.000Z" };
    expect(campaignFor([winter], "basic", "NOK", now)?.id).toBe("c1");
    expect(campaignFor([winter, fixed], "pro", "NOK", now)?.id).toBe("c2");
    // An amount only where it has one; its plans only.
    expect(campaignFor([fixed], "pro", "EUR", now)).toBeNull();
    expect(campaignFor([fixed], "basic", "NOK", now)).toBeNull();
  });

  it("works out the price, never below zero, and whether two campaigns meet", () => {
    expect(campaignPrice(39_900, winter, "NOK")).toBe(19_950);
    expect(campaignPrice(39_900, { kind: "fixed", percent: 0, amounts: { nok: 50_000 } }, "NOK")).toBe(0);
    expect(campaignsMeet(winter, { startsAt: "2026-11-30T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", planIds: ["pro"] })).toBe(true);
    expect(campaignsMeet(winter, { startsAt: "2026-12-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", planIds: [] })).toBe(false);
    expect(campaignsMeet({ ...winter, planIds: ["basic"] }, { ...winter, planIds: ["pro"] })).toBe(false);
  });

  it("makes a code nobody types from the name, within the codes' shape", () => {
    expect(campaignCode("Vintertilbud på Pro!", "a1b2-c3d4")).toBe("VINTERTILBUD-PA-PRO-A1B2C3D4");
    expect(campaignCode("✨", "")).toBe("CAMPAIGN-CAMPAIGN");
    expect(campaignCode("x".repeat(80), "zz").length).toBeLessThanOrEqual(40);
  });

  it("shows the campaign's price on the cards it gives on, and for how long, never its code", () => {
    const shown = publicCampaign(winter);
    expect(shown).not.toHaveProperty("code");
    expect(cardCampaignPrice(shown, "basic", 39_900, "NOK")).toBe(19_950);
    expect(cardCampaignPrice({ ...shown, planIds: ["pro"] }, "basic", 39_900, "NOK")).toBeNull();
    expect(campaignLasts(shown, "month")).toBe(3);
    expect(campaignLasts(shown, "year")).toBe("once");
    expect(campaignLasts({ duration: "forever", durationMonths: null }, "month")).toBe("forever");
    const data: PublicPlans = {
      plans: [{ id: "basic", name: "Basic", description: "", saleFeeBps: 0, position: 1, prices: [{ currency: "NOK", interval: "month", amountMinor: 39_900 }], featureIds: [] }],
      features: [],
      campaign: shown,
    };
    expect(planCards(data, {}).cards[0].campaign).toEqual({ amountMinor: 19_950, lasts: 3 });
    expect(planCards({ ...data, campaign: null }, {}).cards[0].campaign).toBeNull();
  });
});
