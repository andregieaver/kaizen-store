/**
 * What a shop's product page says about its offer in machine-readable form (D900 M2, `docs/market-check.md` 4): schema.org `Product` and
 * its `Offer` (or `AggregateOffer`), `OfferShippingDetails` and `MerchantReturnPolicy`, from the page's JSON-LD. Pure. The model never
 * reads a price off a page's text: a fact is taken only from here, and a page without such data gives none.
 */

import { isCurrency, minorUnitDigits } from "./money";

export type Availability = "in_stock" | "out_of_stock" | "preorder" | "backorder" | "limited" | "discontinued" | "unknown";

export type PageOffer = {
  /** The product's name as the page gives it. */
  name: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  /** The price in minor units of `currency`, as the shop asks it (with VAT where the shop shows it so: the page's own figure). */
  priceMinor: number;
  currency: string;
  /** An AggregateOffer's highest price, when it gives one: a range of variants. */
  highPriceMinor: number | null;
  availability: Availability;
  /** The cheapest shipping the page states, in minor units of `shippingCurrency`, and the countries it is for (empty: not said). */
  shippingMinor: number | null;
  shippingCurrency: string | null;
  shippingCountries: string[];
  /** Days from order to delivery, handling and transit added up, when the page says. */
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  /** Days to return, when the page states a finite window; 0 when returns are not permitted. */
  returnDays: number | null;
};

const LD_JSON = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** The JSON-LD blocks of an HTML page, each parsed, those that do not parse left out. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const match of html.matchAll(LD_JSON)) {
    const raw = match[1].replace(/^\s*<!--|-->\s*$/g, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "").trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // A block a shop wrote wrongly is no fact.
    }
  }
  return out;
}

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** A node's types, without the schema.org prefix. */
function typesOf(node: Node): string[] {
  return list(node["@type"]).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ""));
}

/** Every node in the blocks, nested ones and `@graph` members included, at most `limit` (a page with thousands is cut). */
function allNodes(blocks: readonly unknown[], limit = 2000): Node[] {
  const out: Node[] = [];
  // Breadth first, so nodes come in the page's order: a page's own product before the products it links to.
  const queue = [...blocks];
  while (queue.length > 0 && out.length < limit) {
    const next = queue.shift();
    if (Array.isArray(next)) queue.unshift(...next);
    else if (isNode(next)) {
      out.push(next);
      for (const value of Object.values(next)) if (typeof value === "object" && value !== null) queue.push(value);
    }
  }
  return out;
}

const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (isNode(v) && typeof v.name === "string") return v.name.trim() || null;
  return null;
};

/** An amount as written ("199.00", 199, "1 299,50") in minor units of the currency, or null when it is not a plain amount or the currency is unknown. */
export function amountMinor(value: unknown, currency: string): number | null {
  // A currency the platform does not keep (D109) is no figure it can compare.
  if (!isCurrency(currency)) return null;
  const digits = minorUnitDigits(currency);
  let s = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  s = s.replace(/[\s ]/g, "");
  // A comma as the decimal mark ("1299,50") when there is no point; a comma as thousands ("1,299.50") otherwise.
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return null;
  return Number(whole) * 10 ** digits + Number((fraction + "0".repeat(digits)).slice(0, digits) || "0");
}

const AVAILABILITY: Record<string, Availability> = {
  instock: "in_stock",
  instoreonly: "in_stock",
  onlineonly: "in_stock",
  limitedavailability: "limited",
  outofstock: "out_of_stock",
  soldout: "out_of_stock",
  preorder: "preorder",
  presale: "preorder",
  backorder: "backorder",
  discontinued: "discontinued",
};

function availabilityOf(v: unknown): Availability {
  const key = String(v ?? "").replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
  return AVAILABILITY[key] ?? "unknown";
}

/** The days a `QuantitativeValue` gives (min and max, or a single value), else null. */
function days(v: unknown): { min: number; max: number } | null {
  if (!isNode(v)) return null;
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x) : null);
  const min = num(v.minValue) ?? num(v.value);
  const max = num(v.maxValue) ?? num(v.value) ?? min;
  return min === null || max === null ? null : { min, max };
}

