import { describe, expect, it } from "vitest";

import { amountMinor, jsonLdBlocks, pageOffers } from "./offer-data";

/** A rival's product page as the market check reads it (D900 M2): only what its JSON-LD states, never its text. */
const page = (...blocks: unknown[]) =>
  `<!doctype html><html><head><title>Linen apron</title>${blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("")}</head><body><p>Only 99 kr today!</p></body></html>`;

describe("a product page's offer data (D900 M2)", () => {
  it("reads a Product's Offer: price in minor units, currency, availability, shipping, delivery and returns", () => {
    const [offer] = pageOffers(
      page({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Linen apron",
        sku: "LA-1",
        gtin13: "7090000000017",
        brand: { "@type": "Brand", name: "Linnet" },
        offers: {
          "@type": "Offer",
          price: "449.00",
          priceCurrency: "NOK",
          availability: "https://schema.org/InStock",
          shippingDetails: [
            {
              "@type": "OfferShippingDetails",
              shippingRate: { "@type": "MonetaryAmount", value: 79, currency: "NOK" },
              shippingDestination: { "@type": "DefinedRegion", addressCountry: "NO" },
              deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: { minValue: 0, maxValue: 1 }, transitTime: { minValue: 1, maxValue: 3 } },
            },
            { "@type": "OfferShippingDetails", shippingRate: { value: "0", currency: "NOK" }, shippingDestination: [{ addressCountry: "SE" }] },
          ],
          hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 30 },
        },
      }),
    );
    expect(offer).toEqual({
      name: "Linen apron",
      sku: "LA-1",
      gtin: "7090000000017",
      brand: "Linnet",
      priceMinor: 44900,
      currency: "NOK",
      highPriceMinor: null,
      availability: "in_stock",
      // The cheapest shipping stated: free to Sweden.
      shippingMinor: 0,
      shippingCurrency: "NOK",
      shippingCountries: ["SE"],
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      returnDays: 30,
    });
  });

  it("reads a @graph, an AggregateOffer's range and a price specification, and says no returns as 0", () => {
    const offers = pageOffers(
      page({
        "@graph": [
          { "@type": "WebPage", name: "Shop" },
          {
            "@type": ["Product"],
            name: "Mug",
            offers: { "@type": "AggregateOffer", lowPrice: "1 299,50", highPrice: "1499.50", priceCurrency: "sek", availability: "OutOfStock" },
            hasMerchantReturnPolicy: { returnPolicyCategory: "MerchantReturnNotPermitted" },
          },
          { "@type": "Product", name: "Bowl", offers: [{ "@type": "Offer", priceSpecification: { price: 12.5, priceCurrency: "EUR" } }] },
        ],
      }),
    );
    expect(offers.map((o) => [o.name, o.priceMinor, o.highPriceMinor, o.currency, o.availability, o.returnDays])).toEqual([
      ["Mug", 129950, 149950, "SEK", "out_of_stock", 0],
      ["Bowl", 1250, null, "EUR", "unknown", null],
    ]);
  });

  it("states nothing a page does not: no JSON-LD, a broken block, no price or an unknown currency", () => {
    expect(pageOffers("<html><body>Linen apron, 449 kr</body></html>")).toEqual([]);
    expect(jsonLdBlocks('<script type="application/ld+json">{ not json</script>')).toEqual([]);
    expect(pageOffers(page({ "@type": "Product", name: "A", offers: { "@type": "Offer", priceCurrency: "NOK" } }))).toEqual([]);
    expect(pageOffers(page({ "@type": "Product", name: "A", offers: { "@type": "Offer", price: "10", priceCurrency: "XYZ" } }))).toEqual([]);
  });

  it("turns written amounts into minor units, and refuses what is not a plain amount", () => {
    expect(amountMinor("199", "NOK")).toBe(19900);
    expect(amountMinor("1,299.5", "EUR")).toBe(129950);
    expect(amountMinor("1299,5", "EUR")).toBe(129950);
    expect(amountMinor(12.3, "EUR")).toBe(1230);
    expect(amountMinor("12.345", "EUR")).toBeNull();
    expect(amountMinor("12.340", "EUR")).toBe(1234);
    expect(amountMinor("1500", "JPY")).toBeNull();
    expect(amountMinor("1500", "HUF")).toBe(150000);
    expect(amountMinor("from 99", "NOK")).toBeNull();
    expect(amountMinor("", "NOK")).toBeNull();
  });
});
