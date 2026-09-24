import { describe, expect, it } from "vitest";

import { findMarket, marketForCountry, toMarket } from "./markets";

const markets = [
  toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
  toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
  toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" }),
];

describe("markets", () => {
  it("derives the slug, language and local name from the country", () => {
    expect(markets.map((m) => [m.slug, m.lang, m.name])).toEqual([
      ["no", "nb", "Norge"],
      ["se", "sv", "Sverige"],
      ["dk", "da", "Danmark"],
    ]);
  });

  it("resolves a URL slug to its market", () => {
    expect(findMarket(markets, "se")).toMatchObject({ code: "SE", currency: "SEK" });
    expect(findMarket(markets, "de")).toBeNull();
  });

  it("suggests a market from a visitor's country", () => {
    expect(marketForCountry(markets, "dk")?.slug).toBe("dk");
    expect(marketForCountry(markets, "DE")).toBeNull();
    expect(marketForCountry(markets, null)).toBeNull();
  });
});
