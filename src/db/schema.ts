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
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const commerce = pgSchema("commerce");

/** A Postgres text-search document (keyword search, Phase 2). */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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
  /** Accommodation, transport, catering or leisure on a set date (CRD Art. 16(l)): appointments and stays (D65). */
  "dated_service",
]);

/**
 * How a product variant reaches the shopper: `physical`, shipped (stock,
 * weight, shipping), `digital`, downloaded after payment (files, no stock,
 * no shipping), decision D24, or `service`, an appointment (D65): booked
 * for a time, with no stock, shipping or files.
 */
export const delivery = commerce.enum("delivery", ["physical", "digital", "service"]);

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
 * VAT rates other than the standard one (D65): a country's rate for a kind
 * of sale, e.g. accommodation. A category without a row here takes the
 * country's standard rate, which never charges too little; `exempt` is
 * always 0. Read through `commerce.vat_rate(country, category)`. Reference
 * data kept by Kaizen, to be checked with an accountant like the standard
 * rates.
 */
export const vatRates = commerce.table(
  "vat_rates",
  {
    countryCode: char("country_code", { length: 2 })
      .notNull()
      .references(() => countries.code),
    category: text("category").notNull(),
    rate: numeric("rate", { precision: 5, scale: 4 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.countryCode, t.category] }),
    check("vat_rates_category", sql`${t.category} in ('accommodation')`),
    check("vat_rates_rate", sql`${t.rate} >= 0 and ${t.rate} < 1`),
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
    /** Their profile picture (D97): a path in the `avatars` bucket; without one, Gravatar, then initials. */
    avatarPath: text("avatar_path"),
    /** The admin's colours for them (D99): `system` (their device's), `light` or `dark`. */
    colorMode: text("color_mode").notNull().default("system"),
    /** Operators of the platform itself (approve access requests). */
    platformAdmin: boolean("platform_admin").notNull().default(false),
    /** The AI manager learns their preferences from conversations (D103); off, it only keeps what they tell it to. */
    assistantLearns: boolean("assistant_learns").notNull().default(true),
    /** The owner asked Kaizen for no reminders about plans left unpaid (D33). */
    planRemindersOptedOutAt: timestamp("plan_reminders_opted_out_at", { withTimezone: true }),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("accounts_email_idx").on(sql`lower(${t.email})`),
    check("accounts_color_mode", sql`${t.colorMode} in ('system', 'light', 'dark')`),
  ],
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
    /**
     * The languages the store is in (D109), as locales such as `nb-NO`, the
     * main one first; empty until an owner chooses, when they are the
     * markets' own. Independent of the currencies offered.
     */
    locales: text("locales").array().notNull().default(sql`'{}'::text[]`),
    /** Rates for the currencies offered are kept up to date from the ECB's daily reference rates (D109). */
    ratesAuto: boolean("rates_auto").notNull().default(false),
    ratesUpdatedAt: timestamp("rates_updated_at", { withTimezone: true }),
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
     * Who the store sells to (B2B): `consumers` (prices with VAT), `businesses`
     * (prices shown and entered without VAT, company details at checkout) or
     * `both` (the shopper chooses, and products can be for one or the other).
     */
    audience: text("audience").notNull().default("consumers"),
    /** Stores selling to both: ask first-time visitors whether they buy privately or for a business. */
    businessPopup: boolean("business_popup").notNull().default(false),
    /** On phones, open the slide-out cart (D64) once something is added to it. */
    openCartOnAdd: boolean("open_cart_on_add").notNull().default(false),
    /** Modules the store has switched on (D65): `bookings` for appointments. */
    modules: text("modules").array().notNull().default(sql`'{}'::text[]`),
    /** Where the store's times are, e.g. appointments' (D65): an IANA time zone. */
    timeZone: text("time_zone").notNull().default("Europe/Oslo"),
    /** Hours before an appointment its reminder goes to the shopper (D65); 0 sends none. */
    bookingReminderHours: integer("booking_reminder_hours").notNull().default(24),
    /**
     * One of the store's own pages shown as its front page in every market
     * (D54), instead of the product list. Null for the product list. The
     * foreign key to `pages (store_id, id)` is in the `store_front_page_rules`
     * migration: deleting the page sets only this column back to null.
     */
    frontPageId: uuid("front_page_id"),
    /**
     * One of the store's own pages shown as its All products page, at
     * `/products` in every market (D83), instead of the standard list. Null
     * for the standard list. Its foreign key is in `products_page_rules`,
     * as the front page's.
     */
    productsPageId: uuid("products_page_id"),
    /**
     * The store's own standard product layout (D79), for products no other
     * layout is chosen for; null: Kaizen's. Foreign key in a custom migration.
     */
    productLayoutId: uuid("product_layout_id"),
    /**
     * The store's own header and footer (D80), pages of type `header` and
     * `footer` built in the page builder; null: the standard ones. Foreign
     * keys in a custom migration: deleting the page sets these back to null.
     */
    headerId: uuid("header_id"),
    footerId: uuid("footer_id"),
    /**
     * The store's menus (D85) in its standard header (and the phone's
     * slide-out menu) and footer; null: none. Foreign keys in a custom
     * migration: deleting the menu sets these back to null.
     */
    headerMenuId: uuid("header_menu_id"),
    footerMenuId: uuid("footer_menu_id"),
    /** The store's analytics and marketing tools (D58), loaded only with consent: `TrackingSettings` in lib/cookie-consent. */
    tracking: jsonb("tracking").notNull().default({}),
    /** The owner's own code for the storefront's head and body (D61): `CustomCode` in lib/custom-code, added only on the store's own host. */
    customCode: jsonb("custom_code").notNull().default({}),
    /** The owner's own CSS for every page of the storefront (D100), checked by `cssProblem()` in lib/custom-css. */
    customCss: text("custom_css").notNull().default(""),
    /** Before themes (D60), the store's fonts (D59); now in `theme`. Kept until the code no longer reads it. */
    fonts: jsonb("fonts").notNull().default({}),
    /** The storefront's design (D60): `StoreTheme` in lib/theme, its template, the saved theme it came from and every setting. */
    theme: jsonb("theme").notNull().default({}),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("stores_audience", sql`${t.audience} in ('consumers', 'businesses', 'both')`),
    check("stores_modules", sql`${t.modules} <@ array['bookings', 'deliveries']::text[]`),
    check("stores_booking_reminder_hours", sql`${t.bookingReminderHours} between 0 and 168`),
    check("stores_custom_css", sql`length(${t.customCss}) <= 50000`),
    check(
      "stores_slug_format",
      sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`,
    ),
    // Names the platform needs for its own routes and subdomains.
    check(
      "stores_slug_not_reserved",
      sql`${t.slug} not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'hosting', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'stores', 'support', 'www')`,
    ),
    uniqueIndex("stores_one_template_idx").on(t.isTemplate).where(sql`${t.isTemplate}`),
    index("stores_created_by_idx").on(t.createdBy),
    index("stores_country_idx").on(t.country),
    index("stores_front_page_idx").on(t.id, t.frontPageId),
    index("stores_products_page_idx").on(t.id, t.productsPageId),
    index("stores_header_menu_idx").on(t.id, t.headerMenuId),
    index("stores_footer_menu_idx").on(t.id, t.footerMenuId),
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
    /** Kaizen's own CSS for every one of its pages (D100), checked by `cssProblem()` in lib/custom-css. */
    customCss: text("custom_css").notNull().default(""),
    /**
     * When stores' domains last asked for a new deployment (P8): routing to
     * custom domains is built into each deployment, so a change needs one.
     */
    domainsDeployRequestedAt: timestamp("domains_deploy_requested_at", { withTimezone: true }),
    /** Kaizen's own header and footer (D80), its pages of type `header` and `footer`; null: the standard ones. Foreign keys in a custom migration. */
    headerId: uuid("header_id"),
    footerId: uuid("footer_id"),
    /** Kaizen's menus (D85) in its standard header and footer; null: none. */
    headerMenuId: uuid("header_menu_id"),
    footerMenuId: uuid("footer_menu_id"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    check("platform_settings_single_row", sql`${t.id}`),
    check("platform_settings_sale_fee_range", sql`${t.saleFeeBps} between 0 and 2000`),
    check("platform_settings_checkout_ui", sql`${t.checkoutUi} in ('custom', 'hosted')`),
    check("platform_settings_custom_css", sql`length(${t.customCss}) <= 50000`),
    index("platform_settings_updated_by_idx").on(t.updatedBy),
    index("platform_settings_header_menu_idx").on(t.headerMenuId),
    index("platform_settings_footer_menu_idx").on(t.footerMenuId),
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
 * The currencies a store offers besides its countries' own (D109), with the
 * rate an amount is converted at (units per 1 EUR, as the ECB publishes them)
 * and the step converted amounts are rounded to. Independent of languages:
 * any currency can be shown in any language, and prices stay in each
 * country's own currency.
 */
export const storeCurrencies = commerce.table(
  "store_currencies",
  {
    storeId: storeId().references(() => stores.id),
    currency: char("currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 8 }),
    roundTo: integer("round_to").notNull().default(1),
    position: integer("position").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.currency] }),
    check("store_currencies_rate", sql`${t.rate} is null or ${t.rate} > 0`),
    check("store_currencies_round_to", sql`${t.roundTo} between 1 and 100000`),
  ],
);

/**
 * The languages the platform offers stores (D111), chosen by Kaizen's admins
 * from the world's languages. A store picks its languages among the enabled
 * ones; each has a default locale and any other variants (`de-DE`, `de-AT`).
 * `direction` is for right-to-left scripts, kept for when the storefront
 * draws them.
 */
export const platformLanguages = commerce.table(
  "platform_languages",
  {
    /** The language subtag: `de`. */
    lang: text("lang").primaryKey(),
    /** Its locales, the default (its main region) first: `{de-DE,de-AT}`. */
    locales: text("locales").array().notNull(),
    /** Its name in English, for the admin. */
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    direction: text("direction").notNull().default("ltr"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("platform_languages_lang", sql`${t.lang} ~ '^[a-z]{2,3}$'`),
    check("platform_languages_direction", sql`${t.direction} in ('ltr', 'rtl')`),
    check("platform_languages_locales", sql`cardinality(${t.locales}) >= 1`),
  ],
);

/**
 * The interface text of a language that has no hand-written text (D111), by
 * the catalogue's key (`ui:cart.title`, `email:orderSubject`): a text, or a
 * template with placeholders. `source_hash` fingerprints the English it was
 * translated from, so a changed original is found; `origin` says whether the
 * AI or a person wrote it; `reviewed_at` when a person read it.
 */
export const uiTranslations = commerce.table(
  "ui_translations",
  {
    lang: text("lang")
      .notNull()
      .references(() => platformLanguages.lang, { onDelete: "cascade" }),
    key: text("key").notNull(),
    text: text("text").notNull(),
    sourceHash: text("source_hash").notNull(),
    origin: text("origin").notNull().default("ai"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.lang, t.key] }),
    check("ui_translations_origin", sql`${t.origin} in ('ai', 'staff')`),
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
    /** In stores selling to both (B2B): shown to everyone, only to private shoppers or only to businesses. */
    audience: text("audience").notNull().default("all"),
    /** Which VAT rate it takes (D65): the market's standard rate, accommodation's, or none (exempt, such as health care). */
    vatCategory: text("vat_category").notNull().default("standard"),
    /** What it is (D65, D67): goods (physical or digital), an appointment, a stay (nights) or a rental (days). */
    kind: text("kind").notNull().default("goods"),
    /** The outside host who lists it, when the store is a marketplace (D71); null for the store's own. */
    hostId: uuid("host_id"),
    /** The product's own layout (D79), over its categories', tags' and the store's; foreign key in a custom migration. */
    productLayoutId: uuid("product_layout_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "products_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }),
    index("products_host_idx").on(t.storeId, t.hostId),
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
    check("products_audience", sql`${t.audience} in ('all', 'consumers', 'businesses')`),
    check("products_vat_category", sql`${t.vatCategory} in ('standard', 'accommodation', 'exempt')`),
    check("products_kind", sql`${t.kind} in ('goods', 'appointment', 'stay', 'rental')`),
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
    /** The keyword search document (S1): title and description, stemmed in the translation's language. */
    search: tsvector("search").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`commerce.product_search_doc(locale, title, description)`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    productRef("product_translations_product_fk", t),
    index("product_translations_store_product_idx").on(t.storeId, t.productId),
    index("product_translations_search_idx").using("gin", t.search),
  ],
);

/**
 * What shoppers searched for in a store (Phase 2, S1): the query as typed
 * (trimmed, lower case, at most 100 characters), in which market, and how
 * many products it found, for the zero-result rate and the store's list of
 * searches that found nothing. Queries can hold personal data, so they are
 * kept 90 days (`pruneSearchLog()` in the five-minute cron). Type-ahead is
 * not logged.
 */
/**
 * A randomised test of search (Phase 2, S5, D77): while one runs, each
 * search is given hybrid search (words, meaning and understanding) or
 * keyword search alone at random, `keyword_share` of them keyword. At most
 * one runs at a time (a unique index in the rules migration).
 */
export const searchExperiments = commerce.table(
  "search_experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keywordShare: real("keyword_share").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedBy: uuid("started_by").references(() => accounts.id),
    endedBy: uuid("ended_by").references(() => accounts.id),
  },
  (t) => [
    index("search_experiments_started_by_idx").on(t.startedBy),
    index("search_experiments_ended_by_idx").on(t.endedBy),
    check("search_experiments_share", sql`${t.keywordShare} between 0.05 and 0.95`),
    check("search_experiments_times", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const searchQueries = commerce.table(
  "search_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    marketCode: char("market_code", { length: 2 }).notNull(),
    query: text("query").notNull(),
    results: integer("results").notNull(),
    /** The closest product by meaning (D74), when meaning was asked; for setting the store's similarity limit. */
    semanticBest: real("semantic_best"),
    /** Results only meaning found, not the words (D74). */
    meaningResults: integer("meaning_results").notNull().default(0),
    /** What the store's text model understood the search as, when it changed anything (D75): checked filters. */
    filters: jsonb("filters"),
    /** The search test it was part of (D77), and the search it was given: `hybrid` or `keyword`. */
    experimentId: uuid("experiment_id").references(() => searchExperiments.id),
    arm: text("arm"),
    createdAt: createdAt(),
  },
  (t) => [
    index("search_queries_store_idx").on(t.storeId, t.createdAt),
    index("search_queries_created_idx").on(t.createdAt),
    index("search_queries_experiment_idx").on(t.experimentId, t.arm),
    check("search_queries_arm", sql`(${t.arm} is null) = (${t.experimentId} is null) and coalesce(${t.arm} in ('hybrid', 'keyword'), true)`),
    check("search_queries_query", sql`length(${t.query}) between 1 and 100`),
    check("search_queries_results", sql`${t.results} >= 0`),
    check("search_queries_meaning", sql`${t.meaningResults} between 0 and ${t.results}`),
  ],
);

/**
 * What search asked the store's AI, kept so the same search asks once
 * (D74, D75): a search's vector and the filters it was read as, keyed by a
 * hash of the model, the market, the store's terms (for filters) and the
 * search. Shared by every server instance, unlike an in-memory cache. Kept
 * 30 days, as searches can hold personal data.
 */
export const searchCache = commerce.table(
  "search_cache",
  {
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    /** `vector` or `filters`. */
    kind: text("kind").notNull(),
    /** md5 of everything the answer depends on. */
    key: char("key", { length: 32 }).notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.kind, t.key] }),
    index("search_cache_created_idx").on(t.createdAt),
    check("search_cache_kind", sql`${t.kind} in ('vector', 'filters')`),
  ],
);

/**
 * A shopper opening a product from search results (D77): which search,
 * which product and at which place in the list. Recorded by the result
 * link itself, with no cookie; goes with its search after 90 days.
 */
export const searchClicks = commerce.table(
  "search_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searchQueries.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    /** The result's place in the list, from 1. */
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    productRef("search_clicks_product_fk", t),
    index("search_clicks_search_idx").on(t.searchId),
    index("search_clicks_product_idx").on(t.storeId, t.productId),
    check("search_clicks_position", sql`${t.position} between 1 and 100`),
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
    /**
     * How a rental's variant is booked (D69): whole days (from pick-up on
     * the first to return on the last), a half day (morning or afternoon),
     * or by the hour. The cart line's quantity is the days or hours.
     */
    rentalPeriod: text("rental_period").notNull().default("day"),
    /**
     * The variant's own picture, shown beside it where shoppers choose one
     * (usually one of the product's pictures), with its small copy.
     */
    imageUrl: text("image_url"),
    imageThumbnailUrl: text("image_thumbnail_url"),
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
    check("product_variants_rental_period", sql`${t.rentalPeriod} in ('day', 'half_day', 'hour')`),
    check("product_variants_image", sql`${t.imageThumbnailUrl} is null or ${t.imageUrl} is not null`),
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

/**
 * A store's campaigns (D114): offers without a code, for a time: a
 * percentage off, "buy N pay for M", or a free product over an amount. What
 * they reach is `product_ids` and the categories and tags in `term_ids`; with
 * neither, everything. `thresholds` is per market, in the country's own
 * currency, like a code's minimum.
 */
/**
 * The groups of custom fields a store defines (D118): each with its fields
 * (an array of definitions, checked by `fieldGroupInput`), the kinds of thing
 * it can be on and the rules narrowing which.
 */
export const fieldGroups = commerce.table(
  "field_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    name: text("name").notNull(),
    /** What templates and exports call it; unique in the store. */
    slug: text("slug").notNull(),
    entities: jsonb("entities").notNull().default([]),
    /** OR of AND rules; none: everywhere the group can be. */
    location: jsonb("location").notNull().default([]),
    fields: jsonb("fields").notNull().default([]),
    position: text("position").notNull().default("main"),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("field_groups_store_id_key").on(t.storeId, t.id),
    unique("field_groups_store_slug_key").on(t.storeId, t.slug),
    check("field_groups_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("field_groups_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("field_groups_position", sql`${t.position} in ('main', 'side')`),
    check("field_groups_entities", sql`jsonb_typeof(${t.entities}) = 'array' and jsonb_array_length(${t.entities}) > 0`),
    check("field_groups_location", sql`jsonb_typeof(${t.location}) = 'array'`),
    check("field_groups_fields", sql`jsonb_typeof(${t.fields}) = 'array'`),
  ],
);

/**
 * What was entered in the fields of a product, page or article (D118): one row
 * per thing and language, `locale` empty for values that are the same in every
 * language. Keyed by field id in `values`, so renaming a field loses nothing.
 * No foreign key on `entity_id` (it names rows of different tables): triggers
 * take the rows away with their thing.
 */
export const fieldValues = commerce.table(
  "field_values",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    locale: text("locale").notNull().default(""),
    values: jsonb("values").notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.entity, t.entityId, t.locale] }),
    check("field_values_entity", sql`${t.entity} in ('product', 'page', 'article', 'variant', 'term')`),
    check("field_values_values", sql`jsonb_typeof(${t.values}) = 'object'`),
  ],
);

/**
 * The words of a product's searchable fields (D118, D72), one row per product
 * and language: the language-neutral texts and that language's own, stemmed
 * like the product's title. Rebuilt by `refreshFieldSearch()` whenever a
 * product's fields or the store's field groups change; keyword search reads it.
 */
export const fieldSearch = commerce.table(
  "field_search",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    entity: text("entity").notNull().default("product"),
    entityId: uuid("entity_id").notNull(),
    locale: text("locale").notNull(),
    body: text("body").notNull(),
    search: tsvector("search").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`commerce.product_search_doc(locale, '', body)`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.entity, t.entityId, t.locale] }),
    index("field_search_search_idx").using("gin", t.search),
    check("field_search_entity", sql`${t.entity} in ('product')`),
  ],
);

export const campaigns = commerce.table(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    percent: integer("percent").notNull().default(0),
    buyQuantity: integer("buy_quantity").notNull().default(0),
    payQuantity: integer("pay_quantity").notNull().default(0),
    giftVariantId: uuid("gift_variant_id"),
    giftQuantity: integer("gift_quantity").notNull().default(1),
    thresholds: jsonb("thresholds").notNull().default({}),
    productIds: jsonb("product_ids").notNull().default([]),
    termIds: jsonb("term_ids").notNull().default([]),
    /** Only customers in one of these customer groups (D108), their company's included; none for everyone. */
    tierIds: jsonb("tier_ids").notNull().default([]),
    /** Orders that may get it in all; null for no limit. */
    usageLimit: integer("usage_limit"),
    /** Orders one signed-in customer may get it on; null for no limit. */
    perCustomerLimit: integer("per_customer_limit"),
    /** The countries (market codes) it runs in; none for all of the store's. */
    markets: jsonb("markets").notNull().default([]),
    /** A percentage or a "buy N pay for M" that also applies on top of other campaigns instead of competing with them. */
    stacks: boolean("stacks").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("campaigns_store_id_key").on(t.storeId, t.id),
    variantRef("campaigns_gift_variant_fk", { storeId: t.storeId, variantId: t.giftVariantId }),
    index("campaigns_store_idx").on(t.storeId, t.active),
    index("campaigns_gift_variant_idx").on(t.storeId, t.giftVariantId),
    check("campaigns_kind", sql`${t.kind} in ('percent', 'multi_buy', 'gift')`),
    check("campaigns_percent", sql`(${t.kind} = 'percent' and ${t.percent} between 1 and 100) or (${t.kind} <> 'percent' and ${t.percent} = 0)`),
    check(
      "campaigns_multi_buy",
      sql`(${t.kind} = 'multi_buy' and ${t.buyQuantity} between 2 and 20 and ${t.payQuantity} between 1 and ${t.buyQuantity} - 1) or (${t.kind} <> 'multi_buy' and ${t.buyQuantity} = 0 and ${t.payQuantity} = 0)`,
    ),
    check("campaigns_gift", sql`(${t.kind} = 'gift' and ${t.giftVariantId} is not null and ${t.giftQuantity} between 1 and 5) or (${t.kind} <> 'gift' and ${t.giftVariantId} is null)`),
    check("campaigns_usage_limit", sql`${t.usageLimit} is null or ${t.usageLimit} > 0`),
    check("campaigns_per_customer_limit", sql`${t.perCustomerLimit} is null or ${t.perCustomerLimit} > 0`),
    check("campaigns_stacks", sql`not ${t.stacks} or ${t.kind} in ('percent', 'multi_buy')`),
    check("campaigns_dates", sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`),
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
 * A cart or order is for a country, in the currency shown (D109): any of the
 * store's currencies, not only the country's own.
 */
