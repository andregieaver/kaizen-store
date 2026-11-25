import { describe, expect, it } from "vitest";

import { offerFresh, onRivalSite, priceGap, rivalHost } from "./market-rivals";

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
