import { describe, expect, it } from "vitest";

import { toMarket } from "./markets";
import { parseStoreSeo } from "./seo";
import { postalAddress, productJsonLd, storeNode, type ProductFacts, type StoreFacts } from "./structured-data";

const store: StoreFacts = {
  name: "Kopp",
  url: "https://x.test/s/kopp",
  seo: parseStoreSeo({ sameAs: ["https://instagram.com/kopp"] }),
  details: {
    legalName: "Kopp AS",
    organisationNumber: "999 999 999",
    contactEmail: "hei@kopp.no",
    postalAddress: "Storgata 1\n0155 Oslo",
    country: "NO",
  },
  countries: ["NO", "SE"],
};
const market = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });

const product = (variants: ProductFacts["variants"], withdrawalExclusion = "none"): ProductFacts => ({
  id: "p1",
  title: "Kopp",
  description: "En kopp.",
  images: [{ url: "/mug.webp", alt: "Hvit kopp" }],
  withdrawalExclusion,
  manufacturer: null,
  variants,
});
const variant = (id: string, options: Record<string, string>, amountMinor = 24900) => ({
  id,
  sku: id.toUpperCase(),
  gtin: null,
  options,
  price: { amountMinor, currency: "NOK" },
});

const build = (facts: ProductFacts, freeOverMinor: number | null = null) =>
  productJsonLd({
    product: facts,
    url: "https://x.test/s/kopp/no/p/kopp",
    origin: "https://x.test",
    store,
    market,
    marketHome: "https://x.test/s/kopp/no",
    inStock: (id) => id !== "b",
    shipping: { amountMinor: 9900, freeOverMinor, currency: "NOK" },
  })["@graph"] as Record<string, unknown>[];

describe("postalAddress", () => {
  it("reads a Norwegian address's postcode and place", () => {
    expect(postalAddress("Storgata 1, 0155 Oslo", "NO")).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Storgata 1",
      postalCode: "0155",
      addressLocality: "Oslo",
      addressCountry: "NO",
    });
    expect(postalAddress("", "NO")).toBeUndefined();
  });
});

describe("storeNode", () => {
  it("describes the business with its return policy in every country it sells to", () => {
    expect(storeNode(store, "https://x.test")).toMatchObject({
      "@type": "OnlineStore",
      "@id": "https://x.test/s/kopp#store",
      legalName: "Kopp AS",
      taxID: "999 999 999",
      sameAs: ["https://instagram.com/kopp"],
      hasMerchantReturnPolicy: { applicableCountry: ["NO", "SE"], merchantReturnDays: 14 },
    });
  });
});

describe("productJsonLd", () => {
  it("makes one product with an absolute picture, brand, shipping and returns", () => {
    const [node, trail] = build(product([variant("a", {})]));
    expect(node).toMatchObject({
      "@type": "Product",
      image: ["https://x.test/mug.webp"],
      brand: { name: "Kopp" },
      offers: {
        price: "249.00",
        availability: "https://schema.org/InStock",
        seller: { "@id": "https://x.test/s/kopp#store" },
        shippingDetails: { shippingRate: { value: "99.00", currency: "NOK" } },
        hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow" },
      },
    });
    expect(trail).toMatchObject({ "@type": "BreadcrumbList" });
  });

  it("groups colour and size variants, and lists other options as offers of one product", () => {
    const [group] = build(product([variant("a", { Farge: "Hvit" }), variant("b", { Farge: "Svart" })]));
    expect(group).toMatchObject({ "@type": "ProductGroup", variesBy: ["https://schema.org/color"] });
    expect(group.hasVariant).toMatchObject([
      { color: "Hvit", name: "Kopp – Hvit", offers: { availability: "https://schema.org/InStock" } },
      { color: "Svart", offers: { availability: "https://schema.org/OutOfStock" } },
    ]);

    const [single] = build(product([variant("a", { Linjer: "Prikket" }), variant("b", { Linjer: "Linjert" })]));
    expect(single["@type"]).toBe("Product");
    expect(single.offers).toHaveLength(2);
  });

  it("ships free above the threshold and says when the law excludes returns", () => {
    const [node] = build(product([variant("a", {}, 100000)], "custom_made"), 99900);
    expect(node.offers).toMatchObject({
      shippingDetails: { shippingRate: { value: "0.00" } },
      hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" },
    });
  });
});