function countries(v: unknown): string[] {
  return list(v)
    .flatMap((d) => (isNode(d) ? list(d.addressCountry) : [d]))
    .map((c) => (isNode(c) ? text(c) : typeof c === "string" ? c : null))
    .filter((c): c is string => c !== null && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
}

/** The cheapest shipping a list of `OfferShippingDetails` states, with its countries and delivery days. */
function shippingOf(details: unknown): Pick<PageOffer, "shippingMinor" | "shippingCurrency" | "shippingCountries" | "deliveryDaysMin" | "deliveryDaysMax"> {
  let best: { minor: number; currency: string; countries: string[]; min: number | null; max: number | null } | null = null;
  for (const d of list(details).filter(isNode)) {
    const rate = list(d.shippingRate).find(isNode);
    const currency = rate && typeof rate.currency === "string" && isCurrency(rate.currency.toUpperCase()) ? rate.currency.toUpperCase() : null;
    const minor = rate && currency ? amountMinor(rate.value, currency) : null;
    const delivery = isNode(d.deliveryTime) ? d.deliveryTime : null;
    const handling = delivery ? days(delivery.handlingTime) : null;
    const transit = delivery ? days(delivery.transitTime) : null;
    const min = handling || transit ? (handling?.min ?? 0) + (transit?.min ?? 0) : null;
    const max = handling || transit ? (handling?.max ?? 0) + (transit?.max ?? 0) : null;
    if (minor === null || !currency) continue;
    if (!best || minor < best.minor) best = { minor, currency, countries: countries(d.shippingDestination), min, max };
  }
  return best
    ? { shippingMinor: best.minor, shippingCurrency: best.currency, shippingCountries: best.countries, deliveryDaysMin: best.min, deliveryDaysMax: best.max }
    : { shippingMinor: null, shippingCurrency: null, shippingCountries: [], deliveryDaysMin: null, deliveryDaysMax: null };
}

function returnDaysOf(policy: unknown): number | null {
  const p = list(policy).find(isNode);
  if (!p) return null;
  const category = String(p.returnPolicyCategory ?? "").toLowerCase();
  if (category.endsWith("merchantreturnnotpermitted")) return 0;
  const n = typeof p.merchantReturnDays === "number" ? p.merchantReturnDays : typeof p.merchantReturnDays === "string" && /^\d+$/.test(p.merchantReturnDays) ? Number(p.merchantReturnDays) : null;
  return n !== null && n >= 0 && n <= 3650 ? n : null;
}

/** The offer of one `Product` node, or null when it states no price in a known currency. */
function offerOf(product: Node): PageOffer | null {
  for (const offer of list(product.offers).filter(isNode)) {
    const types = typesOf(offer);
    const spec = list(offer.priceSpecification).find(isNode);
    const currencyRaw = (offer.priceCurrency ?? spec?.priceCurrency) as unknown;
    const currency = typeof currencyRaw === "string" ? currencyRaw.toUpperCase() : "";
    if (!isCurrency(currency)) continue;
    const aggregate = types.includes("AggregateOffer");
    const price = amountMinor(aggregate ? (offer.lowPrice ?? offer.price) : (offer.price ?? spec?.price), currency);
    if (price === null) continue;
    const high = aggregate ? amountMinor(offer.highPrice, currency) : null;
    const gtin = text(product.gtin13) ?? text(product.gtin) ?? text(product.gtin14) ?? text(product.gtin12) ?? text(product.gtin8);
    return {
      name: text(product.name) ?? "",
      sku: text(product.sku),
      gtin,
      brand: text(product.brand),
      priceMinor: price,
      currency,
      highPriceMinor: high !== null && high > price ? high : null,
      availability: availabilityOf(offer.availability),
      ...shippingOf(offer.shippingDetails),
      returnDays: returnDaysOf(offer.hasMerchantReturnPolicy ?? product.hasMerchantReturnPolicy),
    };
  }
  return null;
}

/** The offers a page states, one per `Product` with a price, at most `limit`, in the page's order. */
export function pageOffers(html: string, limit = 20): PageOffer[] {
  const nodes = allNodes(jsonLdBlocks(html));
  const products = nodes.filter((n) => typesOf(n).includes("Product"));
  const out: PageOffer[] = [];
  for (const product of products) {
    const offer = offerOf(product);
    if (offer) out.push(offer);
    if (out.length >= limit) break;
  }
  return out;
}
