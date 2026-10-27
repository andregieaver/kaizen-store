import { z } from "zod";

import { formatMoney } from "./money";
import { MAX_ORDER_QUANTITY } from "./quantity-rules";
import { BRIEF_MAX, BRIEF_MIN, PICTURE_SHAPES } from "./picture-direction";
import {
  BUNDLE_COMPONENTS_MAX,
  BUNDLE_PERCENT_MAX,
  BUNDLE_PRICINGS,
  BUNDLE_QUANTITY_MAX,
  MAX_MEDIA,
  MAX_OPTIONS,
  MAX_VARIANTS,
  combineOptions,
  parsePrice,
  variantLabel,
  type BundleInput,
  type ProductInput,
  type VariantInput,
} from "./product-input";
import type { ProductFacts, WriteKind } from "./product-writing";
import { DESCRIPTION_MAX, EXCERPT_FIELD_MAX, TITLE_MAX } from "./seo";
import type { StandardAttributes } from "./product-taxonomy";
import { slugify } from "./slug";
import { TERM_NAME_MAX } from "./taxonomy";
import { UNITS } from "./unit-price";
import { VAT_CATEGORY_CODE } from "./vat";

/**
 * The AI manager's catalogue tools (D308, unit A1, `docs/ai-autopilot.md` 3): their arguments, and how they become the product editor's own
 * data (`ProductInput`), so a product the assistant makes or changes is saved by `saveProduct()` with the editor's checks, prices and stock
 * history, never written another way. Pure: the server resolves what needs the database (the address that is free, categories and tags by
 * name, pictures from the library) and passes it in.
 *
 * Tools that only change a draft run at once; a change to a product shoppers can see waits for the owner's yes (`GATED_WHEN_LIVE`).
 */

/** Tools gated only while the product is live (status `active`): a draft or an archived product is changed at once. */
export const GATED_WHEN_LIVE: ReadonlySet<string> = new Set(["update_product", "set_prices"]);

/** Pictures the picture model may make in one call: each takes a while and costs the store's AI. */
export const MADE_PICTURES_MAX = 3;
/** Other languages one `write_product_texts` call writes in. */
export const TEXT_LANGUAGES_MAX = 6;

const productRef = z.string().trim().min(1).max(200).describe("The product's id, its handle, or its title as listed.");
const country = z.string().trim().min(2).max(60);
const priceText = z.string().trim().max(20);
const pricesDescription =
  "Price per country, keyed by the country's code from store_overview (such as NO or SE), as text in that country's own currency: \"249\" or \"249,50\". With VAT, as shoppers pay; a store that sells only to businesses gives prices without VAT, as its product editor does. A country left out is not priced, and the product is not sold there until it is.";
const prices = z.record(country, priceText.min(1)).describe(pricesDescription);
const language = z.string().trim().min(2).max(10).describe("A language of the store, by its code from store_overview (such as nb-NO or sv), as its main language unless given.");
const termName = z.string().trim().min(1).max(TERM_NAME_MAX);

const optionArgs = z.object({
  name: z.string().trim().min(1).max(40).describe("Such as Size or Colour."),
  values: z.array(z.string().trim().min(1).max(60)).min(1).max(50).describe("Such as S, M, L."),
});

const measureArgs = z
  .object({
    amount: z.string().trim().min(1).max(20).describe("What one pack holds, as text: \"0,75\" or \"250\"."),
    unit: z.enum(UNITS),
  })
  .describe("What one holds, for the price per kg, litre or metre shoppers are shown (needed in some categories, such as food).");

/** A picture from the store's media library by its address, or one the store's picture model makes from a description. */
const pictureArgs = z.union([
  z.object({
    url: z.string().trim().min(1).max(1000).describe("The address of a picture in the store's media library."),
    alt: z.string().trim().max(300).optional().describe("What the picture shows, for people who cannot see it; the product's title when left out."),
  }),
  z.object({
    make: z.string().trim().min(BRIEF_MIN).max(BRIEF_MAX).describe("What the picture should show; the store's picture model makes it in the site's look and keeps it in the media library."),
    shape: z.enum(PICTURE_SHAPES).default("square"),
  }),
]);
export type PictureArgs = z.output<typeof pictureArgs>;

/** A company named on a product: one of the store's (by name) or a new one with its details (EU product-safety rules). */
const operatorArgs = z.union([
  z.string().trim().min(1).max(200).describe("One of the store's companies, by name."),
  z.object({
    name: z.string().trim().min(1).max(200),
    postal_address: z.string().trim().min(5).max(300),
    contact: z.string().trim().min(3).max(200).describe("An email or web address of the company."),
    country: z.string().trim().regex(/^[A-Za-z]{2}$/).describe("Its country, as a two-letter code."),
  }),
]);
type OperatorArgs = z.output<typeof operatorArgs>;

const translationArgs = z.object({
  language,
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(10_000).optional(),
  seo_title: z.string().trim().max(TITLE_MAX).optional(),
  seo_description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  excerpt: z.string().trim().max(EXCERPT_FIELD_MAX).optional(),
});
type TranslationArgs = z.output<typeof translationArgs>;

