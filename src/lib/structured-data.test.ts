import { describe, expect, it } from "vitest";

import { toMarket } from "./markets";
import { parseStoreSeo } from "./seo";
import {
  DEFAULT_RETURN_POLICY,
  postalAddress,
  productJsonLd,
  returnPolicy,
  returnPolicyOf,
  storeNode,
  type ProductFacts,
  type ReturnPolicyFacts,
  type StoreFacts,
} from "./structured-data";

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

const build = (facts: ProductFacts, freeOverMinor: number | null = null, returns?: ReturnPolicyFacts) =>
  productJsonLd({
    product: facts,
    url: "https://x.test/s/kopp/no/p/kopp",
    origin: "https://x.test",
    store: returns ? { ...store, returns } : store,
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

  it("offers a download as always in stock, with no shipping and no returns", () => {
    const [node] = build(product([{ ...variant("b", {}), delivery: "digital" }]));
    const offer = node.offers as Record<string, unknown>;
    expect(offer).toMatchObject({
      availability: "https://schema.org/InStock",
      hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" },
    });
    expect(offer.shippingDetails).toBeUndefined();
  });
});

describe("the return policy comes from the store's return settings (D153)", () => {
  it("is the legal 14 days at the shopper's cost when the store has not set its rules", () => {
    expect(returnPolicy(["NO"])).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: ["NO"],
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 14,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    });
    expect(returnPolicy(["NO"], DEFAULT_RETURN_POLICY)).toEqual(returnPolicy(["NO"]));
  });

  it("says the store's own window and that it pays for the return when it does", () => {
    const policy: ReturnPolicyFacts = { days: 30, whoPaysReturn: "store", acceptExcluded: false };
    expect(returnPolicy(["NO", "SE"], policy)).toMatchObject({ applicableCountry: ["NO", "SE"], merchantReturnDays: 30, returnFees: "https://schema.org/FreeReturn" });
    expect(returnPolicy(["NO"], { ...policy, whoPaysReturn: "shopper" })).toMatchObject({ merchantReturnDays: 30, returnFees: "https://schema.org/ReturnFeesCustomerResponsibility" });
  });

  it("never says fewer days than the law gives", () => {
    expect(returnPolicy(["NO"], { days: 7, whoPaysReturn: "shopper", acceptExcluded: false })).toMatchObject({ merchantReturnDays: 14 });
  });

  it("is the store's policy on the store and on each product's offer", () => {
    const policy: ReturnPolicyFacts = { days: 45, whoPaysReturn: "store", acceptExcluded: false };
    expect(storeNode({ ...store, returns: policy }, "https://x.test")).toMatchObject({
      hasMerchantReturnPolicy: { applicableCountry: ["NO", "SE"], merchantReturnDays: 45, returnFees: "https://schema.org/FreeReturn" },
    });
    const [node] = build(product([variant("a", {})]), null, policy);
    expect(node.offers).toMatchObject({
      hasMerchantReturnPolicy: { applicableCountry: ["NO"], merchantReturnDays: 45, returnFees: "https://schema.org/FreeReturn" },
    });
    // A store with no settings says the legal default, as before.
    expect(storeNode(store, "https://x.test")).toMatchObject({ hasMerchantReturnPolicy: { merchantReturnDays: 14, returnFees: "https://schema.org/ReturnFeesCustomerResponsibility" } });
  });

  it("keeps saying no returns for goods the law excludes, unless the store takes those back too", () => {
    const excluded = product([variant("a", {}, 100000)], "custom_made");
    expect(build(excluded)[0].offers).toMatchObject({ hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" } });
    expect(build(excluded, null, { days: 14, whoPaysReturn: "shopper", acceptExcluded: false })[0].offers).toMatchObject({
      hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" },
    });
    expect(build(excluded, null, { days: 30, whoPaysReturn: "shopper", acceptExcluded: true })[0].offers).toMatchObject({
      hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 30 },
    });
  });

  it("never offers a download back, whatever the store accepts", () => {
    const [node] = build(product([{ ...variant("b", {}), delivery: "digital" }]), null, { days: 30, whoPaysReturn: "store", acceptExcluded: true });
    expect(node.offers).toMatchObject({ hasMerchantReturnPolicy: { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" } });
  });

  it("reads a settings row without trusting it", () => {
    expect(returnPolicyOf(null)).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf(undefined)).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf("14")).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf({ windowDays: 30, whoPaysReturn: "store", acceptExcluded: true })).toEqual({ days: 30, whoPaysReturn: "store", acceptExcluded: true });
    expect(returnPolicyOf({ windowDays: "60", whoPaysReturn: "shopper", acceptExcluded: false })).toEqual({ days: 60, whoPaysReturn: "shopper", acceptExcluded: false });
    // A window the settings could not hold, or an unknown payer, is read as the legal default.
    expect(returnPolicyOf({ windowDays: 3, whoPaysReturn: "somebody", acceptExcluded: "yes" })).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf({ windowDays: 400 })).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf({ windowDays: 30.5 })).toEqual(DEFAULT_RETURN_POLICY);
    expect(returnPolicyOf({ windowDays: null })).toEqual(DEFAULT_RETURN_POLICY);
  });
});

