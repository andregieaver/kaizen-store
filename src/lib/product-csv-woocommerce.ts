/**
 * WooCommerce's product file read into Kaizena Flow's neutral rows (wave 11 unit E, D384), pure, after `product-csv-shopify.ts`.
 *
 * Held to WooCommerce's own product CSV import schema (github.com/woocommerce/woocommerce/wiki/Product-CSV-Import-Schema, read
 * 29 October 2026): ID, Type (simple, variable, variation, grouped, external, with virtual and downloadable beside them), SKU, Name,
 * Published (1, 0 private, -1 draft), Short description, Description, Date sale price starts and ends, Tax status, Stock, Low stock
 * amount, Backorders allowed?, Weight (unit), Sale price, Regular price, Categories (a comma list, `>` between a parent and its
 * child), Tags, Images (a comma list, the first the featured picture), Parent (`id:100` or a SKU), and Attribute n name / value(s).
 * A column is matched by its name lowercased.
 *
 * WooCommerce's file has no address column: a product's handle is its name as WordPress makes a slug of it (`wooSlug()`), which is the
 * address `/product/{slug}` its shop had, so the import can leave a redirect from it. A variable product is one product whose
 * variations follow it (put together here, whatever order the file has them in), its options the attributes its variations name.
 *
 * The price is what the product sold for: the sale price where one is set and its dates (if any) hold, else the regular price; a
 * regular price above a sale price is a compare-at price and is never imported (98/6/EC Art. 6a), as Shopify's. Not read: grouped and
 * external products (skipped, said), upsells and cross-sells, catalogue visibility, featured, purchase notes, positions, tax classes and
 * downloads; each is said, never silently dropped.
 */
import { finding, type Finding } from "./data-job";
import { unescapeText } from "./csv";
import { htmlToText } from "./product-csv-shopify";
import type { IgnoredColumn, NeutralFile, NeutralRow, ProductCsvContext } from "./product-csv";

const norm = (name: string) => name.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

/** Whether a header row is WooCommerce's: its Type and Regular price columns with one of its own (Parent, Published, Visibility in catalog). */
export function isWooCommerce(header: readonly string[]): boolean {
  const names = header.map(norm);
  const has = (n: string) => names.includes(n);
  return has("type") && has("regular price") && (has("parent") || has("published") || has("visibility in catalog") || has("attribute 1 name"));
}

/** The characters WordPress's `remove_accents()` turns into plain letters, for the Nordic and German letters a name is likely to have. */
const ACCENTS: Record<string, string> = { æ: "ae", ø: "o", å: "a", ä: "a", ö: "o", ü: "u", ß: "ss", é: "e", è: "e", ê: "e", á: "a", à: "a", ó: "o", ú: "u", í: "i", ñ: "n", ç: "c" };

/** A product's name as WordPress makes its slug: accents to plain letters, lower case, every other character a hyphen, at most 80. */
export function wooSlug(name: string): string {
  const plain = [...name.toLowerCase()].map((c) => ACCENTS[c] ?? c).join("").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, lbs: 453.592, lb: 453.592, oz: 28.3495 };

/** A weight in the column's unit as whole grams, or empty for none, 0 or a unit it cannot read. */
function gramsOf(text: string, unit: string): string {
  const n = Number(text.trim().replace(",", "."));
  const factor = GRAMS_PER[unit.toLowerCase()];
  return factor && Number.isFinite(n) && n > 0 ? String(Math.round(n * factor)) : "";
}

const listOf = (cell: string) => cell.split(",").map((p) => p.trim()).filter((p) => p !== "");

const IGNORED: Record<string, string> = {
  id: "WooCommerce's own number is read only to find a variation's parent",
  "is featured?": "Kaizena Flow has no featured flag on a product; a category's own order does that",
  "visibility in catalog": "A product is shown or not by its status",
  "tax class": "A product keeps its VAT category, and an import never sets the exempt category",
  "in stock?": "Stock is read from the Stock column",
  "sold individually?": "Quantity rules are set in the editor",
  "allow customer reviews?": "Reviews are a store setting",
  "purchase note": "Kaizena Flow has no purchase note",
  "shipping class": "Shipping is set by the store's methods",
  "download limit": "Downloads are not imported",
  "download expiry days": "Downloads are not imported",
  "grouped products": "Grouped products are not imported",
  upsells: "Recommendations are worked out by Kaizena Flow",
  "cross-sells": "Recommendations are worked out by Kaizena Flow",
  "external url": "External products are not imported",
  "button text": "The buy button's words are the theme's",
  position: "A category's own order sets where a product is shown",
  "short description": "The Description column is the product's text; the short one is read only when Description is empty",
};

