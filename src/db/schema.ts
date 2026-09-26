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
  customType,
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
 * How a product variant reaches the shopper: `physical`, shipped (stock,
 * weight, shipping), or `digital`, downloaded after payment (files, no stock,
 * no shipping). Decision D24.
 */
export const delivery = commerce.enum("delivery", ["physical", "digital"]);

/** How often a subscription renews: every `interval_count` weeks, months or years (D25). */
export const planInterval = commerce.enum("plan_interval", ["week", "month", "year"]);

/**
 * A subscription's state, following Stripe's: `pending` until the first
 * payment, `expired` when that checkout was never paid.
 */
export const subscriptionStatus = commerce.enum("subscription_status", [
  "pending",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
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
    /** The owner asked Kaizen for no reminders about plans left unpaid (D33). */
    planRemindersOptedOutAt: timestamp("plan_reminders_opted_out_at", { withTimezone: true }),
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
    /**
     * Search and sharing: home page title and description per locale, share
     * image, social profiles, search engine and AI crawler rules, the
     * store's own llms.txt text. Shape and defaults: `StoreSeo` in lib/seo.
     */
    seo: jsonb("seo").notNull().default({}),
    /**
     * The storefront's logo and header and footer menus (D30). Shape and
     * checks: `StoreNavigation` in lib/navigation.
     */
    navigation: jsonb("navigation").notNull().default({}),
    /** Reminder emails about carts left at checkout (D33), on only when the store turns them on. */
    cartReminders: boolean("cart_reminders").notNull().default(false),
    /**
     * One of the store's own pages shown as its front page in every market
     * (D54), instead of the product list. Null for the product list. The
     * foreign key to `pages (store_id, id)` is in the `store_front_page_rules`
     * migration: deleting the page sets only this column back to null.
     */
    frontPageId: uuid("front_page_id"),
    /** The store's analytics and marketing tools (D58), loaded only with consent: `TrackingSettings` in lib/cookie-consent. */
    tracking: jsonb("tracking").notNull().default({}),
    /** The owner's own code for the storefront's head and body (D61): `CustomCode` in lib/custom-code, added only on the store's own host. */
    customCode: jsonb("custom_code").notNull().default({}),
    /** Before themes (D60), the store's fonts (D59); now in `theme`. Kept until the code no longer reads it. */
    fonts: jsonb("fonts").notNull().default({}),
    /** The storefront's design (D60): `StoreTheme` in lib/theme, its template, the saved theme it came from and every setting. */
    theme: jsonb("theme").notNull().default({}),
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
      sql`${t.slug} not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'stores', 'support', 'www')`,
    ),
    uniqueIndex("stores_one_template_idx").on(t.isTemplate).where(sql`${t.isTemplate}`),
    index("stores_created_by_idx").on(t.createdBy),
    index("stores_country_idx").on(t.country),
    index("stores_front_page_idx").on(t.id, t.frontPageId),
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

/** Kaizen's own settings: a single row. */
export const platformSettings = commerce.table(
  "platform_settings",
  {
    id: boolean("id").primaryKey().default(true),
    /** Kaizen's fee on each storefront sale, in basis points (100 = 1 %). */
    saleFeeBps: integer("sale_fee_bps").notNull().default(0),
    /** Search and sharing for Kaizen's own pages (`StoreSeo` in lib/seo, locale `en`). */
    seo: jsonb("seo").notNull().default({}),
    /**
     * Where shoppers pay: `custom`, Kaizen's own checkout page with Stripe's
     * payment form, or `hosted`, Stripe's checkout page (the fallback).
     */
    checkoutUi: text("checkout_ui").notNull().default("custom"),
    /** Reminders to store owners who started paying for a plan and did not finish (D33). */
    planReminders: boolean("plan_reminders").notNull().default(false),
    /** Kaizen's own header and footer (D42): logo and menus. Shape: `PlatformNavigation` in lib/navigation. */
    navigation: jsonb("navigation").notNull().default({}),
    /** Who runs Kaizen, shown in the footer of its pages (D42): `BusinessDetails` in lib/navigation. */
    business: jsonb("business").notNull().default({}),
    /** Kaizen's own analytics and marketing tools (D58), loaded only with consent: `TrackingSettings` in lib/cookie-consent. */
    tracking: jsonb("tracking").notNull().default({}),
    /** Heading and body fonts from Google Fonts, self-hosted (D59). */
    fonts: jsonb("fonts").notNull().default({}),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    check("platform_settings_single_row", sql`${t.id}`),
    check("platform_settings_sale_fee_range", sql`${t.saleFeeBps} between 0 and 2000`),
    check("platform_settings_checkout_ui", sql`${t.checkoutUi} in ('custom', 'hosted')`),
    index("platform_settings_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * Kaizen's webhooks in its own Stripe account, per mode: `snapshot` for
 * payment events from stores' accounts, `thin` for account (v2) events,
 * `billing` for Kaizen's own subscriptions to stores.
 * The signing secret is encrypted like store payment secrets.
 */
export const platformWebhooks = commerce.table(
  "platform_webhooks",
  {
    provider: text("provider").notNull(),
    mode: paymentMode("mode").notNull(),
    kind: text("kind").notNull(),
    endpointId: text("endpoint_id").notNull(),
    url: text("url").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.mode, t.kind] }),
    check("platform_webhooks_kind", sql`${t.kind} in ('snapshot', 'thin', 'billing')`),
    index("platform_webhooks_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * A plan Kaizen sells to stores (decision D18): a monthly or yearly price and
 * Kaizen's fee on each of the store's sales. Plans are archived, never
 * deleted, so stores on an old plan keep it.
 */
export const plans = commerce.table(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Kaizen's fee on each storefront sale, in basis points (100 = 1 %). */
    saleFeeBps: integer("sale_fee_bps").notNull().default(0),
    /** Order on the plans page, lowest tier first. */
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    check("plans_sale_fee_range", sql`${t.saleFeeBps} between 0 and 2000`),
    check("plans_name_present", sql`length(trim(${t.name})) > 0`),
    index("plans_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * A plan's price in one currency and billing interval, excluding VAT. Prices
 * never change: a new amount is a new row, and the old one is switched off
 * (stores already on it keep it until moved).
 */
export const planPrices = commerce.table(
  "plan_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    currency: char("currency", { length: 3 }).notNull(),
    interval: text("interval").notNull(),
    amountMinor: money("amount_minor"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("plan_prices_interval", sql`${t.interval} in ('month', 'year')`),
    check("plan_prices_amount", sql`${t.amountMinor} >= 0`),
    uniqueIndex("plan_prices_one_active")
      .on(t.planId, t.currency, t.interval)
      .where(sql`${t.active}`),
    index("plan_prices_plan_idx").on(t.planId),
  ],
);

/**
 * What Kaizen has created in its own Stripe account, per mode: a Stripe
 * Product per plan, a Price per plan price, the VAT rate and the customer
 * portal settings. `error` keeps the last failure so it can be shown.
 */
export const stripeSync = commerce.table(
  "stripe_sync",
  {
    mode: paymentMode("mode").notNull(),
    kind: text("kind").notNull(),
    localId: text("local_id").notNull(),
    stripeId: text("stripe_id"),
    /** Switched off in Stripe (a price that is no longer offered). */
    archived: boolean("archived").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    error: text("error"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.mode, t.kind, t.localId] }),
    check(
      "stripe_sync_kind",
      sql`${t.kind} in ('product', 'price', 'tax_rate', 'portal', 'coupon', 'promotion_code')`,
    ),
    index("stripe_sync_stripe_id_idx").on(t.mode, t.stripeId),
  ],
);

/**
 * Kaizen's discount codes for stores' plans (D31), kept in Stripe as a
 * coupon and a promotion code in each mode. What a code gives cannot change
 * once made (Stripe's coupons cannot); it can be switched off.
 */
export const platformDiscountCodes = commerce.table(
  "platform_discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    kind: text("kind").notNull(),
    percent: integer("percent").notNull().default(0),
    /** Amount off per plan currency, lower-case, in minor units: `{"nok": 10000}`. */
    amounts: jsonb("amounts").notNull().default({}),
    duration: text("duration").notNull(),
    durationMonths: integer("duration_months"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxRedemptions: integer("max_redemptions"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    /** Changes when what the code gives changes, and with it the coupon in Stripe. */
    updatedAt: updatedAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    check("platform_discount_codes_kind", sql`${t.kind} in ('percent', 'fixed')`),
    check(
      "platform_discount_codes_percent",
      sql`(${t.kind} = 'percent' and ${t.percent} between 1 and 100) or (${t.kind} = 'fixed' and ${t.percent} = 0)`,
    ),
    check("platform_discount_codes_duration", sql`${t.duration} in ('once', 'repeating', 'forever')`),
    check(
      "platform_discount_codes_months",
      sql`(${t.duration} = 'repeating') = (${t.durationMonths} is not null)`,
    ),
    index("platform_discount_codes_created_by_idx").on(t.createdBy),
  ],
);

/**
 * A store's plan with Kaizen: its Stripe subscription (on Kaizen's account,
 * with the store's own Stripe account as the customer) as last reported by
 * Stripe, and an optional fee that overrides the plan's.
 */
export const storeBilling = commerce.table(
  "store_billing",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    planId: uuid("plan_id").references(() => plans.id),
    priceId: uuid("price_id").references(() => planPrices.id),
    mode: paymentMode("mode"),
    subscriptionId: text("subscription_id"),
    /** Stripe's subscription status: trialing, active, past_due, canceled, … */
    status: text("status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    saleFeeBpsOverride: integer("sale_fee_bps_override"),
    /** Kaizen's discount code on the plan, while Stripe still applies it (D31). */
    platformDiscountId: uuid("platform_discount_id").references(() => platformDiscountCodes.id, {
      onDelete: "set null",
    }),
    discountAppliedAt: timestamp("discount_applied_at", { withTimezone: true }),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("store_billing_subscription_key").on(t.mode, t.subscriptionId),
    check(
      "store_billing_fee_range",
      sql`${t.saleFeeBpsOverride} is null or ${t.saleFeeBpsOverride} between 0 and 2000`,
    ),
    index("store_billing_plan_idx").on(t.planId),
    index("store_billing_price_idx").on(t.priceId),
    index("store_billing_platform_discount_idx").on(t.platformDiscountId),
    index("store_billing_updated_by_idx").on(t.updatedBy),
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
    /** How new variants are delivered; each variant can differ (D24). */
    delivery: delivery("delivery").notNull().default("physical"),
    /** Digital variants: times each file can be downloaded per order (null: no limit). */
    downloadLimit: integer("download_limit"),
    /** Digital variants: days the download links work after payment (null: no end). */
    downloadDays: integer("download_days"),
    /** Sold only through its purchase options (selling plans), never once (D25). */
    subscriptionOnly: boolean("subscription_only").notNull().default(false),
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
    check("products_download_limit_positive", sql`${t.downloadLimit} > 0`),
    check("products_download_days_positive", sql`${t.downloadDays} > 0`),
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
    /** Title and description for search results and shares; empty uses the listing's own. */
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
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

/**
 * A file shoppers download after buying a digital variant (D24), kept in the
 * private `digital-files` bucket. Removing a file from the product keeps the
 * row, so earlier buyers can still download what they paid for.
 */
export const productFiles = commerce.table(
  "product_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    /** Null: delivered with every digital variant of the product. */
    variantId: uuid("variant_id"),
    /** The file name shoppers see. */
    name: text("name").notNull(),
    /** Object path in the `digital-files` bucket: `{store}/{uuid}/{name}`. */
    path: text("path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    position: integer("position").notNull().default(0),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("product_files_store_id_key").on(t.storeId, t.id),
    unique("product_files_path_key").on(t.path),
    productRef("product_files_product_fk", t),
    index("product_files_product_idx").on(t.storeId, t.productId, t.position),
    index("product_files_variant_idx").on(t.storeId, t.variantId),
    check("product_files_size_positive", sql`${t.sizeBytes} > 0`),
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
    /** Shipped, or downloaded after payment (D24). Digital variants have no stock. */
    delivery: delivery("delivery").notNull().default("physical"),
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

/**
 * A purchase option for subscribing to a product (D25), as Shopify's selling
 * plans and WooCommerce's subscription options: how often it renews and the
 * subscriber's discount. Options in use are switched off, never deleted.
 */
export const sellingPlans = commerce.table(
  "selling_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    interval: planInterval("interval").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    /** Whole percent off the one-time price, 0 for none. */
    discountPercent: integer("discount_percent").notNull().default(0),
    /** Days free before the first charge for what renews (D29). */
    trialDays: integer("trial_days").notNull().default(0),
    /** A one-time fee when subscribing, in minor units per market: `{"NO": 4900}` (D29). */
    signupFee: jsonb("signup_fee").notNull().default({}),
    /** Payments the subscriber commits to, the first included; 0 for none (D29). */
    minCycles: integer("min_cycles").notNull().default(0),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("selling_plans_store_id_key").on(t.storeId, t.id),
    productRef("selling_plans_product_fk", t),
    index("selling_plans_product_idx").on(t.storeId, t.productId, t.position),
    // Stripe renews at most every three years.
    check(
      "selling_plans_interval_count",
      sql`(${t.interval} = 'week' and ${t.intervalCount} between 1 and 52)
        or (${t.interval} = 'month' and ${t.intervalCount} between 1 and 12)
        or (${t.interval} = 'year' and ${t.intervalCount} between 1 and 3)`,
    ),
    check("selling_plans_discount_percent", sql`${t.discountPercent} between 0 and 90`),
    check("selling_plans_trial_days", sql`${t.trialDays} between 0 and 90`),
    check("selling_plans_min_cycles", sql`${t.minCycles} between 0 and 24`),
  ],
);

const sellingPlanRef = (name: string, cols: { storeId: AnyPgColumn; sellingPlanId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.sellingPlanId],
    foreignColumns: [sellingPlans.storeId, sellingPlans.id],
  });

/**
 * A store's discount code (D31): a percentage, a fixed amount per market or
 * free shipping, for everything or some products, with optional dates,
 * minimum order and limits. Codes that have been used are switched off,
 * never deleted, so orders keep what they got.
 */
export const discountCodes = commerce.table(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    /** In capitals; shoppers may type it in any case. */
    code: text("code").notNull(),
    kind: text("kind").notNull(),
    percent: integer("percent").notNull().default(0),
    /** Amount off per market, in minor units, for `fixed`: `{"NO": 5000}`. */
    amounts: jsonb("amounts").notNull().default({}),
    /** Least order per market, in minor units; a missing market has none. */
    minSubtotals: jsonb("min_subtotals").notNull().default({}),
    /** Product ids it applies to; null for every product. */
    productIds: jsonb("product_ids"),
    /** A percentage that also lowers every renewal of a subscription. */
    recurring: boolean("recurring").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    oncePerCustomer: boolean("once_per_customer").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("discount_codes_store_id_key").on(t.storeId, t.id),
    unique("discount_codes_store_code_key").on(t.storeId, t.code),
    check("discount_codes_kind", sql`${t.kind} in ('percent', 'fixed', 'free_shipping')`),
    check(
      "discount_codes_percent",
      sql`(${t.kind} = 'percent' and ${t.percent} between 1 and 100) or (${t.kind} <> 'percent' and ${t.percent} = 0)`,
    ),
    check("discount_codes_recurring", sql`not ${t.recurring} or ${t.kind} = 'percent'`),
    check("discount_codes_usage_limit", sql`${t.usageLimit} is null or ${t.usageLimit} > 0`),
    check("discount_codes_dates", sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`),
  ],
);

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
    /** My account (D28): the customer's own details, all optional. */
    name: text("name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: jsonb("address").notNull().default({}),
    /** scrypt hash, when the customer has chosen a password; sign-in by emailed code always works. */
    passwordHash: text("password_hash"),
    failedSignIns: integer("failed_sign_ins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    /**
     * When the customer proved the email is theirs, with an emailed code
     * (D32). Until then, only orders placed while signed in join the
     * account: someone who registers another person's email sees nothing
     * of theirs.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_store_id_key").on(t.storeId, t.id),
    unique("customers_store_auth_user_key").on(t.storeId, t.authUserId),
    uniqueIndex("customers_store_email_idx").on(t.storeId, sql`lower(${t.email})`),
  ],
);

/**
 * A signed-in customer's browser (D28). The cookie holds a random token;
 * only its SHA-256 is kept, so the table cannot be used to sign in.
 */
export const customerSessions = commerce.table(
  "customer_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    customerId: uuid("customer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "customer_sessions_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    index("customer_sessions_customer_idx").on(t.storeId, t.customerId),
  ],
);

/**
 * A sign-in code emailed to a customer (D28): six digits, kept only as a
 * hash, valid for ten minutes and five tries.
 */
export const customerCodes = commerce.table(
  "customer_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("customer_codes_email_idx").on(t.storeId, sql`lower(${t.email})`, t.createdAt)],
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
    /** The discount code the shopper entered (D31), checked again at checkout. */
    discountCode: text("discount_code"),
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
    /** Bought as a subscription with this purchase option; null for once (D25). */
    sellingPlanId: uuid("selling_plan_id"),
  },
  (t) => [
    unique("cart_lines_cart_variant_plan_key").on(t.cartId, t.variantId, t.sellingPlanId).nullsNotDistinct(),
    sellingPlanRef("cart_lines_selling_plan_fk", t),
    index("cart_lines_selling_plan_idx").on(t.storeId, t.sellingPlanId),
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
    /**
     * When the shopper asked for digital content to be delivered at once and
     * acknowledged losing the right of withdrawal for it (CRD Art. 16(m),
     * angrerettloven § 22 n). Null when the order has no such content.
     */
    digitalConsentAt: timestamp("digital_consent_at", { withTimezone: true }),
    /** When the goods reached the customer; starts the withdrawal period. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** The subscription this order started or renewed (D25). */
    subscriptionId: uuid("subscription_id"),
    /** The discount code used, and its text as the shopper saw it (D31). */
    discountCodeId: uuid("discount_code_id"),
    discountCode: text("discount_code"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("orders_store_id_key").on(t.storeId, t.id),
    index("orders_discount_code_idx").on(t.storeId, t.discountCodeId),
    foreignKey({
      name: "orders_discount_code_fk",
      columns: [t.storeId, t.discountCodeId],
      foreignColumns: [discountCodes.storeId, discountCodes.id],
    }),
    index("orders_subscription_idx").on(t.storeId, t.subscriptionId),
    unique("orders_store_number_key").on(t.storeId, t.number),
    marketRef("orders_market_fk", t),
    customerRef("orders_customer_fk", t),
    cartRef("orders_cart_fk", t),
    index("orders_market_idx").on(t.storeId, t.marketCode, t.currency),
    index("orders_customer_idx").on(t.storeId, t.customerId),
    index("orders_cart_idx").on(t.storeId, t.cartId),
    index("orders_store_placed_idx").on(t.storeId, t.placedAt),
    index("orders_email_idx").on(t.storeId, sql`lower(${t.email})`),
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

/**
 * A shopper who chose a password at checkout (D32): the account is opened
 * once the order is paid, with the email the shopper paid with, unless
 * that email already has an account or earlier purchases, in which case
 * they are asked to reset the password instead. The password's hash is
 * dropped once the order is paid.
 */
export const checkoutAccounts = commerce.table(
  "checkout_accounts",
  {
    orderId: uuid("order_id").primaryKey(),
    storeId: storeId(),
    passwordHash: text("password_hash"),
    /** `created`, or `known` when the email already had an account or purchases. */
    outcome: text("outcome"),
    customerId: uuid("customer_id"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** The one sign-in straight from the order page. */
    signedInAt: timestamp("signed_in_at", { withTimezone: true }),
  },
  (t) => [
    orderRef("checkout_accounts_order_fk", t).onDelete("cascade"),
    foreignKey({
      name: "checkout_accounts_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    check("checkout_accounts_outcome", sql`${t.outcome} in ('created', 'known')`),
  ],
);

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
    /** How the line is delivered, as sold. */
    delivery: delivery("delivery").notNull().default("physical"),
    /** A subscription line: the purchase option and how often it renews, as sold (D25). */
    sellingPlanId: uuid("selling_plan_id"),
    planInterval: planInterval("plan_interval"),
    planIntervalCount: integer("plan_interval_count"),
  },
  (t) => [
    unique("order_lines_store_id_key").on(t.storeId, t.id),
    sellingPlanRef("order_lines_selling_plan_fk", t),
    index("order_lines_selling_plan_idx").on(t.storeId, t.sellingPlanId),
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

/**
 * A shopper's subscription (D25): what is sent or made available each time
 * it renews, at the price agreed when it started. Stripe Billing on the
 * store's own account charges it; each paid renewal becomes an order.
 */
export const subscriptions = commerce.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    /** Shown to shoppers and staff: the first order's number. */
    number: text("number").notNull(),
    status: subscriptionStatus("status").notNull().default("pending"),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    email: text("email").notNull().default(""),
    shippingAddress: jsonb("shipping_address").notNull().default({}),
    interval: planInterval("interval").notNull(),
    intervalCount: integer("interval_count").notNull(),
    /** Each renewal: the items, shipping, total and the VAT in it. */
    subtotalMinor: money("subtotal_minor"),
    shippingMinor: money("shipping_minor").default(0),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    firstOrderId: uuid("first_order_id").notNull(),
    /** The Stripe subscription, on the store's account. */
    provider: text("provider").notNull().default("stripe"),
    providerReference: text("provider_reference"),
    providerAccount: text("provider_account"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** The free trial, until the first charge for what renews (D29). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Payments committed to, the first included (D29). */
    minCycles: integer("min_cycles").notNull().default(0),
    /** Charges and deliveries are paused until then (D29). */
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    /** When the subscription will end, if a cancellation waits for the commitment (D29). */
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    /** The charge date the last reminder email was for (D29). */
    remindedFor: timestamp("reminded_for", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** The secret in the shopper's link to see and cancel the subscription. */
    manageToken: text("manage_token").notNull().unique(),
    /** The customer's account, found by the order's email (D28). */
    customerId: uuid("customer_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("subscriptions_store_id_key").on(t.storeId, t.id),
    customerRef("subscriptions_customer_fk", t),
    index("subscriptions_customer_idx").on(t.storeId, t.customerId),
    unique("subscriptions_store_reference_key").on(t.storeId, t.provider, t.providerReference),
    orderRef("subscriptions_first_order_fk", { storeId: t.storeId, orderId: t.firstOrderId }),
    index("subscriptions_first_order_idx").on(t.storeId, t.firstOrderId),
    index("subscriptions_store_status_idx").on(t.storeId, t.status),
    check("subscriptions_interval_count_positive", sql`${t.intervalCount} > 0`),
    check("subscriptions_total_adds_up", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor}`),
    check(
      "subscriptions_amounts_non_negative",
      sql`${t.subtotalMinor} >= 0 and ${t.shippingMinor} >= 0 and ${t.taxMinor} >= 0`,
    ),
  ],
);

/** What each renewal of a subscription contains, as agreed at the start. */
export const subscriptionLines = commerce.table(
  "subscription_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    subscriptionId: uuid("subscription_id").notNull(),
    variantId: uuid("variant_id"),
    sellingPlanId: uuid("selling_plan_id"),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor"),
    totalMinor: money("total_minor"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull(),
    taxCode: text("tax_code").notNull(),
    delivery: delivery("delivery").notNull().default("physical"),
  },
  (t) => [
    foreignKey({
      name: "subscription_lines_subscription_fk",
      columns: [t.storeId, t.subscriptionId],
      foreignColumns: [subscriptions.storeId, subscriptions.id],
    }).onDelete("cascade"),
    variantRef("subscription_lines_variant_fk", t),
    sellingPlanRef("subscription_lines_selling_plan_fk", t),
    index("subscription_lines_subscription_idx").on(t.storeId, t.subscriptionId),
    index("subscription_lines_variant_idx").on(t.storeId, t.variantId),
    index("subscription_lines_selling_plan_idx").on(t.storeId, t.sellingPlanId),
    check("subscription_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("subscription_lines_total_adds_up", sql`${t.totalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
  ],
);

/** `delivered`, `bounced` and `complained` come later, from the email service's events (D32). */
export const emailStatus = commerce.enum("email_status", [
  "queued",
  "sent",
  "failed",
  "logged",
  "delivered",
  "bounced",
  "complained",
]);

/**
 * Every email Kaizen sends (D26), kept as sent: to whom, why and what it
 * said. `logged` means no email service was configured, so it was only
 * recorded. The key stops one event sending the same email twice.
 */
export const emailMessages = commerce.table(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own emails. */
    storeId: uuid("store_id").references(() => stores.id),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    status: emailStatus("status").notNull().default("queued"),
    providerReference: text("provider_reference"),
    error: text("error"),
    orderId: uuid("order_id"),
    subscriptionId: uuid("subscription_id"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_messages_idempotency_idx").on(t.idempotencyKey),
    index("email_messages_store_created_idx").on(t.storeId, t.createdAt),
    index("email_messages_order_idx").on(t.storeId, t.orderId),
    index("email_messages_subscription_idx").on(t.storeId, t.subscriptionId),
    index("email_messages_provider_idx").on(t.providerReference),
  ],
);

/**
 * A paid order's download link for one file (D24). The token is the secret
 * in the link; limits come from the product when the order is paid.
 */
export const orderDownloads = commerce.table(
  "order_downloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    fileId: uuid("file_id").notNull(),
    token: text("token").notNull().unique(),
    downloads: integer("downloads").notNull().default(0),
    maxDownloads: integer("max_downloads"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    orderRef("order_downloads_order_fk", t),
    foreignKey({
      name: "order_downloads_file_fk",
      columns: [t.storeId, t.fileId],
      foreignColumns: [productFiles.storeId, productFiles.id],
    }),
    unique("order_downloads_order_file_key").on(t.orderId, t.fileId),
    index("order_downloads_order_idx").on(t.storeId, t.orderId),
    index("order_downloads_file_idx").on(t.storeId, t.fileId),
    check("order_downloads_count_non_negative", sql`${t.downloads} >= 0`),
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
    /** The store's connected Stripe account the payment was taken on (Connect). */
    providerAccount: text("provider_account"),
    /**
     * For Kaizen's own checkout page: the Checkout Session's client secret,
     * which the shopper's browser needs to show Stripe's payment form. Only
     * this shopper's page is given it; it cannot move money on its own.
     */
    clientSecret: text("client_secret"),
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
    /** What went back into stock with it: `[{ "sku": …, "quantity": … }]` (D27). */
    restocked: jsonb("restocked").notNull().default([]),
    /** The staff member who refunded; null for refunds made in Stripe. */
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("refunds_store_id_key").on(t.storeId, t.id),
    index("refunds_created_by_idx").on(t.createdBy),
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

/**
 * A parcel sent for an order (D27): the carrier and tracking number shoppers
 * get by email. Sending one marks the order as sent.
 */
export const shipments = commerce.table(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    carrier: text("carrier").notNull().default(""),
    trackingNumber: text("tracking_number").notNull().default(""),
    trackingUrl: text("tracking_url"),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    orderRef("shipments_order_fk", t),
    index("shipments_order_idx").on(t.storeId, t.orderId),
    index("shipments_created_by_idx").on(t.createdBy),
    check("shipments_tracking_url", sql`${t.trackingUrl} ~ '^https://'`),
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
    /** On from the start: new stores take test payments with no setup (D20). */
    enabled: boolean("enabled").notNull().default(true),
    activeMode: paymentMode("active_mode").notNull().default("test"),
    /** Stripe emails an invoice PDF with each order (Stripe Invoicing fees apply). */
    orderInvoices: boolean("order_invoices").notNull().default(false),
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

/**
 * The store's own Stripe account on Kaizen's Connect platform, per mode
 * (decision D17). The store is the seller: payments are direct charges on
 * this account. Status is copied from Stripe so pages need not ask it.
 */
export const stripeAccounts = commerce.table(
  "stripe_accounts",
  {
    storeId: storeId().references(() => stores.id),
    mode: paymentMode("mode").notNull(),
    accountId: text("account_id").notNull(),
    /** Stripe's status for the card_payments capability: active, pending, restricted, … */
    cardPayments: text("card_payments").notNull().default("inactive"),
    /** Stripe needs more information now (currently or past due). */
    requirementsDue: boolean("requirements_due").notNull().default(true),
    /** Created and filled in by Kaizen with Stripe's test values (test mode, D20). */
    managedByKaizen: boolean("managed_by_kaizen").notNull().default(false),
    /**
     * What Stripe still wants, as last reported: field descriptions, who must
     * act, deadlines and error codes. No personal data.
     */
    requirements: jsonb("requirements").notNull().default([]),
    /**
     * Web domains registered on this account for payment methods that need
     * it on Kaizen's checkout page (Apple Pay, Google Pay, Link, Klarna).
     */
    paymentDomains: text("payment_domains").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Payment method capabilities Kaizen has asked Stripe for on this account
     * (card payments, Klarna, Link, MobilePay, D23). Stripe and the store's
     * own settings decide what is then offered.
     */
    paymentMethodsRequested: text("payment_methods_requested").array().notNull().default(sql`'{}'::text[]`),
    /** Kaizen has switched its payment methods on in this (Kaizen-made test) account's display settings. */
    paymentMethodsShown: boolean("payment_methods_shown").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.mode] }),
    unique("stripe_accounts_account_key").on(t.mode, t.accountId),
    index("stripe_accounts_created_by_idx").on(t.createdBy),
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

/**
 * A step in a store's reminders about carts left at checkout (D33): sent
 * this long after the shopper typed their email, in each of the store's
 * languages, optionally with a discount code. Steps go in order of delay.
 */
export const cartReminderSteps = commerce.table(
  "cart_reminder_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    delayMinutes: integer("delay_minutes").notNull(),
    active: boolean("active").notNull().default(true),
    discountCodeId: uuid("discount_code_id"),
    /** Per locale: `{"nb-NO": {subject, heading, body, button}}`. */
    content: jsonb("content").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("cart_reminder_steps_store_id_key").on(t.storeId, t.id),
    index("cart_reminder_steps_store_idx").on(t.storeId, t.delayMinutes),
    check("cart_reminder_steps_delay", sql`${t.delayMinutes} between 30 and 43200`),
  ],
);

/**
 * A checkout a shopper who is not signed in gave their email for (D33):
 * the cart as it was, for the reminders, until it is paid, the shopper
 * opts out, or it grows old. Opting out erases the email and the cart.
 */
export const abandonedCheckouts = commerce.table(
  "abandoned_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    cartId: uuid("cart_id").notNull(),
    orderId: uuid("order_id"),
    email: text("email"),
    marketCode: char("market_code", { length: 2 }).notNull(),
    locale: text("locale").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** The cart as shown in the reminders: `[{variantId, sellingPlanId, title, quantity, unitPriceMinor}]`. */
    lines: jsonb("lines").notNull().default([]),
    subtotalMinor: money("subtotal_minor").default(0),
    /** The secret in the reminder's links: back to the cart, and to stop the reminders. */
    token: text("token").notNull().unique(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    /** The delay of the last step sent; the next step is the next longer one. */
    lastDelayMinutes: integer("last_delay_minutes").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    recoveredOrderId: uuid("recovered_order_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("abandoned_checkouts_cart_key").on(t.storeId, t.cartId),
    index("abandoned_checkouts_due_idx")
      .on(t.capturedAt)
      .where(sql`${t.recoveredAt} is null and ${t.optedOutAt} is null and ${t.email} is not null`),
    index("abandoned_checkouts_email_idx").on(t.storeId, sql`lower(${t.email})`),
    index("abandoned_checkouts_store_idx").on(t.storeId, t.createdAt),
  ],
);

/** Emails that asked a store for no reminders (D33), from checkout or an email's link. */
export const emailOptOuts = commerce.table(
  "email_opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    email: text("email").notNull(),
    /** `checkout` or `unsubscribe`. */
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_opt_outs_email_idx").on(t.storeId, sql`lower(${t.email})`)],
);

/** A step in Kaizen's reminders to owners who left a plan unpaid (D33); like a store's cart reminders. */
export const planReminderSteps = commerce.table(
  "plan_reminder_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    delayMinutes: integer("delay_minutes").notNull(),
    active: boolean("active").notNull().default(true),
    platformDiscountId: uuid("platform_discount_id").references(() => platformDiscountCodes.id, { onDelete: "set null" }),
    /** Per locale: `{"en": {subject, heading, body, button}}`. */
    content: jsonb("content").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("plan_reminder_steps_delay_idx").on(t.delayMinutes),
    check("plan_reminder_steps_delay", sql`${t.delayMinutes} between 30 and 43200`),
  ],
);

/**
 * An owner who went to pay for a plan (D33): the latest attempt per store,
 * until the store is on a plan, the owner opts out, or it grows old.
 */
export const abandonedPlanCheckouts = commerce.table(
  "abandoned_plan_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .unique()
      .references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email"),
    priceId: uuid("price_id").references(() => planPrices.id, { onDelete: "set null" }),
    planName: text("plan_name").notNull(),
    amountMinor: money("amount_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    interval: text("interval").notNull(),
    token: text("token").notNull().unique(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastDelayMinutes: integer("last_delay_minutes").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("abandoned_plan_checkouts_due_idx")
      .on(t.capturedAt)
      .where(sql`${t.recoveredAt} is null and ${t.optedOutAt} is null and ${t.email} is not null`),
    index("abandoned_plan_checkouts_account_idx").on(t.accountId),
    index("abandoned_plan_checkouts_price_idx").on(t.priceId),
  ],
);

/**
 * A shopper's wishlist in a store (D34): a signed-in customer's, or, for a
 * shopper not signed in, this browser's (the hash of a token in a cookie),
 * which joins the account at sign-in. A shopper can keep several.
 */
export const wishlists = commerce.table(
  "wishlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    customerId: uuid("customer_id"),
    browserTokenHash: text("browser_token_hash"),
    name: text("name").notNull(),
    /** Whether items stay in the list once added to the cart (the shopper chooses). */
    keepAfterCart: boolean("keep_after_cart").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("wishlists_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "wishlists_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    index("wishlists_customer_idx").on(t.storeId, t.customerId),
    index("wishlists_browser_idx").on(t.storeId, t.browserTokenHash),
    check("wishlists_owner", sql`${t.customerId} is not null or ${t.browserTokenHash} is not null`),
    check("wishlists_name", sql`length(${t.name}) between 1 and 60`),
  ],
);

/** A product in a wishlist, with the variant and quantity to add to the cart. */
export const wishlistItems = commerce.table(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    wishlistId: uuid("wishlist_id").notNull(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    quantity: integer("quantity").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "wishlist_items_wishlist_fk",
      columns: [t.storeId, t.wishlistId],
      foreignColumns: [wishlists.storeId, wishlists.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "wishlist_items_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete("cascade"),
    unique("wishlist_items_product_key").on(t.wishlistId, t.productId),
    index("wishlist_items_product_idx").on(t.storeId, t.productId),
    index("wishlist_items_variant_idx").on(t.variantId),
    check("wishlist_items_quantity", sql`${t.quantity} between 1 and 99`),
  ],
);

/**
 * A store's places (D40): its office, and any shops and pickup points,
 * each with an address and, if it has them, opening hours (see
 * lib/opening-hours: the usual week, seasons and single dates).
 */
export const storeLocations = commerce.table(
  "store_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** `office` (at most one), `shop` or `pickup`. */
    kind: text("kind").notNull(),
    name: text("name").notNull().default(""),
    street: text("street").notNull(),
    postalCode: text("postal_code").notNull(),
    city: text("city").notNull(),
    country: char("country", { length: 2 }).notNull(),
    phone: text("phone").notNull().default(""),
    /** How to find it, where to park, what to bring: shown with the address. */
    notes: text("notes").notNull().default(""),
    hours: jsonb("hours"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("store_locations_store_id_key").on(t.storeId, t.id),
    uniqueIndex("store_locations_one_office").on(t.storeId).where(sql`${t.kind} = 'office'`),
    index("store_locations_store_idx").on(t.storeId, t.kind, t.position),
    check("store_locations_kind", sql`${t.kind} in ('office', 'shop', 'pickup')`),
    check("store_locations_named", sql`${t.kind} = 'office' or length(trim(${t.name})) > 0`),
  ],
);

/**
 * A store's connection to an automation service (D41): Zapier or Make.
 * Kaizen sends the store's events it asks for to its webhook address,
 * which is kept encrypted (it is all a sender needs).
 */
export const storeIntegrations = commerce.table(
  "store_integrations",
  {
    storeId: storeId().references(() => stores.id),
    /** `zapier` or `make`. */
    provider: text("provider").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    webhookUrlEncrypted: text("webhook_url_encrypted").notNull(),
    /** Where the address points, shown to staff: e.g. `hooks.zapier.com/…/abc1`. */
    webhookHint: text("webhook_hint").notNull(),
    events: text("events").array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.provider] }),
    index("store_integrations_updated_by_idx").on(t.updatedBy),
    check("store_integrations_provider", sql`${t.provider} in ('zapier', 'make')`),
  ],
);

/**
 * One event on its way to an integration (D41): queued by the database as
 * the event happens, its content built and sent by Kaizen, and tried again
 * later when the service does not take it. Kept 30 days.
 */
export const integrationDeliveries = commerce.table(
  "integration_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    provider: text("provider").notNull(),
    /** `order.paid`, `order.sent`, `customer.created`, … or `test`. */
    event: text("event").notNull(),
    /** The order, customer or subscription it is about. */
    subjectId: uuid("subject_id"),
    /** What was sent, built at the first try and sent the same on every retry. */
    payload: jsonb("payload"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("integration_deliveries_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
    index("integration_deliveries_store_idx").on(t.storeId, t.provider, t.createdAt),
    check("integration_deliveries_status", sql`${t.status} in ('pending', 'delivered', 'failed')`),
  ],
);

/**
 * An item a shopper put in the cart from a wishlist (D36), written with the
 * cart line. Whether it was then bought is read from the order the cart
 * became. The list's name, the product's title and the price are kept as
 * they were, so the record outlives the list, the product and the account.
 */
export const wishlistCartAdds = commerce.table(
  "wishlist_cart_adds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    /** Set null (only this column) when the list is deleted: see the rules migration. */
    wishlistId: uuid("wishlist_id"),
    wishlistName: text("wishlist_name").notNull(),
    /** The signed-in shopper, if any; set null when the account is deleted. */
    customerId: uuid("customer_id"),
    cartId: uuid("cart_id").notNull(),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    title: text("title").notNull(),
    sku: text("sku").notNull(),
    /** How many went into the cart (fewer than asked when stock ran short). */
    quantity: integer("quantity").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    cartRef("wishlist_cart_adds_cart_fk", t).onDelete("cascade"),
    index("wishlist_cart_adds_store_created_idx").on(t.storeId, t.createdAt),
    index("wishlist_cart_adds_cart_idx").on(t.storeId, t.cartId),
    index("wishlist_cart_adds_wishlist_idx").on(t.storeId, t.wishlistId),
    index("wishlist_cart_adds_customer_idx").on(t.storeId, t.customerId),
    index("wishlist_cart_adds_product_idx").on(t.storeId, t.productId),
    index("wishlist_cart_adds_variant_idx").on(t.storeId, t.variantId),
    check("wishlist_cart_adds_quantity", sql`${t.quantity} > 0`),
  ],
);

/**
 * A page built from blocks (D42): for now Kaizen's own pages, served at
 * `/{slug}` (`store_id` null); stores' pages will share the table. `draft`
 * is the working copy the editor saves; `published` is what visitors see,
 * copied from the draft on publishing, so a published page can be edited
 * without changing it. `slug` is the address in use: the live one once
 * published, else the draft's. Shape and checks: `PageContent` in
 * lib/page-content.
 */
export const pages = commerce.table(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own pages. */
    storeId: uuid("store_id").references(() => stores.id),
    /** A page, or an article (D57, at `/blog/{slug}`): the same builder, each with its own addresses. */
    type: text("type").notNull().default("page"),
    slug: text("slug").notNull(),
    draft: jsonb("draft").notNull(),
    published: jsonb("published"),
    /** When it was last published; null while it is not public. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** When it was first published, kept when it is published again or taken off: an article's date (D57). */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("pages_store_slug_key").on(t.storeId, t.type, t.slug).nullsNotDistinct(),
    check("pages_type", sql`${t.type} in ('page', 'article')`),
    // For stores' front pages (D54): a store can only choose a page of its own.
    unique("pages_store_id_key").on(t.storeId, t.id),
    index("pages_created_by_idx").on(t.createdBy),
    index("pages_updated_by_idx").on(t.updatedBy),
    check("pages_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(${t.slug}) <= 80`),
    // The platform's own routes at the root of the site (category and tag listings: D50).
    check(
      "pages_slug_not_reserved",
      sql`${t.storeId} is not null or ${t.type} <> 'page' or ${t.slug} not in ('account', 'admin', 'api', 'app', 'auth', 'blog', 'category', 'cookies', 'forgot-password', 'help', 'mail', 'platform', 'robots', 's', 'setup', 'sign-in', 'sign-up', 'sitemap', 'status', 'stores', 'support', 'tag', 'unsubscribe', 'www')`,
    ),
    // A store's own routes inside each of its markets (D53).
    check(
      "pages_store_slug_not_reserved",
      sql`${t.storeId} is null or ${t.type} <> 'page' or ${t.slug} not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'download', 'order', 'p', 'subscription', 'tag', 'unsubscribe', 'wishlist')`,
    ),
    // The blog's own routes (D57): /blog/category/…, /blog/tag/… and pages of the list.
    check("pages_article_slug_not_reserved", sql`${t.type} <> 'article' or ${t.slug} not in ('category', 'page', 'tag')`),
    check("pages_published_together", sql`(${t.published} is null) = (${t.publishedAt} is null)`),
  ],
);

/**
 * An address a published page had before its slug changed (D42): visiting
 * it redirects permanently to the page's address now. A page taking the
 * address later replaces the redirect.
 */
export const pageRedirects = commerce.table(
  "page_redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id),
    /** The page's type (D57): pages and articles have addresses of their own. Set from the page. */
    type: text("type").notNull().default("page"),
    slug: text("slug").notNull(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("page_redirects_store_slug_key").on(t.storeId, t.type, t.slug).nullsNotDistinct(),
    index("page_redirects_page_idx").on(t.pageId),
  ],
);

/**
 * A row, column or component saved to use again (D46): for now Kaizen's own
 * (`store_id` null), shown under Saved in the page builder. Using one puts a
 * copy on the page; changing it later changes what the next use gets, not
 * the pages that already have it. Shape: `PageRow`, `PageColumn` or
 * `PageBlock` in lib/page-content.
 */
export const savedParts = commerce.table(
  "saved_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own. */
    storeId: uuid("store_id").references(() => stores.id),
    /** `row`, `column` or `block`. */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    content: jsonb("content").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("saved_parts_store_kind_idx").on(t.storeId, t.kind, t.name),
    index("saved_parts_created_by_idx").on(t.createdBy),
    index("saved_parts_updated_by_idx").on(t.updatedBy),
    check("saved_parts_kind", sql`${t.kind} in ('row', 'column', 'block')`),
    check("saved_parts_name", sql`length(trim(${t.name})) between 1 and 80`),
  ],
);

/**
 * A category or tag (D50) for one kind of content (`page`, `article` or
 * `product`) of Kaizen's (`store_id` null) or a store's. Categories nest
 * (`parent_id`, a category of the same owner and content); tags are flat.
 * Pages carry theirs in their content (`categories`, `tags`), so they go
 * live when the page is published; products in `product_terms`.
 */
export const terms = commerce.table(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id),
    contentType: text("content_type").notNull(),
    kind: text("kind").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => terms.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("terms_scope_slug_key").on(t.storeId, t.contentType, t.kind, t.slug).nullsNotDistinct(),
    // For product_terms: a product's terms are its own store's product terms.
    unique("terms_store_content_id_key").on(t.storeId, t.contentType, t.id),
    index("terms_scope_idx").on(t.storeId, t.contentType, t.kind, t.position),
    index("terms_parent_idx").on(t.parentId),
    check("terms_content_type", sql`${t.contentType} in ('page', 'article', 'product')`),
    check("terms_kind", sql`${t.kind} in ('category', 'tag')`),
    check("terms_products_in_stores", sql`${t.contentType} <> 'product' or ${t.storeId} is not null`),
    check("terms_tags_flat", sql`${t.kind} = 'category' or ${t.parentId} is null`),
    check("terms_not_own_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check("terms_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("terms_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(${t.slug}) <= 80`),
  ],
);

/** A product's categories and tags (D50): only its own store's product terms. */
export const productTerms = commerce.table(
  "product_terms",
  {
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    termId: uuid("term_id").notNull(),
    contentType: text("content_type").notNull().default("product"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.termId] }),
    // Cover both composite foreign keys.
    index("product_terms_product_idx").on(t.storeId, t.productId),
    index("product_terms_term_idx").on(t.storeId, t.contentType, t.termId),
    check("product_terms_content_type", sql`${t.contentType} = 'product'`),
    foreignKey({
      name: "product_terms_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_terms_term_fk",
      columns: [t.storeId, t.contentType, t.termId],
      foreignColumns: [terms.storeId, terms.contentType, terms.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A visitor's cookie choices (D58), kept as proof of consent for 12 months:
 * which optional categories they allowed, on Kaizen's site (`store_id` null)
 * or a store's, against which list of categories. `visitor` is the random
 * id in their consent cookie; nothing else identifies them.
 */
export const consents = commerce.table(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    visitor: uuid("visitor").notNull(),
    /** `{ preferences, statistics, marketing }`, each true or false. */
    choices: jsonb("choices").notNull(),
    /** The optional categories the site used when asked, e.g. `statistics+marketing`. */
    version: text("version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("consents_store_created_idx").on(t.storeId, t.createdAt),
    index("consents_visitor_idx").on(t.visitor),
    check("consents_version_length", sql`length(${t.version}) <= 100`),
  ],
);

/**
 * Cookie scans (D58): a real browser opens Kaizen's site (null store) or a
 * store's, first without consent and then with everything allowed, and
 * records what it finds in the browser. Queued by an owner's Scan now or by
 * the schedule; at most one queued or running per site.
 */
export const cookieScans = commerce.table(
  "cookie_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    /** Who asked for it; null for the weekly schedule. */
    requestedBy: uuid("requested_by").references(() => accounts.id, { onDelete: "set null" }),
    /** The site's addresses the browser opened. */
    pages: jsonb("pages").notNull().default([]),
    /** What was found: `ScannedItem[]` (`src/lib/cookie-scan.ts`). */
    items: jsonb("items").notNull().default([]),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("cookie_scans_store_created_idx").on(t.storeId, t.createdAt),
    index("cookie_scans_requested_by_idx").on(t.requestedBy),
    uniqueIndex("cookie_scans_one_active_idx")
      .on(sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.status} in ('queued', 'running')`),
    check("cookie_scans_status", sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
    check("cookie_scans_items_array", sql`jsonb_typeof(${t.items}) = 'array' and jsonb_typeof(${t.pages}) = 'array'`),
  ],
);

/**
 * What an owner says about a cookie a scan found that Kaizen does not know
 * (D58): its category and purpose, shown on the site's cookie page and
 * deciding whether visitors are asked about it.
 */
export const cookieNotes = commerce.table(
  "cookie_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** `cookie`, `localStorage` or `sessionStorage`. */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** The host that set it, without a leading dot. */
    domain: text("domain").notNull(),
    category: text("category").notNull(),
    provider: text("provider").notNull(),
    purpose: text("purpose").notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("cookie_notes_item_idx").on(
      sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.kind,
      t.name,
      t.domain,
    ),
    index("cookie_notes_store_idx").on(t.storeId),
    index("cookie_notes_updated_by_idx").on(t.updatedBy),
    check("cookie_notes_kind", sql`${t.kind} in ('cookie', 'localStorage', 'sessionStorage')`),
    check("cookie_notes_category", sql`${t.category} in ('necessary', 'preferences', 'statistics', 'marketing')`),
    check(
      "cookie_notes_lengths",
      sql`length(${t.name}) between 1 and 200 and length(${t.domain}) between 1 and 253 and length(${t.provider}) between 1 and 100 and length(${t.purpose}) between 1 and 500`,
    ),
  ],
);

/** Raw bytes, for font files (D59). */
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/**
 * Google Fonts families installed on Kaizen (D59): downloaded once from
 * Google, when a site first uses one, and served from Kaizen's own address
 * so visitors' browsers never contact Google. Shared by every site.
 */
export const fonts = commerce.table(
  "fonts",
  {
    family: text("family").primaryKey(),
    slug: text("slug").notNull().unique(),
    category: text("category").notNull(),
    /** The `@font-face` rules, pointing at `font_files`, and the family's class. */
    css: text("css").notNull(),
    /** The size of its files together. */
    bytes: integer("bytes").notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("fonts_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("fonts_category", sql`${t.category} in ('sans-serif', 'serif', 'display', 'handwriting', 'monospace')`),
  ],
);

/** A font file, named by a hash of its bytes so families that share one store it once. */
export const fontFiles = commerce.table(
  "font_files",
  {
    name: text("name").primaryKey(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("font_files_name", sql`${t.name} ~ '^[0-9a-f]{32}\\.woff2$'`),
    check("font_files_size", sql`octet_length(${t.data}) between 1 and 2000000`),
  ],
);

/**
 * A store's own saved themes (D60): its settings under a name, kept to
 * switch back to or share between its looks. `base` is the template it
 * started from, which Reset goes back to.
 */
export const storeThemes = commerce.table(
  "store_themes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    base: text("base").notNull(),
    settings: jsonb("settings").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("store_themes_name_idx").on(t.storeId, sql`lower(${t.name})`),
    index("store_themes_created_by_idx").on(t.createdBy),
    check("store_themes_name_length", sql`length(${t.name}) between 1 and 60`),
    check("store_themes_base", sql`${t.base} in ('minimal', 'warm', 'bold')`),
  ],
);
