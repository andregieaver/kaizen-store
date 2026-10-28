/**
 * Product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13): one normalised list of a store's variants in one market, written as
 * Google Merchant Center's RSS and the Meta, TikTok and Pinterest catalogue CSVs. Pure: the server builds the items from the catalogue's own
 * reads, so a price here is the price the storefront shows (with VAT, in the market's currency). No zod: nothing here is typed by a person.
 */

import { writeCsv, type Cell } from "./csv";
import { minorUnitDigits } from "./money";
import type { Base, Measure } from "./unit-price";

export const FEED_CHANNELS = ["google", "meta", "tiktok", "pinterest", "openai"] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

/**
 * The AI shopping channels (D353): served only while the store has switched each on (`feed_settings.channels`, off by default), besides the
 * feeds being on. ChatGPT's (`openai`) follows OpenAI's product feed spec, read on 28 October 2026 (developers.openai.com/commerce/specs/feed).
 */
export const AGENT_FEED_CHANNELS = ["openai"] as const satisfies readonly FeedChannel[];
export type AgentFeedChannel = (typeof AGENT_FEED_CHANNELS)[number];
export const isAgentChannel = (channel: FeedChannel): channel is AgentFeedChannel => (AGENT_FEED_CHANNELS as readonly string[]).includes(channel);

/** The file each channel is written as. */
export const FEED_EXTENSION: Record<FeedChannel, "xml" | "csv"> = { google: "xml", meta: "csv", tiktok: "csv", pinterest: "csv", openai: "csv" };

export type FeedAvailability = "in_stock" | "out_of_stock" | "backorder";

export type FeedItem = {
  /** The variant's SKU, else its id. */
  id: string;
  /** The product's id: the variants of one product share it. */
  groupId: string;
  title: string;
  description: string;
  link: string;
  /** Absolute addresses, the variant's own picture first. */
  images: string[];
  /** As the storefront shows it, with VAT, in minor units of `currency`. */
  priceMinor: number;
  /** The 30-day reference price when the price is a genuine reduction (D21), else null. */
  referenceMinor: number | null;
  currency: string;
  availability: FeedAvailability;
  gtin: string | null;
  brand: string;
  /** The variant's content and the base the market compares per (D160), or null. */
  measure: (Measure & { base: Base }) | null;
  /** The flat rate to the market for this item (0 when free over the threshold), or null for nothing to ship. */
  shippingMinor: number | null;
  /** The market's country, ISO 3166-1 alpha-2. */
  country: string;
  /** Google's product taxonomy id of the product's standard category (D327), from the release's mapping; none without one. */
  googleCategory?: number | null;
  /** The standard category's colour, material and pattern values (D327) in English, several joined by `/` as Google asks; none when unset. */
  color?: string | null;
  material?: string | null;
  pattern?: string | null;
};

/** Why a product is not in a feed: each is named on the admin's page. */
export const FEED_PROBLEMS = ["not_goods", "subscription_only", "business_only", "no_picture", "no_price"] as const;
export type FeedProblem = (typeof FEED_PROBLEMS)[number];

export type FeedCandidate = {
  kind: string;
  subscriptionOnly: boolean;
  audience: string;
  hasPicture: boolean;
  hasPrice: boolean;
};

/** Every reason a product cannot be advertised in a catalogue feed; empty when it can. */
export function feedProblems(product: FeedCandidate): FeedProblem[] {
  const problems: FeedProblem[] = [];
  if (product.kind !== "goods") problems.push("not_goods");
  if (product.subscriptionOnly) problems.push("subscription_only");
  if (product.audience === "business") problems.push("business_only");
  if (!product.hasPicture) problems.push("no_picture");
  if (!product.hasPrice) problems.push("no_price");
  return problems;
}

