import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv } from "./csv";
import { groupProducts } from "./product-csv";
import { detectFormat, htmlToText, mapBase, mapUnit, readShopify } from "./product-csv-shopify";
import { DEFAULT_IMPORT_OPTIONS, planImport, type ImportOptions } from "./product-import";
import { T1, boot, context, env, snapshotOf } from "./product-csv-test-support";

const ctx = context();

/** Shopify's template header row (the names are facts, taken from the published template; no Shopify text is copied beyond them). */
const HEADER = [
  "Title", "URL handle", "Description", "Vendor", "Product category", "Type", "Tags", "Published on online store", "Status", "SKU", "Barcode",
  "Option1 name", "Option1 value", "Option1 Linked To", "Option2 name", "Option2 value", "Option2 Linked To", "Option3 name", "Option3 value", "Option3 Linked To",
  "Price", "Compare-at price", "Cost per item", "Price / International", "Compare-at price / International", "Charge tax", "Tax code",
  "Unit price total measure", "Unit price total measure unit", "Unit price base measure", "Unit price base measure unit",
  "Inventory tracker", "Inventory quantity", "Continue selling when out of stock", "Weight value (grams)", "Weight unit for display", "Requires shipping", "Fulfillment service",
  "Product image URL", "Image position", "Image alt text", "Variant image URL", "Gift card", "SEO title", "SEO description",
  "Color (product.metafields.shopify.color-pattern)", "Google Shopping / Google product category", "Google Shopping / Gender",
];

function row(values: Record<string, string>): string[] {
  return HEADER.map((h) => values[h] ?? "");
}

const SIMPLE = row({
  Title: "Wool sock", "URL handle": "wool-sock", Description: "<p>Soft &amp; warm</p><ul><li>Wool</li><li>Made in Norway</li></ul>", Vendor: "Sock Co", "Product category": "Apparel", Type: "Socks",
  Tags: "winter, wool", "Published on online store": "true", Status: "active", SKU: "SOCK-S", Barcode: "7041234567890", "Option1 name": "Size", "Option1 value": "S",
  Price: "129.00", "Compare-at price": "199.00", "Cost per item": "40.00", "Charge tax": "true", "Tax code": "", "Inventory tracker": "shopify", "Inventory quantity": "10",
  "Continue selling when out of stock": "deny", "Weight value (grams)": "120.0", "Weight unit for display": "g", "Requires shipping": "true", "Fulfillment service": "manual",
  "Product image URL": "https://cdn.example/sock-1.jpg", "Image position": "1", "Image alt text": "A sock", "Gift card": "false", "SEO title": "Wool sock", "SEO description": "A sock",
});
const SECOND = row({ "URL handle": "wool-sock", SKU: "SOCK-M", "Option1 value": "M", Price: "129.00", "Compare-at price": "199.00", "Inventory quantity": "4", "Weight value (grams)": "130" });
const PICTURE = row({ "URL handle": "wool-sock", "Product image URL": "https://cdn.example/sock-2.jpg", "Image position": "2", "Image alt text": "Two socks" });

function read(rows: string[][], options: Partial<ImportOptions> = {}, c = ctx) {
  const file = readShopify(rows, c, { priceMarket: options.priceMarket ?? null });
  return { file, plan: (stored = [] as ReturnType<typeof boot>[]) => planImport(file, snapshotOf(stored), env(c, { options: { ...DEFAULT_IMPORT_OPTIONS, ...options } })) };
}

describe("which format a header is", () => {
  it("knows Shopify's current names, its older names, and Kaizen's own", () => {
    expect(detectFormat(HEADER)).toBe("shopify");
    expect(detectFormat(["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU", "Variant Price", "Image Src"])).toBe("shopify");
    expect(detectFormat(["Handle", "Title", "Tags"])).toBe("shopify");
    expect(detectFormat(["handle", "status", "title", "sku", "price:NO"])).toBe("kaizen");
    expect(detectFormat(["handle", "sku", "variant_id"])).toBe("kaizen");
    expect(detectFormat(["name", "email"])).toBeNull();
    expect(detectFormat([])).toBeNull();
    expect(detectFormat(["﻿Title", "URL handle", "SKU"])).toBe("shopify");
  });

  it("is not fooled by capitalisation or spaces", () => {
    expect(detectFormat(["  URL HANDLE ", "title"])).toBe("shopify");
  });
});

