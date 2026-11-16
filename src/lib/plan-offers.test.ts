import { describe, expect, it } from "vitest";

import { isPlanOfferKey, PLAN_OFFER_KEYS, planOfferDraft } from "./plan-offers";

describe("ready plan offers (round 16)", () => {
  it("knows its four offers and nothing else", () => {
    expect(PLAN_OFFER_KEYS).toHaveLength(4);
    expect(isPlanOfferKey("start20")).toBe(true);
    expect(isPlanOfferKey("free")).toBe(false);
  });

  it("gives codes their shape and the weekend campaign the coming Friday to Sunday", () => {
    expect(planOfferDraft("welcome")).toEqual({ code: "WELCOME", campaign: false, percent: 100, duration: "once" });
    expect(planOfferDraft("start20").durationMonths).toBe(3);
    expect(planOfferDraft("partner").duration).toBe("forever");
    // Monday 16 November 2026 at noon in Oslo.
    const weekend = planOfferDraft("weekend", new Date("2026-11-16T11:00:00Z"));
    expect(weekend).toMatchObject({ campaign: true, percent: 30, startsAt: "2026-11-20", expiresAt: "2026-11-22" });
    expect(weekend.code).toBeUndefined();
  });
});
