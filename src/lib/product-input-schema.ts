import { z } from "zod";

import { DEFAULT_CANCEL_HOURS, DEFAULT_DEPOSIT_PERCENT, PAYMENT_MODES } from "./pay-later";
import { PRODUCT_AUDIENCES } from "./b2b";
import { RENTAL_PERIODS } from "./booking-ranges";
import { LOCATIONS_MAX } from "./inventory";
import { stockPolicyFields } from "./inventory-schema";
import { PRICE_BREAKS_MAX } from "./price-breaks";
import { MAX_ORDER_QUANTITY } from "./quantity-rules";
import { PRICE_WORD_MAX } from "./price-words";
import { isPictureAddress } from "./picture-address";
import { MAX_MEDIA, MEDIA_KINDS, VIDEO_SOURCES } from "./product-media";
import { CATEGORY_ID, MAX_ATTRIBUTE_VALUES } from "./product-taxonomy";
import { BASES, UNITS, baseFits, parseMeasureAmount } from "./unit-price";
import { DESCRIPTION_MAX, EXCERPT_FIELD_MAX, TITLE_MAX } from "./seo";
import { termIdsSchema } from "./taxonomy-schema";
import { VAT_CATEGORY_CODE } from "./vat";
import { MAX_DISCOUNT_PERCENT, MAX_MIN_CYCLES, MAX_PLANS, MAX_TRIAL_DAYS, PLAN_INTERVALS } from "./subscriptions";
import {
  BUNDLE_COMPONENTS_MAX,
  BUNDLE_PERCENT_MAX,
  BUNDLE_PRICINGS,
  BUNDLE_QUANTITY_MAX,
  DELIVERIES,
  MAX_FILES,
  MAX_OPTIONS,
  MAX_VARIANTS,
  PRODUCER_SCHEMES,
  PRODUCT_KINDS,
  WITHDRAWAL_EXCLUSIONS,
} from "./product-input";

/**
 * The product editor's schemas (bloat review step 2.46): productInput and the parts it is made of, apart from the helpers and
 * constants in product-input.ts, so a screen that only reads a constant or a helper loads no zod. The server checks every product it
 * is sent with productInput. Import this file only where a schema runs; product-input.ts imports it as a type alone.
 */

const pictureAddress = z
  .string()
  .trim()
  .max(1000)
  .refine(isPictureAddress, "A picture has an invalid address.");

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

const text = (max: number) => z.string().trim().max(max);

/** Text that may be left empty: "" and null both become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

export const operatorSchema = z.union([
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
        /** A picture, a video or a 3D model (D325); every item has a picture: its own, or a video's or model's poster. */
        kind: z.enum(MEDIA_KINDS).default("image"),
        /** A video's: uploaded, or on YouTube or Vimeo. */
        source: z.enum(VIDEO_SOURCES).nullable().default(null),
        /** A video's file or address, or a model's file. */
        mediaUrl: z.string().trim().max(1000).nullable().default(null),
        url: pictureAddress,
        thumbnailUrl: pictureAddress.nullable(),
        /** The words in the main language. */
        alt: text(300),
        /** The words in the store's other languages, as typed (D325); a language left out reads the library's, then the title. */
        alts: z.record(z.string().min(2).max(20), text(300)).default({}),
      }),
    )
    .max(MAX_MEDIA, `Use at most ${MAX_MEDIA} pictures, videos and 3D models.`),
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
         * With several active locations (D397): the stock at each, as typed (`onHand`) beside what the editor read (`loaded`), so a level the
         * person did not change is left as it is, whatever was sold since. Absent with one location, where `stock` is that location's.
         */
        locationStock: z
          .array(z.object({ locationId: z.uuid(), onHand: z.number().int().min(0, "Stock cannot be negative.").max(1_000_000), loaded: z.number().int().min(0).max(1_000_000) }))
          .max(LOCATIONS_MAX)
          .refine((list) => new Set(list.map((l) => l.locationId)).size === list.length, { message: "A location is listed twice." })
          .optional(),
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
        /** Read only (D335 A.2): the countries whose price a market price rule wrote. Never saved: a price typed there is the owner's own. */
        derivedIn: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).optional(),
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
  /**
   * The standard taxonomy's category (D327, Shopify's id), null for none. Left out, the product keeps its category and attributes (an
   * import without the column, an older editor); given, it is written with `standardAttributes` (none when left out), checked against
   * the release by `standardProblems()` on the server.
   */
  standardCategory: z.string().regex(CATEGORY_ID, "Choose a category from the standard taxonomy.").nullable().optional(),
  /** The category's attributes' chosen values: an attribute id to value ids. */
  standardAttributes: z
    .record(z.string().regex(/^\d{1,9}$/), z.array(z.number().int().positive()).max(MAX_ATTRIBUTE_VALUES, `Choose at most ${MAX_ATTRIBUTE_VALUES} values of one attribute.`))
    .optional(),
  /**
   * Where it is not sold (D335 A.1): countries (market codes) the whole product is switched off in, and per variant (by SKU) the countries
   * that variant is off in; its prices there are kept. Left out, the product keeps what it has (an import without the column, an older
   * editor); given, it replaces what is stored for the countries the editor shows (`saveProduct()` keeps the rest, D178).
   */
  availability: z
    .object({
      off: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).default([]),
      variants: z.record(z.string().max(64), z.array(z.string().regex(/^[A-Z]{2}$/)).max(60)).default({}),
    })
    .optional(),
  /**
   * Its description for one country, over its language's (D338): a German text for Austria beside Germany's. Left out, what is stored is kept;
   * given, it replaces what is stored for the countries the editor shows. Empty texts are not kept (the language's is shown).
   */
  countryTexts: z
    .array(z.object({ market: z.string().regex(/^[A-Z]{2}$/), locale: z.string().min(2).max(10), description: text(10_000) }))
    .max(200)
    .optional(),
  /**
   * Whether its price of nothing says Free (D913): true, false, or null as its tags, categories and the store say. Left out, the product keeps what
   * it has.
   */
  zeroFree: z.boolean().nullable().optional(),
  /** Buy now past the cart page (D915): true skips, false shows the cart, null as its tags', categories' and the store's; left out, unchanged. */
  skipCart: z.boolean().nullable().optional(),
  /**
   * Its own words before and after its price (D429, `price-words.ts`): the store's, none, or its own by language. Left out, the product keeps
   * what it has (an import, the AI manager, an older editor); the server checks each word (`priceWordProblem()`) for the store's languages.
   */
  priceWords: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("inherit") }),
      z.object({ mode: z.literal("none") }),
      z.object({
        mode: z.literal("own"),
        words: z.record(
          z.string().min(2).max(10),
          z.object({ prefix: z.string().max(PRICE_WORD_MAX * 4), suffix: z.string().max(PRICE_WORD_MAX * 4) }),
        ),
      }),
    ])
    .optional(),
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
        /** The SKU of the one variant it is for, null for every variant (D911): monthly and yearly as variants with their own prices. */
        variantSku: z.string().max(64).nullable().default(null),
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
  /**
   * Price on request (D431): its price is never shown to shoppers and it cannot be put in a cart; its page offers Request a quote instead.
   * Goods only (`products_price_on_request_goods`), bought once.
   */
  priceOnRequest: z.boolean().default(false),
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
