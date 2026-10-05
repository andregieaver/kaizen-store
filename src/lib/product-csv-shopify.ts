/**
 * Shopify's product file read into Kaizen's neutral rows (D165, `docs/wave-2-data.md` 1.2, 2.2, 4.1), pure.
 *
 * Held to Shopify's published template and its documentation (the page states no file size or row limit and shows no preview): the
 * current column names (Title, URL handle, Description, Vendor, Product category, Type, Tags, Published on online store, Status, SKU,
 * Barcode, Option1 name / value / Linked To, Price, Compare-at price, Cost per item, Price / {Market}, Charge tax, Tax code, Unit price
 * total measure and base measure, Inventory tracker, Inventory quantity, Continue selling when out of stock, Weight value (grams),
 * Requires shipping, Product image URL, Image position, Image alt text, Variant image URL, Gift card, SEO title, SEO description and
 * metafields) and the older names (Handle, Body (HTML), Variant SKU, Variant Price, Image Src, ...). A column is matched by its name
 * lowercased, so capitalisation never matters.
 *
 * What is read: text, tags (Shopify's comma list), status and "Published on online store", options, SKU, barcode, one price per market
 * (the plain Price column goes to the market the member chose), cost, stock, weight, pictures, the variant's picture, the unit price's
 * content and SEO texts. What is NOT: Vendor (never the manufacturer, a legal designation), Product category and Type (Shopify's own
 * taxonomy), compare-at prices (never imported, 98/6/EC Art. 6a), Charge tax and tax codes (a product keeps its VAT category), gift
 * cards (refused), fulfilment, tracking, Google Shopping columns and other metafields. Each is reported, never silently dropped.
 */
import { finding, type Finding } from "./data-job";
import { unescapeText } from "./csv";
import { isBase, isUnit, type Base, type Unit } from "./unit-price";
import type { FileFormat, IgnoredColumn, NeutralFile, NeutralRow, ProductCsvContext } from "./product-csv";

// ---------------------------------------------------------------------------
// Which format
// ---------------------------------------------------------------------------

const norm = (name: string) => name.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

const SHOPIFY_MARKERS = ["url handle", "variant sku", "body (html)", "option1 name", "image src", "published on online store", "variant price", "variant grams", "product image url"];

/** The format a header row is: Kaizen's (its own snake_case names) or Shopify's (current or older names), else null. */
export function detectFormat(header: readonly string[]): FileFormat | null {
  const names = header.map(norm);
  const has = (n: string) => names.includes(n);
  if (SHOPIFY_MARKERS.some(has)) return has("handle") || has("url handle") ? "shopify" : null;
  if (has("handle") && has("sku") && (has("title") || has("variant_id") || has("option1_name") || has("price_basis") || names.some((n) => /^price:[a-z]{2}$/.test(n)))) return "kaizen";
  // A Shopify file with only the basics: Handle, Title, Variant SKU is caught above; Handle + Title + Tags is Shopify's older minimum.
  if (has("handle") && has("title") && (has("body (html)") || has("tags") || has("vendor") || has("type"))) return "shopify";
  return null;
}

// ---------------------------------------------------------------------------
// HTML to plain text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", deg: "°", euro: "€", aring: "å", Aring: "Å", oslash: "ø", Oslash: "Ø", aelig: "æ", AElig: "Æ", auml: "ä", ouml: "ö", Auml: "Ä", Ouml: "Ö", eacute: "é" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/**
 * Shopify's description (HTML) as the plain text a Kaizen product has (descriptions are plain text and HTML is never stored): block
 * ends and breaks become line breaks, list items "- ", every other tag is dropped with its script and style, entities are decoded,
 * and runs of blank lines and spaces are collapsed. The text is never put into a page as HTML.
 */
export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html.replace(/\r\n/g, "\n").trim();
  let t = html.replace(/\r\n/g, "\n");
  t = t.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/<li\b[^>]*>/gi, "\n- ");
  t = t.replace(/<\/li\s*>/gi, "");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/(p|div|h[1-6]|ul|ol|tr|table|blockquote|section)\s*>/gi, "\n");
  t = t.replace(/<(div|h[1-6]|tr|table|blockquote|section)\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]*>/g, "");
  t = decodeEntities(t);
  t = t.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}(?=- )/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Shopify's column (lowercased) to the neutral column it fills. A name starting with `_` is a flag the planner reads, not a value. */
