import { z } from "zod";

import { DEFAULT_CANCEL_HOURS, DEFAULT_DEPOSIT_PERCENT, PAYMENT_MODES } from "./pay-later";
import { PRODUCT_AUDIENCES } from "./b2b";
import { RENTAL_PERIODS } from "./booking-ranges";
import { policyProblem, stockPolicyFields } from "./inventory";
import { PRICE_BREAKS_MAX, priceBreakProblems } from "./price-breaks";
import { MAX_ORDER_QUANTITY, ruleProblem } from "./quantity-rules";
import { minorUnitDigits } from "./money";
import { isPictureAddress } from "./picture-address";
import { BASES, UNITS, baseFits, measureProblem, parseMeasureAmount, type Base, type Unit } from "./unit-price";
import { DESCRIPTION_MAX, EXCERPT_FIELD_MAX, TITLE_MAX } from "./seo";
import { termIdsSchema } from "./taxonomy";
import { VAT_CATEGORY_CODE } from "./vat";
import {
  MAX_DISCOUNT_PERCENT,
  MAX_INTERVAL_COUNT,
  MAX_MIN_CYCLES,
  MAX_PLANS,
  MAX_TRIAL_DAYS,
  PLAN_INTERVALS,
  planSummary,
} from "./subscriptions";

export { isPictureAddress };

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

/**
 * A variant's content for the unit price (D160): the pack's total as typed text ("0,75", "250"), its unit and what the
 * price is compared per (null: the unit's default, 1 kg, 1 l, 1 m, 1 m2 or 1 piece). Parsed by `parseMeasureAmount()`,
 * never as a float; whether a variant may have one at all is `productProblems()`'s.
 */
export const measureInput = z
  .object({
    amount: z.string().trim().max(20),
    unit: z.enum(UNITS),
    base: z.enum(BASES).nullable().default(null),
  })
  .refine((m) => parseMeasureAmount(m.amount) !== null, {
    message: "Content must be a number above 0 and up to 1,000,000, with at most 4 decimals.",
    path: ["amount"],
  })
  .refine((m) => m.base === null || baseFits(m.unit, m.base), {
    message: "The content cannot be compared per that unit.",
    path: ["base"],
  });
export type MeasureInput = { amount: string; unit: Unit; base: Base | null };

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

/** Shipped, downloaded after payment (D24), or an appointment booked for a time (D65). */
export const DELIVERIES = ["physical", "digital", "service"] as const;
export type Delivery = (typeof DELIVERIES)[number];

/** A delivery as stored; anything unknown is shipped. */
export const parseDelivery = (value: unknown): Delivery =>
  DELIVERIES.includes(value as Delivery) ? (value as Delivery) : "physical";

export const MAX_FILES = 20;

export const MAX_OPTIONS = 3;
/** Shopify's limit (wave 6 unit B, D320): 2,048 variants over 3 options, held by the database too (`commerce.product_variants_limit()`). */
export const MAX_VARIANTS = 2048;
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

/**
 * What a product is (D65): goods (shipped or downloaded), an appointment, a stay, a rental, a gift card (D300, its variants its amounts), or a
 * bundle (D322: one variant made of other goods, its stock and, when computed, its price coming from them).
 */
export const PRODUCT_KINDS = ["goods", "appointment", "stay", "rental", "gift_card", "bundle"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
/** Kinds booked for a time (D65, D67): sold as services, with the settings below. */
export const BOOKED_KINDS = ["appointment", "stay", "rental"] as const;
export const isBooked = (kind: ProductKind): kind is (typeof BOOKED_KINDS)[number] => (BOOKED_KINDS as readonly string[]).includes(kind);
/** The VAT category of a gift card (D300): a multi-purpose voucher carries no VAT when sold; it is for gift cards only. */
export const VOUCHER_CATEGORY = "voucher";

/** A bundle's limits (D322): components (`bundle_components_rules()` holds the 20), each one's quantity, and a computed price's percentage off. */
export const BUNDLE_COMPONENTS_MAX = 20;
export const BUNDLE_QUANTITY_MAX = 99;
export const BUNDLE_PERCENT_MAX = 90;
export const BUNDLE_PRICINGS = ["fixed", "computed"] as const;

/**
 * What a bundle is made of and how it is priced (D322): its components (goods variants of the store, each with how many go in one bundle) and
 * `fixed` (its own prices, typed as any product's) or `computed` (the components' prices less `percentOff`, worked out by the database).
 */
export const bundleInput = z.object({
  pricing: z.enum(BUNDLE_PRICINGS).default("fixed"),
  percentOff: z
    .number()
    .int()
    .min(0, "A percentage off cannot be negative.")
    .max(BUNDLE_PERCENT_MAX, `A bundle can be at most ${BUNDLE_PERCENT_MAX}% off its components.`)
    .default(0),
  components: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1, "Put at least one of each component in the bundle.").max(BUNDLE_QUANTITY_MAX, `Put at most ${BUNDLE_QUANTITY_MAX} of a component in the bundle.`),
      }),
    )
    .max(BUNDLE_COMPONENTS_MAX, `A bundle has at most ${BUNDLE_COMPONENTS_MAX} components.`)
    .default([]),
});
export type BundleInput = z.infer<typeof bundleInput>;