const ignoredReason = (name: string): string =>
  IGNORED[name] ??
  (/^attribute \d+ (default|visible|global)$/.test(name) ? "Only an attribute's name and values are read" : /^download \d+ /.test(name) ? "Downloads are not imported" : /^meta:/.test(name) ? "Only Kaizena Flow's own custom fields are imported" : "Kaizena Flow does not have this column");

export type WooReadOptions = {
  /** The Kaizena Flow market the prices go to; the store's first market when null. */
  priceMarket: string | null;
  /** Today in the store's time zone (`YYYY-MM-DD`), for a sale's dates. */
  today: string;
};

type Record_ = { row: number; cells: Record<string, string> };

/** WooCommerce's rows (the header first) as a neutral file. */
export function readWooCommerce(raw: readonly (readonly string[])[], ctx: ProductCsvContext, options: WooReadOptions): NeutralFile {
  const header = (raw[0] ?? []).map((h) => h.replace(/^﻿/, "").trim());
  const names = header.map(norm);
  const findings: Finding[] = [];
  const ignored: IgnoredColumn[] = [];
  const market = (options.priceMarket ?? ctx.markets[0]?.code ?? "").toUpperCase();
  const READ = new Set(["id", "type", "sku", "name", "published", "description", "short description", "date sale price starts", "date sale price ends", "tax status", "stock", "low stock amount", "backorders allowed?", "sale price", "regular price", "categories", "tags", "images", "parent"]);
  let weightColumn: { index: number; unit: string } | null = null;
  names.forEach((name, i) => {
    if (name === "") return;
    const weight = /^weight \(([a-z]+)\)$/.exec(name);
    if (weight && !weightColumn) {
      weightColumn = { index: i, unit: weight[1] };
      if (!GRAMS_PER[weight[1]]) ignored.push({ column: header[i], reason: "The weight's unit could not be read" });
      return;
    }
    if (/^(length|width|height) \(/.test(name)) return void ignored.push({ column: header[i], reason: "Kaizena Flow keeps a weight, not dimensions" });
    if (/^attribute \d+ (name|value\(s\))$/.test(name)) return;
    if (READ.has(name) && name !== "id" && name !== "short description") return;
    ignored.push({ column: header[i], reason: ignoredReason(name) });
  });

  const records: Record_[] = [];
  for (let r = 1; r < raw.length; r += 1) {
    const row = raw[r];
    if (row.every((c) => c.trim() === "")) continue;
    const cells: Record<string, string> = {};
    names.forEach((name, i) => {
      if (name !== "" && !Object.hasOwn(cells, name)) cells[name] = unescapeText(row[i] ?? "");
    });
    if (weightColumn) cells._grams = gramsOf(row[(weightColumn as { index: number }).index] ?? "", (weightColumn as { unit: string }).unit);
    records.push({ row: r + 1, cells });
  }

  const typesOf = (rec: Record_) => new Set(listOf(rec.cells.type ?? "").map((t) => t.toLowerCase()));
  const attributesOf = (rec: Record_): { name: string; value: string }[] => {
    const out: { name: string; value: string }[] = [];
    for (let n = 1; n <= 20; n += 1) {
      const name = (rec.cells[`attribute ${n} name`] ?? "").trim();
      if (name === "") continue;
      out.push({ name, value: listOf(rec.cells[`attribute ${n} value(s)`] ?? "")[0] ?? "" });
    }
    return out;
  };
  const priceOf = (rec: Record_): string => {
    const sale = (rec.cells["sale price"] ?? "").trim();
    const regular = (rec.cells["regular price"] ?? "").trim();
    const starts = (rec.cells["date sale price starts"] ?? "").trim().slice(0, 10);
    const ends = (rec.cells["date sale price ends"] ?? "").trim().slice(0, 10);
    const saleOn = sale !== "" && (starts === "" || starts <= options.today) && (ends === "" || ends >= options.today);
    if (sale !== "" && regular !== "") findings.push(finding("compare_at.ignored", { column: "Regular price" }));
    return saleOn ? sale : regular;
  };
  const variantCells = (rec: Record_, v: Record<string, string>) => {
    v.sku = (rec.cells.sku ?? "").trim();
    if (market) v[`price:${market}`] = priceOf(rec);
    const stock = (rec.cells.stock ?? "").trim();
    v.stock = /^-?\d+$/.test(stock) ? stock : "";
    const low = (rec.cells["low stock amount"] ?? "").trim();
    if (/^\d+$/.test(low)) v.low_stock_threshold = low;
    if (rec.cells._grams) v.weight_grams = rec.cells._grams;
    const backorders = (rec.cells["backorders allowed?"] ?? "").trim().toLowerCase();
    if (backorders === "1" || backorders === "notify") v._continue = "true";
    if ((rec.cells["tax status"] ?? "").trim().toLowerCase() === "none") v._tax = "true";
    const types = typesOf(rec);
    if (types.has("virtual") || types.has("downloadable")) v._no_shipping = "true";
  };
  const productCells = (rec: Record_, handle: string): Record<string, string> => {
    const v: Record<string, string> = { handle, title: (rec.cells.name ?? "").trim() };
    const description = (rec.cells.description ?? "").trim() || (rec.cells["short description"] ?? "").trim();
    v.description = htmlToText(description);
    const published = (rec.cells.published ?? "").trim();
    v.status = published === "1" ? "active" : "draft";
    if (published === "0") v._unpublished = "true";
    v.categories = listOf(rec.cells.categories ?? "").map((c) => c.split(">").map((p) => p.trim()).filter((p) => p !== "").join(" / ")).filter((c) => c !== "").join(" | ");
    v.tags = listOf(rec.cells.tags ?? "").join(" | ");
    return v;
  };

  // A variation's parent, by `id:{n}` or by SKU.
  const byId = new Map<string, Record_>();
  const bySku = new Map<string, Record_>();
  for (const rec of records) {
    const id = (rec.cells.id ?? "").trim();
    if (id) byId.set(id, rec);
    const sku = (rec.cells.sku ?? "").trim();
    if (sku) bySku.set(sku.toLowerCase(), rec);
  }
  const parentOf = (rec: Record_): Record_ | null => {
    const ref = (rec.cells.parent ?? "").trim();
    if (ref === "") return null;
    const id = /^id:(\d+)$/i.exec(ref);
    return (id ? byId.get(id[1]) : bySku.get(ref.toLowerCase())) ?? null;
  };

  const rows: NeutralRow[] = [];
  const children = new Map<Record_, Record_[]>();
  for (const rec of records) {
    if (!typesOf(rec).has("variation")) continue;
    const parent = parentOf(rec);
    if (!parent) {
      findings.push(finding("woocommerce.parent_missing", { sku: (rec.cells.sku ?? "").trim() }));
      continue;
    }
    children.set(parent, [...(children.get(parent) ?? []), rec]);
  }
  let skipped = 0;
  for (const rec of records) {
    const types = typesOf(rec);
    if (types.has("variation")) continue;
    if (types.has("grouped") || types.has("external")) {
      skipped += 1;
      continue;
    }
    const handle = wooSlug(rec.cells.name ?? "");
    const pictures = listOf(rec.cells.images ?? "");
    const product = productCells(rec, handle);
    if (types.has("variable")) {
      const variations = children.get(rec) ?? [];
      const optionNames: string[] = [];
      for (const variation of variations) for (const a of attributesOf(variation)) if (!optionNames.includes(a.name)) optionNames.push(a.name);
      optionNames.slice(0, 3).forEach((name, i) => (product[`option${i + 1}_name`] = name));
      if (optionNames.length > 3) findings.push(finding("options.too_many", { handle }));
      if (pictures[0]) product.image_url = pictures[0];
      rows.push({ row: rec.row, v: product });
      for (const variation of variations) {
        const v: Record<string, string> = { handle };
        const attributes = attributesOf(variation);
        optionNames.slice(0, 3).forEach((name, i) => (v[`option${i + 1}_value`] = attributes.find((a) => a.name === name)?.value ?? ""));
        variantCells(variation, v);
        const picture = listOf(variation.cells.images ?? "")[0];
        if (picture) v.variant_image_url = picture;
        rows.push({ row: variation.row, v });
      }
    } else {
      variantCells(rec, product);
      if (pictures[0]) product.image_url = pictures[0];
      rows.push({ row: rec.row, v: product });
    }
    // The other pictures, each a row of its own as a file of Kaizena Flow's would have it.
    for (const picture of pictures.slice(1)) rows.push({ row: rec.row, v: { handle, image_url: picture } });
  }
  if (skipped > 0) findings.push(finding("woocommerce.type_skipped", { n: skipped }));

  const columns = new Set<string>(["handle", "title", "description", "status", "categories", "tags", "sku", "stock", "image_url", "variant_image_url", "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value"]);
  if (market) columns.add(`price:${market}`);
  if (weightColumn) columns.add("weight_grams");
  if (names.includes("low stock amount")) columns.add("low_stock_threshold");
  const seen = new Set<string>();
  const unique = findings.filter((f) => (seen.has(`${f.code}:${f.column ?? ""}:${f.text}`) ? false : (seen.add(`${f.code}:${f.column ?? ""}:${f.text}`), true)));
  return { format: "woocommerce", columns, rows, ignored, findings: unique };
}
