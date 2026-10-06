/**
 * Planning a product import (D165, `docs/wave-2-data.md` 2.2, 4.4, 4.5), pure: a file already read into drafts is checked, laid over the
 * stored product the editor holds, and turned into the `ProductInput` the editor's own `saveProduct()` takes, with the findings of every
 * row and a summary of what would change. No database, no file, no clock: the server loads the stored products and SKU owners, calls this,
 * and writes only through `saveProduct()` (so `commerce.set_price`, `productProblems()`, the unit-price rules and the publishing
 * triggers apply unchanged). Nothing here deletes a product, a variant, a price or a picture of a product outside the file, and nothing
 * changes a handle.
 *
 * Rules held here (each has a test): blank means clear and absent means keep; an unchanged product writes nothing; an amount is read
 * as the editor reads it (`parsePrice()`, the country's own currency, never converted) and a price equal to the stored one is not
 * set again; a compare-at price is never read; a SKU of another product is an error, never a move; a variant not in the file is kept,
 * or switched off by leaving it out of the input, never deleted; a product that cannot be published becomes a draft (or is skipped).
 */
import { withVat, withoutVat } from "./b2b";
import { PRODUCT_STATUSES, DELIVERY_WORDS, groupProducts, optionNamesOf, orderedPictures, parseTermList, priceBasisOf } from "./product-csv";
import type { FileFinding, Grouped, NeutralFile, ProductCsvContext, ProductDraft, StoredProduct, DraftVariant } from "./product-csv";
import { addressableFields, ambiguousFieldNames, isPriceColumn } from "./product-csv";
import { finding, type DryRunCounts, type Finding, type ItemOutcome, type Severity } from "./data-job";
import { IMPORT_MAX_PRODUCTS, IMPORT_MAX_ROWS } from "./data-limits";
import { BACKORDER_DAYS_MAX, BACKORDER_DAYS_MIN, THRESHOLD_MAX } from "./inventory";
import { parsePlainField, plainFieldText, type PlainParsed } from "./field-csv";
import type { FieldChanges, FieldDef, FieldValue } from "./custom-fields";
import { MAX_MEDIA, MAX_OPTIONS, MAX_VARIANTS, PRODUCT_KINDS, formatPriceInput, parsePrice, productInput, productProblems } from "./product-input";
import type { ProductInput, PublishContext, VariantInput } from "./product-input";
import { ITEM_TERMS_MAX } from "./taxonomy";
import { BASES, baseFits, isBase, isUnit, normaliseMeasureAmount } from "./unit-price";
import { isPictureAddress } from "./picture-address";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export const IMPORT_MODES = ["upsert", "create", "update"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export type ImportOptions = {
  /** Create new and update existing (the default), only create, or only update. */
  mode: ImportMode;
  /** What to do with a product that cannot be published: save it as a draft (the default) or skip it. */
  unpublishable: "draft" | "skip";
  /** The economic operator that is the manufacturer of a NEW physical product the file gives none (a Shopify file has no GPSR manufacturer). */
  manufacturerId: string | null;
  /** Variants of an existing product that are not in the file: keep (the default) or switch off (leave out of the saved product). */
  missingVariants: "keep" | "switch_off";
  /** For a Shopify file: whether its prices include VAT. No default: null until the member chooses. */
  pricesIncludeVat: boolean | null;
  /** For a Shopify file: the market its plain Price column is for (the store's first market when null). */
  priceMarket: string | null;
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  mode: "upsert",
  unpublishable: "draft",
  manufacturerId: null,
  missingVariants: "keep",
  pricesIncludeVat: null,
  priceMarket: null,
};

/** The member's options from what a form or a job's `options` column holds; anything unknown is the default. */
export function parseImportOptions(raw: unknown): ImportOptions {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    mode: IMPORT_MODES.find((m) => m === o.mode) ?? DEFAULT_IMPORT_OPTIONS.mode,
    unpublishable: o.unpublishable === "skip" ? "skip" : "draft",
    manufacturerId: typeof o.manufacturerId === "string" && /^[0-9a-f-]{36}$/i.test(o.manufacturerId) ? o.manufacturerId : null,
    missingVariants: o.missingVariants === "switch_off" ? "switch_off" : "keep",
    pricesIncludeVat: typeof o.pricesIncludeVat === "boolean" ? o.pricesIncludeVat : null,
    priceMarket: typeof o.priceMarket === "string" && /^[A-Za-z]{2}$/.test(o.priceMarket) ? o.priceMarket.toUpperCase() : null,
  };
}

// ---------------------------------------------------------------------------
// What the plan needs
// ---------------------------------------------------------------------------

export type SkuOwner = { handle: string; variantId: string };
export type FetchedPicture = { url: string; thumbnailUrl: string | null };

/** The store's state the plan is checked against: the stored products of the handles in the file, and who owns the SKUs and variant ids it names. */
export type StoreSnapshot = {
  products: ReadonlyMap<string, StoredProduct>;
  /** Lowercased SKU to its owner, for every SKU of the store the file names (any product, active or not). */
  skuOwners: ReadonlyMap<string, SkuOwner>;
  /** Variant id to the handle of the product it belongs to, for the ids the file names. */
  variantOwners: ReadonlyMap<string, string>;
};

