import { z } from "zod";

import { minorUnitDigits } from "./money";
import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";
import { termIdsSchema } from "./taxonomy";
import {
  MAX_DISCOUNT_PERCENT,
  MAX_INTERVAL_COUNT,
  MAX_MIN_CYCLES,
  MAX_PLANS,
  MAX_TRIAL_DAYS,
  PLAN_INTERVALS,
  planSummary,
} from "./subscriptions";

/**
 * A picture's address: a web address (http or https), or a path on the
 * store's own site such as the demo pictures' `/demo/notebook.svg`.
 */
export function isPictureAddress(value: string): boolean {
  if (/^\/(?![/\\])/.test(value)) return !/\s/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const pictureAddress = z
  .string()
  .trim()
  .max(1000)
  .refine(isPictureAddress, "A picture has an invalid address.");

/**
 * The product editor's data, shared by the browser (which builds it) and the
 * server (which checks and saves it). Prices are typed text in major units
 * ("249,00") and converted with `parsePrice` for each market's currency.
 */

export const GENERAL_TAX_CODE = "txcd_99999999";

/** Why a product may be excluded from the right of withdrawal, in plain words. */
export const WITHDRAWAL_EXCLUSIONS = [
  { id: "none", label: "No exclusion: customers can change their mind within 14 days" },
  { id: "custom_made", label: "Made to the customer's specifications or clearly personalised" },
  { id: "perishable", label: "Goes off or expires quickly" },
  { id: "sealed_hygiene", label: "Sealed for health or hygiene reasons (once unsealed)" },
  { id: "sealed_media", label: "Sealed audio, video or software (once unsealed)" },
  { id: "mixed_inseparably", label: "Mixed with other items after delivery and cannot be separated" },
  { id: "price_fluctuation", label: "Price depends on financial markets the seller does not control" },
  { id: "alcohol_future_delivery", label: "Alcohol priced at sale but delivered after 30 days" },
  { id: "periodicals", label: "Newspaper, periodical or magazine (not subscriptions)" },
  { id: "digital_content", label: "Digital content delivered at once, with the customer's consent" },
] as const;

/** Producer responsibility schemes (recycling fees) a product can fall under. */
export const PRODUCER_SCHEMES = [
  { id: "packaging", label: "Packaging" },
  { id: "electrical_equipment", label: "Electrical and electronic equipment" },
  { id: "batteries", label: "Batteries" },
  { id: "textiles", label: "Textiles" },
  { id: "furniture", label: "Furniture" },
  { id: "tyres", label: "Tyres" },
] as const;

/** Shipped, or downloaded after payment (D24). */
export const DELIVERIES = ["physical", "digital"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const MAX_FILES = 20;

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;
export const MAX_MEDIA = 12;

const text = (max: number) => z.string().trim().max(max);
/** Text that may be left empty: "" and null both become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const operatorSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({
    new: z.object({
      name: text(200).min(1, "Enter the company's name."),
      postalAddress: text(300).min(5, "Enter the company's postal address."),
      electronicAddress: text(200).min(3, "Enter an email or web address for the company."),
      country: z.string().regex(/^[A-Z]{2}$/, "Choose the company's country."),
    }),
  }),
  z.null(),
]);

export type OperatorChoice = z.infer<typeof operatorSchema>;

export const productInput = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "The web address may use lowercase letters, digits and single hyphens.")
    .max(80),
  status: z.enum(["draft", "active"]),
  translations: z
    .array(
      z.object({
        locale: z.string().min(2).max(10),
        title: text(200),
        description: text(10_000),
        safetyInformation: text(5_000),
        /** For search results and shares; empty uses the title and description. */
        seoTitle: text(TITLE_MAX).default(""),
        seoDescription: text(DESCRIPTION_MAX).default(""),
      }),
    )
    .min(1),
  media: z
    .array(
      z.object({
        url: pictureAddress,
        thumbnailUrl: pictureAddress.nullable(),
        alt: text(300),
      }),
    )
    .max(MAX_MEDIA, `Use at most ${MAX_MEDIA} pictures.`),
  options: z
    .array(
      z.object({
        name: text(40).min(1, "Give each option a name, such as Colour."),
        values: z.array(text(60).min(1)).min(1, "Give each option at least one value."),
      }),
    )
    .max(MAX_OPTIONS, `Use at most ${MAX_OPTIONS} options.`),
  variants: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        options: z.record(z.string(), z.string()),
        sku: text(64).min(1, "Every variant needs a SKU (your stock-keeping code)."),
        gtin: optionalText(14).refine((v) => v === null || /^[0-9]{8,14}$/.test(v), {
          message: "A barcode (GTIN/EAN) is 8 to 14 digits.",
        }),
        prices: z.record(z.string(), z.string().trim().max(20)),
        stock: z.number().int().min(0, "Stock cannot be negative.").max(1_000_000),
        active: z.boolean(),
        weightGrams: z.number().int().positive("Weight must be more than 0 g.").max(1_000_000).nullable(),
        hsCode: optionalText(10).refine((v) => v === null || /^[0-9]{6,10}$/.test(v), {
          message: "A customs tariff (HS) code is 6 to 10 digits.",
        }),
        originCountry: optionalText(2).refine((v) => v === null || /^[A-Z]{2}$/.test(v), {
          message: "Choose a country of origin.",
        }),
        delivery: z.enum(DELIVERIES).default("physical"),
      }),
    )
    .min(1, "A product needs at least one variant.")
    .max(MAX_VARIANTS, `Use at most ${MAX_VARIANTS} variants.`),
  /** How new variants are delivered; each variant can differ. */
  delivery: z.enum(DELIVERIES).default("physical"),
  /** Files for digital variants: already uploaded to the store's folder. */
  files: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        name: text(200).min(1, "Give each file a name."),
        path: z.string().max(500),
        sizeBytes: z.number().int().positive(),
        contentType: z.string().max(200),
        /** The digital variant it belongs to, by SKU; null for every digital variant. */
        variantSku: z.string().nullable(),
      }),
    )
    .max(MAX_FILES, `Use at most ${MAX_FILES} files.`)
    .default([]),
  /** Times each file can be downloaded per order; null for no limit. */
  downloadLimit: z.number().int().min(1, "Allow at least one download.").max(1000).nullable().default(5),
  /** Days the download links work after payment; null for no end. */
  downloadDays: z.number().int().min(1, "Keep links working at least one day.").max(3650).nullable().default(30),
  /** Purchase options for subscribing (D25). */
  plans: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        interval: z.enum(PLAN_INTERVALS),
        intervalCount: z.number().int().min(1, "Renew at least every 1 week, month or year."),
        discountPercent: z
          .number()
          .int()
          .min(0, "A discount cannot be negative.")
          .max(MAX_DISCOUNT_PERCENT, `A discount can be at most ${MAX_DISCOUNT_PERCENT}%.`),
        /** Days free before the first charge (D29). */
        trialDays: z.number().int().min(0).max(MAX_TRIAL_DAYS, `A free trial can be at most ${MAX_TRIAL_DAYS} days.`).default(0),
        /** A one-time fee when subscribing, typed per market ("49,00"); empty for none. */
        signupFee: z.record(z.string(), z.string().max(20)).default({}),
        /** Payments committed to, the first included; 0 for none. */
        minCycles: z.number().int().min(0).max(MAX_MIN_CYCLES, `Commit to at most ${MAX_MIN_CYCLES} payments.`).default(0),
      }),
    )
    .max(MAX_PLANS, `Use at most ${MAX_PLANS} purchase options.`)
    .default([]),
  /** Sold only through its purchase options. */
  subscriptionOnly: z.boolean().default(false),
  taxCode: z.string().trim().regex(/^txcd_[0-9]{8}$/, "A Stripe tax code looks like txcd_99999999."),
  withdrawalExclusion: z.enum(WITHDRAWAL_EXCLUSIONS.map((w) => w.id) as [string, ...string[]]),
  schemes: z.array(z.enum(PRODUCER_SCHEMES.map((s) => s.id) as [string, ...string[]])),
  manufacturer: operatorSchema,
  responsiblePerson: operatorSchema,
  /** The store's product categories and tags, by id (D50). */
  ...termIdsSchema.shape,
});

