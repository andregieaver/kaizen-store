/**
 * The Kaizen product file (D165, `docs/wave-2-data.md` 4.1), pure: the columns, a product turned into rows (`productRowsOf()`), and a
 * file read into neutral rows and then into products (`readNeutral()`, `groupProducts()`). The Shopify reader maps its file onto the
 * same neutral rows (`product-csv-shopify.ts`), and `product-import.ts` plans what to write.
 *
 * The file has ONE ROW PER VARIANT, grouped by product, a product's own cells on its first row only, and extra pictures as rows that
 * carry the handle and a picture only. Column names are the contract; a change is a change to the spec first. A text cell is written
 * escaped (`csv.ts`) and read unescaped; an amount is a number cell of `amountCell()`; nothing here reads or writes a file or a database.
 */
import { normaliseMeasureAmount } from "./unit-price";
import { parsePrice } from "./product-input";
import type { ProductInput } from "./product-input";
import type { StoreAudience } from "./b2b";
import type { Cell } from "./csv";
import { amountCell, unescapeText } from "./csv";
import type { FieldData, FieldDef } from "./custom-fields";
import { isPlainField, LIST_SEPARATOR, plainFieldText } from "./field-csv";
import { fieldCell } from "./field-csv-cells";
import type { Term } from "./taxonomy";
import { finding, type Finding } from "./data-job";

// ---------------------------------------------------------------------------
// What the file needs to know about the store
// ---------------------------------------------------------------------------

export type CsvMarket = {
  code: string;
  currency: string;
  /** The market's country name, to match a Shopify market by name. */
  name?: string;
  /** The VAT rate now per category (`commerce.vat_rate()`), for a Shopify file whose prices exclude VAT. */
  vatRates: Record<string, number>;
};

/** A plain custom field (`field-csv.ts`), of products or of their variants. */
export type CsvField = { def: FieldDef; entity: "product" | "variant" };

export type ProductCsvContext = {
  /** The store's languages, the primary first. */
  locales: string[];
  primaryLocale: string;
  markets: CsvMarket[];
  mainCurrency: string;
  audience: StoreAudience;
  /** The store's product categories and tags. */
  terms: Term[];
  /** The store's custom fields of products and variants (any type; only the plain ones have columns). */
  fields: CsvField[];
  /** The codes of the VAT categories the store may use. */
  vatCategories: string[];
};

/** A stored product as the editor holds it, with what the file also carries. */
export type StoredProduct = ProductInput & {
  id?: string;
  archived: boolean;
  /** Custom field values of the product, and of each variant by its id (the batch reader's output). */
  fieldData?: { product: FieldData; variants: Record<string, FieldData> };
};

/** How the store enters its prices: with VAT, or without it for a store selling only to businesses. */
export type PriceBasis = "incl_vat" | "excl_vat";
export const priceBasisOf = (audience: StoreAudience): PriceBasis => (audience === "businesses" ? "excl_vat" : "incl_vat");

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export const TEXT_COLUMNS = ["title", "description", "safety_information", "seo_title", "seo_description"] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export const DELIVERY_WORDS = ["physical", "digital", "service"] as const;

/** Cells that belong to a variant, as against the product (a row with any of them filled is a variant's row). */
export const VARIANT_COLUMNS = [
  "variant_id", "sku", "gtin", "active", "delivery", "weight_grams", "hs_code", "origin_country", "cost", "stock", "measure_amount", "measure_unit", "measure_base",
  "option1_value", "option2_value", "option3_value", "variant_image_url",
] as const;

export const isPriceColumn = (name: string): boolean => /^price:[A-Za-z]{2}$/.test(name);
export const isVariantColumn = (name: string): boolean =>
  (VARIANT_COLUMNS as readonly string[]).includes(name) || isPriceColumn(name) || name.startsWith("variant_field:");

/** The fields that can be addressed by name: plain, and with a name no other field of the same kind has. */
export function addressableFields(ctx: ProductCsvContext, entity: "product" | "variant"): FieldDef[] {
  const plain = ctx.fields.filter((f) => f.entity === entity && isPlainField(f.def));
  const count = new Map<string, number>();
  for (const f of plain) count.set(f.def.name, (count.get(f.def.name) ?? 0) + 1);
  return plain.filter((f) => count.get(f.def.name) === 1).map((f) => f.def);
}

