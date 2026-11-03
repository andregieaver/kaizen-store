import { describe, expect, it } from "vitest";

import { localized } from "./store-localized";

// D429: each country carries how it shows prices, from the store's row.
describe("localized: how each country shows prices", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    features: ["countries", "languages"],
    locales: ["nb-NO", "en-GB"],
    currencies: [],
    markets: [
      { code: "NO", currency: "NOK", defaultLocale: "nb-NO", priceDecimals: null },
      { code: "DE", currency: "EUR", defaultLocale: "de-DE", priceDecimals: "always" },
    ],
    all_markets: [],
    ...over,
  });

  it("gives each country its own decimals, else the store's, and the store's words with its main language", () => {
    const { markets } = localized(row({ price_decimals: "hide_whole", price_words: { "nb-NO": { prefix: "Kun", suffix: "" } } }));
    expect(markets.map((m) => [m.code, m.priceStyle?.decimals])).toEqual([
      ["NO", "hide_whole"],
      ["DE", "always"],
    ]);
    expect(markets[0].priceStyle?.words).toEqual({ byLocale: { "nb-NO": { prefix: "Kun", suffix: "" } }, main: "nb-NO" });
  });

  it("shows decimals always and no words for a row without the columns", () => {
    const { markets } = localized(row());
    expect(markets[0].priceStyle).toEqual({ decimals: "always", words: { byLocale: {}, main: "nb-NO" } });
  });
});