describe("a Shopify description as plain text", () => {
  it("turns blocks and lists into lines, drops tags and scripts, decodes entities, and never leaves markup", () => {
    expect(htmlToText("<p>Soft &amp; warm</p><ul><li>Wool</li><li>Made in Norway</li></ul>")).toBe("Soft & warm\n- Wool\n- Made in Norway");
    expect(htmlToText("Line one<br>Line two<br/>Three")).toBe("Line one\nLine two\nThree");
    expect(htmlToText('<h2>Title</h2><script>alert(1)</script><p style="x">Body &lt;b&gt; &#169; &#x41; &nbsp;end</p><style>p{}</style>')).toBe("Title\nBody <b> © A end");
    expect(htmlToText("plain text, no markup")).toBe("plain text, no markup");
    expect(htmlToText("  <div>  spaced   out  </div>  ")).toBe("spaced out");
    expect(htmlToText("<a href=\"https://x\">link</a> and <b>bold</b>")).toBe("link and bold");
    expect(htmlToText("a &unknownentity; b")).toBe("a &unknownentity; b");
    expect(htmlToText("<!-- note -->kept")).toBe("kept");
    expect(htmlToText("")).toBe("");
  });
});

describe("units", () => {
  it("maps Shopify's units to Kaizen's and refuses the rest", () => {
    expect(["mL", "L", "g", "kg", "m", "m2", "item", "cm"].map(mapUnit)).toEqual(["ml", "l", "g", "kg", "m", "m2", "piece", "cm"]);
    expect(["mg", "mm", "oz", "m3", ""].map(mapUnit)).toEqual([null, null, null, null, null]);
    expect(mapBase("100", "mL")).toBe("100ml");
    expect(mapBase("100", "g")).toBe("100g");
    expect(mapBase("1", "kg")).toBe("kg");
    expect(mapBase("1", "item")).toBe("piece");
    expect(mapBase("3", "kg")).toBeNull();
  });
});