/** Names two or more plain fields share (a column would be ambiguous). */
export function ambiguousFieldNames(ctx: ProductCsvContext, entity: "product" | "variant"): string[] {
  const count = new Map<string, number>();
  for (const f of ctx.fields.filter((x) => x.entity === entity && isPlainField(x.def))) count.set(f.def.name, (count.get(f.def.name) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([name]) => name);
}

const fieldHeaders = (defs: FieldDef[], prefix: string, otherLocales: readonly string[]): string[] =>
  defs.flatMap((d) => [`${prefix}:${d.name}`, ...(d.type === "text" || d.type === "textarea" ? otherLocales.map((l) => `${prefix}:${d.name}:${l}`) : [])]);

/** The header row, in the contract's order. */
export function productColumns(ctx: ProductCsvContext): string[] {
  const others = ctx.locales.filter((l) => l !== ctx.primaryLocale);
  return [
    "handle", "status", "kind", "vat_category",
    ...TEXT_COLUMNS,
    ...others.flatMap((l) => TEXT_COLUMNS.map((c) => `${c}:${l}`)),
    "categories", "tags",
    "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value",
    "variant_id", "sku", "gtin", "active", "delivery", "weight_grams", "hs_code", "origin_country", "cost", "stock",
    "measure_amount", "measure_unit", "measure_base", "price_basis",
    ...ctx.markets.map((m) => `price:${m.code}`),
    "image_url", "image_position", "image_alt", "variant_image_url",
    ...fieldHeaders(addressableFields(ctx, "product"), "field", others),
    ...fieldHeaders(addressableFields(ctx, "variant"), "variant_field", others),
  ];
}

// ---------------------------------------------------------------------------
// Terms as names
// ---------------------------------------------------------------------------

export const CATEGORY_PATH_SEPARATOR = " / ";

/** A category's path of names from the top (`["Shoes", "Boots"]`), or a tag's name alone. */
export function termPath(terms: readonly Term[], id: string): string[] | null {
  const byId = new Map(terms.map((t) => [t.id, t]));
  const out: string[] = [];
  let at = byId.get(id);
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift(at.name);
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return out.length > 0 ? out : null;
}

const termNames = (terms: readonly Term[], ids: readonly string[], kind: "category" | "tag"): string =>
  ids
    .map((id) => terms.find((t) => t.id === id && t.kind === kind))
    .filter((t): t is Term => !!t)
    .map((t) => (kind === "category" ? (termPath(terms, t.id) ?? [t.name]).join(CATEGORY_PATH_SEPARATOR) : t.name))
    .join(LIST_SEPARATOR);

/** A cell of terms as lists of names (a category's path as its parts), blank parts dropped. */
export function parseTermList(cell: string, kind: "category" | "tag"): string[][] {
  return cell
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => (kind === "category" ? part.split("/").map((p) => p.trim()).filter((p) => p !== "") : [part]))
    .filter((path) => path.length > 0);
}

// ---------------------------------------------------------------------------
// A product as rows
// ---------------------------------------------------------------------------

const text = (value: string | null | undefined): Cell => (value === null || value === undefined || value === "" ? null : value);

/** The cell for a price typed as the editor holds it ("249,00"): a number cell in the market's own currency, never converted. */
function priceCell(typed: string | undefined, market: CsvMarket): Cell {
  if (!typed) return null;
  const minor = parsePrice(typed, market.currency);
  return minor === null ? null : amountCell(minor, market.currency);
}