const MAP: Record<string, string> = {
  title: "title",
  "url handle": "handle",
  handle: "handle",
  description: "description",
  "body (html)": "description",
  tags: "tags",
  "published on online store": "_published",
  published: "_published",
  status: "status",
  sku: "sku",
  "variant sku": "sku",
  barcode: "gtin",
  "variant barcode": "gtin",
  "option1 name": "option1_name",
  "option1 value": "option1_value",
  "option2 name": "option2_name",
  "option2 value": "option2_value",
  "option3 name": "option3_name",
  "option3 value": "option3_value",
  price: "_price",
  "variant price": "_price",
  "compare-at price": "_compare_at",
  "variant compare at price": "_compare_at",
  "cost per item": "cost",
  "charge tax": "_charge_tax",
  "charge tax?": "_charge_tax",
  "variant taxable": "_charge_tax",
  "tax code": "_tax_code",
  "variant tax code": "_tax_code",
  "unit price total measure": "_up_amount",
  "unit price total measure unit": "_up_unit",
  "unit price base measure": "_up_base",
  "unit price base measure unit": "_up_base_unit",
  "inventory quantity": "stock",
  "variant inventory qty": "stock",
  "continue selling when out of stock": "_continue",
  "variant inventory policy": "_policy",
  "weight value (grams)": "weight_grams",
  "variant grams": "weight_grams",
  "requires shipping": "_requires_shipping",
  "variant requires shipping": "_requires_shipping",
  "product image url": "image_url",
  "image src": "image_url",
  "image position": "image_position",
  "image alt text": "image_alt",
  "variant image url": "variant_image_url",
  "variant image": "variant_image_url",
  "gift card": "_gift_card",
  "seo title": "seo_title",
  "seo description": "seo_description",
};

/** Columns that are known and deliberately not read, with the reason the member is told. */
const IGNORED: Record<string, string> = {
  vendor: "Vendor is never turned into the product's manufacturer: that is a legal designation you make yourself in the editor",
  "product category": "Shopify's own product taxonomy; Kaizen has its own categories",
  type: "Shopify's product type; Kaizen has its own categories and tags",
  "option1 linked to": "Shopify's linked options are not used",
  "option2 linked to": "Shopify's linked options are not used",
  "option3 linked to": "Shopify's linked options are not used",
  "inventory tracker": "Kaizen keeps stock for every goods variant",
  "variant inventory tracker": "Kaizen keeps stock for every goods variant",
  "fulfillment service": "Kaizen has no fulfilment service setting",
  "variant fulfillment service": "Kaizen has no fulfilment service setting",
  "weight unit for display": "Weights are read in grams",
  "variant weight unit": "Weights are read in grams",
  "variant image alt text": "A variant's picture has no separate alt text",
};