/** How an appointment is booked (D65); kept in `appointment_settings` and `product_resources`. */
const dayOfYear = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, "Choose the day and month each season starts and ends.")
  .nullable();

/** A season of a stay's or rental's prices (D70): days of the year (or all year), weekdays, and a percentage. */
export const seasonInput = z
  .object({
    name: text(60).min(1, "Name each season, such as High season."),
    /** The name in the store's other languages, by locale; blank ones are left out. */
    names: z
      .record(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/), z.string().trim().max(60, "Keep season names to 60 characters."))
      .default({})
      .transform((names) => Object.fromEntries(Object.entries(names).filter(([, name]) => name !== ""))),
    fromDay: dayOfYear,
    toDay: dayOfYear,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one weekday for each season.").max(7),
    percent: z
      .number()
      .int()
      .min(-90, "A season lowers the price by at most 90 %.")
      .max(500, "A season raises the price by at most 500 %.")
      .refine((p) => p !== 0, "A season changes the price: give it a percentage."),
  })
  .refine((s) => (s.fromDay === null) === (s.toDay === null), "Give each season both a first and a last day, or neither.");

export type SeasonInput = z.infer<typeof seasonInput>;

export const appointmentInput = z.object({
  durationMinutes: z.number().int().min(5, "An appointment lasts at least 5 minutes.").max(720, "An appointment lasts at most 12 hours."),
  bufferBeforeMinutes: z.number().int().min(0).max(240, "Keep at most 4 hours free before."),
  bufferAfterMinutes: z.number().int().min(0).max(240, "Keep at most 4 hours free after."),
  stepMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  minNoticeMinutes: z.number().int().min(0).max(43200, "Ask for at most 30 days' notice."),
  maxDaysAhead: z.number().int().min(1, "Take bookings at least a day ahead.").max(730, "Take bookings at most two years ahead."),
  locationId: z.uuid().nullable(),
  resourceIds: z.array(z.uuid()).max(200),
  /** How it is paid and the shopper's cancellation rule (D66). */
  payment: z.enum(PAYMENT_MODES).default("now"),
  depositPercent: z.number().int().min(1, "A deposit is at least 1 %.").max(99, "A deposit is at most 99 %; take it all now instead.").default(DEFAULT_DEPOSIT_PERCENT),
  cancelHours: z.number().int().min(0).max(720, "Let shoppers cancel at most 30 days before.").default(DEFAULT_CANCEL_HOURS),
  noShowPercent: z.number().int().min(0).max(100, "A no-show fee is at most the whole price.").default(0),
  /** Stays and rentals (D67): check-in and check-out (pick-up and return), and how many nights or days. */
  checkInTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Write times as HH:MM.").default("15:00"),
  checkOutTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Write times as HH:MM.").default("11:00"),
  minNights: z.number().int().min(1, "A booking is at least one night or day.").max(365).default(1),
  maxNights: z.number().int().min(1).max(365, "A booking is at most a year.").default(28),
  /** A fee per booking (D70): a stay's cleaning, a rental's preparation; typed per market like prices. */
  bookingFee: z.record(z.string(), z.string().trim().max(20)).default({}),
  /** Seasons that change the price per night or day (D70), in order. */
  seasons: z.array(seasonInput).max(20, "Use at most 20 seasons.").default([]),
});

export const DEFAULT_APPOINTMENT: z.infer<typeof appointmentInput> = {
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  stepMinutes: 15,
  minNoticeMinutes: 60,
  maxDaysAhead: 60,
  locationId: null,
  resourceIds: [],
  payment: "now",
  depositPercent: DEFAULT_DEPOSIT_PERCENT,
  cancelHours: DEFAULT_CANCEL_HOURS,
  noShowPercent: 0,
  checkInTime: "15:00",
  checkOutTime: "11:00",
  minNights: 1,
  maxNights: 28,
  bookingFee: {},
  seasons: [],
};