describe("productJsonLd: the price per measure (D160)", () => {
  const measured = (id: string, measure: { amount: string; unit: "g" | "kg" | "ml" | "cl" | "l" | "cm" | "m" | "m2" | "piece"; base: "kg" | "100g" | "l" | "100ml" | "m" | "m2" | "piece" }, amountMinor = 4990) => ({
    ...variant(id, {}, amountMinor),
    measure,
  });
  const spec = (v: ReturnType<typeof measured>) => {
    const [node] = build(product([v]));
    return (node.offers as Record<string, unknown>).priceSpecification as Record<string, unknown>;
  };

  it("says the pack's price, its content and what it is compared per, as Google's merchant listing page shows it", () => {
    expect(spec(measured("a", { amount: "250", unit: "g", base: "kg" }))).toEqual({
      "@type": "UnitPriceSpecification",
      price: "49.90",
      priceCurrency: "NOK",
      referenceQuantity: {
        "@type": "QuantitativeValue",
        value: "250",
        unitCode: "GRM",
        valueReference: { "@type": "QuantitativeValue", value: "1", unitCode: "KGM" },
      },
    });
  });

  it("writes every unit and base with its code", () => {
    const cases: [Parameters<typeof measured>[1], string, string, string, string][] = [
      [{ amount: "250", unit: "g", base: "100g" }, "250", "GRM", "100", "GRM"],
      [{ amount: "1.5", unit: "kg", base: "kg" }, "1.5", "KGM", "1", "KGM"],
      [{ amount: "330", unit: "ml", base: "l" }, "330", "MLT", "1", "LTR"],
      [{ amount: "33", unit: "cl", base: "100ml" }, "33", "CLT", "100", "MLT"],
      [{ amount: "0.75", unit: "l", base: "l" }, "0.75", "LTR", "1", "LTR"],
      [{ amount: "3", unit: "m", base: "m" }, "3", "MTR", "1", "MTR"],
      [{ amount: "0.5", unit: "m2", base: "m2" }, "0.5", "MTK", "1", "MTK"],
      [{ amount: "6", unit: "piece", base: "piece" }, "6", "C62", "1", "C62"],
    ];
    for (const [measure, value, unitCode, baseValue, baseCode] of cases) {
      expect(spec(measured("a", measure)).referenceQuantity).toMatchObject({
        value,
        unitCode,
        valueReference: { value: baseValue, unitCode: baseCode },
      });
    }
  });

  it("is written even when the content equals what it is compared per (the shop leaves the line out, the data keeps the quantity)", () => {
    expect(spec(measured("a", { amount: "1", unit: "kg", base: "kg" })).referenceQuantity).toMatchObject({ value: "1", unitCode: "KGM" });
  });

  it("has none for a variant without content, and each offer of a group has its own", () => {
    const [node] = build(product([variant("a", {})]));
    expect((node.offers as Record<string, unknown>).priceSpecification).toBeUndefined();
    const [group] = build(product([{ ...measured("a", { amount: "250", unit: "g", base: "kg" }), options: { Farge: "Hvit" } }, { ...variant("b", { Farge: "Svart" }) }]));
    const [first, second] = group.hasVariant as { offers: Record<string, unknown> }[];
    expect(first.offers.priceSpecification).toBeDefined();
    expect(second.offers.priceSpecification).toBeUndefined();
  });

  it("carries the price the offer carries (a subscription-only product passes the subscriber's), and the base the market shows", () => {
    // The page hands the structured data the amount it shows; a German page's base arrives as kg even when the owner chose 100 g.
    const priced = spec(measured("a", { amount: "250", unit: "g", base: "kg" }, 4491));
    expect(priced.price).toBe("44.91");
  });
});
