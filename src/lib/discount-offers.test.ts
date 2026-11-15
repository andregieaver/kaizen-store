import { describe, expect, it } from "vitest";

import { endsAtLocal, isOfferKey, OFFER_KEYS, OFFERS } from "./discount-offers";

describe("ready offers", () => {
  it("has a valid code for each offer", () => {
    for (const key of OFFER_KEYS) expect(OFFERS[key].code).toMatch(/^[A-Z0-9_-]{3,40}$/);
  });
  it("knows its keys", () => {
    expect(isOfferKey("welcome")).toBe(true);
    expect(isOfferKey("nope")).toBe(false);
    expect(isOfferKey(undefined)).toBe(false);
  });
  it("ends two weeks later in Oslo time", () => {
    expect(endsAtLocal(14, new Date("2026-11-15T12:00:00Z"))).toBe("2026-11-29T23:59");
  });
});