/** Where a stay or a rental starts from (D67): a year ahead, a day's notice for a stay, check-in 15–11, pick-up 9–17. */
export const DEFAULT_STAY: z.infer<typeof appointmentInput> = {
  ...DEFAULT_APPOINTMENT,
  minNoticeMinutes: 0,
  maxDaysAhead: 365,
  cancelHours: 72,
};
export const DEFAULT_RENTAL: z.infer<typeof appointmentInput> = {
  ...DEFAULT_STAY,
  checkInTime: "09:00",
  checkOutTime: "17:00",
  maxNights: 14,
  cancelHours: 24,
};

/** The settings a new booked product of a kind starts with. */
export function defaultBooking(kind: (typeof BOOKED_KINDS)[number]): z.infer<typeof appointmentInput> {
  return kind === "stay" ? DEFAULT_STAY : kind === "rental" ? DEFAULT_RENTAL : DEFAULT_APPOINTMENT;
}

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
        /** A short text for lists and content grids; empty uses the start of the description. */
        excerpt: text(EXCERPT_FIELD_MAX).default(""),
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
        values: z
          .array(text(60).min(1))
          .min(1, "Give each option at least one value.")
          .max(MAX_VARIANTS, `Use at most ${MAX_VARIANTS} values in an option.`),
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
        /** What one unit costs the store (D152), typed like a price in the store's main currency, without VAT; empty when unknown. */
        cost: z.string().trim().max(20).default(""),
        stock: z.number().int().min(0, "Stock cannot be negative.").max(1_000_000),
        /**
         * What happens at zero stock (wave 3, D172): `deny` stops selling, `continue` keeps selling on backorder with a stated delivery time
         * (`backorderDays`, 1 to 90, required with it). `lowStockThreshold` is the owner's warning level (goods only). `policyProblem()` holds the rules.
         */
        ...stockPolicyFields,
        /** How many at a time (wave 6 unit E, D323): a line's minimum, maximum (null: none) and step; goods and bundles only, `ruleProblem()`'s rules. */
        minQuantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY).default(1),
        maxQuantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY).nullable().default(null),
        quantityStep: z.number().int().min(1).max(MAX_ORDER_QUANTITY).default(1),
        active: z.boolean(),
        weightGrams: z.number().int().positive("Weight must be more than 0 g.").max(1_000_000).nullable(),
        hsCode: optionalText(10).refine((v) => v === null || /^[0-9]{6,10}$/.test(v), {
          message: "A customs tariff (HS) code is 6 to 10 digits.",
        }),
        originCountry: optionalText(2).refine((v) => v === null || /^[A-Z]{2}$/.test(v), {
          message: "Choose a country of origin.",
        }),
        delivery: z.enum(DELIVERIES).default("physical"),
        /** Unit price (D160): the pack's total content; goods only, null for none. */
        measure: measureInput.nullable().default(null),
        /** A rental's variant: by the day, half day or hour (D69). Ignored for other kinds. */
        rentalPeriod: z.enum(RENTAL_PERIODS).default("day"),
        /** Its own picture, shown where shoppers choose a variant: one of the product's, or uploaded for it. */
        image: z.object({ url: pictureAddress, thumbnailUrl: pictureAddress.nullable() }).nullable().default(null),
      }),
    )
    .min(1, "A product needs at least one variant.")
    .max(MAX_VARIANTS, `Use at most ${MAX_VARIANTS} variants.`),
  /** A stay's or rental's outside host (D71); null for the store's own. */
  hostId: z.uuid().nullable().default(null),
  /** Its own product layout (D79); null: from its categories, tags or the store. */
  layoutId: z.uuid().nullable().default(null),
  /** The shipping profile (D237): null is General. Left out, the product keeps the one it has (an import, a bulk edit, an older editor). */
  shippingProfileId: z.uuid().nullable().optional(),
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
  /** In stores selling to both (B2B): for everyone, only private shoppers or only businesses. */
  audience: z.enum(PRODUCT_AUDIENCES).default("all"),
  /** Unit price (D160): every active goods variant needs its content. Goods only (`products_sold_by_measure_goods`). */
  soldByMeasure: z.boolean().default(false),
  /** Which VAT rate it takes (D65). */
  vatCategory: z.string().regex(VAT_CATEGORY_CODE, "Choose a VAT category.").default("standard"),
  /** Goods, or an appointment booked for a time (D65), with how it is booked. */
  kind: z.enum(PRODUCT_KINDS).default("goods"),
  appointment: appointmentInput.nullable().default(null),
  /** A bundle's components and pricing (D322); null for every other kind. */
  bundle: bundleInput.nullable().default(null),
  /**
   * Price breaks (wave 6 unit E2, D323): from how many units in one line, a percentage off or a price per market as typed, for a variant by SKU or
   * every variant (null); goods and bundles only, `priceBreakProblems()`'s rules.
   */
  priceBreaks: z
    .array(
      z.object({
        variantSku: z.string().max(64).nullable(),
        from: z.number().int().min(2).max(9999),
        percent: z.number().int().min(1).max(99).nullable(),
        prices: z.record(z.string(), z.string().trim().max(20)),
      }),
    )
    .max(PRICE_BREAKS_MAX, `A product has at most ${PRICE_BREAKS_MAX} price breaks.`)
    .default([]),
  taxCode: z.string().trim().regex(/^txcd_[0-9]{8}$/, "A Stripe tax code looks like txcd_99999999."),
  withdrawalExclusion: z.enum(WITHDRAWAL_EXCLUSIONS.map((w) => w.id) as [string, ...string[]]),
  schemes: z.array(z.enum(PRODUCER_SCHEMES.map((s) => s.id) as [string, ...string[]])),
  manufacturer: operatorSchema,
  responsiblePerson: operatorSchema,
  /** The store's product categories and tags, by id (D50). */
  ...termIdsSchema.shape,
});