export type PlanEnv = {
  ctx: ProductCsvContext;
  options: ImportOptions;
  /** A blank product as the editor starts one (`emptyProduct()`): its defaults, and the store's first manufacturer. */
  blank: ProductInput;
  publish: PublishContext;
  /** Whether an address is one of the store's own pictures (its library, or the site's own path). */
  isOwnPicture: (url: string) => boolean;
  /** Pictures an import already fetched, by the address in the file: `null` for one that could not be. */
  fetched?: ReadonlyMap<string, FetchedPicture | null>;
  /** How many stock locations the store has active (wave 3, D172): with more than one, a stock figure of the file cannot say where, so it is not imported. */
  activeLocations?: number;
};

/** A category or tag the file names that the store does not have yet. `named` is a path the file names in full, as against a parent made only so a child has somewhere to be: only a named one is given to the product. */
export type PendingTerm = { kind: "category" | "tag"; path: string[]; named?: boolean };
export const pendingKey = (t: PendingTerm): string => `${t.kind}:${t.path.map((p) => p.toLowerCase()).join("/")}`;

export type ProductPlan = {
  handle: string;
  rows: number[];
  /** What would happen: `drafted` is a product saved as a draft because it cannot be published. */
  outcome: Exclude<ItemOutcome, "failed" | "checked">;
  /** Whether the product is new to the store. */
  isNew: boolean;
  /** The product to save with `saveProduct()`; null when nothing is written. */
  input: ProductInput | null;
  /** The product was archived: set it archived again after the save (the editor's save makes it a draft). */
  archiveAfter: boolean;
  fields?: FieldChanges;
  /** By the variant's SKU. */
  variantFields?: Record<string, FieldChanges>;
  /** Categories and tags to create first (parents before children), then `withCreatedTerms()`. */
  pendingTerms: PendingTerm[];
  /** Picture addresses to fetch (external, not yet in `env.fetched`), in order. */
  pictures: string[];
  findings: Finding[];
  changes: { prices: number; fields: string[]; stock: boolean };
};

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const t = (v: string | undefined) => (v ?? "").trim();
const lower = (s: string) => s.toLowerCase();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const TRUE = ["true", "yes", "1", "ja"];
const FALSE = ["false", "no", "0", "nei", "nej"];
function parseBool(text: string): boolean | null {
  const v = lower(text.trim());
  return TRUE.includes(v) ? true : FALSE.includes(v) ? false : null;
}

