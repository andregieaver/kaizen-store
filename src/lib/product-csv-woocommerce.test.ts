import { describe, expect, it } from "vitest";

import { groupProducts } from "./product-csv";
import { isWooCommerce, readWooCommerce, wooSlug } from "./product-csv-woocommerce";
import { DEFAULT_IMPORT_OPTIONS, oldProductAddress, planImport, type ImportOptions } from "./product-import";
import { context, env, snapshotOf } from "./product-csv-test-support";

const ctx = context();

/** WooCommerce's export header (the names from its CSV import schema; no WooCommerce text is copied beyond them). */
const HEADER = [
  "ID", "Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog", "Short description", "Description", "Date sale price starts", "Date sale price ends",
  "Tax status", "Tax class", "In stock?", "Stock", "Low stock amount", "Backorders allowed?", "Weight (kg)", "Length (cm)", "Sale price", "Regular price",
  "Categories", "Tags", "Images", "Parent", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global", "Upsells",
];
const row = (values: Record<string, string>) => HEADER.map((h) => values[h] ?? "");

const SIMPLE = row({
  ID: "10", Type: "simple", SKU: "MUG-1", Name: "Blå kopp", Published: "1", Description: "<p>Stoneware &amp; glaze</p>", Stock: "7", "Low stock amount": "2",
  "Weight (kg)": "0.35", "Regular price": "249", Categories: "Kitchen > Cups, Gifts", Tags: "blue, stoneware", Images: "https://img.example/a.jpg, https://img.example/b.jpg",
});
const VARIABLE = row({ ID: "20", Type: "variable", SKU: "TEE", Name: "Tee", Published: "1", Description: "A tee", "Regular price": "", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S, M" });
const VAR_S = row({ ID: "21", Type: "variation", SKU: "TEE-S", Name: "Tee - S", Parent: "id:20", "Regular price": "199", "Sale price": "149", Stock: "3", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" });
const VAR_M = row({ ID: "22", Type: "variation, virtual", SKU: "TEE-M", Name: "Tee - M", Parent: "TEE", "Regular price": "199", Stock: "", "Backorders allowed?": "notify", "Attribute 1 name": "Size", "Attribute 1 value(s)": "M" });
const GROUPED = row({ ID: "30", Type: "grouped", Name: "Set", Published: "1" });

const read = (rows: string[][], today = "2026-10-29") => readWooCommerce(rows, ctx, { priceMarket: null, today });

describe("a WooCommerce product file (D384)", () => {
  it("is told by its own columns", () => {
    expect(isWooCommerce(HEADER)).toBe(true);
    expect(isWooCommerce(["Title", "URL handle", "Variant SKU", "Variant Price"])).toBe(false);
  });

  it("names a product as WordPress makes its slug, the address its old shop had", () => {
    expect(wooSlug("Blå kopp")).toBe("bla-kopp");
    expect(wooSlug("Ærlig & Øl – 50 cl")).toBe("aerlig-ol-50-cl");
    expect(oldProductAddress("woocommerce", "bla-kopp")).toBe("/product/bla-kopp");
    expect(oldProductAddress("shopify", "tee")).toBe("/products/tee");
    expect(oldProductAddress("kaizen", "tee")).toBeNull();
  });

  it("reads a simple product: text, status, terms, price, stock, weight in grams and every picture", () => {
    const file = read([HEADER, SIMPLE]);
    const { drafts } = groupProducts(file);
    expect(drafts).toHaveLength(1);
    const [d] = drafts;
    expect(d.handle).toBe("bla-kopp");
    expect(d.product).toMatchObject({ title: "Blå kopp", description: "Stoneware & glaze", status: "active", categories: "Kitchen / Cups | Gifts", tags: "blue | stoneware" });
    expect(d.variants[0].v).toMatchObject({ sku: "MUG-1", "price:NO": "249", stock: "7", low_stock_threshold: "2", weight_grams: "350" });
    expect(d.pictures.map((p) => p.url)).toEqual(["https://img.example/a.jpg", "https://img.example/b.jpg"]);
  });

  it("puts a variable product's variations under it by id or SKU, its options from their attributes, the sale price as the price", () => {
    const file = read([HEADER, VAR_S, SIMPLE, VARIABLE, VAR_M]);
    const tee = groupProducts(file).drafts.find((d) => d.handle === "tee")!;
    expect(tee.product.option1_name).toBe("Size");
    expect(tee.variants.map((v) => [v.v.sku, v.v.option1_value, v.v["price:NO"]])).toEqual([
      ["TEE-S", "S", "149"],
      ["TEE-M", "M", "199"],
    ]);
    expect(tee.variants[1].v).toMatchObject({ _continue: "true", _no_shipping: "true", stock: "" });
    expect(file.findings.map((f) => f.code)).toContain("compare_at.ignored");
  });

  it("uses the regular price outside a sale's dates", () => {
    const dated = row({ ID: "40", Type: "simple", SKU: "C-1", Name: "Cap", Published: "1", "Regular price": "300", "Sale price": "200", "Date sale price starts": "2026-11-01" });
    const v = groupProducts(read([HEADER, dated])).drafts[0].variants[0].v;
    expect(v["price:NO"]).toBe("300");
  });

  it("leaves out grouped products and orphan variations, and says so; ignored columns carry a reason", () => {
    const orphan = row({ Type: "variation", SKU: "X-1", Parent: "id:999", "Regular price": "1" });
    const file = read([HEADER, GROUPED, orphan, SIMPLE]);
    expect(groupProducts(file).drafts.map((d) => d.handle)).toEqual(["bla-kopp"]);
    expect(file.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["woocommerce.type_skipped", "woocommerce.parent_missing"]));
    expect(file.ignored.find((i) => i.column === "Upsells")?.reason).toMatch(/Recommendations/);
    expect(file.ignored.find((i) => i.column === "Length (cm)")).toBeDefined();
  });

  it("is planned like any file: the VAT question first, then products to create", () => {
    const file = read([HEADER, SIMPLE, VARIABLE, VAR_S, VAR_M]);
    const plan = (options: Partial<ImportOptions>) => planImport(file, snapshotOf([]), env(ctx, { options: { ...DEFAULT_IMPORT_OPTIONS, ...options } }));
    expect(plan({}).fileFindings.map((f) => f.finding.code)).toContain("price_basis.required");
    const planned = plan({ pricesIncludeVat: true });
    // The tee has a virtual variation, which is not a shipped good: it is made a draft and says why, as a Shopify file's would be.
    expect(planned.products.map((p) => p.outcome)).toEqual(["created", "drafted"]);
    expect(planned.products[1].findings.map((f) => f.code)).toEqual(expect.arrayContaining(["delivery.not_importable", "inventory.continue_selling_ignored"]));
  });
});
