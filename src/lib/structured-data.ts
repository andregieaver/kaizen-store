import type { Market } from "./markets";
import { minorUnitDigits } from "./money";
import { absoluteUrl, schemaPrice, schemaProperty, type JsonLd, type StoreSeo } from "./seo";

/**
 * Schema.org data for search engines and AI assistants (decision D21):
 * the store as an OnlineStore with its return policy, its web site, product
 * lists, products with offers, shipping and variants, and breadcrumbs.
 * Pure, so it can be tested without a store.
 */

const SCHEMA = "https://schema.org";

export type StoreFacts = {
  name: string;
  /** The store's front door, absolute. */
  url: string;
  seo: StoreSeo;
  details: {
    legalName: string | null;
    organisationNumber: string | null;
    contactEmail: string | null;
    postalAddress: string | null;
    country: string | null;
  };
  /** Country codes the store sells to. */
  countries: string[];
};

export type ShippingFacts = { amountMinor: number; freeOverMinor: number | null; currency: string } | null;

export const storeNodeId = (storeUrl: string) => `${storeUrl}#store`;
const websiteNodeId = (url: string) => `${url}#website`;

/** A free-text postal address ("Gate 1\n0150 Oslo") as a PostalAddress. */
export function postalAddress(text: string | null, country: string | null): JsonLd | undefined {
  if (!text?.trim()) return undefined;
  const lines = text.split(/\r?\n|,\s*/).map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  const place = last.match(/^(?:[A-Z]{2}-)?(\d{4,5})\s+(.+)$/);
  return {
    "@type": "PostalAddress",
    streetAddress: (place ? lines.slice(0, -1) : lines).join(", ") || undefined,
    ...(place && { postalCode: place[1], addressLocality: place[2] }),
    ...(country && { addressCountry: country }),
  };
}

/**
 * The right of withdrawal as a return policy: 14 days, returned by post at
 * the shopper's cost (the legal default in Norway and the EU). Products the
 * law excludes say so on their own offer.
 */
export function returnPolicy(countries: string[]): JsonLd {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: countries,
    returnPolicyCategory: `${SCHEMA}/MerchantReturnFiniteReturnWindow`,
    merchantReturnDays: 14,
    returnMethod: `${SCHEMA}/ReturnByMail`,
    returnFees: `${SCHEMA}/ReturnFeesCustomerResponsibility`,
  };
}

const noReturns = (country: string): JsonLd => ({
  "@type": "MerchantReturnPolicy",
  applicableCountry: country,
  returnPolicyCategory: `${SCHEMA}/MerchantReturnNotPermitted`,
});

/** The business behind the store. */
export function storeNode(store: StoreFacts, origin: string): JsonLd {
  const d = store.details;
  return {
    "@type": "OnlineStore",
    "@id": storeNodeId(store.url),
    name: store.name,
    url: store.url,
    ...(d.legalName && d.legalName !== store.name && { legalName: d.legalName }),
    ...(d.organisationNumber && { taxID: d.organisationNumber }),
    ...(d.contactEmail && { email: d.contactEmail }),
    ...(store.seo.image && { image: absoluteUrl(store.seo.image.url, origin) }),
    address: postalAddress(d.postalAddress, d.country),
    ...(store.seo.sameAs.length > 0 && { sameAs: store.seo.sameAs }),
    ...(store.countries.length > 0 && { hasMerchantReturnPolicy: returnPolicy(store.countries) }),
  };
}

/** A market's home page: the store and its web site in that language. */
export function storeHomeJsonLd({
  store,
  origin,
  homeUrl,
  market,
  description,
  productUrls,
}: {
  store: StoreFacts;
  origin: string;
  homeUrl: string;
  market: Market;
  description: string;
  productUrls: string[];
}): JsonLd {
  return {
    "@context": SCHEMA,
    "@graph": [
      storeNode(store, origin),
      {
        "@type": "WebSite",
        "@id": websiteNodeId(homeUrl),
        url: homeUrl,
        name: store.name,
        ...(description && { description }),
        inLanguage: market.locale,
        publisher: { "@id": storeNodeId(store.url) },
      },
      {
        "@type": "CollectionPage",
        "@id": homeUrl,
        url: homeUrl,
        name: store.name,
        isPartOf: { "@id": websiteNodeId(homeUrl) },
        inLanguage: market.locale,
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: productUrls.length,
          itemListElement: productUrls.map((url, index) => ({ "@type": "ListItem", position: index + 1, url })),
        },
      },
    ],
  };
}