/** An integer of at most 15 digits; null otherwise. */
function parseWhole(text: string): number | null {
  return /^\d{1,15}$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** Strips what a person's words in a sentence could quote: whatever is in double quotes. */
const safeReason = (problem: string) => problem.replace(/"[^"]*"/g, "…").replace(/\.+$/, "").slice(0, 200);

// ---------------------------------------------------------------------------
// The whole file
// ---------------------------------------------------------------------------

/** Findings about the file as a whole, from what it holds and the options: unknown and ambiguous columns, a price basis, the limits. */
export function checkFile(file: NeutralFile, grouped: Grouped, env: PlanEnv): FileFinding[] {
  const { ctx } = env;
  const out: FileFinding[] = [];
  const add = (f: Finding, rows: number[] = []) => out.push({ rows, finding: f });
  if (file.rows.length > IMPORT_MAX_ROWS) add(finding("file.too_many_rows", { n: file.rows.length, max: IMPORT_MAX_ROWS }));
  if (grouped.drafts.length > IMPORT_MAX_PRODUCTS) add(finding("file.too_many_products", { n: grouped.drafts.length, max: IMPORT_MAX_PRODUCTS }));
  for (const f of file.findings) add(f);
  for (const c of file.ignored) add(finding("column.ignored", { column: c.column, reason: c.reason }));

  const marketCodes = new Set(ctx.markets.map((m) => m.code));
  for (const column of file.columns) {
    const price = /^price:([A-Za-z]{2})$/.exec(column);
    if (price && !marketCodes.has(price[1].toUpperCase()) && !file.findings.some((f) => f.column === column)) {
      add(finding("price.market_unknown", { column, name: price[1].toUpperCase() }));
    }
    const text = /^(?:title|description|safety_information|seo_title|seo_description):(.+)$/.exec(column);
    if (text && !ctx.locales.includes(text[1])) add(finding("column.ignored", { column, reason: "The store does not offer that language" }));
  }
  // Custom fields: a name the store does not have is ignored, one two fields share is an error for the column.
  for (const entity of ["product", "variant"] as const) {
    const prefix = entity === "product" ? "field" : "variant_field";
    const ambiguous = new Set(ambiguousFieldNames(ctx, entity));
    const known = new Set(addressableFields(ctx, entity).map((d) => d.name));
    for (const column of file.columns) {
      if (!column.startsWith(`${prefix}:`)) continue;
      const name = column.slice(prefix.length + 1).split(":")[0];
      if (ambiguous.has(name)) add(finding("field.ambiguous", { column }));
      else if (!known.has(name)) add(finding("field.unknown", { column }));
    }
  }
  // Prices: Kaizen says which basis its prices are in, and it must be the store's; a Shopify file must be told.
  const hasPrices = [...file.columns].some(isPriceColumn);
  if (file.format === "kaizen" && file.columns.has("price_basis")) {
    const store = priceBasisOf(ctx.audience);
    const differs = file.rows.some((r) => t(r.v.price_basis) !== "" && t(r.v.price_basis) !== store);
    if (differs) add(finding("price_basis.mismatch"));
  }
  if (file.format === "shopify" && hasPrices && env.options.pricesIncludeVat === null) add(finding("price_basis.required"));
  return out;
}

/** The finding that stops every product of the file, if one does (a price basis nobody can guess, a file over the limits). */
export function blockingFinding(fileFindings: readonly FileFinding[]): Finding | null {
  return fileFindings.find((f) => f.finding.severity === "error" && ["price_basis.mismatch", "price_basis.required", "file.too_many_rows", "file.too_many_products"].includes(f.finding.code))?.finding ?? null;
}

/** The SKUs that appear in more than one product of the file, or twice in one: the handle of the later product, and the SKU. */
export function duplicateSkus(drafts: readonly ProductDraft[]): Map<string, string> {
  const seen = new Map<string, string>();
  const dup = new Map<string, string>();
  for (const d of drafts) {
    const own = new Set<string>();
    for (const v of d.variants) {
      const sku = lower(t(v.v.sku));
      if (sku === "") continue;
      if ((seen.has(sku) && seen.get(sku) !== d.handle) || own.has(sku)) dup.set(d.handle, t(v.v.sku));
      own.add(sku);
      if (!seen.has(sku)) seen.set(sku, d.handle);
    }
  }
  return dup;
}

// ---------------------------------------------------------------------------
// One product
// ---------------------------------------------------------------------------

type Canon = {
  status: string;
  archived: boolean;
  kind: string;
  vat: string;
  translations: [string, string, string, string, string, string][];
  media: [string, string][];
  options: [string, string[]][];
  categories: string[];
  tags: string[];
  variants: unknown[];
};

/** A product in the form two products are compared in: amounts as minor units, texts trimmed, ids in order. */
export function canonical(input: ProductInput, archived: boolean, ctx: ProductCsvContext): Canon {
  const market = (code: string) => ctx.markets.find((m) => m.code === code);
  return {
    status: input.status,
    archived,
    kind: input.kind,
    vat: input.vatCategory,
    translations: input.translations.map((x) => [x.locale, x.title.trim(), x.description.trim(), x.safetyInformation.trim(), x.seoTitle.trim(), x.seoDescription.trim()] as [string, string, string, string, string, string]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    media: input.media.map((m) => [m.url, m.alt.trim()] as [string, string]),
    options: input.options.map((o) => [o.name, [...o.values]] as [string, string[]]),
    categories: [...input.categories].sort(),
    tags: [...input.tags].sort(),
    variants: input.variants.map((v) => ({
      id: v.id,
      options: Object.entries(v.options).sort(([a], [b]) => (a < b ? -1 : 1)),
      sku: v.sku.trim(),
      gtin: v.gtin,
      active: v.active,
      delivery: v.delivery,
      weight: v.weightGrams,
      hs: v.hsCode,
      origin: v.originCountry,
      cost: v.cost ? parsePrice(v.cost, ctx.mainCurrency) : null,
      stock: v.stock,
      policy: [v.stockPolicy, v.stockPolicy === "continue" ? v.backorderDays : null, v.lowStockThreshold],
      measure: v.measure ? [normaliseMeasureAmount(v.measure.amount), v.measure.unit, v.measure.base] : null,
      prices: Object.entries(v.prices)
        .map(([code, typed]) => [code, typed ? parsePrice(typed, market(code)?.currency ?? "NOK") : null] as const)
        .filter(([, minor]) => minor !== null)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
      image: v.image?.url ?? null,
    })),
  };
}

type Ctx = {
  draft: ProductDraft;
  file: NeutralFile;
  env: PlanEnv;
  stored: StoredProduct | null;
  snapshot: StoreSnapshot;
  findings: Finding[];
  /** Counts a plan keeps for its summary. */
  pricesChanged: number;
  stockChanged: boolean;
  changedFields: Set<string>;
  pictures: string[];
  pending: Map<string, PendingTerm>;
  blocked: Finding | null;
  duplicateSku: string | null;
};

const has = (c: Ctx, column: string) => c.file.columns.has(column);
const err = (c: Ctx, code: Parameters<typeof finding>[0], params: Parameters<typeof finding>[1] = {}, severity?: Severity) => {
  c.findings.push(finding(code, { handle: c.draft.handle, ...params }, severity));
};
const hasError = (c: Ctx) => c.findings.some((f) => f.severity === "error");

function resolveTerms(c: Ctx, cell: string, kind: "category" | "tag"): string[] {
  const { terms } = c.env.ctx;
  const ids: string[] = [];
  for (const path of parseTermList(cell, kind)) {
    let parent: string | null = null;
    let missingFrom = -1;
    for (let i = 0; i < path.length; i += 1) {
      const found = terms.find((x) => x.kind === kind && (kind === "tag" || x.parentId === parent) && lower(x.name) === lower(path[i]));
      if (!found) {
        missingFrom = i;
        break;
      }
      parent = found.id;
    }
    if (missingFrom === -1 && parent) {
      if (!ids.includes(parent)) ids.push(parent);
    } else {
      // The missing part and the parts below it are made when the job applies; the parts above exist.
      for (let i = missingFrom; i < path.length; i += 1) {
        const p: PendingTerm = { kind, path: path.slice(0, i + 1), ...(i === path.length - 1 ? { named: true } : {}) };
        const have = c.pending.get(pendingKey(p));
        if (!have) c.pending.set(pendingKey(p), p);
        else if (p.named) have.named = true;
      }
    }
  }
  return ids;
}

function pictureFor(c: Ctx, url: string, alt: string, from: StoredProduct | null): { url: string; thumbnailUrl: string | null; alt: string } | null {
  const { env } = c;
  if (!isPictureAddress(url)) {
    err(c, "media.address_invalid");
    return null;
  }
  const own = url.startsWith("/") || env.isOwnPicture(url);
  if (own) {
    const known = from?.media.find((m) => m.url === url);
    const variantKnown = from?.variants.find((v) => v.image?.url === url)?.image;
    return { url, thumbnailUrl: known?.thumbnailUrl ?? variantKnown?.thumbnailUrl ?? null, alt };
  }
  if (env.fetched?.has(url)) {
    const got = env.fetched.get(url);
    if (!got) {
      c.findings.push(finding("media.fetch_failed", { handle: c.draft.handle }));
      return null;
    }
    return { url: got.url, thumbnailUrl: got.thumbnailUrl, alt };
  }
  if (!c.pictures.includes(url)) c.pictures.push(url);
  return { url, thumbnailUrl: null, alt };
}

type VariantResult = { variant: VariantInput; fieldChanges?: FieldChanges };

function fieldChangesFor(
  c: Ctx,
  defs: FieldDef[],
  prefix: "field" | "variant_field",
  v: Record<string, string>,
  storedData: { values: Record<string, FieldValue>; translations: Record<string, Record<string, FieldValue>> } | undefined,
  onlyIfPresent = true,
): FieldChanges | undefined {
  const { ctx } = c.env;
  const changes: FieldChanges = { values: {}, translations: {} };
  let any = false;
  for (const def of defs) {
    const translatable = def.type === "text" || def.type === "textarea";
    const keys: { column: string; locale: string | null }[] = translatable
      ? ctx.locales.map((l) => ({ column: l === ctx.primaryLocale ? `${prefix}:${def.name}` : `${prefix}:${def.name}:${l}`, locale: l }))
      : [{ column: `${prefix}:${def.name}`, locale: null }];
    for (const { column, locale } of keys) {
      if (onlyIfPresent && !has(c, column)) continue;
      const cell = t(v[column]);
      const parsed: PlainParsed = parsePlainField(def, cell);
      if (!parsed.ok) {
        err(c, "field.invalid", { column, reason: safeReason(parsed.problem) });
        continue;
      }
      const old = locale === null ? storedData?.values[def.id] : storedData?.translations[locale]?.[def.id];
      const oldText = plainFieldText(def, old as FieldValue | undefined);
      const newText = parsed.value === null ? "" : plainFieldText(def, parsed.value);
      if (oldText === newText) continue;
      if (parsed.value === null) err(c, "value.cleared", { column }, "warning");
      any = true;
      c.changedFields.add(column);
      if (locale === null) changes.values[def.id] = parsed.value;
      else (changes.translations[locale] ??= {})[def.id] = parsed.value;
    }
  }
  return any ? changes : undefined;
}

function convertPrice(c: Ctx, minor: number, marketCode: string, category: string): number {
  const { options, ctx } = c.env;
  if (c.file.format !== "shopify" || options.pricesIncludeVat === null) return minor;
  const market = ctx.markets.find((m) => m.code === marketCode);
  const rate = market ? (market.vatRates[category] ?? market.vatRates.standard ?? 0) : 0;
  if (ctx.audience === "businesses") return options.pricesIncludeVat ? withoutVat(minor, rate) : minor;
  return options.pricesIncludeVat ? minor : withVat(minor, rate);
}

/** One variant of the file laid over the stored one (or a new one). Errors are findings on the product. */
function overlayVariant(c: Ctx, base: VariantInput, dv: DraftVariant, names: { pos: number; name: string }[], isNew: boolean, category: string): VariantResult {
  const { ctx } = c.env;
  const v = dv.v;
  const out: VariantInput = clone(base);
  const sku = t(v.sku);
  if ((has(c, "sku") || isNew) && !(base.sku !== "" && lower(sku) === lower(base.sku))) out.sku = sku || out.sku;
  if (isNew) {
    out.options = {};
  }
  if (names.length > 0) {
    const options: Record<string, string> = {};
    for (const { pos, name } of names) {
      const value = t(v[`option${pos}_value`]);
      if (value === "") err(c, "options.mismatch");
      options[name] = value;
    }
    out.options = options;
  }
  if (has(c, "gtin")) {
    const g = t(v.gtin);
    if (g === "") out.gtin = null;
    else if (/^\d{8,14}$/.test(g)) out.gtin = g;
    else err(c, "gtin.invalid", { sku: sku || undefined });
  }
  if (has(c, "active") && t(v.active) !== "") {
    const b = parseBool(v.active);
    if (b === null) err(c, "active.invalid");
    else out.active = b;
  }
  if (has(c, "delivery") && t(v.delivery) !== "") {
    const d = lower(t(v.delivery));
    // A download or a service needs its file or its staff, which the file does not carry: only what is already there reads back.
    if (!(DELIVERY_WORDS as readonly string[]).includes(d) || d !== out.delivery) err(c, "delivery.not_importable", {}, "error");
  }
  if (isNew && v._no_shipping === "true") err(c, "delivery.not_importable", {}, "warning");
  if (has(c, "weight_grams")) {
    const w = t(v.weight_grams);
    if (w === "") out.weightGrams = null;
    else {
      const n = parseWhole(w);
      if (n === null || n <= 0 || n > 1_000_000) err(c, "weight.invalid");
      else out.weightGrams = n;
    }
  }
  if (has(c, "hs_code")) {
    const h = t(v.hs_code).replace(/[.\s]/g, "");
    if (h === "") out.hsCode = null;
    else if (/^\d{6,10}$/.test(h)) out.hsCode = h;
    else err(c, "hs_code.invalid");
  }
  if (has(c, "origin_country")) {
    const o = t(v.origin_country).toUpperCase();
    if (o === "") out.originCountry = null;
    else if (/^[A-Z]{2}$/.test(o)) out.originCountry = o;
    else err(c, "origin.invalid");
  }
  if (has(c, "cost")) {
    const cost = t(v.cost);
    if (cost === "") out.cost = "";
    else {
      const minor = parsePrice(cost, ctx.mainCurrency);
      if (minor === null) err(c, "cost.unreadable", { sku: sku || undefined });
      else {
        const oldMinor = base.cost ? parsePrice(base.cost, ctx.mainCurrency) : null;
        if (oldMinor !== minor) out.cost = formatPriceInput(minor, ctx.mainCurrency);
      }
    }
  }
  if (has(c, "stock") && t(v.stock) !== "") {
    const n = parseWhole(v.stock);
    if (n === null || n > 1_000_000) err(c, "stock.invalid");
    else if (out.delivery !== "digital" && n !== out.stock) {
      if ((c.env.activeLocations ?? 1) > 1) {
        // Which location the figure is for is not in this file; the stock file says so.
        if (!c.findings.some((f) => f.code === "inventory.multi_location_stock_ignored")) err(c, "inventory.multi_location_stock_ignored", {}, "warning");
      } else {
        out.stock = n;
        c.stockChanged = true;
      }
    }
  }
  // Selling past zero and the warning level (wave 3, D172). An empty policy or delivery-time cell keeps what the variant has; an empty warning level
  // switches the warning off, as an empty weight clears the weight. A download, service or booking has none of the three.
  if (has(c, "stock_policy") && t(v.stock_policy) !== "") {
    const word = lower(t(v.stock_policy));
    if (word !== "deny" && word !== "continue") err(c, "stock_policy.invalid", { sku: sku || undefined });
    else if (word === "continue" && out.delivery !== "physical") err(c, "stock_policy.not_goods", { sku: sku || undefined });
    else out.stockPolicy = word;
  }
  if (has(c, "backorder_days") && t(v.backorder_days) !== "") {
    const days = parseWhole(v.backorder_days);
    if (days === null || days < BACKORDER_DAYS_MIN || days > BACKORDER_DAYS_MAX) err(c, "backorder_days.invalid", { sku: sku || undefined });
    else out.backorderDays = days;
  }
  if (has(c, "stock_policy") || has(c, "backorder_days")) {
    if (out.stockPolicy === "deny") out.backorderDays = null;
    else if (out.backorderDays === null && !hasError(c)) err(c, "backorder_days.required", { sku: sku || undefined });
  }
  if (has(c, "low_stock_threshold")) {
    const cell = t(v.low_stock_threshold);
    if (cell === "") out.lowStockThreshold = null;
    else {
      const n = parseWhole(cell);
      if (n === null || n > THRESHOLD_MAX || out.delivery !== "physical") err(c, "low_stock_threshold.invalid", { sku: sku || undefined });
      else out.lowStockThreshold = n;
    }
  }
  if (has(c, "measure_amount") || has(c, "measure_unit")) {
    const amount = t(v.measure_amount);
    const unit = t(v.measure_unit);
    if (amount === "" && unit === "") out.measure = null;
    else if (unit.startsWith("!") || !isUnit(unit) || normaliseMeasureAmount(amount) === null) err(c, "measure.invalid");
    else {
      const baseWord = t(v.measure_base);
      if (baseWord !== "" && !(isBase(baseWord) && baseFits(unit, baseWord))) err(c, "measure.invalid");
      else out.measure = { amount: normaliseMeasureAmount(amount) as string, unit, base: baseWord === "" ? null : (baseWord as (typeof BASES)[number]) };
    }
  }
  for (const m of ctx.markets) {
    const column = `price:${m.code}`;
    if (!has(c, column)) continue;
    const cell = t(v[column]);
    if (cell === "") {
      if (out.prices[m.code]) {
        delete out.prices[m.code];
        err(c, "value.cleared", { column }, "warning");
        c.pricesChanged += 1;
      }
      continue;
    }
    if (cell.startsWith("-")) {
      err(c, "price.negative", { column });
      continue;
    }
    const minor = parsePrice(cell, m.currency);
    if (minor === null) {
      err(c, "price.unreadable", { column });
      continue;
    }
    const typed = convertPrice(c, minor, m.code, category);
    const oldMinor = base.prices[m.code] ? parsePrice(base.prices[m.code], m.currency) : null;
    if (oldMinor !== typed) {
      out.prices[m.code] = formatPriceInput(typed, m.currency);
      c.pricesChanged += 1;
    }
  }
  if (has(c, "variant_image_url")) {
    const url = t(v.variant_image_url);
    if (url === "") out.image = null;
    else {
      const p = pictureFor(c, url, "", c.stored);
      out.image = p ? { url: p.url, thumbnailUrl: p.thumbnailUrl } : null;
    }
  }
  return { variant: out };
}

/** Lays a draft over the stored product and decides what to write. */
export function planProduct(draft: ProductDraft, file: NeutralFile, env: PlanEnv, snapshot: StoreSnapshot, extra: { blocked?: Finding | null; duplicateSku?: string | null } = {}): ProductPlan {
  const { ctx, options } = env;
  const stored = snapshot.products.get(draft.handle) ?? null;
  const c: Ctx = {
    draft, file, env, stored, snapshot, findings: [], pricesChanged: 0, stockChanged: false, changedFields: new Set(), pictures: [], pending: new Map(),
    blocked: extra.blocked ?? null, duplicateSku: extra.duplicateSku ?? null,
  };
  const isNew = stored === null;
  const result = (outcome: ProductPlan["outcome"], input: ProductInput | null, more: Partial<ProductPlan> = {}): ProductPlan => ({
    handle: draft.handle,
    rows: draft.rows,
    outcome,
    isNew,
    input,
    archiveAfter: false,
    pendingTerms: [...c.pending.values()],
    pictures: c.pictures,
    findings: c.findings,
    changes: { prices: c.pricesChanged, fields: [...c.changedFields], stock: c.stockChanged },
    ...more,
  });
  const skipped = () => result("skipped", null, { pendingTerms: [], pictures: [] });

  if (c.blocked) {
    c.findings.push(c.blocked);
    return skipped();
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.handle) || draft.handle.length > 80) {
    err(c, "row.handle_invalid");
    return skipped();
  }
  if (isNew && options.mode === "update") {
    err(c, "product.missing");
    return skipped();
  }
  if (!isNew && options.mode === "create") {
    err(c, "product.exists");
    return skipped();
  }
  const p = draft.product;
  if (c.duplicateSku !== null) err(c, "sku.duplicate_in_file", { sku: c.duplicateSku });

  // Things that stop a product at once -------------------------------------------------------------------------------------
  const rowFlags = (key: string) => draft.variants.some((v) => v.v[key] === "true") || p[key] === "true";
  if (rowFlags("_gift_card")) err(c, "giftcard.not_supported");
  if (rowFlags("_continue")) err(c, "inventory.continue_selling_ignored", {}, "warning");
  if (rowFlags("_tax")) err(c, "tax.ignored", {}, "warning");

  const base: ProductInput = clone(stored ? (({ archived, id, fieldData, ...rest }) => (void archived, void id, void fieldData, rest))(stored) : env.blank);
  const input = base;
  if (isNew) input.handle = draft.handle;
  const category = has(c, "vat_category") && file.format === "kaizen" && t(p.vat_category) !== "" ? t(p.vat_category) : base.vatCategory;

  // Kind: a new product is goods; a kind is never changed.
  if (has(c, "kind") && t(p.kind) !== "") {
    const k = lower(t(p.kind));
    if (!(PRODUCT_KINDS as readonly string[]).includes(k) || k !== base.kind) err(c, "kind.not_importable");
  }
  if (has(c, "vat_category") && file.format === "kaizen" && t(p.vat_category) !== "") {
    if (!ctx.vatCategories.includes(t(p.vat_category))) err(c, "vat_category.unknown");
    else input.vatCategory = t(p.vat_category);
  }

  // Status ----------------------------------------------------------------------------------------------------------------
  let wantsArchived = stored?.archived ?? false;
  if (has(c, "status") && t(p.status) !== "") {
    const s = lower(t(p.status));
    if (!(PRODUCT_STATUSES as readonly string[]).includes(s)) err(c, "status.unknown");
    else if (s === "archived") {
      wantsArchived = true;
      input.status = "draft";
    } else {
      wantsArchived = false;
      input.status = s as "draft" | "active";
    }
  }
  if (p._unpublished === "true") err(c, "status.draft_because_unpublished", {}, "warning");

  // Texts, one set per language the store offers -------------------------------------------------------------------------
  const fieldOf = { title: "title", description: "description", safety_information: "safetyInformation", seo_title: "seoTitle", seo_description: "seoDescription" } as const;
  for (const tr of input.translations) {
    for (const [column, prop] of Object.entries(fieldOf)) {
      const name = tr.locale === ctx.primaryLocale ? column : `${column}:${tr.locale}`;
      if (!has(c, name)) continue;
      const value = (p[name] ?? "").replace(/\r\n/g, "\n").trim();
      const before = tr[prop as keyof typeof tr] as string;
      if (value === "" && before.trim() !== "") err(c, "value.cleared", { column: name }, "warning");
      (tr as Record<string, string>)[prop] = value;
    }
  }

  // Terms -----------------------------------------------------------------------------------------------------------------
  for (const [column, kind] of [["categories", "category"], ["tags", "tag"]] as const) {
    if (!has(c, column)) continue;
    const ids = resolveTerms(c, p[column] ?? "", kind);
    if ((kind === "category" ? input.categories : input.tags).length > 0 && ids.length === 0 && parseTermList(p[column] ?? "", kind).length === 0) err(c, "value.cleared", { column }, "warning");
    if (kind === "category") input.categories = ids;
    else input.tags = ids;
  }
  if (input.categories.length + input.tags.length > ITEM_TERMS_MAX) err(c, "save.failed", { reason: `Use at most ${ITEM_TERMS_MAX} categories and tags.` });
  if (c.pending.size > 0) err(c, "term.created", { n: c.pending.size }, "info");

  // Pictures --------------------------------------------------------------------------------------------------------------
  if (has(c, "image_url")) {
    const ordered = orderedPictures(draft.pictures);
    if (ordered.length > MAX_MEDIA) err(c, "media.too_many", { max: MAX_MEDIA });
    else {
      const media: ProductInput["media"] = [];
      for (const pic of ordered) {
        const made = pictureFor(c, pic.url, pic.alt.trim(), stored);
        if (made) media.push(made);
      }
      if (ordered.length === 0 && input.media.length > 0) err(c, "value.cleared", { column: "image_url" }, "warning");
      input.media = media;
    }
  }

  // Variants --------------------------------------------------------------------------------------------------------------
  const fieldChanges: { product?: FieldChanges; variants: Record<string, FieldChanges> } = { variants: {} };
  const vdefs = addressableFields(ctx, "variant");
  const pdefs = addressableFields(ctx, "product");
  if (draft.variants.length > MAX_VARIANTS) err(c, "options.too_many", { max: MAX_VARIANTS });
  if (draft.variants.length === 0 && isNew) err(c, "sku.missing");
  const hasOptionColumns = [1, 2, 3].some((i) => has(c, `option${i}_name`));
  const names = hasOptionColumns ? optionNamesOf(draft) : base.options.map((o, i) => ({ pos: i + 1, name: o.name }));
  if (draft.variants.length > 0 && !hasOptionColumns && !isNew) {
    // Option values come from the stored variants; a new variant has none to give.
  }
  if (draft.variants.length > 1 && names.length === 0 && (isNew || hasOptionColumns)) err(c, "options.mismatch");

  if (draft.variants.length > 0) {
    // A new product has no variants yet: the blank one is only the template of a new variant.
    const storedVariants = isNew ? [] : input.variants;
    const matchedStored = new Set<number>();
    const next: VariantInput[] = [];
    const created: VariantInput[] = [];
    for (const dv of draft.variants) {
      const id = t(dv.v.variant_id);
      const sku = t(dv.v.sku);
      let index = -1;
      if (id !== "") {
        index = storedVariants.findIndex((sv) => sv.id === id);
        if (index === -1) {
          if (snapshot.variantOwners.has(id)) err(c, "handle.mismatch", { column: "variant_id" });
          else err(c, "variant.unknown_id", { column: "variant_id" });
          continue;
        }
      } else {
        if (sku === "") {
          err(c, "sku.missing");
          continue;
        }
        index = storedVariants.findIndex((sv) => sv.sku === sku);
        if (index === -1) index = storedVariants.findIndex((sv) => lower(sv.sku) === lower(sku));
      }
      if (sku !== "") {
        const owner = snapshot.skuOwners.get(lower(sku));
        const mine = index !== -1 && owner?.variantId === storedVariants[index].id;
        if (owner && owner.handle !== draft.handle && !mine) {
          err(c, "sku.in_other_product", { sku });
          continue;
        }
      } else if (index !== -1 && has(c, "sku")) {
        err(c, "sku.missing");
        continue;
      }
      const isNewVariant = index === -1;
      if (!isNewVariant) {
        if (matchedStored.has(index)) {
          err(c, "sku.duplicate_in_file", { sku: sku || undefined });
          continue;
        }
        matchedStored.add(index);
      }
      const baseVariant: VariantInput = isNewVariant ? { ...clone(env.blank.variants[0]), id: null, sku, stock: 0 } : storedVariants[index];
      const made = overlayVariant(c, baseVariant, dv, hasOptionColumns || isNewVariant ? names : [], isNewVariant, category);
      const key = made.variant.sku;
      const stored = isNewVariant ? undefined : c.stored?.fieldData?.variants[storedVariants[index].id ?? ""];
      const vc = fieldChangesFor(c, vdefs, "variant_field", dv.v, stored);
      if (vc) fieldChanges.variants[key] = vc;
      if (isNewVariant) created.push(made.variant);
      else next[index] = made.variant;
    }
    // Variants of the product that are not in the file: kept in their place, or left out (and so switched off by the save).
    const kept: VariantInput[] = [];
    storedVariants.forEach((sv, i) => {
      if (matchedStored.has(i)) kept.push(next[i]);
      else if (options.missingVariants === "keep") kept.push(sv);
    });
    input.variants = [...kept, ...created];
    if (input.variants.length === 0 && !hasError(c)) err(c, "sku.missing");
    // Options: from the file's names, with the values of the variants that are there, in the order they come.
    if (hasOptionColumns) {
      const keptStoredOnly = storedVariants.some((_, i) => !matchedStored.has(i)) && options.missingVariants === "keep";
      if (!isNew && keptStoredOnly && JSON.stringify(base.options.map((o) => o.name)) !== JSON.stringify(names.map((n) => n.name))) err(c, "options.mismatch");
      if (names.length > MAX_OPTIONS) err(c, "options.too_many", { max: MAX_OPTIONS });
      input.options = names.map(({ name }) => {
        const values: string[] = [];
        for (const v of input.variants) {
          const value = v.options[name];
          if (value && !values.includes(value)) values.push(value);
        }
        return { name, values };
      });
    }
  }

  // Custom fields of the product ------------------------------------------------------------------------------------------
  const pc = fieldChangesFor(c, pdefs, "field", p, c.stored?.fieldData?.product);
  if (pc) fieldChanges.product = pc;

  // Manufacturer for a new physical product with none -----------------------------------------------------------------------
  if (isNew && !input.manufacturer && options.manufacturerId) input.manufacturer = { id: options.manufacturerId };

  if (hasError(c)) return result("skipped", null, { pendingTerms: [], pictures: [] });

  // Nothing changed: nothing is written, whatever the editor would say about the product as it stands.
  const before = stored ? canonical(clone(stored), stored.archived, ctx) : null;
  const intended = canonical(input, wantsArchived, ctx);
  const fields = fieldChanges.product;
  const variantFields = Object.keys(fieldChanges.variants).length > 0 ? fieldChanges.variants : undefined;
  if (before !== null && JSON.stringify(before) === JSON.stringify(intended) && !fields && !variantFields && c.pending.size === 0) {
    return result("unchanged", null, { pendingTerms: [], pictures: [] });
  }

  // The editor's own checks. What cannot be saved at all is an error; what only stops publishing is a draft. ----------------------
  const shape = productInput.safeParse(input);
  if (!shape.success) {
    err(c, "save.failed", { reason: safeReason(shape.error.issues[0]?.message ?? "The product is not valid.") });
    return skipped();
  }
  let drafted = false;
  const hardProblems = productProblems({ ...input, status: "draft" }, env.publish);
  if (hardProblems.length > 0) {
    err(c, "save.failed", { reason: safeReason(hardProblems[0]) });
    return skipped();
  }
  if (input.status === "active") {
    const publishProblems = productProblems(input, env.publish);
    if (publishProblems.length > 0) {
      if (options.unpublishable === "skip") {
        err(c, "product.not_published", { reason: safeReason(publishProblems[0]) });
        return skipped();
      }
      input.status = "draft";
      drafted = true;
      err(c, "product.drafted", { reason: safeReason(publishProblems[0]) }, "warning");
    }
  }
  // A saved product that was archived is made a draft by the editor's save, and archived again after it.
  const outcome: ProductPlan["outcome"] = drafted ? "drafted" : isNew ? "created" : "updated";
  return result(outcome, input, { archiveAfter: wantsArchived, fields, variantFields });
}

/** Puts the ids of terms an apply created into a plan's input (`ids` by `pendingKey()`), in the order they were named. */
export function withCreatedTerms(plan: ProductPlan, ids: ReadonlyMap<string, string>): ProductPlan {
  if (!plan.input || plan.pendingTerms.length === 0) return plan;
  const input = clone(plan.input);
  for (const term of plan.pendingTerms) {
    const id = ids.get(pendingKey(term));
    if (!id) continue;
    const list = term.kind === "category" ? input.categories : input.tags;
    // Only a path the file names in full is attached; the parents made on the way are for the tree, not for the product (unless the file names a parent too).
    if (term.named && !list.includes(id)) list.push(id);
  }
  return { ...plan, input };
}

// ---------------------------------------------------------------------------
// The whole plan (a dry run)
// ---------------------------------------------------------------------------

export type ImportPlan = {
  fileFindings: FileFinding[];
  products: ProductPlan[];
  /** Findings of rows that belong to no product (no handle, a handle that came back). */
  blocked: Finding | null;
  dry: DryRunCounts;
};

export function dryRunCounts(plans: readonly ProductPlan[], fileFindings: readonly FileFinding[]): DryRunCounts {
  return {
    toCreate: plans.filter((p) => p.isNew && (p.outcome === "created" || p.outcome === "drafted")).length,
    toUpdate: plans.filter((p) => !p.isNew && (p.outcome === "updated" || p.outcome === "drafted")).length,
    unchanged: plans.filter((p) => p.outcome === "unchanged").length,
    withProblems: plans.filter((p) => p.findings.some((f) => f.severity === "error")).length + fileFindings.filter((f) => f.finding.severity === "error" && f.rows.length > 0).length,
  };
}

/** Plans a whole read file against the store's snapshot: the dry run, and what an apply would write. */
export function planImport(file: NeutralFile, snapshot: StoreSnapshot, env: PlanEnv): ImportPlan {
  const grouped = groupProducts(file);
  const fileFindings = [...checkFile(file, grouped, env), ...grouped.findings];
  const blocked = blockingFinding(fileFindings);
  const dup = duplicateSkus(grouped.drafts);
  const products = grouped.drafts.map((d) => planProduct(d, file, env, snapshot, { blocked, duplicateSku: dup.get(d.handle) ?? null }));
  return { fileFindings, products, blocked, dry: dryRunCounts(products, fileFindings) };
}

/** The SKUs and variant ids a file names, for the server to ask the database who owns. */
export function namedKeys(grouped: Grouped): { handles: string[]; skus: string[]; variantIds: string[] } {
  const handles = grouped.drafts.map((d) => d.handle);
  const skus = [...new Set(grouped.drafts.flatMap((d) => d.variants.map((v) => t(v.v.sku))).filter((s) => s !== ""))];
  const variantIds = [...new Set(grouped.drafts.flatMap((d) => d.variants.map((v) => t(v.v.variant_id))).filter((s) => s !== ""))];
  return { handles, skus, variantIds };
}

/** An item of the job for a plan (a dry run's items say `checked` and keep the prediction in `changes.will`). */
export function itemOf(plan: ProductPlan, dry: boolean): { kind: "product"; ref: string; rows: number[]; outcome: ItemOutcome; messages: Finding[]; changes: Record<string, unknown> } {
  return {
    kind: "product",
    ref: plan.handle,
    rows: plan.rows,
    outcome: dry ? "checked" : plan.outcome,
    messages: plan.findings,
    changes: { ...(dry ? { will: plan.outcome } : {}), prices: plan.changes.prices, fields: plan.changes.fields, stock: plan.changes.stock, pictures: plan.pictures.length, terms: plan.pendingTerms.length },
  };
}

