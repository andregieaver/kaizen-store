/**
 * The data model for the Kaizen platform. Many stores share one database, in
 * the private `commerce` schema, which Supabase does not expose through its
 * public Data API: only server code with a direct connection can reach it.
 *
 * Tenancy (docs/platform.md, P1):
 * - Every store-owned table has `store_id`.
 * - Parents are unique on `(store_id, id)`, and children reference them by
 *   that pair, so no row can point into another store.
 *
 * Conventions:
 * - Money is an integer count of minor units with an ISO 4217 code alongside.
 *   Prices are VAT-inclusive (gross), per market.
 * - Records with legal weight (prices, invoices, credit notes, order events,
 *   the audit log) are append-only; triggers in the rules migration enforce it.
 * - Snapshots (addresses, titles, tax on order lines) are copied onto orders so
 *   later catalogue edits never rewrite what a customer bought.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const commerce = pgSchema("commerce");

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" }).notNull();
const storeId = () => uuid("store_id").notNull();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const storeStatus = commerce.enum("store_status", [
  "active",
  "suspended",
  "closed",
]);

export const memberRole = commerce.enum("member_role", ["owner", "admin"]);

export const accessRequestStatus = commerce.enum("access_request_status", [
  "pending",
  "approved",
  "declined",
]);

export const productStatus = commerce.enum("product_status", [
  "draft",
  "active",
  "archived",
]);

/**
 * Why a product is excluded from the 14-day right of withdrawal: the goods and
 * digital-content cases of the Consumer Rights Directive Art. 16, which
 * Norway's angrerettloven § 22 mirrors. `none` means the right applies.
 */
export const withdrawalExclusion = commerce.enum("withdrawal_exclusion", [
  "none",
  "custom_made",
  "perishable",
  "sealed_hygiene",
  "sealed_media",
  "mixed_inseparably",
  "price_fluctuation",
  "alcohol_future_delivery",
  "periodicals",
  "digital_content",
]);

/**
 * Extended producer responsibility schemes a product can fall under. Each one
 * needs a registration in every market the product is sold in.
 */
export const producerScheme = commerce.enum("producer_scheme", [
  "packaging",
  "electrical_equipment",
  "batteries",
  "textiles",
  "furniture",
  "tyres",
]);

export const cartStatus = commerce.enum("cart_status", ["open", "converted", "abandoned"]);

export const orderStatus = commerce.enum("order_status", [
  "pending_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "closed",
]);

export const paymentStatus = commerce.enum("payment_status", [
  "pending",
  "authorized",
  "captured",
  "failed",
  "cancelled",
]);

export const refundStatus = commerce.enum("refund_status", ["pending", "succeeded", "failed"]);

export const returnStatus = commerce.enum("return_status", [
  "requested",
  "in_transit",
  "received",
  "inspected",
  "closed",
]);

export const idempotencyStatus = commerce.enum("idempotency_status", [
  "in_progress",
  "completed",
]);

export const paymentMode = commerce.enum("payment_mode", ["test", "live"]);

// ---------------------------------------------------------------------------
// Platform: countries, accounts, stores, members
// ---------------------------------------------------------------------------

/** Countries the platform can sell to, with their currency and languages. */
export const countries = commerce.table(
  "countries",
  {
    code: char("code", { length: 2 }).primaryKey(),
    name: text("name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    defaultLocale: text("default_locale").notNull(),
    locales: text("locales").array().notNull(),
    inEu: boolean("in_eu").notNull(),
    /**
     * The standard VAT rate, e.g. 0.2500. Used to show the VAT included in
     * an order until Stripe Tax computes it (reduced rates are not applied).
     */
    standardVatRate: numeric("standard_vat_rate", { precision: 5, scale: 4 }),
  },
  (t) => [
    check("countries_code_upper", sql`${t.code} = upper(${t.code})`),
    check("countries_default_locale_listed", sql`${t.defaultLocale} = any(${t.locales})`),
  ],
);

/**
 * A person who can sign in. Created when they are invited or approved;
 * `auth_user_id` links the Supabase Auth user on first sign-in.
 */
export const accounts = commerce.table(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    authUserId: uuid("auth_user_id").unique(),
    name: text("name"),
    /** Operators of the platform itself (approve access requests). */
    platformAdmin: boolean("platform_admin").notNull().default(false),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("accounts_email_idx").on(sql`lower(${t.email})`)],
);