const handleArgs = z
  .string()
  .trim()
  .max(80)
  .describe("The product's web address after /p/, in lowercase letters, digits and hyphens; made from the title when left out.");

/** The words of the main language, written beside the product's other fields. */
const mainTexts = {
  description: z.string().trim().max(10_000).describe("Plain text in the main language; paragraphs separated by a blank line."),
  seo_title: z.string().trim().max(TITLE_MAX).describe("The title search results show; the product's title when empty."),
  seo_description: z.string().trim().max(DESCRIPTION_MAX).describe("The description search results show; the start of the description when empty."),
  excerpt: z.string().trim().max(EXCERPT_FIELD_MAX).describe("A short text for lists and product grids; the start of the description when empty."),
};

/** How many at a time (D323): a line's minimum, maximum and step for goods and bundles; the database refuses a minimum or maximum that is not whole steps. */
const ruleArgs = {
  min_quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY).optional().describe("The fewest one order line may hold; a whole number of quantity_step."),
  max_quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY).nullable().optional().describe("The most one order line may hold (null: no limit of its own); a whole number of quantity_step."),
  quantity_step: z.number().int().min(1).max(MAX_ORDER_QUANTITY).optional().describe("Sold in multiples of this, such as 6 for a box of six; 1 sells any number."),
};

const variantArgs = z.object({
  options: z.record(z.string(), z.string()).default({}).describe("The variant's value for each option, such as {\"Size\": \"M\"}; leave out for a product without options."),
  sku: z.string().trim().min(1).max(64).optional().describe("Its stock-keeping code, unique in the store; made from the address and the options when left out."),
  prices: prices.optional().describe("Its own prices; the product's `prices` when left out."),
  stock: z.number().int().min(0).max(1_000_000).optional().describe("Units in stock to start with; the product's `stock` when left out."),
  weight_grams: z.number().int().positive().max(1_000_000).optional(),
  cost: z.string().trim().max(20).optional().describe("What one costs the store, without VAT, in its main currency, such as \"120\"; for profit figures."),
  gtin: z.string().trim().regex(/^[0-9]{8,14}$/, "A barcode (GTIN/EAN) is 8 to 14 digits.").optional(),
  content: measureArgs.optional(),
  ...ruleArgs,
});

/** The product's category in the standard taxonomy (D327) and its attributes' values, by name: the server resolves them against the release. */
const standardArgs = {
  standard_category: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .nullable()
    .optional()
    .describe(
      "What the product is in the standard product taxonomy that Google and marketplaces read (apart from the store's own categories): a category's id (such as aa-1-1) or its full English path (such as Apparel & Accessories > Clothing > Activewear). Anything else is answered with the closest categories to choose from. null takes it away.",
    ),
  standard_attributes: z
    .record(z.string().trim().min(1).max(100), z.array(z.string().trim().min(1).max(100)).max(25))
    .optional()
    .describe(
      "Values of the category's attributes by name in English, such as {\"Color\": [\"Black\"], \"Pattern\": [\"Striped\"]} (they replace the ones there; an empty list takes an attribute away). Only the category's own attributes and their values; get_product names them.",
    ),
};

/** A bundle's components by SKU and its pricing (D322): the AI manager makes or changes one as the editor does. */
const bundleArgs = z
  .object({
    components: z
      .array(z.object({ sku: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(BUNDLE_QUANTITY_MAX).default(1) }))
      .min(1)
      .max(BUNDLE_COMPONENTS_MAX)
      .describe("The goods in it, by SKU (from get_product or list_products), with how many of each go in one bundle; at least two units in all."),
    pricing: z.enum(BUNDLE_PRICINGS).default("computed").describe("computed: its components' prices less percent_off, kept up to date; fixed: its own prices."),
    percent_off: z.number().int().min(0).max(BUNDLE_PERCENT_MAX).default(0).describe("For a computed price: whole percent off the components' sum."),
  })
  .describe("Makes it a bundle of other goods of the store, sold together as one product: its stock is what its components allow, so it has no stock of its own.");