export type ProductInput = z.infer<typeof productInput>;
export type AppointmentInput = z.infer<typeof appointmentInput>;
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
  /** The store's main currency (D152): what a variant's cost is typed in. */
  mainCurrency: string;
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

  // A unit's cost (D152) is typed like a price, in the main currency; empty means not known.
  for (const variant of input.variants) {
    if (variant.cost && parsePrice(variant.cost, context.mainCurrency) === null) {
      problems.push(`${variantLabel(variant.options)}: "${variant.cost}" is not a cost in ${context.mainCurrency}.`);
    }
  }

  // Content for the unit price (D160): physical goods only. Whether a product NEEDS content is the server's
  // (`unitPriceProblems()`: it needs the product's categories), the same rules the database holds.
  for (const variant of input.variants) {
    const problem = measureProblem(variant.measure, { kind: input.kind, delivery: variant.delivery });
    if (problem) problems.push(`${variantLabel(variant.options)}: ${problem}`);
  }
  if (input.soldByMeasure && input.kind !== "goods") {
    problems.push("Only goods can be sold by measure: take the tick away for appointments, stays and rentals.");
  }

  // Backorder and the low-stock level (wave 3, D172): the same rules the database holds (`product_variants` checks).
  for (const variant of input.variants) {
    const problem = policyProblem(
      { stockPolicy: variant.stockPolicy, backorderDays: variant.backorderDays, lowStockThreshold: variant.lowStockThreshold },
      variant.delivery,
    );
    if (problem) problems.push(`${variantLabel(variant.options)}: ${problem}`);
  }

  // How many at a time (D323): goods and bundles keep the rule the database would take; any other kind is bought one at a time.
  if (input.kind === "goods" || input.kind === "bundle") {
    for (const variant of input.variants) {
      const problem = ruleProblem({ min: variant.minQuantity, max: variant.maxQuantity, step: variant.quantityStep });
      if (problem) problems.push(`${variantLabel(variant.options)}: ${problem}`);
    }
  }

  // Price breaks (D323): goods and bundles only (any other kind's are dropped on save), each a percentage or prices in the store's own markets.
  if (input.priceBreaks.length > 0 && (input.kind === "goods" || input.kind === "bundle")) {
    const currencies = new Map(context.markets.map((m) => [m.code, m.currency]));
    problems.push(
      ...priceBreakProblems(input.priceBreaks, input.variants.map((v) => v.sku), (market, typed) => {
        const currency = currencies.get(market);
        return currency ? parsePrice(typed, currency) : null;
      }),
    );
  }

  // A stay's or rental's fee per booking (D70), typed like a price.
  for (const market of context.markets) {
    const typed = input.appointment?.bookingFee?.[market.code] ?? "";
    if ((input.kind === "stay" || input.kind === "rental") && typed && parsePrice(typed, market.currency) === null) {
      problems.push(`Fee per booking: "${typed}" is not a price in ${market.currency}.`);
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

  // Appointments, stays and rentals (D65, D67): booked for a time, never subscribed to.
  if (isBooked(input.kind)) {
    const what = { appointment: "appointment", stay: "stay", rental: "rental" }[input.kind];
    if (!input.appointment) problems.push(`Say how the ${what} is booked.`);
    if (input.plans.length > 0) problems.push("Bookings cannot be subscribed to: take the purchase options away.");
    if (input.status === "active" && input.appointment && input.appointment.resourceIds.length === 0) {
      problems.push(
        input.kind === "appointment"
          ? "Choose who does the appointment before publishing it."
          : input.kind === "stay"
            ? "Choose the rooms or homes guests stay in before publishing it."
            : "Choose the items that are rented out before publishing it.",
      );
    }
    if (input.kind !== "appointment" && input.appointment && input.appointment.maxNights < input.appointment.minNights) {
      problems.push("The longest booking cannot be shorter than the shortest.");
    }
  }

  // A gift card (D300): its variants are its amounts, emailed as a code, with no VAT when sold; nothing else.
  if (input.kind === "gift_card") {
    if (input.vatCategory !== VOUCHER_CATEGORY) problems.push("A gift card takes the VAT category Gift card: it carries no VAT when sold.");
    if (input.plans.length > 0 || input.subscriptionOnly) problems.push("Gift cards cannot be subscribed to: take the purchase options away.");
    if (input.variants.some((v) => v.delivery !== "digital")) problems.push("A gift card is sent by email: make every amount digital.");
    if (input.files.length > 0) problems.push("A gift card sends a code, not a file: take the files away.");
  } else if (input.vatCategory === VOUCHER_CATEGORY) {
    problems.push("The VAT category Gift card is for gift cards only.");
  }

  // A bundle (D322): one physical variant made of other goods, never subscribed to, with no files or content of its own.
  if (input.kind === "bundle") problems.push(...bundleProblems(input));

  if (input.status !== "active") return problems;

  if (input.media.length === 0) problems.push("Add at least one picture before publishing the product.");
  const active = input.variants.filter((v) => v.active);
  for (const variant of active.filter((v) => v.delivery === "digital" && input.kind !== "gift_card")) {
    if (!input.files.some((f) => f.variantSku === null || f.variantSku === variant.sku)) {
      problems.push(`${variantLabel(variant.options)} is digital: add a file for shoppers to download.`);
    }
  }
  if (active.length === 0) problems.push("Switch on at least one variant before publishing the product.");
  const priced =
    (input.kind === "bundle" && input.bundle?.pricing === "computed") ||
    active.some((v) => context.markets.some((m) => parsePrice(v.prices[m.code] ?? "", m.currency) !== null));
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

/** The units in one bundle, all components together (D322): a bundle sells at least two. */
export const bundleUnits = (bundle: Pick<BundleInput, "components"> | null): number => (bundle?.components ?? []).reduce((sum, c) => sum + c.quantity, 0);

/** What is wrong with a bundle as the owner made it (D322), in words they can act on; the database holds the per-component rules again. */
export function bundleProblems(input: ProductInput): string[] {
  const problems: string[] = [];
  if (!input.bundle) return ["Choose what goes in the bundle."];
  if (input.options.length > 0 || input.variants.length !== 1) problems.push("A bundle has one variant: take the options away.");
  if (input.variants.some((v) => v.delivery !== "physical")) problems.push("A bundle is sent by post: make its variant physical.");
  if (input.plans.length > 0 || input.subscriptionOnly) problems.push("Bundles cannot be subscribed to: take the purchase options away.");
  if (input.files.length > 0) problems.push("A bundle sends its components, not a file: take the files away.");
  if (input.soldByMeasure || input.variants.some((v) => v.measure !== null)) problems.push("A bundle has no content of its own for a price per kg or litre.");
  if (input.variants.some((v) => v.stockPolicy === "continue")) problems.push("A bundle is never sold on backorder: its stock comes from its components.");
  const ids = input.bundle.components.map((c) => c.variantId);
  if (new Set(ids).size !== ids.length) problems.push("A component is in the bundle twice: give it one line with its quantity.");
  if (input.status === "active" && bundleUnits(input.bundle) < 2) {
    problems.push("Put at least two units in the bundle before publishing it: two products, or two of one.");
  }
  return problems;
}