/** The rows of one product: a row per variant, then a row per picture the variants' rows did not carry. */
export function productRowsOf(record: StoredProduct, ctx: ProductCsvContext): Cell[][] {
  const header = productColumns(ctx);
  const others = ctx.locales.filter((l) => l !== ctx.primaryLocale);
  const productFields = addressableFields(ctx, "product");
  const variantFields = addressableFields(ctx, "variant");
  const translation = (locale: string) => record.translations.find((t) => t.locale === locale);
  const basis = priceBasisOf(ctx.audience);
  const variants = record.variants;
  const media = record.media;
  const rowCount = Math.max(variants.length, 1) + Math.max(0, media.length - Math.max(variants.length, 1));

  const productCells: Record<string, Cell> = {
    handle: record.handle,
    status: record.archived ? "archived" : record.status,
    kind: record.kind,
    vat_category: record.vatCategory,
    categories: text(termNames(ctx.terms, record.categories, "category")),
    tags: text(termNames(ctx.terms, record.tags, "tag")),
  };
  const primary = translation(ctx.primaryLocale);
  productCells.title = text(primary?.title);
  productCells.description = text(primary?.description);
  productCells.safety_information = text(primary?.safetyInformation);
  productCells.seo_title = text(primary?.seoTitle);
  productCells.seo_description = text(primary?.seoDescription);
  for (const l of others) {
    const t = translation(l);
    productCells[`title:${l}`] = text(t?.title);
    productCells[`description:${l}`] = text(t?.description);
    productCells[`safety_information:${l}`] = text(t?.safetyInformation);
    productCells[`seo_title:${l}`] = text(t?.seoTitle);
    productCells[`seo_description:${l}`] = text(t?.seoDescription);
  }
  record.options.slice(0, 3).forEach((o, i) => {
    productCells[`option${i + 1}_name`] = o.name;
  });
  for (const def of productFields) {
    const data = record.fieldData?.product;
    productCells[`field:${def.name}`] = fieldCell(def, plainFieldText(def, (def.type === "text" || def.type === "textarea" ? data?.translations[ctx.primaryLocale]?.[def.id] : data?.values[def.id]) as never));
    if (def.type === "text" || def.type === "textarea") for (const l of others) productCells[`field:${def.name}:${l}`] = text(plainFieldText(def, data?.translations[l]?.[def.id] as never));
  }

  const rows: Cell[][] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cells: Record<string, Cell> = r === 0 ? { ...productCells } : { handle: record.handle };
    const variant = variants[r];
    if (variant) {
      record.options.slice(0, 3).forEach((o, i) => {
        cells[`option${i + 1}_value`] = text(variant.options[o.name]);
      });
      cells.variant_id = text(variant.id);
      cells.sku = variant.sku;
      cells.gtin = text(variant.gtin);
      cells.active = variant.active ? "true" : "false";
      cells.delivery = variant.delivery;
      cells.weight_grams = variant.weightGrams;
      cells.hs_code = text(variant.hsCode);
      cells.origin_country = text(variant.originCountry);
      const cost = variant.cost ? parsePrice(variant.cost, ctx.mainCurrency) : null;
      cells.cost = cost === null ? null : amountCell(cost, ctx.mainCurrency);
      cells.stock = variant.stock;
      cells.measure_amount = variant.measure ? { num: normaliseMeasureAmount(variant.measure.amount) ?? "0" } : null;
      cells.measure_unit = variant.measure?.unit ?? null;
      cells.measure_base = variant.measure?.base ?? null;
      cells.price_basis = basis;
      for (const m of ctx.markets) cells[`price:${m.code}`] = priceCell(variant.prices[m.code], m);
      cells.variant_image_url = text(variant.image?.url);
      const data = variant.id ? record.fieldData?.variants[variant.id] : undefined;
      for (const def of variantFields) {
        cells[`variant_field:${def.name}`] = fieldCell(def, plainFieldText(def, (def.type === "text" || def.type === "textarea" ? data?.translations[ctx.primaryLocale]?.[def.id] : data?.values[def.id]) as never));
        if (def.type === "text" || def.type === "textarea") for (const l of others) cells[`variant_field:${def.name}:${l}`] = text(plainFieldText(def, data?.translations[l]?.[def.id] as never));
      }
    }
    const picture = media[r];
    if (picture) {
      cells.image_url = picture.url;
      cells.image_position = r + 1;
      cells.image_alt = text(picture.alt);
    }
    rows.push(header.map((name) => cells[name] ?? null));
  }
  return rows;
}

/** A whole file: the header, then the products in handle order. */
export function productFileRows(records: readonly StoredProduct[], ctx: ProductCsvContext): Cell[][] {
  const sorted = [...records].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  return [productColumns(ctx), ...sorted.flatMap((p) => productRowsOf(p, ctx))];
}

/** How many rows of the file a product takes (its variants' rows and any extra picture rows), for the size of an export. */
export const rowCountOf = (variants: number, pictures: number): number => Math.max(variants, 1) + Math.max(0, pictures - Math.max(variants, 1));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type FileFormat = "kaizen" | "shopify";

/** One row of a file as neutral cells by Kaizen column name (text unescaped). `row` is the member's number: the header is row 1. */
export type NeutralRow = { row: number; v: Record<string, string> };
export type IgnoredColumn = { column: string; reason: string };