export const createProductInput = z.object({
  title: z.string().trim().min(1).max(200).describe("The product's name in the store's main language."),
  description: mainTexts.description.default(""),
  seo_title: mainTexts.seo_title.default(""),
  seo_description: mainTexts.seo_description.default(""),
  excerpt: mainTexts.excerpt.default(""),
  translations: z.array(translationArgs).max(10).default([]).describe("Its words in the store's other languages, one entry per language."),
  handle: handleArgs.optional(),
  prices: prices.optional().describe(`${pricesDescription} Used for every variant that gives none of its own.`),
  stock: z.number().int().min(0).max(1_000_000).default(0).describe("Units in stock of each variant to start with."),
  weight_grams: z.number().int().positive().max(1_000_000).optional().describe("Each unit's weight with its packaging, for shipping by weight."),
  options: z.array(optionArgs).max(MAX_OPTIONS).default([]).describe(`Up to ${MAX_OPTIONS} options shoppers choose between, such as Size and Colour.`),
  variants: z
    .array(variantArgs)
    .min(1)
    .max(MAX_VARIANTS)
    .optional()
    .describe("Leave out for one variant without options, or for every combination of the options. Give them to set a variant's own SKU, price, stock or weight."),
  categories: z.array(termName).max(20).default([]).describe("Product categories by name or address; one the store does not have is made."),
  tags: z.array(termName).max(20).default([]).describe("Product tags by name or address; one the store does not have is made."),
  pictures: z.array(pictureArgs).max(MAX_MEDIA).default([]).describe(`Up to ${MAX_MEDIA} pictures in order, the first the main one. At most ${MADE_PICTURES_MAX} made by the picture model in one call.`),
  vat_category: z.string().trim().regex(VAT_CATEGORY_CODE).optional().describe("Its VAT category, such as standard or food; standard when left out."),
  manufacturer: operatorArgs.optional().describe("Who makes it, required on goods for sale in the EU; the store's first company when left out."),
  responsible_person: operatorArgs.optional().describe("A person or company in the EU responsible for its safety, required when the manufacturer is outside the EU."),
  bundle: bundleArgs.optional(),
  ...standardArgs,
});
export type CreateProductInput = z.output<typeof createProductInput>;

const variantChangeArgs = z.object({
  sku: z.string().trim().min(1).max(64).describe("The variant, by its SKU; a SKU the product does not have adds a variant."),
  options: z.record(z.string(), z.string()).optional(),
  prices: z.record(country, priceText).optional().describe(`${pricesDescription} Only the countries given change; "" takes a country's price away.`),
  stock: z.number().int().min(0).max(1_000_000).optional().describe("Only for a new variant; an existing variant's stock is changed with set_stock."),
  weight_grams: z.number().int().positive().max(1_000_000).nullable().optional(),
  cost: z.string().trim().max(20).optional(),
  gtin: z.string().trim().regex(/^[0-9]{8,14}$/, "A barcode (GTIN/EAN) is 8 to 14 digits.").nullable().optional(),
  content: measureArgs.nullable().optional(),
  active: z.boolean().optional().describe("False switches the variant off (it is never deleted)."),
  ...ruleArgs,
});

export const updateProductInput = z.object({
  product: productRef,
  title: z.string().trim().min(1).max(200).optional().describe("The title in the main language."),
  description: mainTexts.description.optional(),
  seo_title: mainTexts.seo_title.optional(),
  seo_description: mainTexts.seo_description.optional(),
  excerpt: mainTexts.excerpt.optional(),
  translations: z.array(translationArgs).max(10).optional().describe("Words in other languages; only the fields given change."),
  handle: handleArgs.optional().describe("A new web address; the old one is redirected to it."),
  options: z.array(optionArgs).max(MAX_OPTIONS).optional().describe("The options as they should be (they replace the ones there); every variant must then have a value for each."),
  variants: z.array(variantChangeArgs).max(MAX_VARIANTS).optional(),
  categories: z.array(termName).max(20).optional().describe("The product's categories as they should be (they replace the ones there); new ones are made."),
  tags: z.array(termName).max(20).optional().describe("The product's tags as they should be (they replace the ones there); new ones are made."),
  pictures: z.array(pictureArgs).max(MAX_MEDIA).optional().describe("The pictures as they should be, in order (they replace the pictures there; the product's videos and 3D models stay, after them)."),
  add_pictures: z.array(pictureArgs).max(MAX_MEDIA).optional().describe("Pictures added after the ones there."),
  vat_category: z.string().trim().regex(VAT_CATEGORY_CODE).optional(),
  manufacturer: operatorArgs.optional(),
  responsible_person: operatorArgs.optional(),
  bundle: bundleArgs.optional().describe("A bundle's components and pricing as they should be (they replace the ones there); only for a bundle."),
  ...standardArgs,
});
export type UpdateProductInput = z.output<typeof updateProductInput>;

export const setPricesInput = z.object({
  product: productRef,
  changes: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64).optional().describe("One variant by its SKU; every variant that is on when left out."),
        prices: z.record(country, priceText).describe(`${pricesDescription} Only the countries given change; "" takes a country's price away.`),
      }),
    )
    .min(1)
    .max(MAX_VARIANTS),
});
export type SetPricesInput = z.output<typeof setPricesInput>;

export const setProductStatusInput = z.object({
  product: productRef,
  status: z.enum(["active", "draft"]).describe("active: on the site, for sale. draft: off the site, kept to work on."),
});
export type SetProductStatusInput = z.output<typeof setProductStatusInput>;

export const WRITE_TEXTS = ["description", "search", "languages"] as const;
export type WriteText = (typeof WRITE_TEXTS)[number];