/** Someone asking to join the beta (docs/platform.md, P3). */
export const accessRequests = commerce.table(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    storeName: text("store_name").notNull(),
    message: text("message").notNull().default(""),
    status: accessRequestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => accounts.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The store created when the request was approved. */
    storeId: uuid("store_id").references((): AnyPgColumn => stores.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("access_requests_pending_email_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    index("access_requests_decided_by_idx").on(t.decidedBy),
    index("access_requests_store_idx").on(t.storeId),
    index("access_requests_status_idx").on(t.status, t.createdAt),
  ],
);

export const stores = commerce.table(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The subdomain: `{slug}.{platform domain}`. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: storeStatus("status").notNull().default("active"),
    /** The store new stores are copied from (docs/platform.md, P4). */
    isTemplate: boolean("is_template").notNull().default(false),
    /** When the owner finished the setup wizard. */
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    /**
     * The business behind the store, as shown to shoppers in the footer,
     * terms and order confirmations. Filled in by the setup wizard.
     */
    legalName: text("legal_name"),
    organisationNumber: text("organisation_number"),
    contactEmail: text("contact_email"),
    postalAddress: text("postal_address"),
    country: char("country", { length: 2 }).references(() => countries.code),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "stores_slug_format",
      sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`,
    ),
    // Names the platform needs for its own routes and subdomains.
    check(
      "stores_slug_not_reserved",
      sql`${t.slug} not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'support', 'www')`,
    ),
    uniqueIndex("stores_one_template_idx").on(t.isTemplate).where(sql`${t.isTemplate}`),
    index("stores_created_by_idx").on(t.createdBy),
    index("stores_country_idx").on(t.country),
  ],
);

/** Who works in which store, and in what role (docs/platform.md, P5). */
export const storeMembers = commerce.table(
  "store_members",
  {
    storeId: storeId().references(() => stores.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    role: memberRole("role").notNull().default("admin"),
    invitedBy: uuid("invited_by").references(() => accounts.id),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.accountId] }),
    index("store_members_account_idx").on(t.accountId),
    index("store_members_invited_by_idx").on(t.invitedBy),
  ],
);

/** Append-only record of settings, staff and platform changes. No secrets. */
export const auditLog = commerce.table(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** Null for platform-level events. */
    storeId: uuid("store_id").references(() => stores.id),
    accountId: uuid("account_id").references(() => accounts.id),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_store_idx").on(t.storeId, t.createdAt),
    index("audit_log_account_idx").on(t.accountId),
  ],
);

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/** A country a store sells to. Launch countries are `active`. */
export const markets = commerce.table(
  "markets",
  {
    storeId: storeId().references(() => stores.id),
    code: char("code", { length: 2 })
      .notNull()
      .references(() => countries.code),
    currency: char("currency", { length: 3 }).notNull(),
    defaultLocale: text("default_locale").notNull(),
    locales: text("locales").array().notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.code] }),
    unique("markets_store_code_currency_key").on(t.storeId, t.code, t.currency),
    index("markets_code_idx").on(t.code),
    check("markets_default_locale_listed", sql`${t.defaultLocale} = any(${t.locales})`),
  ],
);

/**
 * A flat shipping rate per market, optionally free above an order value
 * (both VAT-inclusive, in the market's currency).
 */
export const shippingRates = commerce.table(
  "shipping_rates",
  {
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    freeOverMinor: bigint("free_over_minor", { mode: "number" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.marketCode] }),
    foreignKey({
      name: "shipping_rates_market_fk",
      columns: [t.storeId, t.marketCode, t.currency],
      foreignColumns: [markets.storeId, markets.code, markets.currency],
    }).onDelete("cascade"),
    check("shipping_rates_amount_non_negative", sql`${t.amountMinor} >= 0`),
    check("shipping_rates_free_over_positive", sql`${t.freeOverMinor} is null or ${t.freeOverMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * A manufacturer, importer or EU responsible person, as named on a listing
 * under the General Product Safety Regulation (EU) 2023/988, Art. 19.
 */
export const economicOperators = commerce.table(
  "economic_operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    postalAddress: text("postal_address").notNull(),
    /** An email address or web address where the operator can be contacted. */
    electronicAddress: text("electronic_address").notNull(),
    country: char("country", { length: 2 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("economic_operators_store_id_key").on(t.storeId, t.id)],
);

export const products = commerce.table(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    handle: text("handle").notNull(),
    status: productStatus("status").notNull().default("draft"),
    manufacturerId: uuid("manufacturer_id"),
    /** Required when the manufacturer is established outside the EU. */
    responsiblePersonId: uuid("responsible_person_id"),
    /** Stripe Tax product tax code, e.g. `txcd_99999999`. */
    taxCode: text("tax_code").notNull(),
    withdrawalExclusion: withdrawalExclusion("withdrawal_exclusion").notNull().default("none"),
    /** Category-specific attributes. */
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("products_store_id_key").on(t.storeId, t.id),
    unique("products_store_handle_key").on(t.storeId, t.handle),
    foreignKey({
      name: "products_manufacturer_fk",
      columns: [t.storeId, t.manufacturerId],
      foreignColumns: [economicOperators.storeId, economicOperators.id],
    }),
    foreignKey({
      name: "products_responsible_person_fk",
      columns: [t.storeId, t.responsiblePersonId],
      foreignColumns: [economicOperators.storeId, economicOperators.id],
    }),
    index("products_manufacturer_idx").on(t.storeId, t.manufacturerId),
    index("products_responsible_person_idx").on(t.storeId, t.responsiblePersonId),
    index("products_store_status_idx").on(t.storeId, t.status),
    check("products_handle_format", sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

const productRef = (
  name: string,
  cols: { storeId: AnyPgColumn; productId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.productId],
    foreignColumns: [products.storeId, products.id],
  }).onDelete("cascade");

/** Localised listing text, including GPSR safety information. */
export const productTranslations = commerce.table(
  "product_translations",
  {
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Warnings and safety information, shown on the listing itself. */
    safetyInformation: text("safety_information").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    productRef("product_translations_product_fk", t),
    index("product_translations_store_product_idx").on(t.storeId, t.productId),
  ],
);

export const productMedia = commerce.table(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    url: text("url").notNull(),
    /** A small copy (about 480 px) for product lists and the cart. */
    thumbnailUrl: text("thumbnail_url"),
    position: integer("position").notNull().default(0),
    /** Alt text keyed by locale. */
    alt: jsonb("alt").notNull().default({}),
  },
  (t) => [
    productRef("product_media_product_fk", t),
    index("product_media_product_idx").on(t.storeId, t.productId, t.position),
  ],
);

export const productVariants = commerce.table(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    gtin: text("gtin"),
    /** Overrides the product's Stripe Tax code for this variant. */
    taxCode: text("tax_code"),
    /** Option values, e.g. `{"size": "M", "colour": "blue"}`. */
    options: jsonb("options").notNull().default({}),
    weightGrams: integer("weight_grams"),
    /** Customs tariff (HS) code and country of origin, for export declarations. */
    hsCode: text("hs_code"),
    originCountry: char("origin_country", { length: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("product_variants_store_id_key").on(t.storeId, t.id),
    unique("product_variants_store_sku_key").on(t.storeId, t.sku),
    productRef("product_variants_product_fk", t),
    index("product_variants_product_idx").on(t.storeId, t.productId),
    check("product_variants_gtin_digits", sql`${t.gtin} ~ '^[0-9]{8,14}$'`),
    check("product_variants_weight_positive", sql`${t.weightGrams} > 0`),
    check("product_variants_hs_code_digits", sql`${t.hsCode} ~ '^[0-9]{6,10}$'`),
  ],
);

const variantRef = (
  name: string,
  cols: { storeId: AnyPgColumn; variantId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.variantId],
    foreignColumns: [productVariants.storeId, productVariants.id],
  });

const marketRef = (
  name: string,
  cols: { storeId: AnyPgColumn; marketCode: AnyPgColumn; currency: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.marketCode, cols.currency],
    foreignColumns: [markets.storeId, markets.code, markets.currency],
  });

/**
 * Price history per variant and market. Append-only: a price change closes the
 * current row and opens a new one (see `commerce.set_price`), so the lowest
 * price of the previous 30 days can always be computed, as the Omnibus rule
 * requires for any advertised reduction.
 */
export const prices = commerce.table(
  "prices",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId(),
    variantId: uuid("variant_id").notNull(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
  },
  (t) => [
    variantRef("prices_variant_fk", t),
    marketRef("prices_market_fk", t),
    index("prices_market_idx").on(t.storeId, t.marketCode, t.currency),
    index("prices_variant_idx").on(t.storeId, t.variantId),
    uniqueIndex("prices_one_current_idx")
      .on(t.variantId, t.marketCode)
      .where(sql`${t.validTo} is null`),
    index("prices_history_idx").on(t.variantId, t.marketCode, t.validFrom),
    check("prices_amount_non_negative", sql`${t.amountMinor} >= 0`),
    check("prices_valid_range", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/** The producer responsibility schemes a product falls under. */
export const productSchemes = commerce.table(
  "product_schemes",
  {
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    scheme: producerScheme("scheme").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.scheme] }),
    productRef("product_schemes_product_fk", t),
    index("product_schemes_store_product_idx").on(t.storeId, t.productId),
  ],
);

/**
 * The store's registration under a producer responsibility scheme in a
 * market, e.g. a packaging or electrical-equipment registration number.
 */
export const producerRegistrations = commerce.table(
  "producer_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    scheme: producerScheme("scheme").notNull(),
    registrationNumber: text("registration_number").notNull(),
    authority: text("authority").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "producer_registrations_market_fk",
      columns: [t.storeId, t.marketCode],
      foreignColumns: [markets.storeId, markets.code],
    }),
    index("producer_registrations_market_scheme_idx").on(t.storeId, t.marketCode, t.scheme),
    check(
      "producer_registrations_valid_range",
      sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const inventoryLocations = commerce.table(
  "inventory_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    country: char("country", { length: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("inventory_locations_store_id_key").on(t.storeId, t.id)],
);

const locationRef = (
  name: string,
  cols: { storeId: AnyPgColumn; locationId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.locationId],
    foreignColumns: [inventoryLocations.storeId, inventoryLocations.id],
  });

export const inventoryLevels = commerce.table(
  "inventory_levels",
  {
    storeId: storeId(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    onHand: integer("on_hand").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    variantRef("inventory_levels_variant_fk", t),
    locationRef("inventory_levels_location_fk", t),
    index("inventory_levels_store_variant_idx").on(t.storeId, t.variantId),
    index("inventory_levels_location_idx").on(t.storeId, t.locationId),
    check("inventory_levels_on_hand_non_negative", sql`${t.onHand} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Customers and carts
// ---------------------------------------------------------------------------

export const customers = commerce.table(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** The Supabase Auth user, once the customer has an account. */
    authUserId: uuid("auth_user_id"),
    email: text("email").notNull(),
    locale: text("locale"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customers_store_id_key").on(t.storeId, t.id),
    unique("customers_store_auth_user_key").on(t.storeId, t.authUserId),
    uniqueIndex("customers_store_email_idx").on(t.storeId, sql`lower(${t.email})`),
  ],
);

const customerRef = (
  name: string,
  cols: { storeId: AnyPgColumn; customerId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.customerId],
    foreignColumns: [customers.storeId, customers.id],
  });

export const carts = commerce.table(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    customerId: uuid("customer_id"),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("carts_store_id_key").on(t.storeId, t.id),
    marketRef("carts_market_fk", t),
    customerRef("carts_customer_fk", t),
    index("carts_market_idx").on(t.storeId, t.marketCode, t.currency),
    index("carts_customer_idx").on(t.storeId, t.customerId),
  ],
);

const cartRef = (name: string, cols: { storeId: AnyPgColumn; cartId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.cartId],
    foreignColumns: [carts.storeId, carts.id],
  });

export const cartLines = commerce.table(
  "cart_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    cartId: uuid("cart_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("cart_lines_cart_variant_key").on(t.cartId, t.variantId),
    cartRef("cart_lines_cart_fk", t).onDelete("cascade"),
    variantRef("cart_lines_variant_fk", t),
    index("cart_lines_store_cart_idx").on(t.storeId, t.cartId),
    index("cart_lines_variant_idx").on(t.storeId, t.variantId),
    check("cart_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = commerce.table(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    /** The customer-facing order number, unique within the store. */
    number: text("number").notNull(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    customerId: uuid("customer_id"),
    cartId: uuid("cart_id"),
    email: text("email").notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    subtotalMinor: money("subtotal_minor"),
    shippingMinor: money("shipping_minor").default(0),
    discountMinor: money("discount_minor").default(0),
    /** VAT contained in the total. Prices are VAT-inclusive. */
    taxMinor: money("tax_minor"),
    totalMinor: money("total_minor"),
    billingAddress: jsonb("billing_address").notNull(),
    shippingAddress: jsonb("shipping_address").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the goods reached the customer; starts the withdrawal period. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("orders_store_id_key").on(t.storeId, t.id),
    unique("orders_store_number_key").on(t.storeId, t.number),
    marketRef("orders_market_fk", t),
    customerRef("orders_customer_fk", t),
    cartRef("orders_cart_fk", t),
    index("orders_market_idx").on(t.storeId, t.marketCode, t.currency),
    index("orders_customer_idx").on(t.storeId, t.customerId),
    index("orders_cart_idx").on(t.storeId, t.cartId),
    index("orders_store_placed_idx").on(t.storeId, t.placedAt),
    check(
      "orders_amounts_non_negative",
      sql`${t.subtotalMinor} >= 0 and ${t.shippingMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.taxMinor} >= 0`,
    ),
    check(
      "orders_total_adds_up",
      sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor} - ${t.discountMinor}`,
    ),
    check("orders_tax_within_total", sql`${t.taxMinor} <= ${t.totalMinor}`),
  ],
);

const orderRef = (name: string, cols: { storeId: AnyPgColumn; orderId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.orderId],
    foreignColumns: [orders.storeId, orders.id],
  });

export const orderLines = commerce.table(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    variantId: uuid("variant_id"),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor"),
    discountMinor: money("discount_minor").default(0),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull(),
    taxCode: text("tax_code").notNull(),
    withdrawalExclusion: withdrawalExclusion("withdrawal_exclusion").notNull().default("none"),
  },
  (t) => [
    unique("order_lines_store_id_key").on(t.storeId, t.id),
    orderRef("order_lines_order_fk", t),
    variantRef("order_lines_variant_fk", t),
    index("order_lines_order_idx").on(t.storeId, t.orderId),
    index("order_lines_variant_idx").on(t.storeId, t.variantId),
    check("order_lines_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "order_lines_total_adds_up",
      sql`${t.totalMinor} = ${t.unitPriceMinor} * ${t.quantity} - ${t.discountMinor}`,
    ),
    check(
      "order_lines_amounts_non_negative",
      sql`${t.unitPriceMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.totalMinor} >= 0 and ${t.taxMinor} >= 0`,
    ),
  ],
);

