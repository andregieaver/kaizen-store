import { describe, expect, it } from "vitest";

import { offerFresh, onRivalSite, priceGap, priceOnPage, rivalHost, rivalMove, type OfferState } from "./market-rivals";

/** A store's rivals, the pure parts (D900 M2): their hosts, their own pages and the price held against the store's. */
describe("rivals (D900 M2)", () => {
  it("takes a shop's host from what the owner typed", () => {
    expect(rivalHost("https://www.Linnet.example/p/apron?x=1")).toBe("linnet.example");
    expect(rivalHost("linnet.example")).toBe("linnet.example");
    expect(rivalHost("shop.linnet.example.")).toBe("shop.linnet.example");
    expect(rivalHost("http://linnet.example")).toBe("linnet.example");
    for (const bad of ["", "linnet", "ftp://linnet.example", "linnet example.com", "javascript:alert(1)", "https://"]) expect(rivalHost(bad), bad).toBeNull();
  });

  it("reads a page only on the rival's own site, over https", () => {
    expect(onRivalSite("linnet.example", "https://linnet.example/p/apron")).toBe(true);
    expect(onRivalSite("linnet.example", "https://www.linnet.example/p/apron")).toBe(true);
    expect(onRivalSite("linnet.example", "http://linnet.example/p/apron")).toBe(false);
    expect(onRivalSite("linnet.example", "https://notlinnet.example/p")).toBe(false);
    expect(onRivalSite("linnet.example", "https://linnet.example.evil.example/p")).toBe(false);
    expect(onRivalSite("linnet.example", "not an address")).toBe(false);
  });

  it("holds a rival's price against the store's own only in one currency", () => {
    expect(priceGap({ priceMinor: 46000, currency: "NOK" }, { priceMinor: 40000, currency: "NOK" })).toBeCloseTo(0.15);
    expect(priceGap({ priceMinor: 35000, currency: "NOK" }, { priceMinor: 40000, currency: "NOK" })).toBeCloseTo(-0.125);
    expect(priceGap({ priceMinor: 46000, currency: "NOK" }, { priceMinor: 4000, currency: "EUR" })).toBeNull();
    expect(priceGap(null, { priceMinor: 40000, currency: "NOK" })).toBeNull();
    expect(priceGap({ priceMinor: 100, currency: "NOK" }, { priceMinor: 0, currency: "NOK" })).toBeNull();
  });

  it("calls an offer old after 30 days", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(offerFresh("2026-10-27T12:00:00Z", now)).toBe(true);
    expect(offerFresh("2026-10-25T12:00:00Z", now)).toBe(false);
    expect(offerFresh("not a date", now)).toBe(false);
  });
});

/** Watching rivals (D900 M3): what a rival changed in its own favour between two reads of its page. */
describe("a rival's move (D900 M3)", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const state: OfferState = { priceMinor: 46000, currency: "NOK", availability: "in_stock", shippingMinor: 9900, shippingCurrency: "NOK", returnDays: 14 };
  const offer = (after: Partial<OfferState>, over: { previous?: (OfferState & { readAt: string }) | null; changedAt?: string | null; readAt?: string } = {}) => ({
    ...state,
    ...after,
    previous: { ...state, readAt: "2026-10-28T12:00:00Z" },
    changedAt: "2026-11-24T12:00:00Z",
    readAt: "2026-11-24T12:00:00Z",
    ...over,
  });

  it("is a price down by a twentieth or more in the same currency, else cheaper shipping, else longer returns", () => {
    expect(rivalMove(offer({ priceMinor: 40000 }), now)).toEqual({ move: "price", before: 46000, after: 40000, currency: "NOK" });
    // Under a twentieth is noise; a rise is no threat.
    expect(rivalMove(offer({ priceMinor: 44000 }), now)).toBeNull();
    expect(rivalMove(offer({ priceMinor: 50000 }), now)).toBeNull();
    expect(rivalMove(offer({ priceMinor: 3000, currency: "EUR" }), now)).toBeNull();
    expect(rivalMove(offer({ shippingMinor: 0 }), now)).toEqual({ move: "shipping", before: 9900, after: 0, currency: "NOK" });
    expect(rivalMove(offer({ returnDays: 30 }), now)).toEqual({ move: "returns", before: 14, after: 30, currency: null });
    expect(rivalMove(offer({ returnDays: null }), now)).toBeNull();
    // A price cut and free shipping at once: the price is the move told.
    expect(rivalMove(offer({ priceMinor: 40000, shippingMinor: 0 }), now)?.move).toBe("price");
  });

  it("is news only on a fresh offer changed within 30 days, and never without a read before", () => {
    expect(rivalMove(offer({ priceMinor: 40000 }, { previous: null }), now)).toBeNull();
    expect(rivalMove(offer({ priceMinor: 40000 }, { changedAt: "2026-10-01T12:00:00Z" }), now)).toBeNull();
    expect(rivalMove(offer({ priceMinor: 40000 }, { readAt: "2026-10-01T12:00:00Z" }), now)).toBeNull();
  });
});

/** Other store platforms' prices (D900 M4): whether a pricing page's text still states the figure a person kept. */
describe("a price on its page (D900 M4)", () => {
  it("finds the amount as pages write it, beside its currency's mark", () => {
    expect(priceOnPage("Basic $29/mo billed yearly", 2900, "USD")).toBe(true);
    expect(priceOnPage("Basic 29 USD per month", 2900, "USD")).toBe(true);
    expect(priceOnPage("Grow €79 per month", 7900, "EUR")).toBe(true);
    expect(priceOnPage("Fra 349 kr/mnd", 34900, "NOK")).toBe(true);
    expect(priceOnPage("Premium\u00a01\u00a0299,00\u00a0kr i måneden", 129900, "NOK")).toBe(true);
    expect(priceOnPage("Plus: $2,300 / month", 230000, "USD")).toBe(true);
    expect(priceOnPage("Shop 24,99 € monatlich", 2499, "EUR")).toBe(true);
  });

  it("does not take another amount, a part of a number, or the figure without its currency", () => {
    expect(priceOnPage("Basic $29.99/mo", 2900, "USD")).toBe(false);
    expect(priceOnPage("Basic $129/mo", 2900, "USD")).toBe(false);
    expect(priceOnPage("Over 29 themes to choose from", 2900, "USD")).toBe(false);
    expect(priceOnPage("Basic €29 per month", 2900, "USD")).toBe(false);
    expect(priceOnPage("", 2900, "USD")).toBe(false);
  });
});