export const writeProductTextsInput = z.object({
  product: productRef,
  texts: z
    .array(z.enum(WRITE_TEXTS))
    .min(1)
    .max(WRITE_TEXTS.length)
    .default([...WRITE_TEXTS])
    .describe("What to write: description (in the main language, from the title, options, categories and tags), search (the title and description search results show) and languages (the title, description and search texts in the store's other languages, translated from the main language)."),
  rewrite: z.boolean().default(false).describe("Write again texts that are already there (an existing description is rewritten keeping its facts); otherwise only empty ones are written."),
  languages: z.array(language).max(TEXT_LANGUAGES_MAX).optional().describe("Which of the store's other languages to write in; all of them when left out."),
});
export type WriteProductTextsInput = z.output<typeof writeProductTextsInput>;

/** What the server knows of the store that the conversion needs. */
export type ToolStore = {
  /** The store's languages, the main one first. */
  locales: readonly string[];
  primaryLocale: string;
  markets: readonly { code: string; currency: string; name: string }[];
  operators: readonly { id: string; name: string; country: string }[];
};

/** What the server resolved from the arguments: the free address, terms by id, pictures as the editor keeps them. */
export type Resolved = {
  handle?: string;
  /** A bundle's components (D322), its SKUs found among the store's variants by the server. */
  components?: { variantId: string; quantity: number }[];
  categories?: string[];
  tags?: string[];
  media?: ProductInput["media"];
  addMedia?: ProductInput["media"];
  /** The standard category and attributes (D327) as ids, resolved by the server from `standard_category` and `standard_attributes`. */
  standard?: { category: string | null; attributes: StandardAttributes };
};

export type Converted = { ok: true; input: ProductInput; changed: string[] } | { ok: false; problems: string[] };

/** A language of the store by its code or the language alone (`nb` for `nb-NO`), or null. */
export function findLocale(given: string, locales: readonly string[]): string | null {
  const wanted = given.trim().toLowerCase().replace("_", "-");
  const exact = locales.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const lang = wanted.split("-")[0];
  const same = locales.filter((l) => l.toLowerCase().split("-")[0] === lang);
  return same.length === 1 ? same[0] : null;
}

/** A country of the store by its code or its name, or null. */
export function findMarket<M extends { code: string; name: string }>(given: string, markets: readonly M[]): M | null {
  const wanted = given.trim().toLowerCase();
  return markets.find((m) => m.code.toLowerCase() === wanted || m.name.toLowerCase() === wanted) ?? null;
}

const countriesList = (markets: ToolStore["markets"]) => markets.map((m) => `${m.name} (${m.code}, ${m.currency})`).join(", ");

/** Prices keyed by the store's own market codes; a country the store does not sell to is a problem. "" stays "" (a price taken away). */
export function pricesByMarket(given: Record<string, string> | undefined, markets: ToolStore["markets"], problems: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, price] of Object.entries(given ?? {})) {
    const market = findMarket(key, markets);
    if (!market) {
      problems.push(`The store does not sell to "${key}". Its countries: ${countriesList(markets)}.`);
      continue;
    }
    out[market.code] = price;
  }
  return out;
}

/** A variant's code from the product's address and its option values: `LINEN-SHIRT-M-BLUE`, at most 64 characters. */
export function skuFor(handle: string, options: Record<string, string>): string {
  const parts = [handle, ...Object.values(options).map((v) => slugify(v, 20))].filter(Boolean);
  return parts.join("-").toUpperCase().slice(0, 64).replace(/-+$/, "");
}

/**
 * A variant's option values under the product's own option names and values, matched without regard to case ("size": "m" is Size: M), so the
 * editor's check (`saveProduct()`: every variant has a value for each option, and only listed values) answers only for real mistakes.
 */
export function matchOptions(given: Record<string, string>, options: ProductInput["options"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(given)) {
    const option = options.find((o) => o.name.toLowerCase() === key.trim().toLowerCase());
    if (!option) {
      out[key] = value;
      continue;
    }
    out[option.name] = option.values.find((v) => v.toLowerCase() === value.trim().toLowerCase()) ?? value;
  }
  return out;
}

/** A company as the editor takes it: one of the store's by name, or a new one; a name the store does not have is a problem. */
export function operatorChoice(given: OperatorArgs, operators: ToolStore["operators"], problems: string[], what: string): ProductInput["manufacturer"] {
  if (typeof given === "string") {
    const found = operators.filter((o) => o.name.toLowerCase() === given.toLowerCase());
    if (found.length === 1) return { id: found[0].id };
    problems.push(
      found.length > 1
        ? `Several of the store's companies are called "${given}"; give the ${what}'s details instead.`
        : `The store has no company called "${given}"${operators.length ? ` (it has ${operators.map((o) => o.name).join(", ")})` : ""}. Give the ${what}'s name, postal address, contact and country to add it.`,
    );
    return null;
  }
  return { new: { name: given.name, postalAddress: given.postal_address, electronicAddress: given.contact, country: given.country.toUpperCase() } };
}

const measureOf = (content: z.output<typeof measureArgs> | null | undefined): VariantInput["measure"] =>
  content ? { amount: content.amount, unit: content.unit, base: null } : null;