const marketCountryRef = (name: string, cols: { storeId: AnyPgColumn; marketCode: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [cols.storeId, cols.marketCode],
    foreignColumns: [markets.storeId, markets.code],
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

/**
 * A group of customers with a fixed discount on what they buy (D108): a
 * wholesale price for a store selling to businesses. Customers are put in one
 * by staff (`customers.tier_id`); a company's members get its tier's discount
 * through the company. Tiers in use are switched off, never deleted.
 */
export const customerTiers = commerce.table(
  "customer_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    /** Whole percent off everything bought once (not subscriptions, sign-up fees or shipping). */
    percent: integer("percent").notNull(),
    note: text("note").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_tiers_store_id_key").on(t.storeId, t.id),
    uniqueIndex("customer_tiers_store_name_idx").on(t.storeId, sql`lower(${t.name})`),
    check("customer_tiers_percent", sql`${t.percent} between 1 and 100`),
    check("customer_tiers_name", sql`length(${t.name}) between 1 and 80`),
  ],
);

/**
 * A company that buys from the store (D108): its tier's discount goes to its
 * members, employees at `employeeSharePercent` of it. Its main account
 * (`customers.company_role = 'owner'`) invites and removes the employees.
 */
export const customerCompanies = commerce.table(
  "customer_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    /** Filled in at checkout for its members, so they buy as a business. */
    organisationNumber: text("organisation_number").notNull().default(""),
    tierId: uuid("tier_id"),
    /** The part of the tier's discount employees get: 100 is all of it, 50 is half. */
    employeeSharePercent: integer("employee_share_percent").notNull().default(100),
    /** The most accounts (main accounts and employees) the company can have. */
    maxMembers: integer("max_members").notNull().default(25),
    /** Switched off: its members get no discount and it invites no one. */
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_companies_store_id_key").on(t.storeId, t.id),
    uniqueIndex("customer_companies_store_name_idx").on(t.storeId, sql`lower(${t.name})`),
    foreignKey({
      name: "customer_companies_tier_fk",
      columns: [t.storeId, t.tierId],
      foreignColumns: [customerTiers.storeId, customerTiers.id],
    }),
    check("customer_companies_share", sql`${t.employeeSharePercent} between 0 and 100`),
    check("customer_companies_max", sql`${t.maxMembers} between 1 and 1000`),
    check("customer_companies_name", sql`length(${t.name}) between 1 and 120`),
  ],
);

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
    /** Business customers (B2B): the company they buy for, filled in at checkout or in My account. */
    companyName: text("company_name").notNull().default(""),
    organisationNumber: text("organisation_number").notNull().default(""),
    /** Their profile picture (D97): a path in the `avatars` bucket; without one, Gravatar, then initials. */
    avatarPath: text("avatar_path"),
    /** Their own discount group (D108), set by staff. */
    tierId: uuid("tier_id"),
    /** The company they belong to and their part in it (D108): its main account, or an employee. */
    companyId: uuid("company_id"),
    companyRole: text("company_role"),
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
    foreignKey({
      name: "customers_tier_fk",
      columns: [t.storeId, t.tierId],
      foreignColumns: [customerTiers.storeId, customerTiers.id],
    }),
    foreignKey({
      name: "customers_company_fk",
      columns: [t.storeId, t.companyId],
      foreignColumns: [customerCompanies.storeId, customerCompanies.id],
    }),
    index("customers_tier_idx").on(t.storeId, t.tierId),
    index("customers_company_idx").on(t.storeId, t.companyId),
    check(
      "customers_company_role",
      sql`(${t.companyId} is null and ${t.companyRole} is null) or (${t.companyId} is not null and ${t.companyRole} is not null and ${t.companyRole} in ('owner', 'employee'))`,
    ),
  ],
);

