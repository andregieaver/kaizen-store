import type { Market } from "./markets";
import { minorUnitDigits } from "./money";
import { absoluteUrl, schemaPrice, schemaProperty, type JsonLd, type StoreSeo } from "./seo";
import { baseQuantity, measureQuantity, type ShownMeasure } from "./unit-price";

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
  /** The store's own return rules (D153); the legal defaults when left out. */
  returns?: ReturnPolicyFacts;
};

/**
 * What the store's return settings (`commerce.return_settings`, D153) say to search engines: how many days goods can come back, who
 * pays for sending them, and whether goods the law leaves out of the right of withdrawal are taken back too.
 */
export type ReturnPolicyFacts = { days: number; whoPaysReturn: "shopper" | "store"; acceptExcluded: boolean };

/** The legal 14 days, returned at the shopper's cost: a store that has not set its rules. */
export const DEFAULT_RETURN_POLICY: ReturnPolicyFacts = { days: 14, whoPaysReturn: "shopper", acceptExcluded: false };

/** The longest window the settings allow (`MAX_WINDOW_DAYS`); a value outside the legal range is read as the default. */
const MIN_RETURN_DAYS = 14;
const MAX_RETURN_DAYS = 100;

/** A store's return policy as its settings row gives it (null: no row, the defaults); never throws, never gives less than the legal 14 days. */
export function returnPolicyOf(raw: unknown): ReturnPolicyFacts {
  if (!raw || typeof raw !== "object") return DEFAULT_RETURN_POLICY;
  const r = raw as Record<string, unknown>;
  const days = Number(r.windowDays);
  return {
    days: Number.isInteger(days) && days >= MIN_RETURN_DAYS && days <= MAX_RETURN_DAYS ? days : DEFAULT_RETURN_POLICY.days,
    whoPaysReturn: r.whoPaysReturn === "store" ? "store" : "shopper",
    acceptExcluded: r.acceptExcluded === true,
  };
}

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
 * The store's return policy (D153): the days it takes goods back (the legal 14, or the longer window the store set), returned by post,
 * with the shopper paying to send them unless the store has said it pays. Products the law excludes say so on their own offer, unless
 * the store takes those back too.
 */
export function returnPolicy(countries: string[], policy: ReturnPolicyFacts = DEFAULT_RETURN_POLICY): JsonLd {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: countries,
    returnPolicyCategory: `${SCHEMA}/MerchantReturnFiniteReturnWindow`,
    merchantReturnDays: Math.max(MIN_RETURN_DAYS, policy.days),
    returnMethod: `${SCHEMA}/ReturnByMail`,
    returnFees: `${SCHEMA}/${policy.whoPaysReturn === "store" ? "FreeReturn" : "ReturnFeesCustomerResponsibility"}`,
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
    ...(store.countries.length > 0 && { hasMerchantReturnPolicy: returnPolicy(store.countries, store.returns) }),
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
  /** The owner\'s custom fields the page says in plain words (D118), as properties of the product. */
  properties?: { name: string; value: string }[];
  variants: {
    id: string;
    sku: string;
    gtin: string | null;
    options: Record<string, string>;
    price: { amountMinor: number; currency: string };
    /** What is in it, with the base the market compares per (D160): the offer says its price per measure. */
    measure?: ShownMeasure | null;
    /** Downloads have no shipping and no withdrawal (D24); shipped when left out. */
    delivery?: "physical" | "digital" | "service";
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
  const policy = store.returns ?? DEFAULT_RETURN_POLICY;
  const returns =
    product.withdrawalExclusion === "none" || policy.acceptExcluded ? returnPolicy([market.code], policy) : noReturns(market.code);

  const offer = (variant: ProductFacts["variants"][number]): JsonLd => {
    const digits = minorUnitDigits(variant.price.currency);
    // Nothing to ship for a download or an appointment.
    const digital = variant.delivery === "digital" || variant.delivery === "service";
    const free =
      shipping !== null && shipping.freeOverMinor !== null && variant.price.amountMinor >= shipping.freeOverMinor;
    return {
      "@type": "Offer",
      url,
      price: schemaPrice(variant.price.amountMinor, digits),
      priceCurrency: variant.price.currency,
      // The price per kg, litre or metre as Google's merchant listing page shows it (D160): the pack's price, the pack's
      // content and, in `valueReference`, what it is compared per. The figure itself is the page's own business.
      ...(variant.measure && {
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: schemaPrice(variant.price.amountMinor, digits),
          priceCurrency: variant.price.currency,
          referenceQuantity: {
            "@type": "QuantitativeValue",
            ...measureQuantity(variant.measure),
            valueReference: { "@type": "QuantitativeValue", ...baseQuantity(variant.measure.base) },
          },
        },
      }),
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
    ...(product.properties &&
      product.properties.length > 0 && {
        additionalProperty: product.properties.map((property) => ({ "@type": "PropertyValue", name: property.name, value: property.value })),
      }),
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

/**
 * An article in a blog (D57): an `Article` by its author (a person, or the
 * store or Kaizen), published by the store or Kaizen, part of the site.
 */
export function articleJsonLd({
  origin,
  url,
  title,
  description,
  image,
  publishedAt,
  modifiedAt,
  author,
  locale,
  store,
}: {
  origin: string;
  url: string;
  title: string;
  description: string;
  image: string | null;
  publishedAt: string;
  modifiedAt: string;
  /** The author's name, or null when the store or Kaizen wrote it. */
  author: string | null;
  locale: string;
  /** For a store's article: its market's front page and the store's address. */
  store?: { homeUrl: string; storeUrl: string };
}): JsonLd {
  const publisher = { "@id": store ? storeNodeId(store.storeUrl) : `${origin}/#organization` };
  return {
    "@context": SCHEMA,
    "@type": "Article",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: url,
    headline: title.slice(0, 110),
    description,
    inLanguage: locale,
    datePublished: publishedAt,
    dateModified: modifiedAt,
    ...(image && { image: [absoluteUrl(image, origin)] }),
    author: author ? { "@type": "Person", name: author } : publisher,
    publisher,
    isPartOf: { "@id": store ? websiteNodeId(store.homeUrl) : `${origin}/#website` },
  };
}