/** A new variant in the editor's shape, from the base product's first (so every field the editor holds is there). */
function newVariant(template: VariantInput, fields: Partial<VariantInput>): VariantInput {
  return {
    ...template,
    id: null,
    options: {},
    sku: "",
    gtin: null,
    prices: {},
    cost: "",
    stock: 0,
    stockPolicy: "deny",
    backorderDays: null,
    lowStockThreshold: null,
    minQuantity: 1,
    maxQuantity: null,
    quantityStep: 1,
    active: true,
    weightGrams: null,
    hsCode: null,
    originCountry: null,
    delivery: "physical",
    measure: null,
    rentalPeriod: "day",
    image: null,
    ...fields,
  };
}

/** The translations with one language's given fields laid over it; a language the product has no entry for gets one. */
function withTexts(translations: ProductInput["translations"], locale: string, texts: Omit<TranslationArgs, "language">): ProductInput["translations"] {
  const blank = { locale, title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "", excerpt: "" };
  const current = translations.find((t) => t.locale === locale) ?? blank;
  const next = {
    ...current,
    ...(texts.title !== undefined && { title: texts.title }),
    ...(texts.description !== undefined && { description: texts.description }),
    ...(texts.seo_title !== undefined && { seoTitle: texts.seo_title }),
    ...(texts.seo_description !== undefined && { seoDescription: texts.seo_description }),
    ...(texts.excerpt !== undefined && { excerpt: texts.excerpt }),
  };
  return translations.some((t) => t.locale === locale) ? translations.map((t) => (t.locale === locale ? next : t)) : [...translations, next];
}

/** Other languages' words laid over the translations; a language the store does not have is a problem. */
function withTranslations(translations: ProductInput["translations"], given: readonly TranslationArgs[], store: ToolStore, problems: string[]): ProductInput["translations"] {
  let out = translations;
  for (const entry of given) {
    const locale = findLocale(entry.language, store.locales);
    if (!locale) {
      problems.push(`The store does not have the language "${entry.language}". Its languages: ${store.locales.join(", ")}.`);
      continue;
    }
    const { language: _language, ...texts } = entry;
    void _language;
    out = withTexts(out, locale, texts);
  }
  return out;
}

/**
 * A new product (`create_product`) in the editor's shape, laid over `base` (the editor's own blank product, `emptyProduct()`), always a draft
 * of physical goods. Its variants: the ones given, else every combination of its options, else one; each takes the product's prices, stock and
 * weight unless it gives its own, and a SKU made from the address when it has none.
 */
export function toProductInput(args: CreateProductInput, base: ProductInput, store: ToolStore, resolved: Resolved): Converted {
  const problems: string[] = [];
  const handle = resolved.handle ?? (slugify(args.title) || "product");
  const options = args.options.map((o) => ({ name: o.name, values: [...new Set(o.values)] }));
  const shared = pricesByMarket(args.prices, store.markets, problems);
  const template = base.variants[0];
  const given: Partial<z.output<typeof variantArgs>>[] =
    args.variants ?? (options.length > 0 ? combineOptions(options).map((combo) => ({ options: combo })) : [{ options: {} }]);
  const variants = given.map((fields) => {
    const own = fields.prices ? pricesByMarket(fields.prices, store.markets, problems) : shared;
    const values = matchOptions(fields.options ?? {}, options);
    return newVariant(template, {
      options: values,
      sku: fields.sku ?? skuFor(handle, values),
      prices: own,
      stock: fields.stock ?? args.stock,
      weightGrams: fields.weight_grams ?? args.weight_grams ?? null,
      cost: fields.cost ?? "",
      gtin: fields.gtin ?? null,
      measure: measureOf(fields.content),
      minQuantity: fields.min_quantity ?? 1,
      maxQuantity: fields.max_quantity ?? null,
      quantityStep: fields.quantity_step ?? 1,
    });
  });
  let translations = withTexts(
    base.translations.length > 0 ? base.translations : [],
    store.primaryLocale,
    { title: args.title, description: args.description, seo_title: args.seo_title, seo_description: args.seo_description, excerpt: args.excerpt },
  );
  translations = withTranslations(translations, args.translations, store, problems);
  const manufacturer = args.manufacturer === undefined ? base.manufacturer : operatorChoice(args.manufacturer, store.operators, problems, "manufacturer");
  const responsiblePerson =
    args.responsible_person === undefined ? base.responsiblePerson : operatorChoice(args.responsible_person, store.operators, problems, "responsible person");
  // A bundle (D322): one variant without options or stock, its components found by the server.
  const bundle = args.bundle ? bundleOf(args.bundle, resolved) : null;
  if (bundle && (options.length > 0 || variants.length > 1)) problems.push("A bundle has one variant: leave out the options and variants.");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    changed: [],
    input: {
      ...base,
      handle,
      status: "draft",
      kind: bundle ? "bundle" : "goods",
      delivery: "physical",
      translations,
      media: resolved.media ?? [],
      options,
      variants: bundle ? variants.slice(0, 1).map((v) => ({ ...v, stock: 0, stockPolicy: "deny" as const, backorderDays: null, measure: null })) : variants,
      bundle,
      categories: resolved.categories ?? [],
      tags: resolved.tags ?? [],
      vatCategory: args.vat_category ?? base.vatCategory,
      manufacturer,
      responsiblePerson,
      ...(resolved.standard && { standardCategory: resolved.standard.category, standardAttributes: resolved.standard.attributes }),
    },
  };
}