/**
 * An invitation to join a company as an employee (D108), sent by email. The
 * token in the link is kept only as a hash. Pending until accepted (which
 * opens or reuses the invitee's account and joins it to the company), revoked
 * by the company or the store, or ended when the employee is removed later.
 */
export const companyInvites = commerce.table(
  "company_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    companyId: uuid("company_id").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    /** The company account that invited them; null when the store did. */
    invitedBy: uuid("invited_by"),
    /** The account that accepted it. */
    customerId: uuid("customer_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "company_invites_company_fk",
      columns: [t.storeId, t.companyId],
      foreignColumns: [customerCompanies.storeId, customerCompanies.id],
    }).onDelete("cascade"),
    index("company_invites_company_idx").on(t.storeId, t.companyId, t.createdAt),
    uniqueIndex("company_invites_one_pending_idx")
      .on(t.companyId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    check("company_invites_status", sql`${t.status} in ('pending', 'accepted', 'revoked', 'ended')`),
  ],
);

/**
 * A one-time link that signs a customer in (D108), emailed when they join a
 * company. Kept as a hash, valid for a week, and used from a page with a
 * button, so a mail scanner opening the link does not spend it.
 */
export const customerSignInLinks = commerce.table(
  "customer_sign_in_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    customerId: uuid("customer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "customer_sign_in_links_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    index("customer_sign_in_links_customer_idx").on(t.storeId, t.customerId),
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
    /** The company the shopper buys for (B2B), entered in the cart and copied to the order. */
    companyName: text("company_name"),
    organisationNumber: text("organisation_number"),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("carts_store_id_key").on(t.storeId, t.id),
    marketCountryRef("carts_market_fk", t),
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
    /** An appointment (D65): when it starts, and with whom (null: whoever is free). */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    resourceId: uuid("resource_id"),
  },
  (t) => [
    unique("cart_lines_cart_variant_plan_key")
      .on(t.cartId, t.variantId, t.sellingPlanId, t.startsAt)
      .nullsNotDistinct(),
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
    /**
     * The part of the discount that is the buyer's group or company discount
     * (D108), the rest being the discount code's; the group's name and the
     * percent they got, as sold.
     */
    memberDiscountMinor: money("member_discount_minor").default(0),
    memberLabel: text("member_label"),
    memberPercent: numeric("member_percent", { precision: 5, scale: 2 }),
    /** The part of the discount that campaigns gave (D114), and their names as sold; the rest is the code's and the group's. */
    campaignDiscountMinor: money("campaign_discount_minor").default(0),
    campaignLabel: text("campaign_label"),
    /** VAT contained in the total. Prices are VAT-inclusive. */
    taxMinor: money("tax_minor"),
    totalMinor: money("total_minor"),
    /** What is still to be paid at the venue (D66): appointments paid there, or the rest after a deposit. */
    balanceMinor: money("balance_minor").default(0),
    /**
     * An order for a host's listing (D71): paid to the host's own Stripe
     * account, the store's commission (of what was paid online) then sent to
     * the store. One checkout pays one host.
     */
    hostId: uuid("host_id"),
    commissionMinor: money("commission_minor").default(0),
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
    /** The company the order was placed for (B2B), shown on the order and its invoice. */
    companyName: text("company_name"),
    organisationNumber: text("organisation_number"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "orders_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }),
    index("orders_host_idx").on(t.storeId, t.hostId),
    unique("orders_store_id_key").on(t.storeId, t.id),
    index("orders_discount_code_idx").on(t.storeId, t.discountCodeId),
    foreignKey({
      name: "orders_discount_code_fk",
      columns: [t.storeId, t.discountCodeId],
      foreignColumns: [discountCodes.storeId, discountCodes.id],
    }),
    index("orders_subscription_idx").on(t.storeId, t.subscriptionId),
    unique("orders_store_number_key").on(t.storeId, t.number),
    marketCountryRef("orders_market_fk", t),
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
    check("orders_member_discount", sql`${t.memberDiscountMinor} between 0 and ${t.discountMinor}`),
    check("orders_campaign_discount", sql`${t.campaignDiscountMinor} between 0 and ${t.discountMinor}`),
    check("orders_tax_within_total", sql`${t.taxMinor} <= ${t.totalMinor}`),
    check("orders_balance", sql`${t.balanceMinor} between 0 and ${t.totalMinor}`),
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
    /**
     * A stay's or rental's nights, days or hours (D67, D70): its cart line's
     * quantity, as the order line is one booking at its whole price. Null
     * for everything else. The checkout page compares carts with it.
     */
    bookedCount: integer("booked_count"),
    unitPriceMinor: money("unit_price_minor"),
    discountMinor: money("discount_minor").default(0),
    /** The part of the discount that is the buyer's group or company discount (D108). */
    memberDiscountMinor: money("member_discount_minor").default(0),
    /** The part a campaign gave (D114), and which; a gift line is the whole line, at its list price. */
    campaignDiscountMinor: money("campaign_discount_minor").default(0),
    campaignId: uuid("campaign_id"),
    /** Every campaign that gave something on this line: `[{ id, name, minor }]`, the first being `campaign_id`. */
    campaignParts: jsonb("campaign_parts").notNull().default([]),
    gift: boolean("gift").notNull().default(false),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    /** The part of the total paid at the venue (D66): all of it, or what a deposit leaves. */
    venueMinor: money("venue_minor").default(0),
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
    check("order_lines_member_discount", sql`${t.memberDiscountMinor} between 0 and ${t.discountMinor}`),
    check("order_lines_campaign_discount", sql`${t.campaignDiscountMinor} between 0 and ${t.discountMinor}`),
    check("order_lines_venue", sql`${t.venueMinor} between 0 and ${t.totalMinor}`),
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
    /**
     * Kaizen's own fee in the charge's application fee (D17), without the
     * store's commission on a host's charge (D71); shown to hosts. 0 when
     * there was none, or for a subscription, whose fee is a percentage.
     */
    kaizenFeeMinor: money("kaizen_fee_minor").default(0),
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
 * A store's connection to an automation service (D41): Zapier or Make, or
 * a Slack channel (D101). Kaizen sends the store's events it asks for to
 * its webhook address, which is kept encrypted (it is all a sender needs).
 */
export const storeIntegrations = commerce.table(
  "store_integrations",
  {
    storeId: storeId().references(() => stores.id),
    /** `zapier`, `make` or `slack`. */
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
    check("store_integrations_provider", sql`${t.provider} in ('zapier', 'make', 'slack')`),
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
    check("pages_type", sql`${t.type} in ('page', 'article', 'product_layout', 'header', 'footer')`),
    // Product layouts (D79) are a store's: Kaizen has no products of its own.
    check("pages_product_layout_store", sql`${t.type} <> 'product_layout' or ${t.storeId} is not null`),
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
      sql`${t.storeId} is null or ${t.type} <> 'page' or ${t.slug} not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'deliveries', 'download', 'order', 'p', 'products', 'search', 'subscription', 'tag', 'unsubscribe', 'wishlist')`,
    ),
    // The blog's own routes (D57): /blog/category/…, /blog/tag/… and pages of the list.
    check("pages_article_slug_not_reserved", sql`${t.type} <> 'article' or ${t.slug} not in ('category', 'page', 'tag')`),
    check("pages_published_together", sql`(${t.published} is null) = (${t.publishedAt} is null)`),
  ],
);

/**
 * Which of a store's pages has a place of its own on its site (D112): its blog
 * (`/blog`), search page (`/search`) or the page shown for an address that is
 * not found, each built in the page builder; without one the site's standard
 * page shows. A page holds at most one role, and deleting it lets the role go.
 * (The front page and All products page keep their own columns on `stores`.)
 */
export const pageRoles = commerce.table(
  "page_roles",
  {
    storeId: storeId().references(() => stores.id),
    role: text("role").notNull(),
    pageId: uuid("page_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.role] }),
    unique("page_roles_store_page_key").on(t.storeId, t.pageId),
    // A store can only choose a page of its own.
    foreignKey({ name: "page_roles_page_fk", columns: [t.storeId, t.pageId], foreignColumns: [pages.storeId, pages.id] }).onDelete("cascade"),
    check("page_roles_role", sql`${t.role} in ('blog', 'search', 'not_found', 'cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries', 'cookies')`),
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
 * A row, column or component saved to use again (D46): Kaizen's own
 * (`store_id` null) or a store's, shown under Saved in the page builder.
 * Using one puts a copy on the page; changing it later changes what the
 * next use gets, not the pages that already have it, unless it is global
 * (D98): then every page's copy is its use and follows it. Shape:
 * `PageRow`, `PageColumn` or `PageBlock` in lib/page-content.
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
    /** Global (D98): its uses on pages stay the same as it, and change with it. */
    global: boolean("global").notNull().default(false),
    /** A global's texts in the owner's other languages (D55), by their place in `content`. */
    translations: jsonb("translations").notNull().default({}),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("saved_parts_store_kind_idx").on(t.storeId, t.kind, t.name),
    check("saved_parts_translations", sql`jsonb_typeof(${t.translations}) = 'object'`),
    index("saved_parts_created_by_idx").on(t.createdBy),
    index("saved_parts_updated_by_idx").on(t.updatedBy),
    check("saved_parts_kind", sql`${t.kind} in ('row', 'column', 'block')`),
    check("saved_parts_name", sql`length(trim(${t.name})) between 1 and 80`),
  ],
);

/**
 * A file in a site's media library (D88): Kaizen's (`store_id` null) or a
 * store's pictures and videos, in the public buckets. Every picture or video
 * uploaded anywhere in the admin is kept here (its address, its small copy,
 * where it lies in Storage, its name as uploaded, type, size and, once
 * known, width and height); `alt` describes it for search. What uses it is
 * found where it is shown, never stored. Its keyword index and vectors
 * (`media_embeddings`) are SQL only.
 */
export const media = commerce.table(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** `image` or `video`. */
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    /** The Storage bucket and paths, to delete the files with the item. */
    bucket: text("bucket").notNull(),
    path: text("path").notNull(),
    thumbnailPath: text("thumbnail_path"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    /** Its alt text in the owner's main language (D89), also what the library's search reads. */
    alt: text("alt").notNull().default(""),
    /** Its alt text in the owner's other languages, by locale; a language without one shows the main one. */
    altTranslations: jsonb("alt_translations").$type<Record<string, string>>().notNull().default({}),
    /** Who wrote the alt text: `ai` (D89) or `staff`; null while there is none. AI never replaces staff's. */
    altSource: text("alt_source"),
    altWrittenAt: timestamp("alt_written_at", { withTimezone: true }),
    /** When the AI last failed to write one (or a language of it), so that picture waits a day. */
    altTriedAt: timestamp("alt_tried_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("media_url_key").on(t.url),
    // The site finds a picture's alt text by either address (D89).
    index("media_thumbnail_url_idx").on(t.thumbnailUrl),
    index("media_store_created_idx").on(t.storeId, t.createdAt),
    index("media_created_by_idx").on(t.createdBy),
    check("media_kind", sql`${t.kind} in ('image', 'video')`),
    check("media_file_name", sql`length(trim(${t.fileName})) between 1 and 255`),
    check("media_alt", sql`length(${t.alt}) <= 500`),
    check("media_alt_translations", sql`jsonb_typeof(${t.altTranslations}) = 'object'`),
    check("media_alt_source", sql`${t.altSource} in ('ai', 'staff')`),
    check("media_size", sql`${t.sizeBytes} >= 0`),
    check(
      "media_dimensions",
      sql`(${t.width} is null and ${t.height} is null) or (${t.width} is not null and ${t.height} is not null and ${t.width} > 0 and ${t.height} > 0)`,
    ),
  ],
);

/**
 * A menu (D85): Kaizen's (`store_id` null) or a store's, edited under Menus
 * and shown wherever it is chosen: a menu component in any page, header or
 * footer, and the standard header and footer. Its items are a list in
 * order, each with its depth under the one before (`MenuEntry` in
 * lib/navigation), so a link can have links under it.
 */
export const menus = commerce.table(
  "menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    items: jsonb("items").notNull().default([]),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("menus_store_name_key").on(t.storeId, t.name).nullsNotDistinct(),
    unique("menus_store_id_key").on(t.storeId, t.id),
    index("menus_created_by_idx").on(t.createdBy),
    index("menus_updated_by_idx").on(t.updatedBy),
    check("menus_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("menus_items", sql`jsonb_typeof(${t.items}) = 'array'`),
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
    /** A product category's or tag's layout (D79) for its products; foreign key in a custom migration. */
    productLayoutId: uuid("product_layout_id"),
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
    check("terms_product_layout", sql`${t.productLayoutId} is null or ${t.contentType} = 'product'`),
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

/**
 * Custom domains of stores (P8): `pending` until the owner's DNS proves the
 * domain is theirs (our TXT record with `token`) and points it at Vercel,
 * then `active`. A host is active for one store at most; claims still
 * pending do not block another store's. One active domain per store can be
 * its primary address, where its other addresses lead. `checks` is the
 * latest check's findings for the admin: `DomainChecks` in lib/custom-domains.
 */
export const storeDomains = commerce.table(
  "store_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    isPrimary: boolean("is_primary").notNull().default(false),
    checks: jsonb("checks").notNull().default({}),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("store_domains_store_hostname_idx").on(t.storeId, t.hostname),
    uniqueIndex("store_domains_active_hostname_idx").on(t.hostname).where(sql`${t.status} = 'active'`),
    uniqueIndex("store_domains_primary_idx").on(t.storeId).where(sql`${t.isPrimary}`),
    index("store_domains_hostname_idx").on(t.hostname),
    index("store_domains_created_by_idx").on(t.createdBy),
    check("store_domains_status", sql`${t.status} in ('pending', 'active')`),
    check("store_domains_primary_active", sql`not ${t.isPrimary} or ${t.status} = 'active'`),
    check(
      "store_domains_hostname",
      sql`${t.hostname} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$' and length(${t.hostname}) <= 253`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Bookings (D65)
// ---------------------------------------------------------------------------

/**
 * An outside host a store lists stays or rentals for, when it runs a
 * marketplace (D71). A host signs in with their own account and sees only
 * their own listings, bookings and calendars; the store keeps its
 * commission of each booking. A host who is not VAT registered charges no
 * VAT on their listings.
 */
export const hosts = commerce.table(
  "hosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Shown to shoppers on the host's listings. */
    name: text("name").notNull(),
    /** The store's share of each booking, in basis points (1500 = 15 %). */
    commissionBps: integer("commission_bps").notNull().default(1500),
    vatRegistered: boolean("vat_registered").notNull().default(false),
    invitedBy: uuid("invited_by").references(() => accounts.id),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("hosts_store_id_key").on(t.storeId, t.id),
    unique("hosts_store_account_key").on(t.storeId, t.accountId),
    index("hosts_account_idx").on(t.accountId),
    index("hosts_invited_by_idx").on(t.invitedBy),
    check("hosts_name", sql`length(${t.name}) between 1 and 120`),
    check("hosts_commission", sql`${t.commissionBps} between 0 and 10000`),
  ],
);

/**
 * A host's own Stripe account for a mode (D71): bookings of their listings
 * are direct charges on it, as the store's own are on the store's. Kept
 * like the store's (`stripe_accounts`); `connected_accounts` lists both.
 */
export const hostStripeAccounts = commerce.table(
  "host_stripe_accounts",
  {
    hostId: uuid("host_id").notNull(),
    storeId: storeId(),
    mode: paymentMode("mode").notNull(),
    accountId: text("account_id").notNull(),
    cardPayments: text("card_payments").notNull().default("inactive"),
    requirementsDue: boolean("requirements_due").notNull().default(true),
    requirements: jsonb("requirements").notNull().default([]),
    /** Created and filled in by Kaizen with Stripe's test values (test mode, D20). */
    managedByKaizen: boolean("managed_by_kaizen").notNull().default(false),
    /** The site domains registered on it for wallets, Link and Klarna, as on the store's own. */
    paymentDomains: text("payment_domains").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.hostId, t.mode] }),
    unique("host_stripe_accounts_account_key").on(t.mode, t.accountId),
    foreignKey({
      name: "host_stripe_accounts_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }).onDelete("cascade"),
    index("host_stripe_accounts_store_idx").on(t.storeId, t.hostId),
  ],
);

/**
 * What the store, as platform operator under DAC7, must know of a host
 * (D71), given by the host in their area: who they are (a person, with
 * their date of birth, or a business, with its registration number), their
 * address, tax identification number and where it was issued, VAT number,
 * and the bank account they are paid to. Reported yearly with what they
 * earned.
 */
export const hostTaxDetails = commerce.table(
  "host_tax_details",
  {
    hostId: uuid("host_id").primaryKey(),
    storeId: storeId(),
    kind: text("kind").notNull().default("individual"),
    /** A person's full name, or a business's legal name. */
    legalName: text("legal_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    address: text("address").notNull(),
    country: char("country", { length: 2 }).notNull(),
    tin: text("tin").notNull(),
    tinCountry: char("tin_country", { length: 2 }).notNull(),
    vatNumber: text("vat_number").notNull().default(""),
    businessNumber: text("business_number").notNull().default(""),
    iban: text("iban").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "host_tax_details_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }).onDelete("cascade"),
    index("host_tax_details_store_idx").on(t.storeId, t.hostId),
    check("host_tax_details_kind", sql`${t.kind} in ('individual', 'entity')`),
    check("host_tax_details_person", sql`${t.kind} = 'entity' or ${t.dateOfBirth} is not null`),
    check("host_tax_details_business", sql`${t.kind} = 'individual' or ${t.businessNumber} <> ''`),
  ],
);

/**
 * The store's commission of a host's payment (D71): the booking's checkout,
 * or a no-show fee charged later to the card saved with it. Sent from
 * Kaizen's balance to the store's Stripe account once paid; tried again
 * from the cron until it goes through, and reversed in part with refunds.
 */
export const hostCommissions = commerce.table(
  "host_commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    /** What was paid: `booking` (at checkout) or `no_show` (a no-show fee). */
    kind: text("kind").notNull().default("booking"),
    hostId: uuid("host_id").notNull(),
    mode: paymentMode("mode").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    /** What has been taken back with refunds. */
    reversedMinor: money("reversed_minor").default(0),
    status: text("status").notNull().default("pending"),
    transferId: text("transfer_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    orderRef("host_commissions_order_fk", t),
    foreignKey({
      name: "host_commissions_payment_fk",
      columns: [t.storeId, t.paymentId],
      foreignColumns: [payments.storeId, payments.id],
    }),
    unique("host_commissions_payment_key").on(t.storeId, t.paymentId),
    foreignKey({
      name: "host_commissions_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }),
    index("host_commissions_order_idx").on(t.storeId, t.orderId),
    index("host_commissions_host_idx").on(t.storeId, t.hostId),
    index("host_commissions_due_idx").on(t.status).where(sql`${t.status} = 'pending'`),
    check("host_commissions_kind", sql`${t.kind} in ('booking', 'no_show')`),
    check("host_commissions_status", sql`${t.status} in ('pending', 'paid')`),
    check("host_commissions_amounts", sql`${t.amountMinor} >= 0 and ${t.reversedMinor} between 0 and ${t.amountMinor}`),
  ],
);

/**
 * What is booked (D65): for appointments, the staff who do them. Each has
 * its hours (`OpeningHours` in lib/opening-hours) and a capacity: how many
 * bookings it takes at once (1 for a person, more for a class).
 */
export const bookingResources = commerce.table(
  "booking_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("staff"),
    name: text("name").notNull(),
    /** Told about their bookings; not shown to shoppers. */
    email: text("email").notNull().default(""),
    hours: jsonb("hours").notNull(),
    capacity: integer("capacity").notNull().default(1),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    /** The secret in its calendar's address (D67), for Airbnb, Booking.com and the like to read; null until asked for. */
    calendarToken: text("calendar_token").unique("booking_resources_calendar_token_key"),
    /** The host whose room or item it is (D71), who keeps its calendar; null for the store's own. */
    hostId: uuid("host_id"),
    /** Where a room or home is, and its land registry number if any, for the DAC7 report (D71). */
    propertyAddress: text("property_address").notNull().default(""),
    landRegistryNumber: text("land_registry_number").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("booking_resources_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "booking_resources_host_fk",
      columns: [t.storeId, t.hostId],
      foreignColumns: [hosts.storeId, hosts.id],
    }),
    index("booking_resources_host_idx").on(t.storeId, t.hostId),
    index("booking_resources_store_idx").on(t.storeId, t.position),
    check("booking_resources_kind", sql`${t.kind} in ('staff', 'unit', 'item')`),
    check("booking_resources_capacity", sql`${t.capacity} between 1 and 500`),
    check("booking_resources_name", sql`length(${t.name}) between 1 and 120`),
  ],
);

/**
 * A season of a stay's or rental's prices (D70): every year from one day to
 * another (`MM-DD`, across the new year if the end comes first; both null
 * for all year), on some weekdays (1 Monday … 7 Sunday; a stay's night
 * counts as the day it starts), the price changed by a percentage. Seasons
 * that meet on a date multiply.
 */
export const bookingSeasons = commerce.table(
  "booking_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    /** The name in the store's other languages, by locale (`sv-SE`: "Högsäsong"); `name` where one is missing. */
    names: jsonb("names").notNull().default({}),
    fromDay: text("from_day"),
    toDay: text("to_day"),
    weekdays: integer("weekdays").array().notNull().default(sql`'{1,2,3,4,5,6,7}'`),
    percent: integer("percent").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    productRef("booking_seasons_product_fk", t),
    index("booking_seasons_product_idx").on(t.storeId, t.productId, t.position),
    check("booking_seasons_name", sql`length(${t.name}) between 1 and 60`),
    check(
      "booking_seasons_days",
      sql`(${t.fromDay} is null) = (${t.toDay} is null) and (${t.fromDay} is null or (${t.fromDay} ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and ${t.toDay} ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'))`,
    ),
    check("booking_seasons_weekdays", sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ '{1,2,3,4,5,6,7}'::int[]`),
    check("booking_seasons_percent", sql`${t.percent} between -90 and 500 and ${t.percent} <> 0`),
  ],
);

/**
 * Another calendar a room, item or member of staff is also booked in (D67):
 * an iCal address from Airbnb, Booking.com or the like, read every quarter
 * of an hour into `resource_blocks`.
 */
export const calendarFeeds = commerce.table(
  "calendar_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** When it was last read, and what went wrong then (empty when it worked). */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    error: text("error").notNull().default(""),
    /** Events read the last time. */
    events: integer("events").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("calendar_feeds_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "calendar_feeds_resource_fk",
      columns: [t.storeId, t.resourceId],
      foreignColumns: [bookingResources.storeId, bookingResources.id],
    }).onDelete("cascade"),
    index("calendar_feeds_resource_idx").on(t.storeId, t.resourceId),
    index("calendar_feeds_due_idx").on(t.syncedAt),
    check("calendar_feeds_name", sql`length(${t.name}) between 1 and 80`),
    check("calendar_feeds_url", sql`${t.url} ~ '^https://' and length(${t.url}) <= 2000`),
  ],
);

/**
 * A time a resource is closed (D67): blocked by the store (the owner's own
 * week, repairs, holidays) or booked elsewhere, as an imported calendar
 * says (`feed_id`, with the event's `uid`). A block closes the whole
 * resource, whatever its capacity.
 */
export const resourceBlocks = commerce.table(
  "resource_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    feedId: uuid("feed_id"),
    uid: text("uid"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "resource_blocks_resource_fk",
      columns: [t.storeId, t.resourceId],
      foreignColumns: [bookingResources.storeId, bookingResources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "resource_blocks_feed_fk",
      columns: [t.storeId, t.feedId],
      foreignColumns: [calendarFeeds.storeId, calendarFeeds.id],
    }).onDelete("cascade"),
    index("resource_blocks_resource_time_idx").on(t.storeId, t.resourceId, t.startsAt),
    uniqueIndex("resource_blocks_feed_uid_key").on(t.feedId, t.uid),
    index("resource_blocks_feed_idx").on(t.storeId, t.feedId),
    check("resource_blocks_times", sql`${t.startsAt} < ${t.endsAt}`),
    check("resource_blocks_note", sql`length(${t.note}) <= 200`),
    check("resource_blocks_feed_uid", sql`(${t.feedId} is null) = (${t.uid} is null)`),
  ],
);

/** How an appointment is booked (D65): its length, the time kept free around it, and how far ahead. */
export const appointmentSettings = commerce.table(
  "appointment_settings",
  {
    productId: uuid("product_id").primaryKey(),
    storeId: storeId(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    /** Times offered start on these steps from the hour: every 15 minutes, say. */
    stepMinutes: integer("step_minutes").notNull().default(15),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(60),
    maxDaysAhead: integer("max_days_ahead").notNull().default(60),
    /**
     * Stays and rentals (D67): when guests check in and out (rentals: pick
     * up and return), in the store's time zone, and how many nights (or
     * days) one booking may be.
     */
    checkInTime: text("check_in_time").notNull().default("15:00"),
    checkOutTime: text("check_out_time").notNull().default("11:00"),
    minNights: integer("min_nights").notNull().default(1),
    maxNights: integer("max_nights").notNull().default(28),
    /**
     * A fee added once to each booking of a stay or rental (D70): a stay's
     * final cleaning, a rental's preparation. VAT-inclusive, in minor units,
     * per market: `{ "NO": 50000 }`. Taxed as the product is.
     */
    bookingFee: jsonb("booking_fee").notNull().default({}),
    /** Where it takes place: one of the store's places (D40), or none said. */
    /** How it is paid (D66): `now`, a `deposit` now and the rest at the venue, or all at the `venue`. */
    payment: text("payment").notNull().default("now"),
    depositPercent: integer("deposit_percent").notNull().default(30),
    /** Shoppers may cancel or move a booking themselves until this many hours before. */
    cancelHours: integer("cancel_hours").notNull().default(24),
    /** What a no-show costs, as a percentage of the price, charged by staff to a saved card. */
    noShowPercent: integer("no_show_percent").notNull().default(0),
    locationId: uuid("location_id"),
  },
  (t) => [
    productRef("appointment_settings_product_fk", t),
    index("appointment_settings_product_idx").on(t.storeId, t.productId),
    foreignKey({
      name: "appointment_settings_location_fk",
      columns: [t.storeId, t.locationId],
      foreignColumns: [storeLocations.storeId, storeLocations.id],
    }),
    index("appointment_settings_location_idx").on(t.storeId, t.locationId),
    check("appointment_settings_duration", sql`${t.durationMinutes} between 5 and 720`),
    check(
      "appointment_settings_buffers",
      sql`${t.bufferBeforeMinutes} between 0 and 240 and ${t.bufferAfterMinutes} between 0 and 240`,
    ),
    check("appointment_settings_step", sql`${t.stepMinutes} in (5, 10, 15, 20, 30, 60)`),
    check("appointment_settings_notice", sql`${t.minNoticeMinutes} between 0 and 43200`),
    check("appointment_settings_payment", sql`${t.payment} in ('now', 'deposit', 'venue')`),
    check("appointment_settings_deposit", sql`${t.depositPercent} between 1 and 99`),
    check("appointment_settings_cancel", sql`${t.cancelHours} between 0 and 720`),
    check("appointment_settings_no_show", sql`${t.noShowPercent} between 0 and 100`),
    check("appointment_settings_ahead", sql`${t.maxDaysAhead} between 1 and 730`),
    check(
      "appointment_settings_times",
      sql`${t.checkInTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.checkOutTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check("appointment_settings_nights", sql`${t.minNights} between 1 and 365 and ${t.maxNights} between ${t.minNights} and 365`),
  ],
);

/** Who can do an appointment (D65). */
export const productResources = commerce.table(
  "product_resources",
  {
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.resourceId] }),
    productRef("product_resources_product_fk", t),
    index("product_resources_product_idx").on(t.storeId, t.productId),
    foreignKey({
      name: "product_resources_resource_fk",
      columns: [t.storeId, t.resourceId],
      foreignColumns: [bookingResources.storeId, bookingResources.id],
    }).onDelete("cascade"),
    index("product_resources_resource_idx").on(t.storeId, t.resourceId),
  ],
);

/**
 * A time taken with a resource (D65). Held while the shopper pays (until
 * `hold_expires_at`), confirmed once paid, cancelled when not. `blocked_*`
 * add the appointment's buffers: that is what no other booking may overlap.
 * Booked only through `commerce.hold_booking`, which checks under a lock.
 */
export const bookings = commerce.table(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    resourceId: uuid("resource_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    blockedFrom: timestamp("blocked_from", { withTimezone: true }).notNull(),
    blockedTo: timestamp("blocked_to", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("held"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    orderId: uuid("order_id"),
    orderLineId: uuid("order_line_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** When the reminder before it was sent to the shopper. */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    /** Raised each time the booking changes, for calendar files that replace the earlier event (D66). */
    sequence: integer("sequence").notNull().default(0),
    /** When staff marked the shopper as not having come (D66); a fee may have been charged for it. */
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("bookings_store_id_key").on(t.storeId, t.id),
    productRef("bookings_product_fk", t),
    variantRef("bookings_variant_fk", t),
    foreignKey({
      name: "bookings_resource_fk",
      columns: [t.storeId, t.resourceId],
      foreignColumns: [bookingResources.storeId, bookingResources.id],
    }),
    orderRef("bookings_order_fk", t),
    index("bookings_resource_time_idx").on(t.storeId, t.resourceId, t.blockedFrom),
    index("bookings_product_idx").on(t.storeId, t.productId),
    index("bookings_variant_idx").on(t.storeId, t.variantId),
    index("bookings_order_idx").on(t.storeId, t.orderId),
    index("bookings_order_line_idx").on(t.storeId, t.orderLineId),
    index("bookings_store_starts_idx").on(t.storeId, t.startsAt),
    // Reminders still to send, across stores (D65).
    index("bookings_reminder_due_idx").on(t.startsAt).where(sql`${t.status} = 'confirmed' and ${t.remindedAt} is null`),
    check("bookings_status", sql`${t.status} in ('held', 'confirmed', 'cancelled')`),
    check("bookings_times", sql`${t.startsAt} < ${t.endsAt}`),
    check("bookings_blocked", sql`${t.blockedFrom} <= ${t.startsAt} and ${t.blockedTo} >= ${t.endsAt}`),
    check("bookings_held_expires", sql`${t.status} <> 'held' or ${t.holdExpiresAt} is not null`),
  ],
);

/**
 * Which AI provider and models Kaizen uses (D73): one row for Kaizen
 * (`store_id` null), the default for every store, and optionally one per
 * store whose owner brings their own provider. Requests go to an
 * OpenAI-compatible API (Vercel AI Gateway, or a provider's own address),
 * so changing provider or model is a change here, not in code. The key is
 * encrypted like payment secrets. A store's row replaces Kaizen's while
 * it is on.
 */
export const aiProviders = commerce.table(
  "ai_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** `gateway`, `mistral`, `openai`, `openai_eu`, `google` or `custom` (`src/lib/ai-provider.ts`). */
    provider: text("provider").notNull(),
    /** Only for `custom`: the API's address, ending before `/embeddings`. */
    baseUrl: text("base_url"),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    apiKeyHint: text("api_key_hint").notNull(),
    /** For meaning-based search; none turns it off. */
    embeddingModel: text("embedding_model"),
    /** For understanding queries and writing product content; none turns those off. */
    textModel: text("text_model"),
    /** The chat agent's voice (D81): speech to text, and text to speech with its voice; none turns voice off. */
    transcriptionModel: text("transcription_model"),
    speechModel: text("speech_model"),
    speechVoice: text("speech_voice"),
    /**
     * Pictures (D92): the model that makes them, and, when they come from
     * another provider than the rest, that provider with its own address and
     * key (encrypted as the other); none uses this row's provider and key.
     * A better model is a new name here, never a change in code.
     */
    imageModel: text("image_model"),
    imageProvider: text("image_provider"),
    imageBaseUrl: text("image_base_url"),
    imageApiKeyEncrypted: text("image_api_key_encrypted"),
    imageApiKeyHint: text("image_api_key_hint"),
    /** `low`, `medium`, `high` or `auto` where the model takes one; none leaves it to the model. */
    imageQuality: text("image_quality"),
    /**
     * Live voice (D105): a full-duplex voice model the AI manager talks
     * through (`/live/sessions` over WebRTC), with its voice; from this row's
     * provider, or another with its own address and key, as pictures. None
     * leaves voice mode to the hands-free loop (D104).
     */
    liveModel: text("live_model"),
    liveVoice: text("live_voice"),
    liveProvider: text("live_provider"),
    liveBaseUrl: text("live_base_url"),
    liveApiKeyEncrypted: text("live_api_key_encrypted"),
    liveApiKeyHint: text("live_api_key_hint"),
    /** How similar a product must be to a query to be found by meaning, from 0 to 1. */
    minSimilarity: real("min_similarity").notNull().default(0.3),
    /**
     * Gateway only: run each model in EU data centres, the request failing
     * where the model cannot (no embedding model can yet: D73).
     */
    embeddingEuOnly: boolean("embedding_eu_only").notNull().default(true),
    textEuOnly: boolean("text_eu_only").notNull().default(true),
    /** Gateway only: only providers that keep nothing after the request. */
    zeroDataRetention: boolean("zero_data_retention").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("ai_providers_store_key").on(t.storeId).nullsNotDistinct(),
    index("ai_providers_updated_by_idx").on(t.updatedBy),
    check("ai_providers_provider", sql`${t.provider} in ('gateway', 'mistral', 'openai', 'openai_eu', 'google', 'custom')`),
    check("ai_providers_base_url", sql`(${t.provider} = 'custom') = (${t.baseUrl} is not null)`),
    check("ai_providers_min_similarity", sql`${t.minSimilarity} between 0 and 1`),
    check(
      "ai_providers_models",
      sql`coalesce(length(${t.embeddingModel}) between 1 and 200, true) and coalesce(length(${t.textModel}) between 1 and 200, true)`,
    ),
    check(
      "ai_providers_voice_models",
      sql`coalesce(length(${t.transcriptionModel}) between 1 and 200, true) and coalesce(length(${t.speechModel}) between 1 and 200, true) and coalesce(length(${t.speechVoice}) between 1 and 100, true)`,
    ),
    check("ai_providers_image_model", sql`coalesce(length(${t.imageModel}) between 1 and 200, true)`),
    check(
      "ai_providers_image_provider",
      sql`coalesce(${t.imageProvider} in ('gateway', 'mistral', 'openai', 'openai_eu', 'google', 'custom'), true)`,
    ),
    check("ai_providers_image_base_url", sql`(${t.imageProvider} is not distinct from 'custom') = (${t.imageBaseUrl} is not null)`),
    check(
      "ai_providers_image_key",
      sql`(${t.imageProvider} is null) = (${t.imageApiKeyEncrypted} is null) and (${t.imageApiKeyEncrypted} is null) = (${t.imageApiKeyHint} is null)`,
    ),
    check("ai_providers_image_quality", sql`coalesce(${t.imageQuality} in ('low', 'medium', 'high', 'auto'), true)`),
    check("ai_providers_live_model", sql`coalesce(length(${t.liveModel}) between 1 and 200, true) and coalesce(length(${t.liveVoice}) between 1 and 100, true)`),
    check("ai_providers_live_provider", sql`coalesce(${t.liveProvider} in ('gateway', 'mistral', 'openai', 'openai_eu', 'google', 'custom'), true)`),
    check("ai_providers_live_base_url", sql`(${t.liveProvider} is not distinct from 'custom') = (${t.liveBaseUrl} is not null)`),
    check(
      "ai_providers_live_key",
      sql`(${t.liveProvider} is null) = (${t.liveApiKeyEncrypted} is null) and (${t.liveApiKeyEncrypted} is null) = (${t.liveApiKeyHint} is null)`,
    ),
  ],
);

/**
 * Google reviews (D91): each owner's (a store's, or Kaizen's with a null
 * store) Google Maps Platform key, encrypted like payment secrets, and the
 * business on Google whose reviews its testimonials components show. Its
 * reviews are fetched when a page is shown, never kept (Google's terms).
 */
export const googlePlaces = commerce.table(
  "google_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    apiKeyHint: text("api_key_hint").notNull(),
    /** Google's id of the business (a Place ID), and its name and address as Google gave them when chosen. */
    placeId: text("place_id"),
    placeName: text("place_name"),
    placeAddress: text("place_address"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("google_places_store_key").on(t.storeId).nullsNotDistinct(),
    index("google_places_updated_by_idx").on(t.updatedBy),
    check("google_places_place_id", sql`coalesce(${t.placeId} ~ '^[A-Za-z0-9_-]+$' and length(${t.placeId}) between 10 and 300, true)`),
    check("google_places_place_named", sql`(${t.placeId} is null) = (${t.placeName} is null)`),
  ],
);

/**
 * A site's chat agent (D81): Kaizen's (`store_id` null) or a store's. It
 * answers visitors in text and voice from the site's published content,
 * its products and its knowledge base, and opens pages for them; only
 * about the site. Its name, occupation and picture make it relatable; it
 * is always shown as an AI assistant.
 */
export const chatAgents = commerce.table(
  "chat_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default(""),
    occupation: text("occupation").notNull().default(""),
    /** Its picture: `{ url, width, height }`, or null. */
    avatar: jsonb("avatar"),
    /** Its first words, by locale; empty uses the built-in greeting in the visitor's language. */
    greeting: jsonb("greeting").notNull().default({}),
    /** The owner's own guidance on tone and what to point out, under the fixed rules. */
    instructions: text("instructions").notNull().default(""),
    /** Visitors may talk to it (the AI's voice models must be set too). */
    voice: boolean("voice").notNull().default(false),
    /** At most this many visitor messages a day, to keep the AI's cost in hand. */
    dailyLimit: integer("daily_limit").notNull().default(500),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("chat_agents_store_key").on(t.storeId).nullsNotDistinct(),
    index("chat_agents_updated_by_idx").on(t.updatedBy),
    check("chat_agents_name", sql`length(${t.name}) <= 60`),
    check("chat_agents_occupation", sql`length(${t.occupation}) <= 80`),
    check("chat_agents_instructions", sql`length(${t.instructions}) <= 2000`),
    check("chat_agents_daily_limit", sql`${t.dailyLimit} between 1 and 100000`),
  ],
);

/**
 * A document in a site's knowledge base (D81): its text, from a file the
 * owner uploaded (text, Markdown, PDF, Word) or typed in. The file itself
 * is not kept. Split into passages in `knowledge_chunks` (SQL only).
 */
export const knowledgeDocuments = commerce.table(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** The uploaded file's name; null for text typed in. */
    fileName: text("file_name"),
    content: text("content").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    index("knowledge_documents_store_idx").on(t.storeId),
    index("knowledge_documents_created_by_idx").on(t.createdBy),
    check("knowledge_documents_title", sql`length(${t.title}) between 1 and 200`),
    check("knowledge_documents_content", sql`length(${t.content}) between 1 and 200000`),
  ],
);

/**
 * How much a site's chat agent was asked (D81): visitor messages a day, for
 * its daily limit, and per visitor (a hash of their address) per
 * ten-minute window, so one visitor cannot use it all. Pruned after a day.
 */
export const chatUsage = commerce.table(
  "chat_usage",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** `day` for the site's count, else the visitor's hash. */
    bucket: text("bucket").notNull(),
    window: timestamp("window", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [unique("chat_usage_key").on(t.storeId, t.bucket, t.window).nullsNotDistinct(), check("chat_usage_count", sql`${t.count} >= 0`)],
);

/**
 * What visitors send with a page's forms (D93): an email form's message or
 * a newsletter sign-up, found by the form's block id in the owner's
 * published pages (a store's, or Kaizen's with a null store). A message
 * is emailed to the form's recipients at once; a sign-up waits
 * (`pending`) until the visitor opens the link emailed to them, whose
 * token is kept only as a hash, and its details (`payload`) only until
 * then. Rows count visitors' and forms' sends for the limits, and go after
 * 30 days.
 */
export const formSubmissions = commerce.table(
  "form_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    /** `message` or `subscription`. */
    kind: text("kind").notNull(),
    /** A daily hash of the visitor's address, for the limits. */
    visitor: text("visitor").notNull(),
    /** How emailing it to the recipients went; `pending` while a sign-up waits to be confirmed, `expired` if its link was opened too late. */
    status: text("status").notNull(),
    /** A sign-up's email address, lower case, so the same one is not sent twice a day. */
    email: text("email"),
    /** sha256 of the confirmation link's token, hex; gone once used. */
    tokenHash: text("token_hash"),
    /** A waiting sign-up's name, consent and language, for the email once confirmed. */
    payload: jsonb("payload"),
    /** The page it was sent from, a path on the site. */
    path: text("path").notNull(),
    locale: text("locale").notNull(),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("form_submissions_token_idx").on(t.tokenHash),
    index("form_submissions_block_idx").on(t.storeId, t.blockId, t.createdAt),
    index("form_submissions_visitor_idx").on(t.visitor, t.createdAt),
    index("form_submissions_created_idx").on(t.createdAt),
    check("form_submissions_kind", sql`${t.kind} in ('message', 'subscription')`),
    check("form_submissions_status", sql`${t.status} in ('pending', 'sent', 'logged', 'failed', 'expired')`),
    check("form_submissions_token", sql`${t.tokenHash} is null or ${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("form_submissions_path", sql`left(${t.path}, 1) = '/' and length(${t.path}) <= 500`),
  ],
);

/**
 * The owner assistant (D94): a store owner's conversations with the store's
 * own AI in the admin, one per thread. Kept until the owner deletes them.
 */
export const assistantConversations = commerce.table(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The store it is about; null for the platform's AI manager (D103), with a platform admin. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    /** `admin`, the owner in the admin, or `kaizen-life`: Kaizen Life's assistant asking for the owner (D96). */
    source: text("source").notNull().default("admin"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assistant_conversations_owner_idx").on(t.storeId, t.accountId, t.updatedAt),
    uniqueIndex("assistant_conversations_kaizen_life_idx")
      .on(t.storeId, t.accountId)
      .where(sql`${t.source} = 'kaizen-life'`),
    check("assistant_conversations_source", sql`${t.source} in ('admin', 'kaizen-life')`),
    index("assistant_conversations_account_idx").on(t.accountId),
    check("assistant_conversations_title", sql`length(${t.title}) <= 200`),
  ],
);

/**
 * An owner's Kaizen Life account, connected for the assistant (D96): tokens
 * from Kaizen Life's OAuth server, encrypted with SETTINGS_ENCRYPTION_KEY,
 * with which the owner assistant asks Kaizen Life's. One per account.
 */
export const kaizenLifeLinks = commerce.table("kaizen_life_links", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** The Kaizen Life account's email, from its token, shown to the owner. */
  lifeEmail: text("life_email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One turn of a conversation: what the owner wrote, or the assistant's answer with the tools it used. */
export const assistantMessages = commerce.table(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null in the platform's conversations (D103). */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    /** `user` or `assistant`. */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** The assistant's tool calls that turn: name and whether it worked, never their data. */
    tools: jsonb("tools").notNull().default([]),
    /** The person's thumbs on an answer (D103): 1 up, -1 down; it learns from them. */
    feedback: integer("feedback"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "assistant_messages_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("cascade"),
    index("assistant_messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("assistant_messages_store_idx").on(t.storeId, t.createdAt),
    check("assistant_messages_role", sql`${t.role} in ('user', 'assistant')`),
    check("assistant_messages_content", sql`length(${t.content}) <= 20000`),
    check("assistant_messages_feedback", sql`${t.feedback} is null or ${t.feedback} in (-1, 1)`),
  ],
);

/**
 * A change the assistant asked to make that needs the owner's yes (D94):
 * anything sent in the store's name, made public or costing money. The
 * exact call is kept; approving runs it, not the model's rewording of it.
 */
export const assistantApprovals = commerce.table(
  "assistant_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the platform's AI manager (D103). */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    args: jsonb("args").notNull(),
    /** What it will do, in words made by code from the arguments. */
    summary: text("summary").notNull(),
    /** `send`, `public` or `spend`. */
    category: text("category").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "assistant_approvals_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("cascade"),
    index("assistant_approvals_conversation_idx").on(t.conversationId, t.createdAt),
    index("assistant_approvals_store_idx").on(t.storeId, t.status),
    index("assistant_approvals_account_idx").on(t.accountId),
    check("assistant_approvals_category", sql`${t.category} in ('send', 'public', 'spend')`),
    check("assistant_approvals_status", sql`${t.status} in ('pending', 'done', 'declined', 'failed')`),
  ],
);

// ---------------------------------------------------------------------------
// Weekly deliveries (D102)
// ---------------------------------------------------------------------------

/**
 * When a store delivers shoppers' standing lists (D102): one day of the
 * week in one market, and the cutoff, a number of days before at a time in
 * the store's time zone. At the cutoff each list becomes that delivery's
 * order.
 */
export const deliverySchedules = commerce.table(
  "delivery_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    name: text("name").notNull(),
    /** ISO weekday of the delivery: 1 Monday … 7 Sunday. */
    deliveryWeekday: integer("delivery_weekday").notNull(),
    /** The cutoff: this many days before the delivery day, at this time (HH:MM). */
    cutoffDays: integer("cutoff_days").notNull().default(2),
    cutoffTime: text("cutoff_time").notNull().default("23:59"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("delivery_schedules_store_id_key").on(t.storeId, t.id),
    marketRef("delivery_schedules_market_fk", t),
    index("delivery_schedules_market_idx").on(t.storeId, t.marketCode, t.currency),
    check("delivery_schedules_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("delivery_schedules_weekday", sql`${t.deliveryWeekday} between 1 and 7`),
    check("delivery_schedules_cutoff_days", sql`${t.cutoffDays} between 1 and 7`),
    check("delivery_schedules_cutoff_time", sql`${t.cutoffTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/**
 * A shopper's standing list (D102): what they want in each delivery until
 * they change it, the address, and the card saved on the store's Stripe
 * account that is charged when a delivery is sent. One open list per
 * customer and store.
 */
export const standingOrders = commerce.table(
  "standing_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    customerId: uuid("customer_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    /** `setup` until the card is saved, then `active`, `paused` or `cancelled`. */
    status: text("status").notNull().default("setup"),
    shippingAddress: jsonb("shipping_address").notNull().default({}),
    /** The card, on the store's connected account (`stripe_account`, in `mode`). */
    stripeAccount: text("stripe_account"),
    mode: text("mode"),
    stripeCustomer: text("stripe_customer"),
    paymentMethod: text("payment_method"),
    /** How the card reads to the shopper: "Visa •••• 4242". */
    cardLabel: text("card_label").notNull().default(""),
    /** The Stripe Checkout session saving the card, until it is done. */
    setupSession: text("setup_session"),
    /** When the shopper agreed to be charged each delivery as it is sent (evidence). */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    /** Delivery days the shopper skips. */
    skipDates: date("skip_dates", { mode: "string" }).array().notNull().default(sql`'{}'::date[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    unique("standing_orders_store_id_key").on(t.storeId, t.id),
    customerRef("standing_orders_customer_fk", t),
    foreignKey({
      name: "standing_orders_schedule_fk",
      columns: [t.storeId, t.scheduleId],
      foreignColumns: [deliverySchedules.storeId, deliverySchedules.id],
    }),
    uniqueIndex("standing_orders_one_open").on(t.storeId, t.customerId).where(sql`${t.status} <> 'cancelled'`),
    index("standing_orders_customer_idx").on(t.storeId, t.customerId),
    index("standing_orders_schedule_idx").on(t.storeId, t.scheduleId, t.status),
    check("standing_orders_status", sql`${t.status} in ('setup', 'active', 'paused', 'cancelled')`),
    check("standing_orders_mode", sql`${t.mode} is null or ${t.mode} in ('test', 'live')`),
    check("standing_orders_card", sql`${t.status} in ('setup', 'cancelled') or ${t.paymentMethod} is not null`),
  ],
);

/** What a standing list holds (D102): a variant and how many, until the shopper changes it. */
export const standingOrderLines = commerce.table(
  "standing_order_lines",
  {
    storeId: storeId(),
    standingOrderId: uuid("standing_order_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.standingOrderId, t.variantId] }),
    foreignKey({
      name: "standing_order_lines_list_fk",
      columns: [t.storeId, t.standingOrderId],
      foreignColumns: [standingOrders.storeId, standingOrders.id],
    }).onDelete("cascade"),
    variantRef("standing_order_lines_variant_fk", t),
    index("standing_order_lines_store_list_idx").on(t.storeId, t.standingOrderId),
    index("standing_order_lines_variant_idx").on(t.storeId, t.variantId),
    check("standing_order_lines_quantity", sql`${t.quantity} between 1 and 99`),
  ],
);

/**
 * Each delivery day of a list (D102), written at its cutoff: the order it
 * became, or why there was none. Unique per list and day, so the cutoff job
 * makes each delivery once.
 */
export const standingDeliveries = commerce.table(
  "standing_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    standingOrderId: uuid("standing_order_id").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    /** `ordered`, or none: `skipped`, `paused`, `empty` (nothing on the list) or `unavailable` (nothing to be had). */
    outcome: text("outcome").notNull(),
    orderId: uuid("order_id"),
    /** What the list asked for that the delivery could not hold: [{ title, wanted, got }]. */
    leftOut: jsonb("left_out").notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    unique("standing_deliveries_list_day_key").on(t.standingOrderId, t.deliveryDate),
    foreignKey({
      name: "standing_deliveries_list_fk",
      columns: [t.storeId, t.standingOrderId],
      foreignColumns: [standingOrders.storeId, standingOrders.id],
    }),
    orderRef("standing_deliveries_order_fk", t),
    index("standing_deliveries_store_list_idx").on(t.storeId, t.standingOrderId, t.deliveryDate),
    uniqueIndex("standing_deliveries_order_idx").on(t.storeId, t.orderId),
    check("standing_deliveries_outcome", sql`${t.outcome} in ('ordered', 'skipped', 'paused', 'empty', 'unavailable')`),
    check("standing_deliveries_order", sql`(${t.outcome} = 'ordered') = (${t.orderId} is not null)`),
  ],
);

/**
 * Every call to an AI model (D106), one row each: what was asked of which
 * provider and model, for which store and its owner's account, whose key
 * paid for it (Kaizen's or the store's own), and what it used. Kept 400
 * days. Written by `recordUsage()` from the calls in `src/server/ai.ts`;
 * read by the usage pages of the platform and of store owners.
 */
export const aiUsage = commerce.table(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    /** The store it was for; null for Kaizen's own (the platform's AI manager, its chat agent). Kept as a total when the store is deleted. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    /** The store's owner account when it was made (the first owner): who the usage is charged to in reports. */
    ownerAccountId: uuid("owner_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** The signed-in person who asked, where there was one (the AI manager, the page studio). */
    actorAccountId: uuid("actor_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Whose key was used: `platform` (Kaizen's) or `store` (the owner's own). */
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** `text`, `embedding`, `transcription`, `speech`, `image` or `live`. */
    kind: text("kind").notNull(),
    /** What in Kaizen asked (`AI_FEATURES` in `src/lib/ai-usage.ts`). */
    feature: text("feature").notNull().default("other"),
    requests: integer("requests").notNull().default(1),
    /** Requests the provider refused or that failed; they still count as requests. */
    failed: integer("failed").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Text read out by speech models. */
    characters: integer("characters").notNull().default(0),
    audioBytes: integer("audio_bytes").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    images: integer("images").notNull().default(0),
    /** The tokens are counted here (about four characters each) because the provider did not say. */
    estimated: boolean("estimated").notNull().default(false),
    /** A live voice call's session at its provider, to add its length when it ends. */
    sessionRef: text("session_ref"),
  },
  (t) => [
    index("ai_usage_created_idx").on(t.createdAt),
    index("ai_usage_store_idx").on(t.storeId, t.createdAt),
    index("ai_usage_owner_idx").on(t.ownerAccountId, t.createdAt),
    index("ai_usage_actor_idx").on(t.actorAccountId),
    check("ai_usage_source", sql`${t.source} in ('platform', 'store')`),
    check("ai_usage_kind", sql`${t.kind} in ('text', 'embedding', 'transcription', 'speech', 'image', 'live')`),
    check(
      "ai_usage_amounts",
      sql`${t.requests} >= 0 and ${t.failed} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.characters} >= 0 and ${t.audioBytes} >= 0 and ${t.audioSeconds} >= 0 and ${t.images} >= 0`,
    ),
  ],
);
