import { z } from "zod";

import { minorUnitDigits } from "./money";

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
      }),
    )
    .min(1),
  media: z
    .array(
      z.object({
        url: z.url("A picture has an invalid address.").max(1000),
        thumbnailUrl: z.url().max(1000).nullable(),
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
      }),
    )
    .min(1, "A product needs at least one variant.")
    .max(MAX_VARIANTS, `Use at most ${MAX_VARIANTS} variants.`),
  taxCode: z.string().trim().regex(/^txcd_[0-9]{8}$/, "A Stripe tax code looks like txcd_99999999."),
  withdrawalExclusion: z.enum(WITHDRAWAL_EXCLUSIONS.map((w) => w.id) as [string, ...string[]]),
  schemes: z.array(z.enum(PRODUCER_SCHEMES.map((s) => s.id) as [string, ...string[]])),
  manufacturer: operatorSchema,
  responsiblePerson: operatorSchema,
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
 * only when the product is to be put on sale.
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

  if (input.status !== "active") return problems;

  if (input.media.length === 0) problems.push("Add at least one picture before putting the product on sale.");
  const active = input.variants.filter((v) => v.active);
  if (active.length === 0) problems.push("Switch on at least one variant before putting the product on sale.");
  const priced = active.some((v) =>
    context.markets.some((m) => parsePrice(v.prices[m.code] ?? "", m.currency) !== null),
  );
  if (active.length > 0 && !priced) problems.push("Give the product a price in at least one country.");

  const country = (choice: OperatorChoice): string | null =>
    choice === null ? null : "id" in choice ? (context.operatorCountries[choice.id] ?? null) : choice.new.country;
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