export type NeutralFile = {
  format: FileFormat;
  /** The neutral column names the file has (a column that is not here is not touched by an import). */
  columns: Set<string>;
  rows: NeutralRow[];
  ignored: IgnoredColumn[];
  /** Findings about the file as a whole. */
  findings: Finding[];
};

/** A Kaizen file's rows (the header first) as a neutral file. Columns it does not know are ignored with a reason, never an error. */
export function readNeutral(raw: readonly (readonly string[])[], ctx: ProductCsvContext): NeutralFile {
  const header = (raw[0] ?? []).map((h) => h.trim());
  const known = new Set(productColumns(ctx));
  const columns = new Set<string>();
  const ignored: IgnoredColumn[] = [];
  const keep: number[] = [];
  header.forEach((name, i) => {
    if (name === "") return;
    if (known.has(name) || /^(field|variant_field):/.test(name) || /^(title|description|safety_information|seo_title|seo_description):/.test(name) || isPriceColumn(name)) {
      if (!columns.has(name)) {
        columns.add(name);
        keep.push(i);
      }
    } else ignored.push({ column: name, reason: "Kaizen does not have this column" });
  });
  const rows: NeutralRow[] = raw.slice(1).map((cells, i) => {
    const v: Record<string, string> = {};
    for (const idx of keep) v[header[idx]] = unescapeText(cells[idx] ?? "");
    return { row: i + 2, v };
  });
  return { format: "kaizen", columns, rows: rows.filter((r) => Object.values(r.v).some((x) => x.trim() !== "")), ignored, findings: [] };
}

export type DraftVariant = { rows: number[]; v: Record<string, string> };
export type DraftPicture = { row: number; url: string; position: number | null; alt: string };

/** A product of the file: its first row's cells, its variants' rows and its pictures, before anything is checked against the store. */
export type ProductDraft = {
  handle: string;
  rows: number[];
  product: Record<string, string>;
  variants: DraftVariant[];
  pictures: DraftPicture[];
};

export type FileFinding = { rows: number[]; finding: Finding };
export type Grouped = { drafts: ProductDraft[]; findings: FileFinding[] };

/** Whether a row carries a variant's data (as against a picture or a product's own cells). */
export function isVariantRow(v: Record<string, string>): boolean {
  return Object.entries(v).some(([k, val]) => isVariantColumn(k) && val.trim() !== "");
}

/** Rows grouped by handle: a handle's rows must be together; a handle that comes back later, or a row with no handle, is a finding. */
export function groupProducts(file: NeutralFile): Grouped {
  const drafts: ProductDraft[] = [];
  const findings: FileFinding[] = [];
  const done = new Set<string>();
  let current: ProductDraft | null = null;
  for (const { row, v } of file.rows) {
    const handle = (v.handle ?? "").trim();
    if (handle === "") {
      findings.push({ rows: [row], finding: finding("row.handle_missing") });
      continue;
    }
    if (!current || current.handle !== handle) {
      if (current) done.add(current.handle);
      if (done.has(handle)) {
        findings.push({ rows: [row], finding: finding("handle.duplicate_in_file", { handle }) });
        current = null;
        continue;
      }
      current = { handle, rows: [], product: v, variants: [], pictures: [] };
      drafts.push(current);
    }
    current.rows.push(row);
    const image = (v.image_url ?? "").trim();
    if (image !== "") {
      const position = Number.parseInt(v.image_position ?? "", 10);
      current.pictures.push({ row, url: image, position: Number.isFinite(position) ? position : null, alt: v.image_alt ?? "" });
    }
    if (isVariantRow(v)) current.variants.push({ rows: [row], v });
  }
  return { drafts, findings };
}

/** Pictures in the order the product shows them: by position where given, else as they came. */
export function orderedPictures(pictures: readonly DraftPicture[]): DraftPicture[] {
  return pictures
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.position ?? a.i + 1) - (b.p.position ?? b.i + 1) || a.i - b.i)
    .map(({ p }) => p);
}

/** The option names a draft's first row carries, with the position (1 to 3) their values are in on every variant row. */
export function optionNamesOf(draft: ProductDraft): { pos: number; name: string }[] {
  const names: { pos: number; name: string }[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const name = (draft.product[`option${i}_name`] ?? "").trim();
    if (name !== "") names.push({ pos: i, name });
  }
  return names;
}
