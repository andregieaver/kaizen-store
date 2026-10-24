import { describe, expect, it } from "vitest";

import { parseCsv, recordsOf } from "./csv";
import {
  CSV_COLUMNS,
  cut,
  feedAmount,
  feedFileName,
  feedProblems,
  googleFeed,
  metaFeed,
  parseFeedFile,
  pinterestFeed,
  pricePair,
  tiktokFeed,
  unitPricing,
  type FeedItem,
} from "./feeds";

const ITEM: FeedItem = {
  id: "MUG-1",
  groupId: "p1",
  title: "Mug <white> & \"blue\"",
  description: "A mug.",
  link: "https://shop.example/no/p/mug",
  images: ["https://cdn.example/a.webp", "https://cdn.example/b.webp"],
  priceMinor: 19900,
  referenceMinor: null,
  currency: "NOK",
  availability: "in_stock",
  gtin: "7038010009457",
  brand: "Kari Keramikk",
  measure: null,
  shippingMinor: 9900,
  country: "NO",
};

describe("feed amounts and prices", () => {
  it("writes major units with the currency", () => {
    expect(feedAmount(19900, "NOK")).toBe("199.00 NOK");
    expect(feedAmount(5, "EUR")).toBe("0.05 EUR");
    expect(feedAmount(1000, "HUF")).toBe("10.00 HUF");
  });

  it("puts the reference in price and the price in sale_price only for a genuine reduction", () => {
    expect(pricePair({ priceMinor: 15000, referenceMinor: 19900, currency: "NOK" })).toEqual({ price: "199.00 NOK", sale: "150.00 NOK" });
    expect(pricePair({ priceMinor: 19900, referenceMinor: 19900, currency: "NOK" })).toEqual({ price: "199.00 NOK", sale: null });
    expect(pricePair({ priceMinor: 19900, referenceMinor: null, currency: "NOK" })).toEqual({ price: "199.00 NOK", sale: null });
  });

  it("says a measure in Google's units", () => {
    expect(unitPricing({ amount: "0,75", unit: "l", base: "l" })).toEqual({ measure: "0.75l", base: "1l" });
    expect(unitPricing({ amount: "6", unit: "piece", base: "piece" })).toEqual({ measure: "6ct", base: "1ct" });
    expect(unitPricing(null)).toBeNull();
  });

  it("cuts long texts and drops control characters", () => {
    expect(cut("abc\u0007def", 10)).toBe("abcdef");
    expect([...cut("x".repeat(200), 150)]).toHaveLength(150);
  });
});

describe("what is left out", () => {
  it("names every reason", () => {
    expect(feedProblems({ kind: "goods", subscriptionOnly: false, audience: "all", hasPicture: true, hasPrice: true })).toEqual([]);
    expect(feedProblems({ kind: "appointment", subscriptionOnly: true, audience: "business", hasPicture: false, hasPrice: false })).toEqual([
      "not_goods",
      "subscription_only",
      "business_only",
      "no_picture",
      "no_price",
    ]);
  });
});

describe("Google Merchant Center", () => {
  const xml = googleFeed([ITEM, { ...ITEM, id: "MUG-2", gtin: null, priceMinor: 15000, referenceMinor: 19900, measure: { amount: "330", unit: "ml", base: "l" }, shippingMinor: null }], {
    title: "Kari & co",
    link: "https://shop.example/no",
  });

  it("has Google's required attributes for each item, escaped", () => {
    const items = xml.split("<item>").slice(1);
    expect(items).toHaveLength(2);
    for (const tag of ["id", "title", "description", "link", "image_link", "availability", "price", "brand", "condition"]) {
      for (const item of items) expect(item).toContain(`<g:${tag}>`);
    }
    expect(xml).toContain("<g:title>Mug &lt;white&gt; &amp; &quot;blue&quot;</g:title>");
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<title>Kari &amp; co</title>");
  });

  it("writes GTIN or says there is none, the sale price, unit pricing and shipping", () => {
    const [first, second] = xml.split("<item>").slice(1);
    expect(first).toContain("<g:gtin>7038010009457</g:gtin>");
    expect(first).toContain("<g:shipping><g:country>NO</g:country><g:price>99.00 NOK</g:price></g:shipping>");
    expect(first).toContain("<g:additional_image_link>https://cdn.example/b.webp</g:additional_image_link>");
    expect(second).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(second).toContain("<g:price>199.00 NOK</g:price><g:sale_price>150.00 NOK</g:sale_price>");
    expect(second).toContain("<g:unit_pricing_measure>330ml</g:unit_pricing_measure><g:unit_pricing_base_measure>1l</g:unit_pricing_base_measure>");
    expect(second).not.toContain("<g:shipping>");
  });
});

describe("catalogue CSVs", () => {
  const read = (text: string) => recordsOf(parseCsv(text).rows);

  it.each([
    ["meta", metaFeed, "id", "in stock", "available for order"],
    ["tiktok", tiktokFeed, "sku_id", "in stock", "available for order"],
    ["pinterest", pinterestFeed, "id", "in stock", "preorder"],
  ] as const)("%s has its own columns and words", (channel, write, idColumn, inStock, backorder) => {
    const { header, records } = read(write([ITEM, { ...ITEM, id: "MUG-2", availability: "backorder" }]));
    expect(header).toEqual([...CSV_COLUMNS[channel]]);
    expect(records[0][idColumn]).toBe("MUG-1");
    expect(records[0].price).toBe("199.00 NOK");
    expect(records[0].title).toBe(ITEM.title);
    expect(records[0].availability).toBe(inStock);
    expect(records[1].availability).toBe(backorder);
    expect(records[0].additional_image_link).toBe("https://cdn.example/b.webp");
  });

  it("keeps a title that starts like a formula from running in a spreadsheet", () => {
    const { records } = read(metaFeed([{ ...ITEM, title: "=HYPERLINK(1)" }]));
    expect(records[0].title.startsWith("'")).toBe(true);
  });
});

describe("file names", () => {
  it("reads back what it writes and nothing else", () => {
    expect(parseFeedFile(feedFileName("no", "google"))).toEqual({ market: "no", channel: "google" });
    expect(parseFeedFile(feedFileName("no-en-eur", "pinterest"))).toEqual({ market: "no-en-eur", channel: "pinterest" });
    expect(parseFeedFile("no-google.csv")).toBeNull();
    expect(parseFeedFile("../x-google.xml")).toBeNull();
    expect(parseFeedFile("no-bing.xml")).toBeNull();
  });
});