describe("reading Shopify's file", () => {
  const rows = [HEADER, SIMPLE, SECOND, PICTURE];

  it("maps its columns onto Kaizen's, said and counted: what is read and what is left out, with the reason", () => {
    const { file } = read(rows);
    expect(file.format).toBe("shopify");
    expect([...file.columns].sort()).toEqual(
      ["cost", "description", "gtin", "handle", "image_alt", "image_position", "image_url", "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value",
        "price:NO", "seo_description", "seo_title", "sku", "status", "stock", "tags", "title", "variant_image_url", "weight_grams", "measure_amount", "measure_unit", "measure_base"].sort(),
    );
    const ignored = Object.fromEntries(file.ignored.map((i) => [i.column, i.reason]));
    expect(Object.keys(ignored)).toEqual(expect.arrayContaining(["Vendor", "Product category", "Type", "Option1 Linked To", "Inventory tracker", "Fulfillment service", "Weight unit for display", "Color (product.metafields.shopify.color-pattern)", "Google Shopping / Google product category", "Compare-at price", "Compare-at price / International", "Price / International"]));
    expect(ignored.Vendor).toMatch(/never turned into the product's manufacturer/);
    expect(file.findings.map((f) => f.code)).toContain("compare_at.ignored");
    expect(file.findings.map((f) => f.code)).toContain("price.market_unknown");
  });

  it("reads rows as neutral cells: handle, text from HTML, tags as a list, grams as a whole number, no option for a default title", () => {
    const { file } = read(rows);
    const [r1, r2, r3] = file.rows;
    expect(r1.row).toBe(2);
    expect(r1.v).toMatchObject({ handle: "wool-sock", title: "Wool sock", tags: "winter | wool", weight_grams: "120", gtin: "7041234567890", sku: "SOCK-S", "price:NO": "129.00", stock: "10", cost: "40.00", status: "active" });
    expect(r1.v.description).toBe("Soft & warm\n- Wool\n- Made in Norway");
    expect(r2.v.sku).toBe("SOCK-M");
    expect(r3.v.image_url).toBe("https://cdn.example/sock-2.jpg");
    const dflt = readShopify([HEADER, row({ "URL handle": "a", Title: "A", SKU: "A1", "Option1 name": "Title", "Option1 value": "Default Title", Price: "1" })], ctx).rows[0].v;
    expect(dflt.option1_name).toBe("");
    expect(dflt.option1_value).toBe("");
  });

  it("groups into one product with two variants and two pictures, picture rows being only handle and picture", () => {
    const d = groupProducts(read(rows).file).drafts[0];
    expect(d.variants).toHaveLength(2);
    expect(d.pictures.map((p) => p.url)).toEqual(["https://cdn.example/sock-1.jpg", "https://cdn.example/sock-2.jpg"]);
  });

  it("never reads a compare-at price: the value is nowhere in the plan, and the member is told why", () => {
    const { plan } = read(rows, { pricesIncludeVat: true });
    const r = plan();
    const text = JSON.stringify(r.products[0].input);
    expect(text).not.toContain("199");
    expect(r.fileFindings.some((f) => f.finding.code === "compare_at.ignored" && /lowest price of the last 30 days/.test(f.finding.text))).toBe(true);
  });
});

describe("importing Shopify's file", () => {
  const rows = [HEADER, SIMPLE, SECOND, PICTURE];

  it("needs the member to say whether prices include VAT, and creates nothing until they do", () => {
    const r = read(rows).plan();
    expect(r.fileFindings.map((f) => f.finding.code)).toContain("price_basis.required");
    expect(r.blocked?.code).toBe("price_basis.required");
    expect(r.products.every((p) => p.outcome === "skipped")).toBe(true);
  });

  it("creates the product with VAT-inclusive prices as they are, in the market the member chose", () => {
    const r = read(rows, { pricesIncludeVat: true }).plan();
    expect(r.blocked).toBeNull();
    const p = r.products[0];
    expect(p.outcome).toBe("created");
    expect(p.input?.status).toBe("active");
    expect(p.input?.translations[0]).toMatchObject({ title: "Wool sock", description: "Soft & warm\n- Wool\n- Made in Norway", seoTitle: "Wool sock" });
    expect(p.input?.variants.map((v) => [v.sku, v.prices, v.stock, v.weightGrams])).toEqual([["SOCK-S", { NO: "129,00" }, 10, 120], ["SOCK-M", { NO: "129,00" }, 4, 130]]);
    expect(p.input?.variants[0]).toMatchObject({ gtin: "7041234567890", cost: "40,00", options: { Size: "S" } });
    expect(p.input?.options).toEqual([{ name: "Size", values: ["S", "M"] }]);
    expect(p.pictures).toEqual(["https://cdn.example/sock-1.jpg", "https://cdn.example/sock-2.jpg"]);
    // "winter" is a tag the store has (matched by name); "wool" is made when the job applies.
    expect(p.pendingTerms.map((t) => t.path.join("/"))).toEqual(["wool"]);
    expect(p.input?.tags).toEqual([T1]);
    expect(p.input?.manufacturer).toEqual(env(ctx).blank.manufacturer);
  });

  it("adds VAT to prices that exclude it, at the market's rate for the product's category (never the country's standard rate)", () => {
    const priced = row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "100.00" });
    const r = read([HEADER, priced], { pricesIncludeVat: false }).plan().products[0];
    expect(r.input?.variants[0].prices.NO).toBe("125,00");
    const food = read([HEADER, priced], { pricesIncludeVat: false }).plan([]);
    expect(food.products[0].input?.variants[0].prices.NO).toBe("125,00");
    // A food product takes the market's reduced rate: the plan reads the category's own rate.
    const e = env(ctx, { options: { ...DEFAULT_IMPORT_OPTIONS, pricesIncludeVat: false } });
    const file = readShopify([HEADER, priced], ctx, { priceMarket: null });
    const stored = boot(ctx, { handle: "a", vatCategory: "food", variants: [{ ...boot(ctx).variants[0], id: "aaaaaaaa-0000-4000-8000-0000000000a1", sku: "A1", options: {} }], options: [] });
    stored.variants[0].prices = {};
    const plan = planImport(file, snapshotOf([stored]), e).products[0];
    expect(plan.input?.variants[0].prices.NO).toBe("115,00");
  });

  it("takes VAT off prices that include it in a store selling only to businesses, and nothing off ones that do not", () => {
    const b2b = context({ audience: "businesses" });
    const priced = row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "125.00" });
    const withVat = read([HEADER, priced], { pricesIncludeVat: true }, b2b);
    const out = planImport(withVat.file, snapshotOf([]), env(b2b, { options: { ...DEFAULT_IMPORT_OPTIONS, pricesIncludeVat: true } })).products[0];
    expect(out.input?.variants[0].prices.NO).toBe("100,00");
    const without = planImport(withVat.file, snapshotOf([]), env(b2b, { options: { ...DEFAULT_IMPORT_OPTIONS, pricesIncludeVat: false } })).products[0];
    expect(without.input?.variants[0].prices.NO).toBe("125,00");
  });

  it("puts the plain Price in the market the member chose, and a market column onto the market it names", () => {
    const withMarkets = [[...HEADER.filter((h) => !h.includes("International")), "Price / Sweden", "Price / Norway"], row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10" }).filter((_, i) => !HEADER[i].includes("International")).concat(["199", "99"])];
    const r = read(withMarkets, { pricesIncludeVat: true, priceMarket: "NO" });
    expect(r.file.rows[0].v["price:SE"]).toBe("199");
    expect(r.file.rows[0].v["price:NO"]).toBe("10");
    const se = read(withMarkets.map((x, i) => (i === 0 ? x.filter((h) => h !== "Price / Norway") : x.slice(0, x.length - 1))), { pricesIncludeVat: true, priceMarket: "SE" });
    expect(se.file.rows[0].v["price:SE"]).toBe("10");
  });

  it("makes a draft of a product that was not published, and says so", () => {
    const unpub = row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10", "Published on online store": "false", Status: "active" });
    const p = read([HEADER, unpub], { pricesIncludeVat: true }).plan().products[0];
    expect(p.input?.status).toBe("draft");
    expect(p.findings.map((f) => f.code)).toContain("status.draft_because_unpublished");
    const archived = row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10", Status: "archived" });
    expect(read([HEADER, archived], { pricesIncludeVat: true }).plan().products[0].archiveAfter).toBe(true);
  });

  it("refuses a gift card, warns about tax settings, backorders and products that need no shipping, and imports the rest", () => {
    const r = (v: Record<string, string>) => read([HEADER, row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10", ...v })], { pricesIncludeVat: true }).plan().products[0];
    expect(r({ "Gift card": "true" }).findings.map((f) => f.code)).toContain("giftcard.not_supported");
    expect(r({ "Gift card": "true" }).outcome).toBe("skipped");
    expect(r({ "Charge tax": "false" }).findings.map((f) => f.code)).toContain("tax.ignored");
    expect(r({ "Tax code": "txcd_10000000" }).findings.map((f) => f.code)).toContain("tax.ignored");
    expect(r({ "Charge tax": "true" }).findings.map((f) => f.code)).not.toContain("tax.ignored");
    expect(r({ "Continue selling when out of stock": "continue" }).findings.map((f) => f.code)).toContain("inventory.continue_selling_ignored");
    expect(r({ "Requires shipping": "false" }).findings.find((f) => f.code === "delivery.not_importable")?.severity).toBe("warning");
    expect(r({ "Requires shipping": "false" }).outcome).not.toBe("skipped");
  });

  it("never sets the exempt VAT category, never makes the vendor the manufacturer", () => {
    const p = read([HEADER, SIMPLE, SECOND], { pricesIncludeVat: true }).plan().products[0];
    expect(p.input?.vatCategory).toBe("standard");
    expect(JSON.stringify(p.input)).not.toContain("Sock Co");
    const tax = read([HEADER, row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10", "Charge tax": "false" })], { pricesIncludeVat: true }).plan().products[0];
    expect(tax.input?.vatCategory).toBe("standard");
  });

  it("reads the unit price's content, and flags one Kaizen cannot hold", () => {
    const r = (amount: string, unit: string, base = "100", baseUnit = "mL") =>
      read([HEADER, row({ "URL handle": "a", Title: "A", SKU: "A1", Price: "10", "Unit price total measure": amount, "Unit price total measure unit": unit, "Unit price base measure": base, "Unit price base measure unit": baseUnit })], { pricesIncludeVat: true }).plan().products[0];
    expect(r("250", "mL").input?.variants[0].measure).toEqual({ amount: "250", unit: "ml", base: "100ml" });
    expect(r("0.75", "L", "1", "L").input?.variants[0].measure).toEqual({ amount: "0.75", unit: "l", base: "l" });
    expect(r("5", "mg").findings.map((f) => f.code)).toEqual(["measure.invalid"]);
  });

  it("updates an existing product by its handle and SKU, leaving a price it already has alone", () => {
    const stored = boot(ctx, { handle: "wool-sock", options: [{ name: "Size", values: ["S"] }], variants: [{ ...boot(ctx).variants[0], id: "aaaaaaaa-0000-4000-8000-0000000000b1", sku: "SOCK-S", options: { Size: "S" }, prices: { NO: "129,00" }, stock: 10, gtin: null, weightGrams: 120, cost: "40,00", hsCode: null, originCountry: null, image: null }] });
    const { plan } = read([HEADER, SIMPLE], { pricesIncludeVat: true });
    const r = plan([stored]).products[0];
    expect(r.isNew).toBe(false);
    expect(r.changes.prices).toBe(0);
    expect(r.input?.variants[0].prices).toEqual({ NO: "129,00" });
  });

  it("reads a Shopify file saved by Excel: semicolons, decimal commas and Windows-1252", () => {
    const text = writeCsv([HEADER, row({ "URL handle": "a", Title: "Sokk", SKU: "A1", Price: "129,50", Description: "Varm og solid" })], "excel_nordic");
    const parsed = parseCsv(text);
    expect(parsed.delimiter).toBe(";");
    const file = readShopify(parsed.rows, ctx);
    expect(file.rows[0].v["price:NO"]).toBe("129,50");
    const p = planImport(file, snapshotOf([]), env(ctx, { options: { ...DEFAULT_IMPORT_OPTIONS, pricesIncludeVat: true } })).products[0];
    expect(p.input?.variants[0].prices.NO).toBe("129,50");
  });

  it("reads Shopify's older names", () => {
    const old = [["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU", "Variant Grams", "Variant Inventory Qty", "Variant Inventory Policy", "Variant Price", "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Variant Barcode", "Image Src", "Image Position", "Image Alt Text", "SEO Title"],
      ["old-one", "Old", "<b>Bold</b>", "V", "T", "a, b", "TRUE", "Title", "Default Title", "OLD-1", "250", "7", "continue", "49.90", "59.90", "TRUE", "TRUE", "12345678", "https://cdn.example/o.jpg", "1", "Alt", "Seo"]];
    const file = readShopify(old, ctx);
    expect(file.rows[0].v).toMatchObject({ handle: "old-one", title: "Old", description: "Bold", tags: "a | b", status: "active", sku: "OLD-1", weight_grams: "250", stock: "7", "price:NO": "49.90", gtin: "12345678", image_url: "https://cdn.example/o.jpg", seo_title: "Seo", _continue: "true" });
    expect(file.rows[0].v.option1_name).toBe("");
  });
});