const orderLineRef = (
  name: string,
  cols: { storeId: AnyPgColumn; orderLineId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.orderLineId],
    foreignColumns: [orderLines.storeId, orderLines.id],
  });

/**
 * Stock held for a cart or an unpaid order. Available stock is on-hand minus
 * the reservations that have neither expired nor been released.
 */
export const inventoryReservations = commerce.table(
  "inventory_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull(),
    cartId: uuid("cart_id"),
    orderId: uuid("order_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    variantRef("inventory_reservations_variant_fk", t),
    locationRef("inventory_reservations_location_fk", t),
    cartRef("inventory_reservations_cart_fk", t).onDelete("cascade"),
    orderRef("inventory_reservations_order_fk", t),
    index("inventory_reservations_active_idx")
      .on(t.variantId, t.locationId)
      .where(sql`${t.releasedAt} is null`),
    index("inventory_reservations_variant_idx").on(t.storeId, t.variantId),
    index("inventory_reservations_location_idx").on(t.storeId, t.locationId),
    index("inventory_reservations_cart_idx").on(t.storeId, t.cartId),
    index("inventory_reservations_order_idx").on(t.storeId, t.orderId),
    check("inventory_reservations_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "inventory_reservations_owner",
      sql`${t.cartId} is not null or ${t.orderId} is not null`,
    ),
  ],
);