/** A bundle's components and pricing from the tool's arguments (D322), with the variant ids the server found for its SKUs. */
function bundleOf(args: z.output<typeof bundleArgs>, resolved: Resolved): BundleInput {
  return { pricing: args.pricing, percentOff: args.pricing === "computed" ? args.percent_off : 0, components: resolved.components ?? [] };
}

/** The change's fields, in words for the answer and the approval ("the title", "the prices of LINEN-M"). */
const FIELD_WORDS: Record<string, string> = {
  title: "the title",
  description: "the description",
  seo_title: "the search title",
  seo_description: "the search description",
  excerpt: "the short text",
  translations: "the words in other languages",
  handle: "the web address",
  options: "the options",
  categories: "the categories",
  tags: "the tags",
  pictures: "the pictures",
  add_pictures: "more pictures",
  vat_category: "the VAT category",
  manufacturer: "the manufacturer",
  responsible_person: "the responsible person",
  bundle: "what is in the bundle and its pricing",
  standard: "the standard category and its attributes",
};

/**
 * A change to a stored product (`update_product`, and `set_prices` through its `variants`): the fields given laid over the product as the
 * editor reads it, saved whole. Variants are found by SKU (a new SKU adds one, never deleting any); an existing variant's stock is never
 * written from here (set_stock keeps its history). `changed` names what the call changes, in words.
 */
export function mergeProduct(stored: ProductInput, change: UpdateProductInput, store: ToolStore, resolved: Resolved): Converted {
  const problems: string[] = [];
  const changed: string[] = [];
  const mark = (key: string) => changed.push(FIELD_WORDS[key] ?? key);
  let translations = stored.translations;
  const main = { title: change.title, description: change.description, seo_title: change.seo_title, seo_description: change.seo_description, excerpt: change.excerpt };
  for (const [key, value] of Object.entries(main)) if (value !== undefined) mark(key);
  translations = withTexts(translations, store.primaryLocale, main);
  if (change.translations) {
    mark("translations");
    translations = withTranslations(translations, change.translations, store, problems);
  }
  const options = change.options ? change.options.map((o) => ({ name: o.name, values: [...new Set(o.values)] })) : stored.options;
  if (change.options) mark("options");
  const handle = change.handle !== undefined ? (resolved.handle ?? change.handle) : stored.handle;
  if (change.handle !== undefined) mark("handle");

  const variants = stored.variants.map((v) => ({ ...v, options: change.options ? matchOptions(v.options, options) : v.options }));
  for (const given of change.variants ?? []) {
    const at = variants.findIndex((v) => v.sku.toLowerCase() === given.sku.toLowerCase());
    const pricesGiven = given.prices ? pricesByMarket(given.prices, store.markets, problems) : null;
    if (at === -1) {
      const values = matchOptions(given.options ?? {}, options);
      variants.push(
        newVariant(stored.variants[0], {
          options: values,
          sku: given.sku,
          prices: Object.fromEntries(Object.entries(pricesGiven ?? {}).filter(([, p]) => p !== "")),
          stock: given.stock ?? 0,
          weightGrams: given.weight_grams ?? null,
          cost: given.cost ?? "",
          gtin: given.gtin ?? null,
          measure: measureOf(given.content),
          active: given.active ?? true,
          minQuantity: given.min_quantity ?? 1,
          maxQuantity: given.max_quantity ?? null,
          quantityStep: given.quantity_step ?? 1,
        }),
      );
      changed.push(`a new variant ${given.sku}`);
      continue;
    }
    const current = variants[at];
    if (given.stock !== undefined && given.stock !== current.stock) {
      problems.push(`${current.sku} is in stock already: change its stock with set_stock, which keeps the stock's history.`);
    }
    const nextPrices = { ...current.prices };
    for (const [code, price] of Object.entries(pricesGiven ?? {})) {
      if (price === "") delete nextPrices[code];
      else nextPrices[code] = price;
    }
    variants[at] = {
      ...current,
      ...(given.options && { options: matchOptions(given.options, options) }),
      prices: nextPrices,
      ...(given.weight_grams !== undefined && { weightGrams: given.weight_grams }),
      ...(given.cost !== undefined && { cost: given.cost }),
      ...(given.gtin !== undefined && { gtin: given.gtin }),
      ...(given.content !== undefined && { measure: measureOf(given.content) }),
      ...(given.active !== undefined && { active: given.active }),
      ...(given.min_quantity !== undefined && { minQuantity: given.min_quantity }),
      ...(given.max_quantity !== undefined && { maxQuantity: given.max_quantity }),
      ...(given.quantity_step !== undefined && { quantityStep: given.quantity_step }),
    };
    const what = [
      given.options && "options",
      pricesGiven && Object.keys(pricesGiven).length > 0 && "prices",
      given.weight_grams !== undefined && "weight",
      given.cost !== undefined && "cost",
      given.gtin !== undefined && "barcode",
      given.content !== undefined && "content",
      given.active === false && "switched off",
      given.active === true && "switched on",
      (given.min_quantity !== undefined || given.max_quantity !== undefined || given.quantity_step !== undefined) && "how many at a time",
    ].filter(Boolean);
    if (what.length > 0) changed.push(`${current.sku}: ${what.join(", ")}`);
  }

  let media = stored.media;
  if (resolved.media) {
    // The pictures are replaced; the product's videos and 3D models (D325) stay, after them, as the owner placed them.
    media = [...resolved.media, ...stored.media.filter((m) => m.kind !== "image")];
    mark("pictures");
  }
  if (resolved.addMedia && resolved.addMedia.length > 0) {
    media = [...media, ...resolved.addMedia.filter((m) => !media.some((had) => had.url === m.url))];
    mark("add_pictures");
  }
  if (resolved.categories) mark("categories");
  if (resolved.tags) mark("tags");
  if (change.vat_category !== undefined) mark("vat_category");
  const manufacturer = change.manufacturer === undefined ? stored.manufacturer : operatorChoice(change.manufacturer, store.operators, problems, "manufacturer");
  if (change.manufacturer !== undefined) mark("manufacturer");
  const responsiblePerson =
    change.responsible_person === undefined ? stored.responsiblePerson : operatorChoice(change.responsible_person, store.operators, problems, "responsible person");
  if (change.responsible_person !== undefined) mark("responsible_person");
  // A bundle's components and pricing (D322): only a bundle has them, and a product never becomes one.
  let bundle = stored.bundle;
  if (change.bundle) {
    if (stored.kind !== "bundle") problems.push("Only a bundle has components: make a new product with `bundle` instead.");
    else {
      bundle = bundleOf(change.bundle, resolved);
      mark("bundle");
    }
  }
  if (resolved.standard) mark("standard");

  if (problems.length > 0) return { ok: false, problems };
  if (changed.length === 0) return { ok: false, problems: ["Nothing to change: give the fields that should change."] };
  return {
    ok: true,
    changed,
    input: {
      ...stored,
      handle,
      translations,
      options,
      variants,
      media,
      categories: resolved.categories ?? stored.categories,
      tags: resolved.tags ?? stored.tags,
      vatCategory: change.vat_category ?? stored.vatCategory,
      manufacturer,
      responsiblePerson,
      bundle,
      ...(resolved.standard && { standardCategory: resolved.standard.category, standardAttributes: resolved.standard.attributes }),
    },
  };
}

