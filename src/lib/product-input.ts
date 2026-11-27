import { missingResponsible, type EstablishedArea, type ProductSafety } from "./product-safety";
import { DEFAULT_CANCEL_HOURS, DEFAULT_DEPOSIT_PERCENT } from "./pay-later";
import { policyProblem } from "./inventory";
import { priceBreakProblems } from "./price-breaks";
import { ruleProblem } from "./quantity-rules";
import { minorUnitDigits } from "./money";
import { isPictureAddress } from "./picture-address";
import { MAX_MEDIA, mediaProblems } from "./product-media";
import { measureProblem, type Base, type Unit } from "./unit-price";
import { MAX_INTERVAL_COUNT, planSummary } from "./subscriptions";
// Type imports are erased: the schemas stay in product-input-schema.ts, out of the helpers' importers (bloat review step 2.46).
import type { AppointmentInput, BundleInput, OperatorChoice, ProductInput } from "./product-input-schema";

export type { AppointmentInput, BundleInput, OperatorChoice, ProductInput, SeasonInput, VariantInput } from "./product-input-schema";

export { isPictureAddress };

/**
 * The product editor's data, shared by the browser (which builds it) and the
 * server (which checks and saves it). Prices are typed text in major units
 * ("249,00") and converted with `parsePrice` for each market's currency.
 */

export const GENERAL_TAX_CODE = "txcd_99999999";

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
  { id: "dated_service", label: "Accommodation, car rental, catering or leisure on a set date" },
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
/** A gallery's items (D325): pictures, videos and 3D models, the limits in `src/lib/product-media.ts`. */
export { MAX_MEDIA };

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

export const DEFAULT_APPOINTMENT: AppointmentInput = {
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
export const DEFAULT_STAY: AppointmentInput = {
  ...DEFAULT_APPOINTMENT,
  minNoticeMinutes: 0,
  maxDaysAhead: 365,
  cancelHours: 72,
};
export const DEFAULT_RENTAL: AppointmentInput = {
  ...DEFAULT_STAY,
  checkInTime: "09:00",
  checkOutTime: "17:00",
  maxNights: 14,
  cancelHours: 24,
};

/** The settings a new booked product of a kind starts with. */
export function defaultBooking(kind: (typeof BOOKED_KINDS)[number]): AppointmentInput {
  return kind === "stay" ? DEFAULT_STAY : kind === "rental" ? DEFAULT_RENTAL : DEFAULT_APPOINTMENT;
}

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
  /** The EU and EEA classifications and each destination's rule (D452): what a manufacturer established elsewhere needs, per market sold in. */
  safety: ProductSafety;
};

/** What the product check says for each area a responsible person is missing in (D452); the database's publish check words the same. */
export const RESPONSIBLE_SENTENCES: Record<EstablishedArea, string> = {
  eu: "The manufacturer is outside the EU, so add a responsible person established in the EU.",
  eea: "The manufacturer is outside the EEA, so add a responsible person established in the EEA.",
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
  // Price on request (D431): goods bought once, as a quote is a draft order of goods (D173).
  if (input.priceOnRequest && input.kind !== "goods") problems.push("Only goods can be priced on request: take the tick away.");
  if (input.priceOnRequest && (input.plans.length > 0 || input.subscriptionOnly)) {
    problems.push("A product priced on request cannot have purchase options: a quote is for goods bought once.");
  }

  // Backorder and the low-stock level (wave 3, D172): the same rules the database holds (`product_variants` checks).
  for (const variant of input.variants) {
    const problem = policyProblem(
      { stockPolicy: variant.stockPolicy, backorderDays: variant.backorderDays, lowStockThreshold: variant.lowStockThreshold, preorderUntil: variant.preorderUntil },
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

  // Only a booked service can be one the law exempts on a set date (D407): goods have their own exclusions.
  if (input.withdrawalExclusion === "dated_service" && !BOOKED_KINDS.includes(input.kind as (typeof BOOKED_KINDS)[number])) {
    problems.push("Only an appointment, stay or rental can be a service on a set date without a right of withdrawal.");
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

  // An option for one variant (D911) names one of the product's variants that are on; two options renew alike only for
  // different variants, and a product sold only by subscription has an option for every variant on.
  const activeSkus = new Set(input.variants.filter((v) => v.active && v.sku).map((v) => v.sku));
  for (const plan of input.plans) {
    if (plan.variantSku !== null && !activeSkus.has(plan.variantSku)) {
      problems.push(`${planSummary(plan)}: it is for a variant this product does not have (on). Choose which variant it is for.`);
    }
  }
  if (input.subscriptionOnly && input.plans.length > 0) {
    for (const variant of input.variants.filter((v) => v.active)) {
      if (!input.plans.some((plan) => plan.variantSku === null || plan.variantSku === variant.sku)) {
        problems.push(`${variantLabel(variant.options)} has no purchase option: give it one, or let shoppers also buy the product once.`);
      }
    }
  }

  const rhythms: { rhythm: string; variantSku: string | null }[] = [];
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
    const overlaps = rhythms.some(
      (r) => r.rhythm === rhythm && (r.variantSku === null || plan.variantSku === null || r.variantSku === plan.variantSku),
    );
    if (overlaps) problems.push(`Two purchase options renew ${planSummary(plan).toLowerCase().split(",")[0]}.`);
    rhythms.push({ rhythm, variantSku: plan.variantSku });
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

  // The gallery's kinds and counts (D325); whether its files are the store's own is the server's check.
  problems.push(...mediaProblems(input.media));

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
  } else {
    // By the countries the store sells to and each one's configured rule: EEA establishment never stands in for EU establishment.
    const missing = missingResponsible(makerCountry, country(input.responsiblePerson), context.markets.map((m) => m.code), context.safety);
    for (const area of missing) problems.push(RESPONSIBLE_SENTENCES[area]);
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