/** Append-only history of everything that happens to an order. */
export const orderEvents = commerce.table(
  "order_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    orderRef("order_events_order_fk", t),
    index("order_events_order_idx").on(t.storeId, t.orderId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Payments and refunds
// ---------------------------------------------------------------------------

export const payments = commerce.table(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").notNull(),
    /** The provider's id, e.g. a Stripe Checkout Session or PaymentIntent. */
    providerReference: text("provider_reference").notNull(),
    amountMinor: money("amount_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payments_store_id_key").on(t.storeId, t.id),
    unique("payments_provider_reference_key").on(t.storeId, t.provider, t.providerReference),
    orderRef("payments_order_fk", t),
    index("payments_order_idx").on(t.storeId, t.orderId),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const refunds = commerce.table(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    paymentId: uuid("payment_id").notNull(),
    amountMinor: money("amount_minor"),
    reason: text("reason").notNull(),
    providerReference: text("provider_reference"),
    status: refundStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("refunds_store_id_key").on(t.storeId, t.id),
    unique("refunds_provider_reference_key").on(t.storeId, t.providerReference),
    foreignKey({
      name: "refunds_payment_fk",
      columns: [t.storeId, t.paymentId],
      foreignColumns: [payments.storeId, payments.id],
    }),
    index("refunds_payment_idx").on(t.storeId, t.paymentId),
    check("refunds_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Withdrawals and returns
// ---------------------------------------------------------------------------

/**
 * A use of the withdrawal button (Directive (EU) 2023/2673): the legal notice.
 * The physical return of goods is tracked separately in `returns`.
 */
export const withdrawalRequests = commerce.table(
  "withdrawal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    channel: text("channel").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** The second, "confirm withdrawal" step. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** When the acknowledgement was sent on a durable medium. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgementReference: text("acknowledgement_reference"),
  },
  (t) => [
    unique("withdrawal_requests_store_id_key").on(t.storeId, t.id),
    orderRef("withdrawal_requests_order_fk", t),
    index("withdrawal_requests_order_idx").on(t.storeId, t.orderId),
    check(
      "withdrawal_requests_ack_after_confirm",
      sql`${t.acknowledgedAt} is null or ${t.confirmedAt} is not null`,
    ),
  ],
);

export const withdrawalRequestLines = commerce.table(
  "withdrawal_request_lines",
  {
    storeId: storeId(),
    withdrawalRequestId: uuid("withdrawal_request_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.withdrawalRequestId, t.orderLineId] }),
    foreignKey({
      name: "withdrawal_request_lines_request_fk",
      columns: [t.storeId, t.withdrawalRequestId],
      foreignColumns: [withdrawalRequests.storeId, withdrawalRequests.id],
    }).onDelete("cascade"),
    orderLineRef("withdrawal_request_lines_order_line_fk", t),
    index("withdrawal_request_lines_request_idx").on(t.storeId, t.withdrawalRequestId),
    index("withdrawal_request_lines_order_line_idx").on(t.storeId, t.orderLineId),
    check("withdrawal_request_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const returns = commerce.table(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    withdrawalRequestId: uuid("withdrawal_request_id"),
    status: returnStatus("status").notNull().default("requested"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("returns_store_id_key").on(t.storeId, t.id),
    orderRef("returns_order_fk", t),
    foreignKey({
      name: "returns_withdrawal_request_fk",
      columns: [t.storeId, t.withdrawalRequestId],
      foreignColumns: [withdrawalRequests.storeId, withdrawalRequests.id],
    }),
    index("returns_order_idx").on(t.storeId, t.orderId),
    index("returns_withdrawal_request_idx").on(t.storeId, t.withdrawalRequestId),
  ],
);

export const returnLines = commerce.table(
  "return_lines",
  {
    storeId: storeId(),
    returnId: uuid("return_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
    condition: text("condition"),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.orderLineId] }),
    foreignKey({
      name: "return_lines_return_fk",
      columns: [t.storeId, t.returnId],
      foreignColumns: [returns.storeId, returns.id],
    }).onDelete("cascade"),
    orderLineRef("return_lines_order_line_fk", t),
    index("return_lines_return_idx").on(t.storeId, t.returnId),
    index("return_lines_order_line_idx").on(t.storeId, t.orderLineId),
    check("return_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Invoices and credit notes
// ---------------------------------------------------------------------------

/**
 * Counters for legally numbered documents, per store. Postgres sequences can
 * skip numbers, so documents take their number from
 * `commerce.next_document_number`, inside the issuing transaction.
 */
export const documentSeries = commerce.table(
  "document_series",
  {
    storeId: storeId().references(() => stores.id),
    series: text("series").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.series] }),
    check("document_series_next_positive", sql`${t.nextNumber} > 0`),
  ],
);

const seriesRef = (name: string, cols: { storeId: AnyPgColumn; series: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.series],
    foreignColumns: [documentSeries.storeId, documentSeries.series],
  });

export const invoices = commerce.table(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    series: text("series").notNull(),
    number: bigint("number", { mode: "number" }).notNull(),
    documentNumber: text("document_number").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("invoices_store_id_key").on(t.storeId, t.id),
    unique("invoices_series_number_key").on(t.storeId, t.series, t.number),
    unique("invoices_document_number_key").on(t.storeId, t.documentNumber),
    orderRef("invoices_order_fk", t),
    seriesRef("invoices_series_fk", t),
    index("invoices_order_idx").on(t.storeId, t.orderId),
  ],
);

export const creditNotes = commerce.table(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    invoiceId: uuid("invoice_id").notNull(),
    refundId: uuid("refund_id"),
    series: text("series").notNull(),
    number: bigint("number", { mode: "number" }).notNull(),
    documentNumber: text("document_number").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("credit_notes_series_number_key").on(t.storeId, t.series, t.number),
    unique("credit_notes_document_number_key").on(t.storeId, t.documentNumber),
    foreignKey({
      name: "credit_notes_invoice_fk",
      columns: [t.storeId, t.invoiceId],
      foreignColumns: [invoices.storeId, invoices.id],
    }),
    foreignKey({
      name: "credit_notes_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    seriesRef("credit_notes_series_fk", t),
    index("credit_notes_invoice_idx").on(t.storeId, t.invoiceId),
    index("credit_notes_refund_idx").on(t.storeId, t.refundId),
  ],
);

// ---------------------------------------------------------------------------
// Integration plumbing
// ---------------------------------------------------------------------------

/** Makes retried writes (checkout, refunds) safe to repeat. */
export const idempotencyKeys = commerce.table(
  "idempotency_keys",
  {
    storeId: storeId().references(() => stores.id),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("in_progress"),
    response: jsonb("response"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.scope, t.key] })],
);

/** Every inbound webhook, stored before processing and deduplicated. */
export const webhookEvents = commerce.table(
  "webhook_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId().references(() => stores.id),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    unique("webhook_events_provider_event_key").on(t.storeId, t.provider, t.eventId),
    index("webhook_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Payment settings (decision D15), per store
// ---------------------------------------------------------------------------

/** A payment provider the store can use, and which of its modes is live. */
export const paymentProviders = commerce.table(
  "payment_providers",
  {
    storeId: storeId().references(() => stores.id),
    provider: text("provider").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    activeMode: paymentMode("active_mode").notNull().default("test"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.provider] }),
    index("payment_providers_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * API credentials per store, provider and mode. Secrets are encrypted with a
 * key that lives only in the server environment; `*_hint` keeps a masked
 * form such as `sk_test_…4242` for display.
 */
export const paymentCredentials = commerce.table(
  "payment_credentials",
  {
    storeId: storeId(),
    provider: text("provider").notNull(),
    mode: paymentMode("mode").notNull(),
    publishableKey: text("publishable_key"),
    secretKeyCiphertext: text("secret_key_ciphertext"),
    secretKeyHint: text("secret_key_hint"),
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),
    webhookSecretHint: text("webhook_secret_hint"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.provider, t.mode] }),
    foreignKey({
      name: "payment_credentials_provider_fk",
      columns: [t.storeId, t.provider],
      foreignColumns: [paymentProviders.storeId, paymentProviders.provider],
    }),
    index("payment_credentials_updated_by_idx").on(t.updatedBy),
  ],
);

/** Whether a payment method is offered at checkout in a market. */
export const paymentMethods = commerce.table(
  "payment_methods",
  {
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    method: text("method").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.marketCode, t.method] }),
    foreignKey({
      name: "payment_methods_market_fk",
      columns: [t.storeId, t.marketCode],
      foreignColumns: [markets.storeId, markets.code],
    }),
    index("payment_methods_updated_by_idx").on(t.updatedBy),
  ],
);