/**
 * `set_prices` as a change of variants: each change's prices for the variant it names, or for every variant that is on. A SKU the product does
 * not have is a problem here (prices never add a variant).
 */
export function pricesAsChange(product: string, input: SetPricesInput, stored: ProductInput): { ok: true; change: UpdateProductInput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const bySku = new Map<string, Record<string, string>>();
  for (const change of input.changes) {
    const targets = change.sku ? stored.variants.filter((v) => v.sku.toLowerCase() === change.sku!.toLowerCase()) : stored.variants.filter((v) => v.active);
    if (targets.length === 0) {
      problems.push(change.sku ? `The product has no variant ${change.sku}. Its SKUs: ${stored.variants.map((v) => v.sku).join(", ")}.` : "The product has no variant that is on.");
      continue;
    }
    for (const target of targets) bySku.set(target.sku, { ...(bySku.get(target.sku) ?? {}), ...change.prices });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, change: { product, variants: [...bySku].map(([sku, prices]) => ({ sku, prices })) } };
}

/** The store's countries no active variant of the product has a price in: it is not sold there. */
export function notPricedIn(input: ProductInput, markets: ToolStore["markets"]): string[] {
  const active = input.variants.filter((v) => v.active);
  return markets.filter((m) => !active.some((v) => (v.prices[m.code] ?? "").trim() !== "")).map((m) => `${m.name} (${m.code}, ${m.currency})`);
}

/** The product's words the D76 writer is given (`ProductFacts`): its own title, description, options and the names of its terms. */
export function factsOf(input: ProductInput, locale: string, termNames: { categories: string[]; tags: string[] }): ProductFacts {
  const words = input.translations.find((t) => t.locale === locale);
  return {
    kind: input.kind,
    title: words?.title ?? "",
    description: words?.description ?? "",
    seoTitle: words?.seoTitle ?? "",
    seoDescription: words?.seoDescription ?? "",
    categories: termNames.categories.slice(0, 30),
    tags: termNames.tags.slice(0, 30),
    options: input.options.slice(0, 10).map((o) => ({ name: o.name, values: o.values.slice(0, 50) })),
  };
}

/** One request to the D76 writer: what to write and in which of the store's languages. */
export type TextJob = { kind: WriteKind; locale: string };

/**
 * What `write_product_texts` asks the writer for, in order: the main language's description (written from the title when empty, rewritten
 * keeping its facts with `rewrite`), its search texts, then each other language translated from the main language. A text already there is
 * kept unless `rewrite`. Every language must be the store's.
 */
