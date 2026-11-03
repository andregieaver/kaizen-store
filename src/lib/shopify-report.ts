/**
 * *Here's your shop* (D445 step 3, `docs/moving-from-shopify.md` 4.3), pure: Shopify's answers to a few small read queries turned into the
 * report Homer reads before anything is copied, what is counted, what the shop's own settings already answer (prices with or without VAT,
 * the countries and currencies it sells in), and at most three things good to know, each a code the page words. Nothing here asks
 * Shopify: `src/server/shopify-report.ts` does, and each answer may be missing (a scope not granted, a field Shopify answered with an
 * error), so every figure is a number or null, and null is never shown as 0.
 */

/** Shopify's `Count`: a number and whether it is exact or a lower bound. */
export type ShopifyCount = { count?: unknown; precision?: unknown } | null | undefined;

export type Figure = { n: number; atLeast: boolean } | null;

/** A Shopify `Count` as a figure, or null when it is not one. */
export function figureOf(value: ShopifyCount): Figure {
  if (!value || typeof value.count !== "number" || !Number.isFinite(value.count) || value.count < 0) return null;
  return { n: Math.floor(value.count), atLeast: value.precision === "AT_LEAST" };
}

/** The answers the server gathered, as Shopify gave them (each part may be missing). */
export type ShopAnswers = {
  shop?: { name?: unknown; currencyCode?: unknown; taxesIncluded?: unknown; primaryDomain?: { host?: unknown } | null; billingAddress?: { countryCodeV2?: unknown } | null } | null;
  productsCount?: ShopifyCount;
  productVariantsCount?: ShopifyCount;
  collectionsCount?: ShopifyCount;
  pagesCount?: ShopifyCount;
  blogs?: { nodes?: { articlesCount?: ShopifyCount }[] } | null;
  urlRedirectsCount?: ShopifyCount;
  locationsCount?: ShopifyCount;
  discountNodesCount?: ShopifyCount;
  customersCount?: ShopifyCount;
  subscribers?: { totalCount?: unknown } | null;
  ordersCount?: ShopifyCount;
  giftCardsCount?: ShopifyCount;
  markets?: { nodes?: { name?: unknown; regions?: { nodes?: { code?: unknown }[] } | null; currencySettings?: { baseCurrency?: { currencyCode?: unknown } | null } | null }[] } | null;
  variants?: { nodes?: { price?: unknown; compareAtPrice?: unknown }[] } | null;
};

export type ShopReport = {
  name: string;
  currency: string | null;
  /** Shopify's own setting: whether its prices include VAT. Null when it could not be read: then the question is asked, as for a file. */
  taxesIncluded: boolean | null;
  /** The countries the shop sells to, from its markets (ISO 3166 alpha-2), its billing country when it has no markets that could be read. */
  countries: string[];
  /** A market's own currency where it is not the shop's. */
  currencies: string[];
  products: Figure;
  variants: Figure;
  collections: Figure;
  pages: Figure;
  blogs: Figure;
  articles: Figure;
  customers: Figure;
  subscribers: Figure;
  orders: Figure;
  giftCardsWithMoney: Figure;
  discounts: Figure;
  redirects: Figure;
  locations: Figure;
  /** Variants in the sample read whose compare-at price is above their price (a sale shown against a reference). */
  compareAtSeen: number;
  goodToKnow: GoodToKnow[];
};

/** What the report says once, in its order of weight; the page words each code. */
export type GoodToKnow = "prices_without_vat" | "compare_at" | "gift_card_codes" | "orders_60_days" | "customers_hidden";

const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const amount = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The good-to-know items a report earns, at most three, the weightiest first. `scopes` is what the shop granted; `allOrders` whether all orders can be read. */
export function goodToKnowOf(r: Omit<ShopReport, "goodToKnow">, o: { missingScopes: readonly string[]; allOrders: boolean }): GoodToKnow[] {
  const items: GoodToKnow[] = [];
  if (r.taxesIncluded === false) items.push("prices_without_vat");
  if (r.compareAtSeen > 0) items.push("compare_at");
  if (r.giftCardsWithMoney && r.giftCardsWithMoney.n > 0) items.push("gift_card_codes");
  if (o.missingScopes.includes("read_customers") || r.customers === null) items.push("customers_hidden");
  if (!o.allOrders && r.orders && r.orders.n > 0) items.push("orders_60_days");
  return items.slice(0, 3);
}

/** The report from Shopify's answers. */
export function shopReport(a: ShopAnswers, o: { missingScopes: readonly string[]; allOrders: boolean }): ShopReport {
  const currency = CURRENCY.test(text(a.shop?.currencyCode)) ? text(a.shop?.currencyCode) : null;
  const countries = new Set<string>();
  const currencies = new Set<string>();
  for (const market of a.markets?.nodes ?? []) {
    for (const region of market.regions?.nodes ?? []) if (typeof region.code === "string" && COUNTRY.test(region.code)) countries.add(region.code);
    const own = text(market.currencySettings?.baseCurrency?.currencyCode);
    if (CURRENCY.test(own) && own !== currency) currencies.add(own);
  }
  const billing = text(a.shop?.billingAddress?.countryCodeV2);
  if (countries.size === 0 && COUNTRY.test(billing)) countries.add(billing);
  const blogNodes = a.blogs?.nodes;
  const articleFigures = (blogNodes ?? []).map((b) => figureOf(b.articlesCount));
  const articles: Figure =
    blogNodes && articleFigures.every((f) => f !== null)
      ? { n: articleFigures.reduce((s, f) => s + f!.n, 0), atLeast: articleFigures.some((f) => f!.atLeast) }
      : null;
  const subscribers = typeof a.subscribers?.totalCount === "number" && a.subscribers.totalCount >= 0 ? { n: Math.floor(a.subscribers.totalCount), atLeast: false } : null;
  const compareAtSeen = (a.variants?.nodes ?? []).filter((v) => {
    const price = amount(v.price);
    const compare = amount(v.compareAtPrice);
    return price !== null && compare !== null && compare > price;
  }).length;
  const base: Omit<ShopReport, "goodToKnow"> = {
    name: text(a.shop?.name),
    currency,
    taxesIncluded: typeof a.shop?.taxesIncluded === "boolean" ? a.shop.taxesIncluded : null,
    countries: [...countries].sort(),
    currencies: [...currencies].sort(),
    products: figureOf(a.productsCount),
    variants: figureOf(a.productVariantsCount),
    collections: figureOf(a.collectionsCount),
    pages: figureOf(a.pagesCount),
    blogs: blogNodes ? { n: blogNodes.length, atLeast: blogNodes.length >= 50 } : null,
    articles,
    customers: figureOf(a.customersCount),
    subscribers,
    orders: figureOf(a.ordersCount),
    giftCardsWithMoney: figureOf(a.giftCardsCount),
    discounts: figureOf(a.discountNodesCount),
    redirects: figureOf(a.urlRedirectsCount),
    locations: figureOf(a.locationsCount),
    compareAtSeen,
  };
  return { ...base, goodToKnow: goodToKnowOf(base, o) };
}

/** A figure as the page writes it: "1,340", "10,000+" for a lower bound, a dash for null (never 0). */
export function figureText(f: Figure, locale: string): string {
  if (f === null) return "–";
  return `${f.n.toLocaleString(locale)}${f.atLeast ? "+" : ""}`;
}