/** Major units with the currency, as every channel takes an amount: `199.00 NOK`, `1000 HUF` for a currency without decimals. */
export function feedAmount(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  if (digits === 0) return `${sign}${abs} ${currency}`;
  const scale = 10 ** digits;
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, "0")} ${currency}`;
}

/** Google's rule for a reduction: `price` is what it cost before and `sale_price` what it costs now. */
export function pricePair(item: Pick<FeedItem, "priceMinor" | "referenceMinor" | "currency">): { price: string; sale: string | null } {
  const reduced = item.referenceMinor !== null && item.referenceMinor > item.priceMinor;
  return reduced
    ? { price: feedAmount(item.referenceMinor!, item.currency), sale: feedAmount(item.priceMinor, item.currency) }
    : { price: feedAmount(item.priceMinor, item.currency), sale: null };
}

const UNIT_WORD: Record<Measure["unit"], string> = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", cm: "cm", m: "m", m2: "sqm", piece: "ct" };
const BASE_WORD: Record<Base, string> = { kg: "1kg", "100g": "100g", l: "1l", "100ml": "100ml", m: "1m", m2: "1sqm", piece: "1ct" };

/** Google's unit pricing attributes for a measure: `750ml` compared per `1l`. */
export function unitPricing(measure: FeedItem["measure"]): { measure: string; base: string } | null {
  if (!measure) return null;
  const amount = measure.amount.replace(",", ".");
  return { measure: `${amount}${UNIT_WORD[measure.unit]}`, base: BASE_WORD[measure.base] };
}

/** How long each channel lets a title and a description be; longer ones are cut, never refused. */
export const FEED_LIMITS: Record<FeedChannel, { title: number; description: number }> = {
  google: { title: 150, description: 5000 },
  meta: { title: 200, description: 9999 },
  tiktok: { title: 150, description: 10000 },
  pinterest: { title: 500, description: 10000 },
  openai: { title: 150, description: 5000 },
};

/** A text cut to a length at most, by code points, and stripped of control characters. */
export function cut(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  const chars = [...clean];
  return chars.length <= max ? clean : chars.slice(0, max - 1).join("").trimEnd() + "…";
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const GOOGLE_AVAILABILITY: Record<FeedAvailability, string> = { in_stock: "in_stock", out_of_stock: "out_of_stock", backorder: "backorder" };

/** Google Merchant Center's RSS 2.0 feed with the `g:` namespace. */
export function googleFeed(items: readonly FeedItem[], channel: { title: string; link: string }): string {
  const limits = FEED_LIMITS.google;
  const tag = (name: string, value: string | null | undefined) => (value ? `<g:${name}>${xml(value)}</g:${name}>` : "");
  const rows = items.map((item) => {
    const { price, sale } = pricePair(item);
    const unit = unitPricing(item.measure);
    return [
      "<item>",
      tag("id", item.id),
      tag("item_group_id", item.groupId),
      tag("title", cut(item.title, limits.title)),
      tag("description", cut(item.description || item.title, limits.description)),
      tag("link", item.link),
      tag("image_link", item.images[0]),
      ...item.images.slice(1, 11).map((image) => tag("additional_image_link", image)),
      tag("availability", GOOGLE_AVAILABILITY[item.availability]),
      tag("price", price),
      tag("sale_price", sale),
      tag("brand", item.brand),
      item.gtin ? tag("gtin", item.gtin) : tag("identifier_exists", "no"),
      tag("condition", "new"),
      item.googleCategory ? tag("google_product_category", String(item.googleCategory)) : "",
      tag("color", item.color),
      tag("material", item.material),
      tag("pattern", item.pattern),
      unit ? tag("unit_pricing_measure", unit.measure) + tag("unit_pricing_base_measure", unit.base) : "",
      item.shippingMinor === null
        ? ""
        : `<g:shipping>${tag("country", item.country)}${tag("price", feedAmount(item.shippingMinor, item.currency))}</g:shipping>`,
      "</item>",
    ].join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    `<channel><title>${xml(channel.title)}</title><link>${xml(channel.link)}</link><description>${xml(channel.title)}</description>`,
    ...rows,
    "</channel></rss>",
    "",
  ].join("\n");
}

type CsvChannel = Exclude<FeedChannel, "google" | "openai">;

const CSV_AVAILABILITY: Record<CsvChannel, Record<FeedAvailability, string>> = {
  meta: { in_stock: "in stock", out_of_stock: "out of stock", backorder: "available for order" },
  tiktok: { in_stock: "in stock", out_of_stock: "out of stock", backorder: "available for order" },
  pinterest: { in_stock: "in stock", out_of_stock: "out of stock", backorder: "preorder" },
};

/** The CSV columns of each catalogue, in its own names. */
export const CSV_COLUMNS: Record<CsvChannel, readonly string[]> = {
  meta: ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "additional_image_link", "brand", "gtin", "item_group_id", "shipping", "google_product_category", "color", "material", "pattern"],
  tiktok: ["sku_id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "additional_image_link", "brand", "gtin", "item_group_id"],
  pinterest: ["id", "title", "description", "link", "image_link", "additional_image_link", "price", "sale_price", "availability", "condition", "brand", "gtin", "item_group_id", "google_product_category"],
};

function csvFeed(channel: CsvChannel, items: readonly FeedItem[]): string {
  const limits = FEED_LIMITS[channel];
  const rows: Cell[][] = items.map((item) => {
    const { price, sale } = pricePair(item);
    const cells: Record<string, string> = {
      id: item.id,
      sku_id: item.id,
      title: cut(item.title, limits.title),
      description: cut(item.description || item.title, limits.description),
      availability: CSV_AVAILABILITY[channel][item.availability],
      condition: "new",
      price,
      sale_price: sale ?? "",
      link: item.link,
      image_link: item.images[0] ?? "",
      additional_image_link: item.images.slice(1, 11).join(","),
      brand: item.brand,
      gtin: item.gtin ?? "",
      item_group_id: item.groupId,
      // Meta's shipping column: country::service:price.
      shipping: item.shippingMinor === null ? "" : `${item.country}::Standard:${feedAmount(item.shippingMinor, item.currency)}`,
      google_product_category: item.googleCategory ? String(item.googleCategory) : "",
      color: item.color ?? "",
      material: item.material ?? "",
      pattern: item.pattern ?? "",
    };
    return CSV_COLUMNS[channel].map((column) => cells[column] ?? "");
  });
  return writeCsv([[...CSV_COLUMNS[channel]], ...rows]);
}

/**
 * ChatGPT's product feed (D353): OpenAI's columns, its required ones first (`item_id`, `title`, `description`, `url`, `brand`, `seller_name`,
 * `image_url`, `availability`, `price`), variants grouped (`group_id`, `listing_has_variations`), search on and checkout off (in-chat checkout
 * stays off until a payment path exists).
 */
export const OPENAI_COLUMNS = [
  "item_id",
  "title",
  "description",
  "url",
  "brand",
  "seller_name",
  "image_url",
  "availability",
  "price",
  "sale_price",
  "group_id",
  "listing_has_variations",
  "gtin",
  "condition",
  "additional_image_urls",
  "shipping_price",
  "color",
  "material",
  "seller_url",
  "is_eligible_search",
  "is_eligible_checkout",
] as const;

export function openaiFeed(items: readonly FeedItem[], store: { title: string; link: string }): string {
  const limits = FEED_LIMITS.openai;
  const variants = new Map<string, number>();
  for (const item of items) variants.set(item.groupId, (variants.get(item.groupId) ?? 0) + 1);
  const rows: Cell[][] = items.map((item) => {
    const { price, sale } = pricePair(item);
    const grouped = (variants.get(item.groupId) ?? 0) > 1 && item.groupId !== item.id;
    const cells: Record<(typeof OPENAI_COLUMNS)[number], string> = {
      item_id: item.id,
      title: cut(item.title, limits.title),
      description: cut(item.description || item.title, limits.description),
      url: item.link,
      brand: item.brand,
      seller_name: store.title,
      image_url: item.images[0] ?? "",
      availability: item.availability,
      price,
      sale_price: sale ?? "",
      group_id: grouped ? item.groupId : "",
      listing_has_variations: grouped ? "true" : "false",
      gtin: item.gtin ?? "",
      condition: "new",
      // Commas inside an address are percent-encoded, as the spec asks of a comma-separated list.
      additional_image_urls: item.images.slice(1, 11).map((url) => url.replace(/,/g, "%2C")).join(","),
      shipping_price: item.shippingMinor === null ? "" : feedAmount(item.shippingMinor, item.currency),
      color: item.color ?? "",
      material: item.material ?? "",
      seller_url: store.link,
      is_eligible_search: "true",
      is_eligible_checkout: "false",
    };
    return OPENAI_COLUMNS.map((column) => cells[column]);
  });
  return writeCsv([[...OPENAI_COLUMNS], ...rows]);
}

export const metaFeed = (items: readonly FeedItem[]) => csvFeed("meta", items);
export const tiktokFeed = (items: readonly FeedItem[]) => csvFeed("tiktok", items);
export const pinterestFeed = (items: readonly FeedItem[]) => csvFeed("pinterest", items);

/** The file of a channel, from the same items. */
export function feedFile(channel: FeedChannel, items: readonly FeedItem[], store: { title: string; link: string }): string {
  switch (channel) {
    case "google":
      return googleFeed(items, store);
    case "meta":
      return metaFeed(items);
    case "tiktok":
      return tiktokFeed(items);
    case "pinterest":
      return pinterestFeed(items);
    case "openai":
      return openaiFeed(items, store);
  }
}

/** A feed file's name in its address: `{market}-{channel}.{xml|csv}`, read back by `parseFeedFile()`. */
export const feedFileName = (market: string, channel: FeedChannel) => `${market}-${channel}.${FEED_EXTENSION[channel]}`;

export function parseFeedFile(name: string): { market: string; channel: FeedChannel } | null {
  const match = /^([a-z]{2}(?:-[a-z0-9]{2,3}){0,2})-(google|meta|tiktok|pinterest|openai)\.(xml|csv)$/.exec(name);
  if (!match) return null;
  const channel = match[2] as FeedChannel;
  return match[3] === FEED_EXTENSION[channel] ? { market: match[1], channel } : null;
}