export function textJobs(input: ProductInput, args: WriteProductTextsInput, store: ToolStore): { ok: true; jobs: TextJob[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const main = input.translations.find((t) => t.locale === store.primaryLocale);
  if (!main?.title) return { ok: false, problems: ["Give the product a title in the main language first."] };
  const jobs: TextJob[] = [];
  const asked = new Set(args.texts);
  if (asked.has("description")) {
    if (!main.description) jobs.push({ kind: "write", locale: store.primaryLocale });
    else if (args.rewrite) jobs.push({ kind: "improve", locale: store.primaryLocale });
  }
  if (asked.has("search") && (args.rewrite || !main.seoTitle || !main.seoDescription)) jobs.push({ kind: "seo", locale: store.primaryLocale });
  if (asked.has("languages")) {
    const others = store.locales.filter((l) => l !== store.primaryLocale);
    const wanted = args.languages
      ? args.languages.flatMap((given) => {
          const locale = findLocale(given, others);
          if (!locale) problems.push(`"${given}" is not one of the store's other languages (${others.join(", ") || "it has none"}).`);
          return locale ? [locale] : [];
        })
      : others;
    for (const locale of [...new Set(wanted)]) {
      const own = input.translations.find((t) => t.locale === locale);
      if (args.rewrite || !own?.title || !own.description) jobs.push({ kind: "translate", locale });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, jobs };
}

/** A language's English name for the writer's prompt: "Norwegian Bokmål", "Swedish". */
export function languageWord(locale: string): string {
  const lang = locale.split("-")[0];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

const cut = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * What a gated product call will do, in words made from its arguments and the product's own title and currencies (never the model's own
 * words about it), shown on the approval the owner says yes or no to.
 */
export function productApprovalSummary(name: string, input: Record<string, unknown>, title: string, markets: ToolStore["markets"]): string {
  const named = `"${cut(title, 100)}"`;
  const priceWords = (prices: unknown) =>
    Object.entries((prices as Record<string, string>) ?? {})
      .map(([key, price]) => {
        const market = findMarket(key, markets);
        return price === "" ? `no price in ${market?.code ?? key}` : `${price} ${market?.currency ?? ""} in ${market?.code ?? key}`.replace("  ", " ");
      })
      .join(", ");
  if (name === "set_product_status") {
    return input.status === "active" ? `Publish ${named} on the site, for sale.` : `Take ${named} off the site, keeping it as a draft.`;
  }
  if (name === "set_prices") {
    const changes = (input.changes as { sku?: string; prices?: unknown }[]) ?? [];
    return `Change the prices of the live product ${named}: ${changes.map((c) => `${c.sku ?? "every variant"} ${priceWords(c.prices)}`).join("; ")}.`;
  }
  if (name === "update_product") {
    const parts: string[] = [];
    if (typeof input.title === "string") parts.push(`the title to "${cut(input.title)}"`);
    for (const key of ["description", "seo_title", "seo_description", "excerpt", "translations", "options", "pictures", "add_pictures", "vat_category", "manufacturer", "responsible_person"]) {
      if (input[key] !== undefined) parts.push(FIELD_WORDS[key]);
    }
    if (typeof input.handle === "string") parts.push(`the web address to /p/${input.handle} (the old one is redirected)`);
    if (input.standard_category === null) parts.push("no standard category");
    else if (typeof input.standard_category === "string") parts.push(`the standard category to ${cut(input.standard_category)}`);
    if (input.standard_attributes !== undefined) {
      const values = Object.entries(input.standard_attributes as Record<string, string[]>).map(([name, given]) => `${name}: ${given.join(", ") || "none"}`);
      parts.push(`the standard attributes to ${cut(values.join("; ")) || "none"}`);
    }
    for (const key of ["categories", "tags"] as const) {
      if (Array.isArray(input[key])) parts.push(`${FIELD_WORDS[key]} to ${(input[key] as string[]).join(", ") || "none"}`);
    }
    for (const v of (input.variants as { sku: string; prices?: unknown; active?: boolean }[] | undefined) ?? []) {
      const bits = [v.prices && Object.keys(v.prices as object).length > 0 ? priceWords(v.prices) : "", v.active === false ? "switched off" : ""].filter(Boolean);
      parts.push(`${v.sku}${bits.length ? `: ${bits.join(", ")}` : ""}`);
    }
    return `Change the live product ${named}: ${parts.join("; ") || "no change"}.`;
  }
  return `Run ${name} on ${named}.`;
}

/** A product's variants in a line each, for an answer, every amount written by `formatMoney()`: "LINEN-M (M): kr 249,00 in NO". */
export function variantLines(input: ProductInput, markets: ToolStore["markets"], locale: string): string[] {
  return input.variants
    .filter((v) => v.active)
    .map((v) => {
      const priced = markets.flatMap((m) => {
        const minor = parsePrice(v.prices[m.code] ?? "", m.currency);
        return minor === null ? [] : [`${formatMoney(minor, m.currency, locale)} in ${m.code}`];
      });
      return `${v.sku} (${variantLabel(v.options)}): ${priced.join(", ") || "no price yet"}`;
    });
}