export function breadcrumbs(items: { name: string; url: string }[]): JsonLd {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export type ProductFacts = {
  id: string;
  title: string;
  description: string;
  images: { url: string; alt: string }[];
  withdrawalExclusion: string;
  manufacturer: { name: string } | null;
  variants: {
    id: string;
    sku: string;
    gtin: string | null;
    options: Record<string, string>;
    price: { amountMinor: number; currency: string };
    /** Downloads have no shipping and no withdrawal (D24); shipped when left out. */
    delivery?: "physical" | "digital";
  }[];
};

/**
 * A product page: the product (or, with variants, a ProductGroup whose
 * variants each have an offer), with price, stock, shipping to the market
 * and the return policy, plus breadcrumbs.
 */
export function productJsonLd({
  product,
  url,
  origin,
  store,
  market,
  marketHome,
  inStock,
  shipping,
}: {
  product: ProductFacts;
  url: string;
  origin: string;
  store: StoreFacts;
  market: Market;
  marketHome: string;
  inStock: (variantId: string) => boolean;
  shipping: ShippingFacts;
}): JsonLd {
  const seller = { "@id": storeNodeId(store.url) };
  const returns =
    product.withdrawalExclusion === "none" ? returnPolicy([market.code]) : noReturns(market.code);

  const offer = (variant: ProductFacts["variants"][number]): JsonLd => {
    const digits = minorUnitDigits(variant.price.currency);
    const digital = variant.delivery === "digital";
    const free =
      shipping !== null && shipping.freeOverMinor !== null && variant.price.amountMinor >= shipping.freeOverMinor;
    return {
      "@type": "Offer",
      url,
      price: schemaPrice(variant.price.amountMinor, digits),
      priceCurrency: variant.price.currency,
      availability: `${SCHEMA}/${digital || inStock(variant.id) ? "InStock" : "OutOfStock"}`,
      itemCondition: `${SCHEMA}/NewCondition`,
      seller,
      ...(shipping &&
        !digital && {
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: {
              "@type": "MonetaryAmount",
              value: schemaPrice(free ? 0 : shipping.amountMinor, minorUnitDigits(shipping.currency)),
              currency: shipping.currency,
            },
            shippingDestination: { "@type": "DefinedRegion", addressCountry: market.code },
          },
        }),
      hasMerchantReturnPolicy: digital ? noReturns(market.code) : returns,
    };
  };

  const base = {
    name: product.title,
    ...(product.description && { description: product.description }),
    image: product.images.map((image) => absoluteUrl(image.url, origin)),
    brand: { "@type": "Brand", name: product.manufacturer?.name ?? store.name },
    ...(product.manufacturer && { manufacturer: { "@type": "Organization", name: product.manufacturer.name } }),
  };

  const optionNames = [...new Set(product.variants.flatMap((v) => Object.keys(v.options)))];
  // Google reads variants only by colour, size, material or pattern; other
  // options (such as ruling) are listed as offers of one product instead.
  const variesBy = optionNames.map(schemaProperty).filter((p): p is string => p !== null);
  const node: JsonLd =
    product.variants.length > 1 && variesBy.length > 0
      ? {
          "@type": "ProductGroup",
          "@id": `${url}#product`,
          url,
          productGroupID: product.id,
          ...base,
          variesBy: variesBy.map((p) => `${SCHEMA}/${p}`),
          hasVariant: product.variants.map((variant) => ({
            "@type": "Product",
            sku: variant.sku,
            ...(variant.gtin && { gtin: variant.gtin }),
            name: `${product.title} – ${Object.values(variant.options).join(", ")}`,
            ...Object.fromEntries(
              Object.entries(variant.options).flatMap(([name, value]) => {
                const property = schemaProperty(name);
                return property ? [[property, value]] : [];
              }),
            ),
            image: base.image[0],
            offers: offer(variant),
          })),
        }
      : {
          "@type": "Product",
          "@id": `${url}#product`,
          url,
          ...base,
          sku: product.variants[0]?.sku,
          ...(product.variants[0]?.gtin && { gtin: product.variants[0].gtin }),
          offers: product.variants.length === 1 ? offer(product.variants[0]) : product.variants.map(offer),
        };

  return {
    "@context": SCHEMA,
    "@graph": [
      node,
      breadcrumbs([
        { name: store.name, url: marketHome },
        { name: product.title, url },
      ]),
    ],
  };
}

/** Kaizen's front page: the company and its site. */
export function platformJsonLd({
  origin,
  name,
  description,
  seo,
}: {
  origin: string;
  name: string;
  description: string;
  seo: StoreSeo;
}): JsonLd {
  return {
    "@context": SCHEMA,
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name,
        url: `${origin}/`,
        ...(seo.image && { image: absoluteUrl(seo.image.url, origin) }),
        ...(seo.sameAs.length > 0 && { sameAs: seo.sameAs }),
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: `${origin}/`,
        name,
        description,
        inLanguage: "en",
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };
}

/**
 * One of Kaizen's pages (D42): a `WebPage` on Kaizen's site, by Kaizen; or
 * a store's page (D54), part of the store's site in a market, by the store.
 */
export function pageJsonLd({
  origin,
  url,
  title,
  description,
  image,
  publishedAt,
  store,
}: {
  origin: string;
  url: string;
  title: string;
  description: string;
  image: string | null;
  publishedAt: string;
  /** For a store's page: its market's front page, the store's address and the market's language. */
  store?: { homeUrl: string; storeUrl: string; locale: string };
}): JsonLd {
  return {
    "@context": SCHEMA,
    "@type": "WebPage",
    "@id": url,
    url,
    name: title,
    description,
    inLanguage: store?.locale ?? "en",
    dateModified: publishedAt,
    ...(image && { primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(image, origin) } }),
    isPartOf: { "@id": store ? websiteNodeId(store.homeUrl) : `${origin}/#website` },
    publisher: { "@id": store ? storeNodeId(store.storeUrl) : `${origin}/#organization` },
  };
}
