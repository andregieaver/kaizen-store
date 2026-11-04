import { describe, expect, it } from "vitest";

import { movedConsentText, movedSubscriber } from "./shopify-subscribers";

const line = (over: Record<string, unknown> = {}) => ({ email: "kari@example.com", name: "Kari", state: "SUBSCRIBED", level: "SINGLE_OPT_IN", updatedAt: "2025-03-02T10:00:00.000Z", ...over });

describe("the email list moved from Shopify (Decision 1)", () => {
  it("subscribes only a subscription with its date, with Shopify's record as the words kept", () => {
    expect(movedSubscriber(line(), "Kari's shop")).toEqual({
      email: "kari@example.com",
      name: "Kari",
      consentedAt: "2025-03-02T10:00:00.000Z",
      confirmed: false,
      consentText: "Agreed to email from Kari's shop while it was on Shopify, as Shopify recorded it: SUBSCRIBED, SINGLE_OPT_IN, 2025-03-02T10:00:00.000Z.",
    });
  });

  it("confirms it only when Shopify says the opt-in was confirmed", () => {
    expect(movedSubscriber(line({ level: "CONFIRMED_OPT_IN" }), "Shop")?.confirmed).toBe(true);
    expect(movedSubscriber(line({ level: "UNKNOWN" }), "Shop")?.confirmed).toBe(false);
  });

  it("never adds anyone else: unsubscribed, not subscribed, pending, without a date or an address", () => {
    for (const over of [{ state: "UNSUBSCRIBED" }, { state: "NOT_SUBSCRIBED" }, { state: "PENDING" }, { state: "REDACTED" }, { updatedAt: null }, { email: "nobody" }]) {
      expect(movedSubscriber(line(over), "Shop")).toBeNull();
    }
  });

  it("keeps the words within what the list holds", () => {
    expect(movedConsentText("x".repeat(2000), { state: "SUBSCRIBED", level: "", updatedAt: null }).length).toBeLessThanOrEqual(1000);
  });
});