export type ProductInput = z.infer<typeof productInput>;
export type VariantInput = ProductInput["variants"][number];

/**
 * A typed price in major units as integer minor units: "249", "249,00",
 * "1 249.5" and "1.249,50" all work. Null for an empty or unreadable price.
 */
export function parsePrice(value: string, currency: string): number | null {
  const compact = value.replace(/[\s ]/g, "");
  if (compact === "") return null;
  if (!/^[0-9.,]+$/.test(compact)) return null;
  // The last separator followed by one or two digits is the decimal mark.
  const match = /^(.*?)[.,]([0-9]{1,2})$/.exec(compact);
  const whole = (match ? match[1] : compact).replace(/[.,]/g, "");
  const fraction = match ? match[2] : "";
  if (whole === "" && fraction === "") return null;
  const digits = minorUnitDigits(currency);
  if (fraction.length > digits) return null;
  const minor = Number(whole || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as text for the price field, e.g. 24900 NOK → "249,00". */
export function formatPriceInput(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.floor(minor / 10 ** digits);
  const fraction = String(minor % 10 ** digits).padStart(digits, "0");
  return `${whole},${fraction}`;
}

/** Every combination of option values, in order: the variants to offer. */
export function combineOptions(options: ProductInput["options"]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (combos, option) =>
      combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value }))),
    [{}],
  );
}