function ignoredReason(name: string): string {
  if (Object.hasOwn(IGNORED, name)) return IGNORED[name];
  if (name.startsWith("google shopping")) return "Google Shopping columns come with the product feed, not the import";
  if (/\(product\.metafields\./.test(name) || /\(variant\.metafields\./.test(name)) return "Only Kaizen's own custom fields are imported";
  if (name.startsWith("inventory quantity /")) return "Stock per location is not imported: Kaizen has one stock figure until locations arrive";
  return "Kaizen does not have this column";
}

/** Shopify's measure units to Kaizen's; null for one Kaizen cannot hold (mg, mm, m3, oz, ...). */
export function mapUnit(unit: string): Unit | null {
  const u = unit.trim().toLowerCase();
  const table: Record<string, Unit> = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", m: "m", cm: "cm", m2: "m2", "m²": "m2", item: "piece", items: "piece", piece: "piece", pcs: "piece" };
  return Object.hasOwn(table, u) ? table[u] : isUnit(u) ? u : null;
}

/** Shopify's base measure (`100` and `ml`) as Kaizen's base, or null when it is the unit's default or has no Kaizen base. */
export function mapBase(amount: string, unit: string): Base | null {
  const mapped = mapUnit(unit);
  const n = amount.trim().replace(",", ".");
  if (!mapped) return null;
  const pair = `${Number(n)}${mapped}`;
  const table: Record<string, Base> = { "1kg": "kg", "100g": "100g", "1l": "l", "100ml": "100ml", "1m": "m", "1m2": "m2", "1piece": "piece" };
  const base = table[pair];
  return base && isBase(base) ? base : null;
}

/** A weight in grams as an integer text, or empty for none or 0 (a variant's weight is above 0). */
function grams(text: string): string {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
}

const truthy = (t: string) => ["true", "yes", "1"].includes(t.trim().toLowerCase());
const falsy = (t: string) => ["false", "no", "0"].includes(t.trim().toLowerCase());

export type ShopifyReadOptions = {
  /** The Kaizen market the plain Price column goes to; the store's first market when null. */
  priceMarket: string | null;
};

/** Shopify's rows (the header first) as a neutral file. */
export function readShopify(raw: readonly (readonly string[])[], ctx: ProductCsvContext, options: ShopifyReadOptions = { priceMarket: null }): NeutralFile {
  const header = (raw[0] ?? []).map((h) => h.replace(/^﻿/, "").trim());
  const names = header.map(norm);
  const ignored: IgnoredColumn[] = [];
  const findings: Finding[] = [];
  const priceMarket = (options.priceMarket ?? ctx.markets[0]?.code ?? "").toUpperCase();

  /** column index to the neutral key it fills (several Shopify columns never fill the same key: the first wins). */
  const target = new Map<number, string>();
  const used = new Set<string>();
  const marketByLabel = (label: string) => ctx.markets.find((m) => m.code.toLowerCase() === label.toLowerCase() || (m.name ?? "").toLowerCase() === label.toLowerCase());
  names.forEach((name, i) => {
    if (name === "") return;
    let key: string | undefined = MAP[name];
    const priced = /^(price|compare-at price|compare at price) \/ (.+)$/.exec(name);
    if (priced) {
      const market = marketByLabel(priced[2]);
      if (priced[1] === "price") {
        if (market) key = `price:${market.code}`;
        else {
          findings.push(finding("price.market_unknown", { column: header[i], name: priced[2] }));
          ignored.push({ column: header[i], reason: "This store does not sell to that market" });
          return;
        }
      } else {
        ignored.push({ column: header[i], reason: "Compare-at prices are never imported" });
        findings.push(finding("compare_at.ignored", { column: header[i] }));
        return;
      }
    } else if (key === "_price") {
      key = priceMarket ? `price:${priceMarket}` : undefined;
      if (!key) {
        ignored.push({ column: header[i], reason: "The store sells to no market" });
        return;
      }
    } else if (key === "_compare_at") {
      ignored.push({ column: header[i], reason: "Compare-at prices are never imported" });
      findings.push(finding("compare_at.ignored", { column: header[i] }));
      return;
    }
    if (key && !used.has(key)) {
      used.add(key);
      target.set(i, key);
    } else if (!key) {
      ignored.push({ column: header[i], reason: ignoredReason(name) });
    }
  });

  const columns = new Set<string>([...used].filter((k) => !k.startsWith("_")));
  if (used.has("_up_amount") || used.has("_up_unit")) {
    columns.add("measure_amount");
    columns.add("measure_unit");
    columns.add("measure_base");
  }
  if (used.has("_published") && !columns.has("status")) columns.add("status");

  const rows: NeutralRow[] = [];
  for (let r = 1; r < raw.length; r += 1) {
    const cells = raw[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const raws: Record<string, string> = {};
    for (const [i, key] of target) raws[key] = unescapeText(cells[i] ?? "");
    const v: Record<string, string> = {};
    for (const [key, value] of Object.entries(raws)) {
      if (key.startsWith("_")) continue;
      v[key] = value;
    }
    if (raws.description !== undefined) v.description = htmlToText(raws.description);
    if (raws.tags !== undefined) {
      v.tags = raws.tags.split(",").map((t) => t.trim()).filter((t) => t !== "").join(" | ");
    }
    if (raws.weight_grams !== undefined) v.weight_grams = grams(raws.weight_grams);
    if (raws.handle !== undefined) v.handle = raws.handle.trim();
    // Status: Shopify's own words, and "Published on online store = false" makes it a draft (and says so).
    if (raws._published !== undefined || raws.status !== undefined) {
      const status = (raws.status ?? "").trim().toLowerCase();
      const unpublished = falsy(raws._published ?? "");
      v.status = unpublished && (status === "" || status === "active") ? "draft" : status;
      if (unpublished && (status === "" || status === "active")) v._unpublished = "true";
      if (status === "" && raws._published !== undefined && truthy(raws._published)) v.status = "active";
    }
    if (used.has("_up_amount") || used.has("_up_unit")) {
      const unit = mapUnit(raws._up_unit ?? "");
      v.measure_amount = (raws._up_amount ?? "").trim();
      v.measure_unit = unit ?? ((raws._up_unit ?? "").trim() === "" ? "" : `!${(raws._up_unit ?? "").trim()}`);
      v.measure_base = (raws._up_base ?? "").trim() === "" ? "" : (mapBase(raws._up_base ?? "", raws._up_base_unit ?? "") ?? "");
    }
    if (falsy(raws._requires_shipping ?? "x")) v._no_shipping = "true";
    if (truthy(raws._continue ?? "") || (raws._continue ?? "").trim().toLowerCase() === "continue" || (raws._policy ?? "").trim().toLowerCase() === "continue") v._continue = "true";
    if (falsy(raws._charge_tax ?? "x") || (raws._tax_code ?? "").trim() !== "") v._tax = "true";
    if (truthy(raws._gift_card ?? "")) v._gift_card = "true";
    // Shopify's product with no options has one option "Title" with the value "Default Title": Kaizen has no option for it.
    if (v.option1_name === "Title" && v.option1_value === "Default Title") {
      v.option1_name = "";
      v.option1_value = "";
    }
    rows.push({ row: r + 1, v });
  }
  // A compare-at column is said once.
  const seen = new Set<string>();
  const unique = findings.filter((f) => (seen.has(`${f.code}:${f.column ?? ""}`) ? false : (seen.add(`${f.code}:${f.column ?? ""}`), true)));
  return { format: "shopify", columns, rows, ignored, findings: unique };
}
