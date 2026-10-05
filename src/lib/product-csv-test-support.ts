/**
 * A store, a stored product and a blank product for the tests of the product file (D165). Tests only: nothing in the app imports it.
 * The shapes are what `getEditorContext()`, `getProductForEdit()` and `emptyProduct()` give (`src/server/products.ts`).
 */
import type { FieldDef } from "./custom-fields";
import { productProblems, type ProductInput, type PublishContext } from "./product-input";
import type { Term } from "./taxonomy";
import type { ProductCsvContext, StoredProduct } from "./product-csv";
import type { PlanEnv, StoreSnapshot } from "./product-import";
import { DEFAULT_IMPORT_OPTIONS } from "./product-import";

export const OPERATOR = "11111111-1111-4111-8111-111111111111";
export const VARIANT_IDS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];

export const field = (id: string, name: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef =>
  ({ id, name, label: name, type, access: "private", ...extra }) as FieldDef;

export const FIELDS = {
  material: field("f_material", "material", "text"),
  weightKg: field("f_wkg", "weight_kg", "number"),
  organic: field("f_org", "organic", "boolean"),
  season: field("f_season", "season", "select", { choices: [{ key: "summer", label: "Summer" }, { key: "winter", label: "Winter" }] }),
  gallery: field("f_gal", "gallery", "gallery"),
  shade: field("f_shade", "shade", "text"),
};

export const C1 = "cccccccc-0000-4000-8000-000000000001";
export const C2 = "cccccccc-0000-4000-8000-000000000002";
export const C3 = "cccccccc-0000-4000-8000-000000000003";
export const C9 = "cccccccc-0000-4000-8000-000000000009";
export const T1 = "dddddddd-1111-4000-8000-000000000001";
export const T2 = "dddddddd-1111-4000-8000-000000000002";

export const TERMS: Term[] = [
  { id: C1, kind: "category", parentId: null, name: "Shoes", slug: "shoes" },
  { id: C2, kind: "category", parentId: C1, name: "Boots", slug: "boots" },
  { id: C3, kind: "category", parentId: null, name: "Bags", slug: "bags" },
  { id: T1, kind: "tag", parentId: null, name: "Winter", slug: "winter" },
  { id: T2, kind: "tag", parentId: null, name: "Sale", slug: "sale" },
];

export function context(over: Partial<ProductCsvContext> = {}): ProductCsvContext {
  return {
    locales: ["nb-NO", "sv-SE", "en-GB"],
    primaryLocale: "nb-NO",
    markets: [
      { code: "NO", currency: "NOK", name: "Norway", vatRates: { standard: 0.25, food: 0.15 } },
      { code: "SE", currency: "SEK", name: "Sweden", vatRates: { standard: 0.25, food: 0.12 } },
    ],
    mainCurrency: "NOK",
    audience: "consumers",
    terms: TERMS,
    fields: [
      { def: FIELDS.material, entity: "product" },
      { def: FIELDS.weightKg, entity: "product" },
      { def: FIELDS.organic, entity: "product" },
      { def: FIELDS.season, entity: "product" },
      { def: FIELDS.gallery, entity: "product" },
      { def: FIELDS.shade, entity: "variant" },
    ],
    vatCategories: ["standard", "food", "exempt"],
    ...over,
  };
}

export function blank(ctx: ProductCsvContext): ProductInput {
  return {
    handle: "",
    status: "draft",
    translations: ctx.locales.map((locale) => ({ locale, title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" })),
    media: [],
    options: [],
    variants: [
      { id: null, options: {}, sku: "", gtin: null, measure: null, prices: {}, cost: "", stock: 0, active: true, weightGrams: null, hsCode: null, originCountry: null, delivery: "physical", rentalPeriod: "day", image: null },
    ],
    delivery: "physical",
    files: [],
    downloadLimit: 5,
    downloadDays: 30,
    plans: [],
    subscriptionOnly: false,
    audience: "all",
    soldByMeasure: false,
    vatCategory: "standard",
    kind: "goods",
    hostId: null,
    layoutId: null,
    appointment: null,
    taxCode: "txcd_99999999",
    withdrawalExclusion: "none",
    schemes: ["packaging"],
    manufacturer: { id: OPERATOR },
    responsiblePerson: null,
    categories: [],
    tags: [],
  };
}

export const publishContext = (ctx: ProductCsvContext): PublishContext => ({
  markets: ctx.markets,
  mainCurrency: ctx.mainCurrency,
  primaryLocale: ctx.primaryLocale,
  operatorCountries: { [OPERATOR]: "DE" },
  euCountries: new Set(["DE", "SE", "NO"]),
});

/** A product with two options, three variants, three languages, two markets, four pictures, a category and tags. */
export function boot(ctx: ProductCsvContext, over: Partial<StoredProduct> = {}): StoredProduct {
  const base = blank(ctx);
  return {
    ...base,
    id: "pppppppp-0000-4000-8000-000000000001",
    archived: false,
    handle: "winter-boot",
    status: "active",
    translations: [
      { locale: "nb-NO", title: "Vinterstøvel", description: "Varm og solid.\nFor kalde dager.", safetyInformation: "Bruk med sokker.", seoTitle: "Vinterstøvel", seoDescription: "Kjøp vinterstøvel" },
      { locale: "sv-SE", title: "Vinterkänga", description: "Varm.", safetyInformation: "", seoTitle: "", seoDescription: "" },
      { locale: "en-GB", title: "Winter boot", description: "Warm, with a \"lining\", and commas.", safetyInformation: "", seoTitle: "", seoDescription: "" },
    ],
    media: [
      { url: "https://store.example/p/1.webp", thumbnailUrl: "https://store.example/p/1t.webp", alt: "Side view" },
      { url: "https://store.example/p/2.webp", thumbnailUrl: "https://store.example/p/2t.webp", alt: "" },
      { url: "https://store.example/p/3.webp", thumbnailUrl: null, alt: "From above" },
      { url: "/demo/boot.svg", thumbnailUrl: null, alt: "" },
    ],
    options: [
      { name: "Colour", values: ["Black", "Brown"] },
      { name: "Size", values: ["42", "43"] },
    ],
    variants: [
      { ...base.variants[0], id: VARIANT_IDS[0], options: { Colour: "Black", Size: "42" }, sku: "BOOT-BLK-42", gtin: "7041234567890", prices: { NO: "1249,00", SE: "1299,50" }, cost: "600,00", stock: 12, weightGrams: 1400, hsCode: "640391", originCountry: "PT", measure: null, image: { url: "https://store.example/p/1.webp", thumbnailUrl: "https://store.example/p/1t.webp" } },
      { ...base.variants[0], id: VARIANT_IDS[1], options: { Colour: "Black", Size: "43" }, sku: "BOOT-BLK-43", prices: { NO: "1249,00", SE: "1299,50" }, stock: 0, weightGrams: 1450 },
      { ...base.variants[0], id: VARIANT_IDS[2], options: { Colour: "Brown", Size: "42" }, sku: "BOOT-BRN-42", prices: { NO: "1299,00" }, stock: 5, active: false, measure: { amount: "0.75", unit: "kg", base: "kg" } },
    ],
    categories: [C2],
    tags: [T1, T2],
    fieldData: {
      product: { values: { f_wkg: 1.4, f_org: true, f_season: "winter" }, translations: { "nb-NO": { f_material: "Skinn" }, "en-GB": { f_material: "Leather" } } },
      variants: { [VARIANT_IDS[0]]: { values: {}, translations: { "nb-NO": { f_shade: "Mørk" } } } },
    },
    ...over,
  };
}

export function env(ctx: ProductCsvContext, over: Partial<PlanEnv> = {}): PlanEnv {
  return {
    ctx,
    options: { ...DEFAULT_IMPORT_OPTIONS },
    blank: blank(ctx),
    publish: publishContext(ctx),
    isOwnPicture: (url) => url.startsWith("https://store.example/"),
    ...over,
  };
}

/** A snapshot of the store holding the given stored products. */
export function snapshotOf(products: StoredProduct[]): StoreSnapshot {
  const skuOwners = new Map<string, { handle: string; variantId: string }>();
  const variantOwners = new Map<string, string>();
  for (const p of products) {
    for (const v of p.variants) {
      skuOwners.set(v.sku.toLowerCase(), { handle: p.handle, variantId: v.id ?? "" });
      if (v.id) variantOwners.set(v.id, p.handle);
    }
  }
  return { products: new Map(products.map((p) => [p.handle, p])), skuOwners, variantOwners };
}

export const noProblems = (ctx: ProductCsvContext, input: ProductInput) => productProblems(input, publishContext(ctx));