/** A readable name for a variant: "White / Large", or "Default". */
export function variantLabel(options: Record<string, string>): string {
  const values = Object.values(options);
  return values.length > 0 ? values.join(" / ") : "Default";
}

export type PublishContext = {
  /** Markets the store sells to: code and currency. */
  markets: { code: string; currency: string }[];
  /** The primary locale, whose title is required. */
  primaryLocale: string;
  /** Country codes of existing operators, by id. */
  operatorCountries: Record<string, string>;
  /** Codes of EU member states. */
  euCountries: ReadonlySet<string>;
};

/**
 * Everything wrong with the product, in words an owner can act on. Problems
 * that only matter for selling (pictures, safety contacts, prices) are listed
 * only when the product is to be published.
 */
export function productProblems(input: ProductInput, context: PublishContext): string[] {
  const problems: string[] = [];
  const primary = input.translations.find((t) => t.locale === context.primaryLocale);
  if (!primary?.title) problems.push("Give the product a title.");

  const skus = input.variants.map((v) => v.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) problems.push("Two variants have the same SKU.");

  for (const variant of input.variants) {
    for (const market of context.markets) {
      const typed = variant.prices[market.code] ?? "";
      if (typed && parsePrice(typed, market.currency) === null) {
        problems.push(`${variantLabel(variant.options)}: "${typed}" is not a price in ${market.currency}.`);
      }
    }
  }

  const digitalSkus = new Set(input.variants.filter((v) => v.delivery === "digital").map((v) => v.sku));
  for (const file of input.files) {
    if (file.variantSku !== null && !digitalSkus.has(file.variantSku)) {
      problems.push(`The file "${file.name}" belongs to a variant that is not digital. Choose where it goes.`);
    }
  }

  const rhythms = new Set<string>();
  for (const plan of input.plans) {
    if (plan.intervalCount > MAX_INTERVAL_COUNT[plan.interval]) {
      problems.push(`${planSummary(plan)}: subscriptions renew at least every three years.`);
    }
    for (const market of context.markets) {
      const fee = plan.signupFee[market.code] ?? "";
      if (fee.trim() && parsePrice(fee, market.currency) === null) {
        problems.push(`${planSummary(plan)}: "${fee}" is not a sign-up fee in ${market.currency}.`);
      }
    }
    const rhythm = `${plan.interval}:${plan.intervalCount}`;
    if (rhythms.has(rhythm)) problems.push(`Two purchase options renew ${planSummary(plan).toLowerCase().split(",")[0]}.`);
    rhythms.add(rhythm);
  }
  if (input.subscriptionOnly && input.plans.length === 0) {
    problems.push("Add a purchase option, or let shoppers also buy the product once.");
  }

  if (input.status !== "active") return problems;

  if (input.media.length === 0) problems.push("Add at least one picture before publishing the product.");
  const active = input.variants.filter((v) => v.active);
  for (const variant of active.filter((v) => v.delivery === "digital")) {
    if (!input.files.some((f) => f.variantSku === null || f.variantSku === variant.sku)) {
      problems.push(`${variantLabel(variant.options)} is digital: add a file for shoppers to download.`);
    }
  }
  if (active.length === 0) problems.push("Switch on at least one variant before publishing the product.");
  const priced = active.some((v) =>
    context.markets.some((m) => parsePrice(v.prices[m.code] ?? "", m.currency) !== null),
  );
  if (active.length > 0 && !priced) problems.push("Give the product a price in at least one country.");

  const country = (choice: OperatorChoice): string | null =>
    choice === null ? null : "id" in choice ? (context.operatorCountries[choice.id] ?? null) : choice.new.country;
  // Product-safety contacts are for physical goods; downloads need none.
  if (!active.some((v) => v.delivery === "physical")) return problems;
  const makerCountry = country(input.manufacturer);
  if (!makerCountry) {
    problems.push("Add the manufacturer: EU product-safety rules require it on the listing.");
  } else if (!context.euCountries.has(makerCountry)) {
    const repCountry = country(input.responsiblePerson);
    if (!repCountry || !context.euCountries.has(repCountry)) {
      problems.push(
        "The manufacturer is outside the EU, so add a responsible person established in the EU.",
      );
    }
  }
  return problems;
}
