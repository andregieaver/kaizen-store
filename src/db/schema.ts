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
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { CHANNEL_KEYS } from "../lib/analytics-channels";
import { AUDIT_AREA_KEYS } from "../lib/audit";
import { MOVEMENT_REASONS, MOVEMENT_SOURCES } from "../lib/inventory";
import { LEGAL_ROLES } from "../lib/legal-roles";
import { DRAFT_STATUSES } from "../lib/draft-status";
import { ORDER_EDIT_DOCUMENTS, ORDER_EDIT_LINE_KINDS, ORDER_EDIT_REASONS, ORDER_EDIT_STATUSES } from "../lib/order-edit-status";
import {
  DRAFT_DISCOUNT_LABEL_MAX,
  DRAFT_INTERNAL_NOTE_MAX,
  DRAFT_LINE_TITLE_COLUMN_MAX,
  DRAFT_LINES_MAX,
  DRAFT_NOTE_TO_BUYER_MAX,
  DRAFT_QUANTITY_MAX,
  DRAFT_VALID_DAYS_MAX,
  DRAFT_VALID_DAYS_MIN,
  GIFT_MESSAGE_LINES,
  GIFT_MESSAGE_MAX,
  GIFT_NAME_MAX,
  AUTO_ARCHIVE_MAX_DAYS,
  AUTO_ARCHIVE_MIN_DAYS,
  DISCOUNT_BPS_MAX,
  DISCOUNT_BPS_MIN,
  TAG_MAX_LENGTH,
  VIEW_TITLE_MAX,
} from "../lib/order-limits";
import { GRANTABLE_PERMISSIONS } from "../lib/permission-keys";
import { COUNTS_FROM, PERIOD_UNITS, RETENTION_BASES, RETENTION_KINDS } from "../lib/retention";
import { RETURN_REASONS } from "../lib/withdrawal";

export const commerce = pgSchema("commerce");

/** A Postgres text-search document (keyword search, Phase 2). */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" }).notNull();
const storeId = () => uuid("store_id").notNull();
/** The channels' keys as a SQL list for a check (`src/lib/analytics-channels.ts`, D152). */
const channelList = sql.raw(CHANNEL_KEYS.map((k) => `'${k}'`).join(", "));
/** The permission keys a custom role may hold (wave 1, 1f: `src/lib/permission-keys.ts`), as a SQL list for a check. */
const grantableList = sql.raw(GRANTABLE_PERMISSIONS.map((k) => `'${k}'`).join(", "));
/** The areas an audit entry may carry (wave 1, 1f: `src/lib/audit.ts`), as a SQL list for a check. */
const auditAreaList = sql.raw(AUDIT_AREA_KEYS.map((k) => `'${k}'`).join(", "));
/** The kinds of data a retention rule can be for (wave 1, 1g: `src/lib/retention.ts`), as a SQL list for a check. */
const retentionKindList = sql.raw(RETENTION_KINDS.map((k) => `'${k}'`).join(", "));
const sqlList = (values: readonly string[]) => sql.raw(values.map((k) => `'${k}'`).join(", "));
/** A number from `src/lib/order-limits.ts` written into a check, so the database and the code say the same. */
const lit = (n: number) => sql.raw(String(n));
/**
 * A gift message (D173): the fields are only set on a gift, and kept inside their limits (`src/lib/gift.ts`; lengths in code points, lines
 * counted on the newline). Cart and order share it.
 */
const giftFieldsCheck = (t: { isGift: AnyPgColumn; giftTo: AnyPgColumn; giftFrom: AnyPgColumn; giftMessage: AnyPgColumn }) =>
  sql`(${t.isGift} or (${t.giftTo} is null and ${t.giftFrom} is null and ${t.giftMessage} is null))
    and char_length(${t.giftTo}) <= ${lit(GIFT_NAME_MAX)} and char_length(${t.giftFrom}) <= ${lit(GIFT_NAME_MAX)}
    and char_length(${t.giftMessage}) <= ${lit(GIFT_MESSAGE_MAX)}
    and (${t.giftMessage} is null or cardinality(string_to_array(${t.giftMessage}, chr(10))) <= ${lit(GIFT_MESSAGE_LINES)})`;
/** The linked legal roles (wave 1, 1e: `src/lib/legal-roles.ts`), as a SQL list for a check. */
const legalRoleList = sql.raw(LEGAL_ROLES.map((r) => `'${r}'`).join(", "));

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

/**
 * A return's life (D153, `docs/returns.md`): `requested` (a voluntary return waiting for the store) or `approved` (a
 * withdrawal return starts here), then `in_transit`, `received`, `inspected`, `closed`; `declined` (a voluntary return
 * the store refused) and `cancelled` end it elsewhere. The order of the values is the order of the steps (the
 * lifecycle trigger in `returns_rules` holds the rest). New values are added in their own migration step.
 */
export const returnStatus = commerce.enum("return_status", [
  "requested",
  "approved",
  "in_transit",
  "received",
  "inspected",
  "closed",
  "declined",
  "cancelled",
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
    /**
     * The country's own time zone (IANA; a country with several uses its capital's, D157): the date a VAT rate takes
     * effect is the country's own date (`commerce.vat_rate(country, category, at)`).
     */
    timeZone: text("time_zone"),
  },
  (t) => [
    check("countries_code_upper", sql`${t.code} = upper(${t.code})`),
    check("countries_default_locale_listed", sql`${t.defaultLocale} = any(${t.locales})`),
  ],
);

/**
 * A kind of sale that has its own VAT rate in some countries (D65, D157): `standard`, `exempt` and `accommodation` are
 * built in, the reduced-rate categories (food, books, ...) are rows platform admins add and switch off, owners only
 * choose one for a product (`products.vat_category`). Never deleted, a built-in one is never renamed or switched off
 * (triggers in the VAT migration). Reference data, no store id.
 */
export const vatCategories = commerce.table(
  "vat_categories",
  {
    code: text("code").primaryKey(),
    nameEn: text("name_en").notNull(),
    description: text("description").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    builtIn: boolean("built_in").notNull().default(false),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("vat_categories_updated_by_idx").on(t.updatedBy),
    check("vat_categories_code", sql`${t.code} ~ '^[a-z][a-z0-9_]{1,30}$'`),
    check("vat_categories_name", sql`length(${t.nameEn}) between 1 and 60`),
    check("vat_categories_description", sql`length(${t.description}) <= 200`),
    check("vat_categories_built_in", sql`not ${t.builtIn} or ${t.code} in ('standard', 'exempt', 'accommodation')`),
  ],
);

/**
 * A country's VAT rate for a category over a period (D65, D157): rates have history, a row is never edited in place
 * (the old period ends and a new one begins, `commerce.set_vat_rate()` is the writer), periods of one (country,
 * category) never overlap, and every row says where it comes from and when it was checked. `valid_from` is the first
 * day of the rate, in the country's own time zone. A missing row means the standard rate; `exempt` has no rows (always
 * 0). Read only through `commerce.vat_rate(country, category, at)`. A seeded row starts unverified (`verified_at` null):
 * a person with an accountant verifies it at `/admin/platform/vat`. Reference data kept by Kaizen.
 */
export const vatRates = commerce.table(
  "vat_rates",
  {
    countryCode: char("country_code", { length: 2 })
      .notNull()
      .references(() => countries.code),
    category: text("category")
      .notNull()
      .references(() => vatCategories.code),
    rate: numeric("rate", { precision: 5, scale: 4 }).notNull(),
    validFrom: date("valid_from").notNull(),
    /** The first day the rate no longer applies; null while it is the current one. */
    validTo: date("valid_to"),
    /** A URL or a named act. */
    source: text("source").notNull(),
    checkedOn: date("checked_on").notNull(),
    note: text("note").notNull().default(""),
    verifiedBy: uuid("verified_by").references(() => accounts.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.countryCode, t.category, t.validFrom] }),
    index("vat_rates_category_idx").on(t.category),
    index("vat_rates_verified_by_idx").on(t.verifiedBy),
    index("vat_rates_created_by_idx").on(t.createdBy),
    check("vat_rates_rate", sql`${t.rate} >= 0 and ${t.rate} < 1`),
    check("vat_rates_period", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    check("vat_rates_source", sql`length(${t.source}) between 8 and 400`),
    check("vat_rates_not_exempt", sql`${t.category} <> 'exempt'`),
    check("vat_rates_verified", sql`(${t.verifiedAt} is null) = (${t.verifiedBy} is null)`),
  ],
);

/**
 * How shipping is taxed in a country (D157): `standard` (the country's standard rate, the default everywhere),
 * `follows_goods` (the goods' rate when every taxable line has the same one) or `highest`. Only a rule a person has
 * verified is ever applied (`commerce.shipping_vat_rule()` answers `standard` for an unverified one). Reference data.
 */
export const shippingVatRules = commerce.table(
  "shipping_vat_rules",
  {
    countryCode: char("country_code", { length: 2 })
      .primaryKey()
      .references(() => countries.code),
    rule: text("rule").notNull().default("standard"),
    source: text("source").notNull().default(""),
    checkedOn: date("checked_on"),
    verifiedBy: uuid("verified_by").references(() => accounts.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shipping_vat_rules_verified_by_idx").on(t.verifiedBy),
    check("shipping_vat_rules_rule", sql`${t.rule} in ('standard', 'follows_goods', 'highest')`),
    check("shipping_vat_rules_source", sql`length(${t.source}) <= 400`),
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
    /**
     * A mirror for display only (wave 1, 1f): when the account was last seen with a verified second step ("has
     * two-step" on the Team page). Never used to decide access: that is read from the signed `aal` claim or a
     * server-side `getUser()`, never from the session cookie.
     */
    twoStepSince: timestamp("two_step_since", { withTimezone: true }),
    /**
     * Set when a recovery code was used or a platform admin reset the account's two-step, cleared when a factor is
     * next verified. While set and without a factor the account is held at enrolment whether or not anything
     * requires two-step: a decision the server made, so unlike the mirror it is read for access.
     */
    twoStepReenrolAt: timestamp("two_step_reenrol_at", { withTimezone: true }),
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
    /** The referral code the request came with (D131), checked against `referrers` when the request is approved. */
    referralCode: text("referral_code"),
    /**
     * The store template the requester chose (D175, docs/store-templates.md), kept only when it was a published one; the platform admin
     * may change it before approving. Null: the Standard store (the default template).
     */
    starterId: uuid("starter_id").references((): AnyPgColumn => storeStarters.id),
    /**
     * The design profile the requester chose (D176, docs/design-profiles.md), kept only when it was a published one; the platform admin
     * may change it before approving, and it is applied right after the store is made. Null: the store template's own look.
     */
    designPresetId: uuid("design_preset_id").references((): AnyPgColumn => designPresets.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("access_requests_pending_email_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    index("access_requests_decided_by_idx").on(t.decidedBy),
    index("access_requests_store_idx").on(t.storeId),
    index("access_requests_status_idx").on(t.status, t.createdAt),
    index("access_requests_starter_idx").on(t.starterId),
    index("access_requests_design_preset_idx").on(t.designPresetId),
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
    /** Why the store is suspended or closed, in the words of whoever did it (D171). */
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** The account that last changed the status (no foreign key: an account can go, the history stays). */
    statusChangedBy: uuid("status_changed_by"),
    /** When the store was closed: set and cleared by the database's rules, the start of the reopening period (D171). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
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
    /**
     * A store template (D175, docs/store-templates.md): a real store the platform keeps as a starting point for new stores. Never also
     * `is_template`, never unmarked; it takes no order, is not open for jobs (`store_is_active()`) and is never indexed.
     */
    starter: boolean("starter").notNull().default(false),
    /** The store template this store was made from (D175), for the platform's counts; nothing behaves differently by it. */
    madeFromStarter: uuid("made_from_starter").references((): AnyPgColumn => storeStarters.id),
    /**
     * A store template's frozen published copy (D177, docs/store-templates.md section 4): made by `commerce.freeze_starter()` when the
     * template is published, what new stores are copied from (`commerce.starter_source()`) and what owners preview. Always `starter`, never
     * worked in (no membership is honoured: `loadMembership()`), closed when a later publish replaces it. Null when the template is deleted.
     */
    starterCopyOf: uuid("starter_copy_of").references((): AnyPgColumn => storeStarters.id, { onDelete: "set null" }),
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
    /**
     * What checkout says about the store's terms (wave 1, 1e): `link` (a sentence with links, the default), `checkbox`
     * (the same with a required tick) or `off` (nothing drawn, nothing recorded). A copy of a store starts with `link`.
     */
    termsAtCheckout: text("terms_at_checkout").notNull().default("link"),
    /**
     * Every member of the store must have a second step (wave 1, 1f); a member without one is held at enrolment before
     * the store's admin. Switched on by an owner who has one themselves. A copy starts with it off.
     */
    requireTwoStep: boolean("require_two_step").notNull().default(false),
    /**
     * The role templates (`ROLE_TEMPLATE_KEYS`) `ensureStoreRoles()` has already offered the store (wave 1, 1f). A template an owner
     * deleted stays listed here, so it is not made again on the next visit. A copy starts empty and is offered them afresh.
     */
    roleTemplatesOffered: text("role_templates_offered").array().notNull().default(sql`'{}'::text[]`),
    /**
     * Cookieless visit counting for the analytics (D152): off until the owner switches it on, and never copied with a
     * store, so a copy counts nothing until its own owner chooses.
     */
    visitCounting: boolean("visit_counting").notNull().default(false),
    /** Modules the store has switched on (D65): `bookings` for appointments, `deliveries` (D102), `work` (D122). */
    modules: text("modules").array().notNull().default(sql`'{}'::text[]`),
    /**
     * The features the owner keeps switched on (D178, `src/lib/store-features.ts`, `docs/store-features.md`): `shop` is the master switch, and a
     * feature is on only with everything it needs (`commerce.feature_on()`). `modules`' `bookings` and `deliveries` follow it (a trigger).
     */
    features: text("features").array().notNull().default(sql`'{shop}'::text[]`),
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
    check("stores_terms_at_checkout", sql`${t.termsAtCheckout} in ('link', 'checkbox', 'off')`),
    check("stores_modules", sql`${t.modules} <@ array['bookings', 'deliveries', 'work']::text[]`),
    check(
      "stores_features",
      sql`${t.features} <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals']::text[]`,
    ),
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
    check("stores_starter_not_template", sql`not (${t.starter} and ${t.isTemplate})`),
    index("stores_made_from_starter_idx").on(t.madeFromStarter),
    index("stores_starter_copy_of_idx").on(t.starterCopyOf),
    // A store template's frozen copy (D177) is a starter like it: never a real store.
    check("stores_starter_copy_is_starter", sql`${t.starterCopyOf} is null or ${t.starter}`),
    index("stores_created_by_idx").on(t.createdBy),
    index("stores_country_idx").on(t.country),
    index("stores_front_page_idx").on(t.id, t.frontPageId),
    index("stores_products_page_idx").on(t.id, t.productsPageId),
    index("stores_header_menu_idx").on(t.id, t.headerMenuId),
    index("stores_footer_menu_idx").on(t.id, t.footerMenuId),
  ],
);

/**
 * Store templates (D175, docs/store-templates.md): the description of a store marked `starter`, what owners and the sign-up form are
 * offered once `published` (D177: from its frozen copy, `published_store_id`), in `position` order. One per starter store; deleted only
 * while no store and no access request came from it (D177), else archived; the rules are in the `store_starters_rules` migrations (only a
 * starter store, store fixed, delete only unused). Classified `never` in `COPY_RULES`.
 */
export const storeStarters = commerce.table(
  "store_starters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references((): AnyPgColumn => stores.id),
    title: text("title").notNull(),
    /** On the card, plain text. */
    summary: text("summary").notNull().default(""),
    /** Longer, plain text. */
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    /** A picture on the site (`/…`) or over https, from Kaizen's media library; null: none. */
    pictureUrl: text("picture_url"),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(false),
    /**
     * The design profile (D176) offered first when a store is made from this template: only the default choice on the cards, never a
     * restriction. Null: the template's own look.
     */
    recommendedDesign: uuid("recommended_design").references((): AnyPgColumn => designPresets.id),
    /**
     * Details saved but not published yet (D177): `{ title, summary, description, category, pictureUrl, recommendedDesign }`, read by the
     * platform admin only; owners see the columns above until Publish copies it there. Null: no unpublished change of the details.
     */
    draft: jsonb("draft"),
    /** The frozen copy new stores are made from and owners preview (D177, `commerce.freeze_starter()`); null until published under D177. */
    publishedStoreId: uuid("published_store_id").references((): AnyPgColumn => stores.id),
    /** The last Publish. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Archived (D177): hidden from every list but the platform's Archived filter, never published while archived; Restore takes it back. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => accounts.id),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("store_starters_store_idx").on(t.storeId),
    index("store_starters_recommended_design_idx").on(t.recommendedDesign),
    index("store_starters_published_store_idx").on(t.publishedStoreId),
    index("store_starters_archived_by_idx").on(t.archivedBy),
    check("store_starters_archived_unpublished", sql`not (${t.published} and ${t.archivedAt} is not null)`),
    check("store_starters_draft", sql`${t.draft} is null or jsonb_typeof(${t.draft}) = 'object'`),
    index("store_starters_offered_idx").on(t.published, t.position),
    index("store_starters_created_by_idx").on(t.createdBy),
    index("store_starters_updated_by_idx").on(t.updatedBy),
    check(
      "store_starters_category",
      sql`${t.category} in ('appointments', 'retail', 'downloads', 'rentals_stays', 'subscriptions', 'services', 'other')`,
    ),
    check("store_starters_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("store_starters_summary", sql`length(${t.summary}) <= 200`),
    check("store_starters_description", sql`length(${t.description}) <= 2000`),
    check(
      "store_starters_picture_url",
      sql`${t.pictureUrl} is null or (length(${t.pictureUrl}) <= 2000 and ${t.pictureUrl} ~ '^(https://|/[^/])')`,
    ),
  ],
);

/**
 * Design profiles (D176, docs/design-profiles.md): a frozen snapshot of a store's look, never its content, that the platform's admins
 * make from a store and any store can apply (`applyDesignPreset()`, the one writer). `snapshot` is `DesignSnapshot` in
 * `src/lib/design-presets.ts` (versioned, `v` 1): the theme's settings, the chosen header, footer and standard product layout as rows,
 * and the site's CSS, cleaned of everything that points into the store it came from. Not store-owned (no `store_id`: the source is only
 * informational), so it is outside `COPY_RULES` and never copied with a store. Deleted only while unused (D177: no use, no access request;
 * a recommendation is cleared), else archived: the rules are in the `design_presets_rules` migrations. Edited in its workspace store (D177)
 * and published from it. Called "design presets" in code, never "template", "starter" or "theme" alone (D125, D175, D60).
 */
export const designPresets = commerce.table(
  "design_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /** On the card, plain text. */
    summary: text("summary").notNull().default(""),
    /** Longer, plain text. */
    description: text("description").notNull().default(""),
    /** A preview picture on the site (`/…`) or over https, from Kaizen's media library; null: none. */
    pictureUrl: text("picture_url"),
    snapshot: jsonb("snapshot").notNull(),
    /** The store the snapshot was taken from, for *Update from its store*; informational, nothing is read from it when applying but its pictures. */
    sourceStoreId: uuid("source_store_id").references((): AnyPgColumn => stores.id),
    /** When the snapshot was last taken. */
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(false),
    /**
     * Details saved but not published yet (D177): `{ title, summary, description, pictureUrl }`, read by the platform admin only; stores see
     * the columns above until Publish copies it there. Null: no unpublished change of the details.
     */
    draft: jsonb("draft"),
    /**
     * The profile's workspace (D177): a hidden store (`starter`, no `store_starters` row, never worked in through the store admin) where its
     * look is edited from the profile's own pages; Publish takes its snapshot into `snapshot`. Null for a profile made before D177 until it is
     * first edited.
     */
    workspaceStoreId: uuid("workspace_store_id").references((): AnyPgColumn => stores.id),
    /** A key of the workspace's look as last published (or as made), to tell whether it changed since (`snapshotKey()`). */
    workspaceKey: text("workspace_key"),
    /** The last Publish. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Archived (D177): hidden from every list but the platform's Archived filter, never published while archived; Restore takes it back. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => accounts.id),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("design_presets_offered_idx").on(t.published, t.position),
    uniqueIndex("design_presets_workspace_idx").on(t.workspaceStoreId),
    index("design_presets_archived_by_idx").on(t.archivedBy),
    check("design_presets_archived_unpublished", sql`not (${t.published} and ${t.archivedAt} is not null)`),
    check("design_presets_draft", sql`${t.draft} is null or jsonb_typeof(${t.draft}) = 'object'`),
    index("design_presets_source_store_idx").on(t.sourceStoreId),
    index("design_presets_created_by_idx").on(t.createdBy),
    index("design_presets_updated_by_idx").on(t.updatedBy),
    check("design_presets_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("design_presets_summary", sql`length(${t.summary}) <= 200`),
    check("design_presets_description", sql`length(${t.description}) <= 2000`),
    check(
      "design_presets_picture_url",
      sql`${t.pictureUrl} is null or (length(${t.pictureUrl}) <= 2000 and ${t.pictureUrl} ~ '^(https://|/[^/])')`,
    ),
    check(
      "design_presets_snapshot",
      sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'v' = '1' and octet_length(${t.snapshot}::text) <= 2000000`,
    ),
  ],
);

/**
 * Each time a design profile (D176) was applied to a store, with the look it replaced (`previous`: the theme as stored, the header, footer and
 * standard product layout chosen and the site's CSS) and the saved theme made of it, so the owner can put the look from before back
 * (`restoreDesignLook()`). Written only by `src/server/design-presets.ts`; never deleted, and only `restored_at`/`restored_by` change, once.
 */
export const designPresetUses = commerce.table(
  "design_preset_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id),
    previous: jsonb("previous").notNull(),
    /** The saved theme (D60) made of the theme it replaced; null once the owner deleted it. */
    savedThemeId: uuid("saved_theme_id").references((): AnyPgColumn => storeThemes.id, { onDelete: "set null" }),
    appliedBy: uuid("applied_by").references(() => accounts.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    restoredBy: uuid("restored_by").references(() => accounts.id),
  },
  (t) => [
    index("design_preset_uses_store_idx").on(t.storeId, t.appliedAt),
    index("design_preset_uses_preset_idx").on(t.presetId),
    index("design_preset_uses_saved_theme_idx").on(t.savedThemeId),
    index("design_preset_uses_applied_by_idx").on(t.appliedBy),
    index("design_preset_uses_restored_by_idx").on(t.restoredBy),
    check("design_preset_uses_previous", sql`jsonb_typeof(${t.previous}) = 'object'`),
  ],
);

/**
 * A store's own roles (wave 1, 1f, `docs/wave-1-trust.md`): a name and `{area}:{read|write}` keys, chosen from the
 * grantable ones (`GRANTABLE_PERMISSIONS` in `src/lib/permission-keys.ts`; never `staff:write`, `billing:write` or `owner`,
 * which stay with the owner role). The system roles `owner` and `admin` have no row. The templates are made by
 * `ensureStoreRoles()` in application code, not by `clone_store()`; `template` keeps one from being made twice.
 */
export const storeRoles = commerce.table(
  "store_roles",
  {
    storeId: storeId().references(() => stores.id),
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    template: text("template"),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.id] }),
    uniqueIndex("store_roles_name_key").on(t.storeId, sql`lower(${t.name})`),
    uniqueIndex("store_roles_template_key").on(t.storeId, t.template).where(sql`${t.template} is not null`),
    index("store_roles_created_by_idx").on(t.createdBy),
    check("store_roles_name", sql`length(btrim(${t.name})) between 1 and 60`),
    check(
      "store_roles_template",
      sql`${t.template} is null or ${t.template} in ('orders', 'products', 'marketing', 'content', 'analytics', 'read_only')`,
    ),
    check("store_roles_permissions", sql`${t.permissions} <@ array[${grantableList}]::text[]`),
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
    /** A custom role (wave 1, 1f); only an `admin` carries one, and null is the default admin set. */
    roleId: uuid("role_id"),
    /** `collaborator`: an agency's account the owner invited with an expiry; never an owner. */
    kind: text("kind").notNull().default("staff"),
    /** When a collaborator's access ends; `getMembership()` ignores a member after it and the daily job marks it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.accountId] }),
    index("store_members_account_idx").on(t.accountId),
    index("store_members_invited_by_idx").on(t.invitedBy),
    index("store_members_role_idx").on(t.storeId, t.roleId),
    foreignKey({
      name: "store_members_role_fk",
      columns: [t.storeId, t.roleId],
      foreignColumns: [storeRoles.storeId, storeRoles.id],
    }).onDelete("restrict"),
    check("store_members_role_id", sql`${t.roleId} is null or ${t.role} = 'admin'`),
    check("store_members_kind", sql`${t.kind} in ('staff', 'collaborator')`),
    check(
      "store_members_collaborator",
      sql`${t.kind} <> 'collaborator' or (${t.role} = 'admin' and ${t.expiresAt} is not null)`,
    ),
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
    /**
     * The part of the admin the action belongs to (wave 1, 1f: `AUDIT_AREAS` in `src/lib/audit.ts`). Filled once by the
     * database's guard for old rows (the one update allowed); readers use `coalesce(area, areaOfAction(action))`.
     */
    area: text("area"),
    /** What the action was done to (`product`, `page`, …) and its id as text, when the action has a target. */
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** The changed fields as `{ field: { from, to } }`, only fields on the allowlist of the kind, never a secret (`diffOf()`). */
    changes: jsonb("changes"),
  },
  (t) => [
    index("audit_log_store_idx").on(t.storeId, t.createdAt),
    index("audit_log_account_idx").on(t.accountId),
    index("audit_log_store_area_idx").on(t.storeId, t.area, sql`${t.id} desc`),
    index("audit_log_store_account_idx").on(t.storeId, t.accountId, sql`${t.id} desc`),
    check("audit_log_area", sql`${t.area} is null or ${t.area} in (${auditAreaList})`),
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
    /** Which VAT rate it takes (D65, D157): a row of `vat_categories` (standard, accommodation, exempt, food, books, ...). */
    vatCategory: text("vat_category").notNull().default("standard"),
    /** What it is (D65, D67): goods (physical or digital), an appointment, a stay (nights) or a rental (days). */
    kind: text("kind").notNull().default("goods"),
    /** The outside host who lists it, when the store is a marketplace (D71); null for the store's own. */
    hostId: uuid("host_id"),
    /** The product's own layout (D79), over its categories', tags' and the store's; foreign key in a custom migration. */
    productLayoutId: uuid("product_layout_id"),
    /** Unit price (D160): every active goods variant needs its content (`measure_*`); never shown to shoppers. */
    soldByMeasure: boolean("sold_by_measure").notNull().default(false),
    /**
     * When the product first became active (wave 2, D168): set by a trigger and never cleared. A handle that changes leaves a redirect only for a
     * product that was ever live (`OLD.status <> 'draft'` or this set). No backfill: a product active or archived today counts as ever live.
     */
    firstActiveAt: timestamp("first_active_at", { withTimezone: true }),
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
    foreignKey({ name: "products_vat_category_fk", columns: [t.vatCategory], foreignColumns: [vatCategories.code] }),
    index("products_vat_category_idx").on(t.vatCategory),
    check("products_kind", sql`${t.kind} in ('goods', 'appointment', 'stay', 'rental')`),
    check("products_handle_format", sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("products_download_limit_positive", sql`${t.downloadLimit} > 0`),
    check("products_download_days_positive", sql`${t.downloadDays} > 0`),
    check("products_sold_by_measure_goods", sql`not ${t.soldByMeasure} or ${t.kind} = 'goods'`),
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
    /** `vector`, `filters` or `rerank` (a recommendation's order, D139). */
    kind: text("kind").notNull(),
    /** md5 of everything the answer depends on. */
    key: char("key", { length: 32 }).notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.kind, t.key] }),
    index("search_cache_created_idx").on(t.createdAt),
    check("search_cache_kind", sql`${t.kind} in ('vector', 'filters', 'rerank')`),
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
    /**
     * What one unit costs the store, in its main currency (D152); null while unknown. Copied onto each order line
     * when it is sold (`order_lines.unit_cost_minor`), so a later change never rewrites history.
     */
    costMinor: bigint("cost_minor", { mode: "number" }),
    /** Customs tariff (HS) code and country of origin, for export declarations. */
    hsCode: text("hs_code"),
    originCountry: char("origin_country", { length: 2 }),
    /**
     * Unit price (D160): the pack's total content, its unit and the owner's preferred comparison base. Goods only. The
     * price per kilogram, litre, metre or piece is worked out on read by `unitPrice()`, never stored.
     */
    measureAmount: numeric("measure_amount", { precision: 12, scale: 4 }),
    measureUnit: text("measure_unit"),
    measureBase: text("measure_base"),
    /**
     * What happens at zero stock (wave 3, D172, `docs/wave-3-inventory.md` 3.1): `deny` stops selling (the default and the
     * old behaviour), `continue` keeps selling on backorder. Goods only; `continue` needs `backorderDays`, because the
     * delivery time is always stated. Read per request, never in a `'use cache'` function.
     */
    stockPolicy: text("stock_policy").notNull().default("deny"),
    /** The days within which a backordered unit is expected to ship (1 to 90): required with `continue`, null otherwise. */
    backorderDays: integer("backorder_days"),
    /** The owner's warning level (0 to 1,000,000): on hand over the active locations at or below it is one email per crossing. Null: no warning. */
    lowStockThreshold: integer("low_stock_threshold"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("product_variants_store_id_key").on(t.storeId, t.id),
    check("product_variants_stock_policy", sql`${t.stockPolicy} in ('deny', 'continue')`),
    check("product_variants_stock_policy_goods", sql`${t.stockPolicy} = 'deny' or ${t.delivery} = 'physical'`),
    check("product_variants_backorder_days", sql`${t.backorderDays} between 1 and 90`),
    check(
      "product_variants_backorder_days_policy",
      sql`(${t.stockPolicy} = 'continue') = (${t.backorderDays} is not null)`,
    ),
    check(
      "product_variants_low_stock_threshold",
      sql`${t.lowStockThreshold} is null or (${t.lowStockThreshold} between 0 and 1000000 and ${t.delivery} = 'physical')`,
    ),
    unique("product_variants_store_sku_key").on(t.storeId, t.sku),
    productRef("product_variants_product_fk", t),
    index("product_variants_product_idx").on(t.storeId, t.productId),
    check("product_variants_gtin_digits", sql`${t.gtin} ~ '^[0-9]{8,14}$'`),
    check("product_variants_rental_period", sql`${t.rentalPeriod} in ('day', 'half_day', 'hour')`),
    check("product_variants_image", sql`${t.imageThumbnailUrl} is null or ${t.imageUrl} is not null`),
    check("product_variants_weight_positive", sql`${t.weightGrams} > 0`),
    check("product_variants_cost_minor", sql`${t.costMinor} >= 0`),
    check("product_variants_hs_code_digits", sql`${t.hsCode} ~ '^[0-9]{6,10}$'`),
    check("product_variants_measure_pair", sql`(${t.measureAmount} is null) = (${t.measureUnit} is null)`),
    check("product_variants_measure_amount", sql`${t.measureAmount} > 0 and ${t.measureAmount} <= 1000000`),
    check(
      "product_variants_measure_unit",
      sql`${t.measureUnit} in ('g', 'kg', 'ml', 'cl', 'l', 'cm', 'm', 'm2', 'piece')`,
    ),
    check(
      "product_variants_measure_base",
      sql`${t.measureBase} is null or (
        ${t.measureAmount} is not null and (
          (${t.measureUnit} in ('g', 'kg') and ${t.measureBase} in ('kg', '100g'))
          or (${t.measureUnit} in ('ml', 'cl', 'l') and ${t.measureBase} in ('l', '100ml'))
          or (${t.measureUnit} in ('cm', 'm') and ${t.measureBase} = 'm')
          or (${t.measureUnit} = 'm2' and ${t.measureBase} = 'm2')
          or (${t.measureUnit} = 'piece' and ${t.measureBase} = 'piece')))`,
    ),
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
 * What was entered in the fields of a product, page or article (D118), and of
 * the store itself, a customer or an order (D120): one row
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
    check(
      "field_values_entity",
      sql`${t.entity} in ('product', 'page', 'article', 'variant', 'term', 'store', 'customer', 'order')`,
    ),
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
    /**
     * The rank for routing (wave 3, D172): a location with a lower `priority` is taken from first, then `created_at`, then `id`.
     * Existing locations get 0 and keep their order by `created_at`, which is what every reader used before.
     */
    priority: integer("priority").notNull().default(0),
    /** Set when an owner deactivates the location and cleared on reactivation, for the report; never copied. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("inventory_locations_store_id_key").on(t.storeId, t.id),
    // Two active locations of one store cannot share a name (case-insensitively).
    uniqueIndex("inventory_locations_active_name_key")
      .on(t.storeId, sql`lower(${t.name})`)
      .where(sql`${t.active}`),
    check("inventory_locations_priority", sql`${t.priority} >= 0`),
    check("inventory_locations_name", sql`length(${t.name}) between 1 and 60`),
  ],
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
    // No non-negative check any more (wave 3, D172): a level goes below zero only by a sale of a variant that keeps selling on
    // backorder, and the trigger `inventory_levels_negative_rule` holds that (a rise is always allowed).
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
    /** Set on a customer copied from another store (D129): the original's id, so a rerun copies nobody twice. */
    copiedFrom: uuid("copied_from"),
    /** The affiliate (D131, a customer of the same store) whose link they registered through; null for none. */
    referredByCustomerId: uuid("referred_by_customer_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_copied_from_key").on(t.storeId, t.copiedFrom).where(sql`${t.copiedFrom} is not null`),
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
    foreignKey({
      name: "customers_referred_by_fk",
      columns: [t.storeId, t.referredByCustomerId],
      foreignColumns: [t.storeId, t.id],
    }).onDelete("set null"),
    index("customers_tier_idx").on(t.storeId, t.tierId),
    index("customers_company_idx").on(t.storeId, t.companyId),
    index("customers_referred_by_idx").on(t.storeId, t.referredByCustomerId),
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
    /**
     * The last proof of identity (D162): set at sign-in and again by a step-up (a code to the address on file, or the
     * password). A shopper's download or delete of their data needs it within `FRESH_SIGN_IN_MINUTES`.
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
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
    /**
     * The EU VAT number the business shopper typed (D157), normalised with its country prefix, and the VIES answer to
     * it (`vat_checks`). Only the cart and the order made from it keep it; never copied, never public.
     */
    vatNumber: text("vat_number"),
    vatCheckId: uuid("vat_check_id"),
    /**
     * The bonus credits the signed-in shopper asked to use (D130), in the currency shown (`bonus_request_currency`);
     * checkout clamps it to what they may use, so it is only ever a request.
     */
    bonusRequestMinor: bigint("bonus_request_minor", { mode: "number" }).notNull().default(0),
    bonusRequestCurrency: char("bonus_request_currency", { length: 3 }),
    /** The affiliate code the shopper arrived with (D131), kept from the consented cookie; checked again at checkout. */
    affiliateCode: text("affiliate_code"),
    /**
     * The delivery option the shopper chose at checkout (D135): one of the cart's `delivery_quotes`. None means the
     * market's flat rate. No foreign key (the quotes point back at the cart); a quote that is gone or has run out is none.
     */
    deliveryQuoteId: uuid("delivery_quote_id"),
    /**
     * The visitor-day that made the cart (D152, only while the store counts visits), which is how a paid order knows
     * its channel and device. The visit is deleted after 25 months; the cart then keeps nothing.
     */
    visitId: uuid("visit_id").references((): AnyPgColumn => visits.id, { onDelete: "set null" }),
    /**
     * A cart made on another site (D170, the WordPress plugin) is opened here by a one-time link: the hash of its secret, when it
     * runs out, and where it goes (the cart or the checkout). The link sets the browser's cart cookie once and is then cleared.
     */
    handoffHash: text("handoff_hash"),
    handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }),
    handoffTo: text("handoff_to"),
    /**
     * A gift message (wave 3, run 2, D173): the shopper marks the order as a gift and may write a name, a sender and a message
     * (`src/lib/gift.ts` cleans them and refuses a text over the limit; only when the store's `order_settings.gift_messages` is on).
     * Copied to the order when it is placed, cleared with the cart. Never sent to anyone but the buyer.
     */
    isGift: boolean("is_gift").notNull().default(false),
    giftTo: text("gift_to"),
    giftFrom: text("gift_from"),
    giftMessage: text("gift_message"),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("carts_store_id_key").on(t.storeId, t.id),
    uniqueIndex("carts_handoff_idx").on(t.handoffHash),
    check("carts_handoff_to", sql`${t.handoffTo} is null or ${t.handoffTo} in ('cart', 'checkout')`),
    check("carts_gift_fields", giftFieldsCheck(t)),
    check("carts_bonus_request", sql`${t.bonusRequestMinor} >= 0`),
    check("carts_vat_number", sql`${t.vatNumber} is null or ${t.vatNumber} ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$'`),
    foreignKey({ name: "carts_vat_check_fk", columns: [t.storeId, t.vatCheckId], foreignColumns: [vatChecks.storeId, vatChecks.id] }),
    index("carts_vat_check_idx").on(t.storeId, t.vatCheckId),
    index("carts_visit_idx").on(t.visitId),
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
    /**
     * The bonus credits used on the order (D130), in the order's currency: a part of the discount (so the total adds
     * up), taken off goods last and spread over the lines as `order_lines.bonus_discount_minor`.
     */
    creditMinor: money("credit_minor").default(0),
    /**
     * What the order earned when it was paid (D130), in the order's currency before it is converted into the credits'
     * currency, and when those credits can be used. Null until paid, and for a guest or an order that earns nothing.
     */
    bonusEarnedMinor: bigint("bonus_earned_minor", { mode: "number" }),
    bonusAvailableAt: timestamp("bonus_available_at", { withTimezone: true }),
    /**
     * The friend's welcome discount from an affiliate's link (D131), in the order's currency: a part of the discount
     * (so the total adds up), taken off goods after campaigns and the group's discount and before codes and credits,
     * spread over the lines as `order_lines.referral_discount_minor`.
     */
    referralDiscountMinor: money("referral_discount_minor").default(0),
    /**
     * The delivery the shopper chose (D135) when it was a carrier's service rather than the flat rate: `carrier`,
     * `serviceId`, `label`, the `postalCode` it was priced for and the chosen `pickupPoint`. Kept as it was bought.
     */
    delivery: jsonb("delivery"),
    /**
     * Which VAT the order carries (D157): `standard` (the destination country's), `reverse_charge` (a business buyer's
     * valid VAT number in another member state: no VAT charged) or `ioss` (a consignment of at most 150 EUR marked with
     * the store's IOSS number; the price is unchanged). The VAT not charged is `vat_relief_minor`, part of
     * `discount_minor` (so the total adds up) with each line's share in `order_lines.vat_relief_minor`; `tax_minor` is 0
     * then. A copied order (D129) keeps kind and relief so the checks hold, never the treatment or a number.
     */
    vatKind: text("vat_kind").notNull().default("standard"),
    vatReliefMinor: money("vat_relief_minor").default(0),
    /** The rate the shipping was charged at, as it was then (the country's rate changes over time); null on older orders. */
    shippingTaxRate: numeric("shipping_tax_rate", { precision: 6, scale: 4 }),
    /**
     * The treatment as it was decided (`OrderVatTreatment`, `src/lib/vat-treatment.ts`): kind, reason, both VAT numbers,
     * the VIES answer, the IOSS number. Frozen once the order leaves `pending_payment`; the invoice (unit 1b) reads
     * the seller's number from here, never from the live profile. Never copied.
     */
    vatTreatment: jsonb("vat_treatment"),
    vatCheckId: uuid("vat_check_id"),
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
    /**
     * When the goods reached the customer; starts the withdrawal period (D153). Written by staff (*Mark delivered*) or
     * by a carrier's tracking, never estimated: the statutory period does not start from the date a parcel was sent.
     */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /**
     * Who pays for sending a withdrawn item back, as the store's setting stood when the order was placed (D153): the
     * consumer is told of that cost before buying (CRD Art. 6(1)(i)), so a later change of the setting changes nothing
     * for this order. Null for an order with no record, which counts as the store paying.
     */
    returnCostPayer: text("return_cost_payer"),
    /**
     * The cheapest standard delivery the store offered for the basket when it was placed, in the order's currency (D153):
     * the market's flat rate (free over its limit, judged on the basket before discounts), kept so a withdrawal of the
     * whole order refunds no more delivery than that (Art. 13(1)) whatever a carrier's dearer service cost. Null when
     * it was not worked out.
     */
    standardShippingMinor: bigint("standard_shipping_minor", { mode: "number" }),
    /** The subscription this order started or renewed (D25). */
    subscriptionId: uuid("subscription_id"),
    /** The discount code used, and its text as the shopper saw it (D31). */
    discountCodeId: uuid("discount_code_id"),
    discountCode: text("discount_code"),
    /** The company the order was placed for (B2B), shown on the order and its invoice. */
    companyName: text("company_name"),
    organisationNumber: text("organisation_number"),
    /**
     * Set on an order copied from another store (D129): the original's id. A copied order is read-only history
     * (numbered `C-{original number}`, with no payment, refund, invoice, shipment or effect on stock), refused by
     * triggers in the store-copy migration.
     */
    copiedFrom: uuid("copied_from"),
    /**
     * Set when an erasure (D162) cut the order loose from the person while the bookkeeping duty keeps it: `customer_id` is
     * null from then on, no reader matches it to a person, it is never emailed, relinked or copied. Anonymised (see
     * `anonymised_at`) when the seller's country's period ends. Written only by `commerce.anonymise_order()`.
     */
    restrictedAt: timestamp("restricted_at", { withTimezone: true }),
    /** When the personal fields were replaced by a marker (`[removed]`); the sale itself (number, amounts, VAT, lines) stays. */
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    /**
     * Archived (wave 3, run 2, D173): set = the order has left the default list and every queue. A visibility state only: no amount, number,
     * stock, document or figure changes. Written only by `src/server/order-archive.ts`; the one column of a copied order (D129) that may change
     * besides its customer link. An order waiting for payment is never archived.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** `checkout` (a shopper's cart, a renewal, copied history) or `draft` (a staff-made order from a draft order, sent or paid outside Kaizen). */
    source: text("source").notNull().default("checkout"),
    /**
     * The draft order this order was made from. No foreign key (like `copied_from`): a draft is deleted by the clean-up while its order lives on,
     * and several orders can name one draft over time (reopen and send again).
     */
    draftId: uuid("draft_id"),
    /** The staff member who sent or paid the draft; null for every other order. */
    madeBy: uuid("made_by").references(() => accounts.id),
    /**
     * The order-level discount staff gave on a draft (D173): a part of `discount_minor` (so the total adds up), spread over the lines as
     * `order_lines.staff_discount_minor`, and the label the buyer sees. `OrderView.discountMinor` leaves it out and shows it as its own row.
     */
    staffDiscountMinor: money("staff_discount_minor").default(0),
    staffDiscountLabel: text("staff_discount_label"),
    /** A gift (D173): copied from the cart when the order is placed, frozen after (the database refuses a change), erased with the order. */
    isGift: boolean("is_gift").notNull().default(false),
    giftTo: text("gift_to"),
    giftFrom: text("gift_from"),
    giftMessage: text("gift_message"),
    /**
     * When staff last applied a change to the order's goods (wave 3 run 3, D174, `order_edits`): the list's *Edited* badge. Written only under the edit context
     * (`kaizen.order_edit`, `applyOrderEdit()`); the money columns above change after `pending_payment` only there too (`orders_settled_guard()`).
     */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("orders_archived_not_pending", sql`${t.archivedAt} is null or ${t.status} <> 'pending_payment'`),
    check("orders_source", sql`${t.source} in ('checkout', 'draft')`),
    check(
      "orders_source_draft",
      sql`(${t.source} = 'draft') = (${t.draftId} is not null) and (${t.source} = 'draft') = (${t.madeBy} is not null)`,
    ),
    check("orders_staff_discount", sql`${t.staffDiscountMinor} between 0 and ${t.discountMinor}`),
    check(
      "orders_staff_discount_label",
      sql`${t.staffDiscountLabel} is null or (${t.staffDiscountMinor} > 0 and char_length(${t.staffDiscountLabel}) between 1 and ${lit(DRAFT_DISCOUNT_LABEL_MAX)})`,
    ),
    check("orders_gift_fields", giftFieldsCheck(t)),
    index("orders_made_by_idx").on(t.madeBy),
    index("orders_draft_idx")
      .on(t.storeId, t.draftId)
      .where(sql`${t.draftId} is not null`),
    uniqueIndex("orders_copied_from_key").on(t.storeId, t.copiedFrom).where(sql`${t.copiedFrom} is not null`),
    check("orders_copied_number", sql`${t.copiedFrom} is null or ${t.number} like 'C-%'`),
    check("orders_credit", sql`${t.creditMinor} between 0 and ${t.discountMinor}`),
    check("orders_vat_kind", sql`${t.vatKind} in ('standard', 'reverse_charge', 'ioss')`),
    check("orders_vat_relief", sql`${t.vatReliefMinor} between 0 and ${t.discountMinor}`),
    check(
      "orders_vat_kind_relief",
      sql`(${t.vatKind} = 'reverse_charge' and ${t.taxMinor} = 0 and ${t.vatReliefMinor} > 0) or (${t.vatKind} <> 'reverse_charge' and ${t.vatReliefMinor} = 0)`,
    ),
    check("orders_shipping_tax_rate", sql`${t.shippingTaxRate} is null or (${t.shippingTaxRate} >= 0 and ${t.shippingTaxRate} < 1)`),
    foreignKey({
      name: "orders_vat_check_fk",
      columns: [t.storeId, t.vatCheckId],
      foreignColumns: [vatChecks.storeId, vatChecks.id],
    }).onDelete("restrict"),
    index("orders_vat_check_idx").on(t.storeId, t.vatCheckId),
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
    /** The retention job's scan: orders not yet anonymised, oldest first (D162). */
    index("orders_retention_idx").on(t.storeId, t.placedAt).where(sql`${t.anonymisedAt} is null`),
    check(
      "orders_anonymised",
      sql`${t.anonymisedAt} is null or (${t.email} = '[removed]' and ${t.billingAddress} = '{}'::jsonb and ${t.shippingAddress} = '{}'::jsonb and ${t.companyName} is null and ${t.organisationNumber} is null and not ${t.isGift} and ${t.giftTo} is null and ${t.giftFrom} is null and ${t.giftMessage} is null)`,
    ),
    index("orders_email_idx").on(t.storeId, sql`lower(${t.email})`),
    /** The withdrawal function finds an order by its number typed without spaces or case (`matchOrder()`). */
    index("orders_number_normalised_idx").on(t.storeId, sql`upper(regexp_replace(${t.number}, '\\s', '', 'g'))`),
    check("orders_return_cost_payer", sql`${t.returnCostPayer} is null or ${t.returnCostPayer} in ('shopper', 'store')`),
    check("orders_standard_shipping", sql`${t.standardShippingMinor} is null or ${t.standardShippingMinor} >= 0`),
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
    /**
     * The variant's cost per unit when the line was sold (D152), in the store's main currency; null when it was not
     * known (it can be filled in later by `backfillCosts()`). Never read for a price.
     */
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
    discountMinor: money("discount_minor").default(0),
    /** The part of the discount that is the buyer's group or company discount (D108). */
    memberDiscountMinor: money("member_discount_minor").default(0),
    /** The part a campaign gave (D114), and which; a gift line is the whole line, at its list price. */
    campaignDiscountMinor: money("campaign_discount_minor").default(0),
    /** The part that bonus credits paid (D130), taken off last; the credits' share of the line, so VAT and refunds agree. */
    bonusDiscountMinor: money("bonus_discount_minor").default(0),
    /** The part the friend's welcome discount gave (D131); the line's share, so VAT and refunds agree. */
    referralDiscountMinor: money("referral_discount_minor").default(0),
    /**
     * The VAT a reverse-charge order did not charge on this line (D157): part of the discount, so the total adds up,
     * and `tax_minor` is 0; `tax_rate` keeps the rate that would have applied.
     */
    vatReliefMinor: money("vat_relief_minor").default(0),
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
    /**
     * Unit price (D160): the variant's measure when the line was sold, and the base that was effective for the market
     * (never null when the amount is set). Frozen after insert; the price per measure is derived on read.
     */
    measureAmount: numeric("measure_amount", { precision: 12, scale: 4 }),
    measureUnit: text("measure_unit"),
    measureBase: text("measure_base"),
    /**
     * Units of the line sold on backorder (wave 3, D172): what the shopper was told when the order was placed, settled when it is paid
     * (`commerce.draw_order_stock()` rewrites it once; for a live hold it only goes down: an earlier checkout's claim is kept whatever
     * the order of payment). Nothing else changes it.
     */
    backorderQuantity: integer("backorder_quantity").notNull().default(0),
    /** The delivery time stated for the backorder, in days, frozen from the variant when the order was placed. */
    backorderDays: integer("backorder_days"),
    /**
     * A draft order's line (D173): the market's list price as shown when the line was added, kept for information only (the price charged is
     * `unit_price_minor`, a custom price is not a discount and no total reads this); null for every other line.
     */
    listPriceMinor: bigint("list_price_minor", { mode: "number" }),
    /** A custom item staff typed in a draft (no variant, `sku` `CUSTOM`, a service). A sign-up fee line is not one. */
    custom: boolean("custom").notNull().default(false),
    /** The part of the discount that is the staff discount of a draft order (D173): the line's share, so VAT and refunds agree. */
    staffDiscountMinor: money("staff_discount_minor").default(0),
    /** The order change that added this line (wave 3 run 3, D174); null for a line placed with the order. Frozen after insert. */
    orderEditId: uuid("order_edit_id"),
  },
  (t) => [
    unique("order_lines_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "order_lines_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }).onDelete("restrict"),
    index("order_lines_order_edit_idx")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.orderEditId} is not null`),
    check("order_lines_list_price", sql`${t.listPriceMinor} is null or ${t.listPriceMinor} >= 0`),
    check("order_lines_custom", sql`not ${t.custom} or (${t.variantId} is null and ${t.sku} = 'CUSTOM' and ${t.delivery} = 'service')`),
    check("order_lines_staff_discount", sql`${t.staffDiscountMinor} between 0 and ${t.discountMinor}`),
    /** Written for lines that carry a staff discount only: it makes every older row pass, and the parts of a draft's line add up. */
    check(
      "order_lines_discount_parts",
      sql`${t.staffDiscountMinor} = 0 or ${t.memberDiscountMinor} + ${t.campaignDiscountMinor} + ${t.bonusDiscountMinor} + ${t.referralDiscountMinor} + ${t.vatReliefMinor} + ${t.staffDiscountMinor} <= ${t.discountMinor}`,
    ),
    check("order_lines_backorder_quantity", sql`${t.backorderQuantity} between 0 and ${t.quantity}`),
    check("order_lines_backorder_days", sql`${t.backorderDays} between 1 and 90`),
    check("order_lines_backorder_stated", sql`${t.backorderQuantity} = 0 or ${t.backorderDays} is not null`),
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
    check("order_lines_bonus_discount", sql`${t.bonusDiscountMinor} between 0 and ${t.discountMinor}`),
    check("order_lines_referral_discount", sql`${t.referralDiscountMinor} between 0 and ${t.discountMinor}`),
    check("order_lines_vat_relief", sql`${t.vatReliefMinor} between 0 and ${t.discountMinor}`),
    check("order_lines_venue", sql`${t.venueMinor} between 0 and ${t.totalMinor}`),
    check("order_lines_unit_cost", sql`${t.unitCostMinor} >= 0`),
    check("order_lines_measure_pair", sql`(${t.measureAmount} is null) = (${t.measureUnit} is null)`),
    check("order_lines_measure_amount", sql`${t.measureAmount} > 0 and ${t.measureAmount} <= 1000000`),
    check(
      "order_lines_measure_unit",
      sql`${t.measureUnit} in ('g', 'kg', 'ml', 'cl', 'l', 'cm', 'm', 'm2', 'piece')`,
    ),
    check(
      "order_lines_measure_base",
      sql`(${t.measureAmount} is null) = (${t.measureBase} is null) and (${t.measureBase} is null or (
        (${t.measureUnit} in ('g', 'kg') and ${t.measureBase} in ('kg', '100g'))
        or (${t.measureUnit} in ('ml', 'cl', 'l') and ${t.measureBase} in ('l', '100ml'))
        or (${t.measureUnit} in ('cm', 'm') and ${t.measureBase} = 'm')
        or (${t.measureUnit} = 'm2' and ${t.measureBase} = 'm2')
        or (${t.measureUnit} = 'piece' and ${t.measureBase} = 'piece')))`,
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
    /**
     * The part of `quantity` held beyond the stock that was there when the checkout started (a variant that keeps selling on
     * backorder, wave 3 D172): it holds no unit. The rest, `quantity - backorder_quantity`, is the physical claim of the
     * order, which a later checkout paying first cannot take (`commerce.draw_order_stock()`); the shopper was told which was which.
     */
    backorderQuantity: integer("backorder_quantity").notNull().default(0),
    cartId: uuid("cart_id"),
    orderId: uuid("order_id"),
    /**
     * Units held for an order change waiting for the customer's payment (wave 3 run 3, D174): the order is `order_id`, the change this. `draw_order_stock()`
     * ignores them; `commerce.draw_edit_stock()` draws them when the change is applied.
     */
    orderEditId: uuid("order_edit_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "inventory_reservations_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    index("inventory_reservations_order_edit_idx")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.orderEditId} is not null`),
    check("inventory_reservations_order_edit", sql`${t.orderEditId} is null or ${t.orderId} is not null`),
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
    check("inventory_reservations_backorder_within", sql`${t.backorderQuantity} between 0 and ${t.quantity}`),
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
    /**
     * A payment at the venue (no Stripe account to say so) made while the store's Stripe was in test mode (D159): set by a trigger when the
     * row is made, so the mode is frozen with the payment and a store that later goes live never gives a test order a legal invoice number.
     * Always false for any other provider (a Stripe payment's mode is its account's).
     */
    testMode: boolean("test_mode").notNull().default(false),
    /**
     * A payment taken outside Kaizen's Stripe (D173, `provider = 'manual'`): how (`cash`, `bank_transfer`, `other`) and which staff member
     * recorded it. Set if and only if the provider is `manual`; such a payment has no Stripe account, no fee, and is always real money.
     */
    method: text("method"),
    recordedBy: uuid("recorded_by").references(() => accounts.id),
    /**
     * The day the money reached the store, in the store's own days (a bank transfer recorded on the 2nd was received on the 30th): only on a payment taken outside Kaizen, and only when staff gave it (D173 review).
     * The invoice's supply date, and so the VAT and OSS period (D161), is this day; without one it is the day the payment was recorded.
     */
    receivedOn: date("received_on", { mode: "string" }),
    /** A payment of an order change's difference (wave 3 run 3, D174): `applySession()` routes by it and never calls `complete_order_payment()` for it. */
    orderEditId: uuid("order_edit_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payments_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "payments_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    index("payments_order_edit_idx")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.orderEditId} is not null`),
    check("payments_received_manual", sql`${t.receivedOn} is null or ${t.provider} = 'manual'`),
    index("payments_recorded_by_idx").on(t.recordedBy),
    check("payments_manual_method", sql`(${t.provider} = 'manual') = (${t.method} is not null) and (${t.method} is null or ${t.method} in ('cash', 'bank_transfer', 'other'))`),
    check("payments_manual_recorded", sql`${t.provider} <> 'manual' or ${t.recordedBy} is not null`),
    /** A payment taken outside Kaizen is real money whatever mode Stripe is in (`payments_venue_mode` only marks venue payments). */
    check("payments_manual_real", sql`${t.provider} <> 'manual' or not ${t.testMode}`),
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
    /**
     * The refund of an order change's lower total, or of a change's payment that arrived when the change could no longer be applied (wave 3 run 3, D174). The
     * first gets no credit note of its own (the change's covers it) and is not a refund in analytics.
     */
    orderEditId: uuid("order_edit_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("refunds_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "refunds_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    index("refunds_order_edit_idx")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.orderEditId} is not null`),
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
    /** A shipment booked through a carrier's connection (D134): which carrier, its shipment number and where the label is. */
    carrierId: text("carrier_id"),
    consignmentNumber: text("consignment_number"),
    labelUrl: text("label_url"),
    createdBy: uuid("created_by").references(() => accounts.id),
    /**
     * Recorded before parcels named their lines (wave 3 run 3, D174): counts as every physical unit of the order sent. The rules migration set it for every row that
     * existed; nothing sets it afterwards. A shipment that is not legacy names its lines and quantities in `shipment_lines` (`markSent()` is the only writer).
     */
    legacy: boolean("legacy").notNull().default(false),
    /**
     * Undone (D174 follow-up, `undoShipment()` / `commerce.undo_shipment()`): staff took "sent" back. The parcel is kept for the history and the audit, but counts
     * nowhere (what is sent, the order's state, slips, labels, emails, the list, the AI tools). Set once, never cleared; `undo_reason` is staff's own words (optional,
     * at most 200 characters, replaced by a marker when the order is anonymised, D162).
     */
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => accounts.id),
    undoReason: text("undo_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shipments_store_id_key").on(t.storeId, t.id),
    orderRef("shipments_order_fk", t),
    index("shipments_order_idx").on(t.storeId, t.orderId),
    index("shipments_created_by_idx").on(t.createdBy),
    index("shipments_undone_by_idx").on(t.undoneBy),
    check("shipments_tracking_url", sql`${t.trackingUrl} ~ '^https://'`),
    check("shipments_label_url", sql`${t.labelUrl} is null or ${t.labelUrl} ~ '^https://'`),
    check("shipments_undo_reason", sql`${t.undoReason} is null or (${t.undoneAt} is not null and char_length(${t.undoReason}) <= 200)`),
    check("shipments_undone_by", sql`${t.undoneBy} is null or ${t.undoneAt} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Withdrawals and returns
// ---------------------------------------------------------------------------

const reasonList = sql.raw(RETURN_REASONS.map((r) => `'${r}'`).join(", "));

/**
 * A use of the withdrawal button (Directive (EU) 2023/2673, D153): the legal notice. The physical return of goods is
 * tracked separately in `returns`. A request is `pending` after the shopper's first step and expires after 24 hours
 * unconfirmed (deleted by `commerce.expire_withdrawal_requests()`); `confirmed` is the legal act. Rules in SQL: a
 * confirmed request is a record that cannot be changed (but for its acknowledgement), and only a pending one confirms.
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
    /** The order's language, which the acknowledgement is written in, and the country the shopper used. */
    locale: text("locale").notNull().default("en"),
    marketCode: char("market_code", { length: 2 }),
    /** `pending`, `confirmed` or `expired`; `confirmed_at` is set exactly when it is `confirmed`. */
    status: text("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** When an unconfirmed request lapses; a confirm after it is refused. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '24 hours'`),
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
    index("withdrawal_requests_expiry_idx").on(t.expiresAt).where(sql`${t.confirmedAt} is null`),
    check(
      "withdrawal_requests_ack_after_confirm",
      sql`${t.acknowledgedAt} is null or ${t.confirmedAt} is not null`,
    ),
    check("withdrawal_requests_status", sql`${t.status} in ('pending', 'confirmed', 'expired')`),
    check("withdrawal_requests_confirmed", sql`(${t.status} = 'confirmed') = (${t.confirmedAt} is not null)`),
    check("withdrawal_requests_confirm_after_submit", sql`${t.confirmedAt} is null or ${t.confirmedAt} >= ${t.submittedAt}`),
    check("withdrawal_requests_ack_in_order", sql`${t.acknowledgedAt} is null or ${t.acknowledgedAt} >= ${t.confirmedAt}`),
    check("withdrawal_requests_expires_after_submit", sql`${t.expiresAt} >= ${t.submittedAt}`),
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

/**
 * Attempts at the withdrawal function that matched no order (D153), kept only as hashes of what the request itself
 * supplied (the store with the normalised email, or with the order number), so repeated guessing can be limited
 * without an IP address or a cookie. No raw email or number is stored, and the rows are deleted after a day by the
 * daily job (`commerce.expire_withdrawal_requests()`).
 */
export const withdrawalAttempts = commerce.table(
  "withdrawal_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** `email` or `order`. */
    keyKind: text("key_kind").notNull(),
    /** sha-256 (hex) of the store id and the normalised value. */
    keyHash: text("key_hash").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("withdrawal_attempts_key_idx").on(t.storeId, t.keyKind, t.keyHash, t.at),
    index("withdrawal_attempts_at_idx").on(t.at),
    check("withdrawal_attempts_kind", sql`${t.keyKind} in ('email', 'order')`),
  ],
);

/**
 * The physical side (D153): created by a confirmed withdrawal (`kind = 'withdrawal'`, starts `approved`) or by a
 * shopper's request inside the store's own longer window (`kind = 'return'`, starts `requested`). `number` is
 * `{order number}-R{n}`, assigned in SQL. Quantities within what is left, the lifecycle, the timestamps' order and a
 * refund never above what was paid are enforced by `returns_rules`.
 */
export const returns = commerce.table(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    withdrawalRequestId: uuid("withdrawal_request_id"),
    status: returnStatus("status").notNull().default("requested"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** `withdrawal` (the statutory right, needs a confirmed request) or `return` (the store's own window). */
    kind: text("kind").notNull().default("return"),
    /** Per order, `{order number}-R{n}`; assigned by a trigger. */
    number: text("number").notNull(),
    reason: text("reason"),
    reasonNote: text("reason_note"),
    /** What the store tells the shopper to do, and the address as it was when the return was made. */
    instructions: text("instructions"),
    labelUrl: text("label_url"),
    returnAddress: jsonb("return_address"),
    /** Why the store declined (a voluntary return), or a note with its approval; emailed to the shopper. */
    decisionNote: text("decision_note"),
    /** Staff's own notes; never shown to the shopper. */
    staffNote: text("staff_note"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** The shopper's proof of sending, or staff's. */
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** `refunded`, `declined`, `no_refund` or `cancelled`; set when the return ends. */
    outcome: text("outcome"),
    /** The refund made through `refundOrder()`, when one was made through Stripe (null when refunded outside or not at all). */
    refundId: uuid("refund_id"),
    /** What `refundFor()` worked out; what was actually refunded is `refund_minor`, and a difference has a reason. */
    refundComputedMinor: bigint("refund_computed_minor", { mode: "number" }),
    refundMinor: bigint("refund_minor", { mode: "number" }),
    refundNote: text("refund_note"),
    /**
     * What `refundFor()` worked out as the credit note reads it (D159): `{ lines: [{ lineId, quantity, valueMinor, deductionMinor }],
     * deliveryMinor, returnShippingMinor, adjustmentMinor, amountMinor, outside }`. Written once, with the refund.
     */
    refundWorking: jsonb("refund_working"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    /** Refunded outside Kaizen's Stripe (a note and an event; nothing sent from here). */
    refundOutside: boolean("refund_outside").notNull().default(false),
    /** The return shipping cost taken off the refund when the shopper pays it. */
    returnShippingMinor: bigint("return_shipping_minor", { mode: "number" }).notNull().default(0),
    /** The delivery this return's refund gave back (Art. 13(1)): later returns of the order take it off what is left. */
    shippingRefundMinor: bigint("shipping_refund_minor", { mode: "number" }).notNull().default(0),
    /** Set while a staff member's refund of this return is with Stripe, so two at once cannot both pay it; cleared when it is recorded or fails. */
    refundClaimedAt: timestamp("refund_claimed_at", { withTimezone: true }),
    /** The latest day the store may refund (14 days after it was informed of a withdrawal, Art. 13(1)). */
    refundDeadline: timestamp("refund_deadline", { withTimezone: true }),
    /** For the shopper's status page: a secret address that shows and changes nothing. */
    publicToken: text("public_token")
      .notNull()
      .default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
  },
  (t) => [
    unique("returns_store_id_key").on(t.storeId, t.id),
    unique("returns_store_number_key").on(t.storeId, t.number),
    unique("returns_public_token_key").on(t.publicToken),
    uniqueIndex("returns_withdrawal_request_key")
      .on(t.storeId, t.withdrawalRequestId)
      .where(sql`${t.withdrawalRequestId} is not null`),
    orderRef("returns_order_fk", t),
    foreignKey({
      name: "returns_withdrawal_request_fk",
      columns: [t.storeId, t.withdrawalRequestId],
      foreignColumns: [withdrawalRequests.storeId, withdrawalRequests.id],
    }),
    foreignKey({
      name: "returns_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    index("returns_order_idx").on(t.storeId, t.orderId),
    index("returns_withdrawal_request_idx").on(t.storeId, t.withdrawalRequestId),
    index("returns_refund_idx").on(t.storeId, t.refundId),
    index("returns_queue_idx").on(t.storeId, t.status, t.createdAt),
    index("returns_refund_deadline_idx").on(t.storeId, t.refundDeadline),
    check("returns_kind", sql`${t.kind} in ('withdrawal', 'return')`),
    check("returns_kind_request", sql`(${t.kind} = 'withdrawal') = (${t.withdrawalRequestId} is not null)`),
    check("returns_reason", sql`${t.reason} is null or ${t.reason} in (${reasonList})`),
    check("returns_reason_note", sql`${t.reasonNote} is null or length(${t.reasonNote}) <= 500`),
    check("returns_instructions", sql`${t.instructions} is null or length(${t.instructions}) <= 2000`),
    check("returns_decision_note", sql`${t.decisionNote} is null or length(${t.decisionNote}) <= 1000`),
    check("returns_staff_note", sql`${t.staffNote} is null or length(${t.staffNote}) <= 2000`),
    check("returns_label_url", sql`${t.labelUrl} is null or ${t.labelUrl} ~ '^https://'`),
    check("returns_outcome", sql`${t.outcome} is null or ${t.outcome} in ('refunded', 'declined', 'no_refund', 'cancelled')`),
    check(
      "returns_amounts",
      sql`${t.returnShippingMinor} >= 0 and ${t.refundMinor} >= 0 and ${t.refundComputedMinor} >= 0 and ${t.shippingRefundMinor} >= 0`,
    ),
    check("returns_refund_recorded", sql`(${t.refundMinor} is null) = (${t.refundedAt} is null)`),
    check("returns_refund_stripe", sql`${t.refundId} is null or (${t.refundMinor} is not null and not ${t.refundOutside})`),
    check("returns_refund_outside", sql`not ${t.refundOutside} or ${t.refundMinor} is not null`),
    check(
      "returns_times_in_order",
      sql`(${t.receivedAt} is null or ${t.approvedAt} is null or ${t.receivedAt} >= ${t.approvedAt})
        and (${t.inspectedAt} is null or ${t.receivedAt} is null or ${t.inspectedAt} >= ${t.receivedAt})
        and (${t.closedAt} is null or ${t.inspectedAt} is null or ${t.closedAt} >= ${t.inspectedAt})
        and (${t.closedAt} is null or ${t.receivedAt} is null or ${t.closedAt} >= ${t.receivedAt})
        and (${t.shippedAt} is null or ${t.receivedAt} is null or ${t.shippedAt} <= ${t.receivedAt})`,
    ),
  ],
);

/**
 * The history of stock (wave 3, D172, `docs/wave-3-inventory.md` 3.2): every change of `inventory_levels.on_hand` is a row here,
 * written by the trigger `commerce.record_inventory_movement()` (so every writer is covered, the SQL functions too), which reads
 * why, by whom and for which order from `commerce.stock_context()`. Append-only: no update, and a row can be removed only when
 * it is older than 24 months (`commerce.guard_inventory_movements()`, `pruneInventoryMovements()`). For every variant and
 * location the movements add up to the level (`commerce.inventory_ledger_check()`). A movement holds no personal data: an
 * account id, an order id and a short note about stock.
 */
export const inventoryMovements = commerce.table(
  "inventory_movements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    /** The change of the level; never 0. */
    delta: integer("delta").notNull(),
    /** The level's figure after the change. */
    onHandAfter: integer("on_hand_after").notNull(),
    /** `src/lib/inventory.ts` `MOVEMENT_REASONS`. */
    reason: text("reason").notNull(),
    /** `src/lib/inventory.ts` `MOVEMENT_SOURCES`. */
    source: text("source").notNull(),
    /** The staff account, an id only (the name is read from `accounts` when shown); null for the system. */
    actorAccountId: uuid("actor_account_id"),
    orderId: uuid("order_id"),
    returnId: uuid("return_id"),
    /** An import job or a bulk batch; no foreign key, those rows expire sooner than the history. */
    jobId: uuid("job_id"),
    /** Typed by staff on a manual change only; at most 200 characters. */
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    variantRef("inventory_movements_variant_fk", t),
    locationRef("inventory_movements_location_fk", t),
    orderRef("inventory_movements_order_fk", t),
    foreignKey({
      name: "inventory_movements_return_fk",
      columns: [t.storeId, t.returnId],
      foreignColumns: [returns.storeId, returns.id],
    }),
    index("inventory_movements_variant_idx").on(t.storeId, t.variantId, t.id.desc()),
    index("inventory_movements_created_idx").on(t.storeId, t.createdAt.desc()),
    index("inventory_movements_order_idx")
      .on(t.storeId, t.orderId)
      .where(sql`${t.orderId} is not null`),
    index("inventory_movements_location_idx").on(t.storeId, t.locationId),
    index("inventory_movements_return_idx")
      .on(t.storeId, t.returnId)
      .where(sql`${t.returnId} is not null`),
    check("inventory_movements_delta", sql`${t.delta} <> 0`),
    check("inventory_movements_reason", sql`${t.reason} in (${sqlList(MOVEMENT_REASONS)})`),
    check("inventory_movements_source", sql`${t.source} in (${sqlList(MOVEMENT_SOURCES)})`),
    check("inventory_movements_note", sql`${t.note} is null or length(${t.note}) <= 200`),
  ],
);

/**
 * The low-stock state of a variant with a level set (wave 3, D172, `docs/wave-3-inventory.md` 3.4): one row per variant, moved by
 * `commerce.refresh_stock_alert()` (the same table as `nextAlertState()` in `src/lib/stock-alerts.ts`). `low` with
 * `notified_at` null is a crossing the five-minute job has not told the owners about yet. Kept with the variant; a cleared level
 * is state `off`, never a deleted row.
 */
export const stockAlerts = commerce.table(
  "stock_alerts",
  {
    storeId: storeId(),
    variantId: uuid("variant_id").notNull(),
    /** `off` (no level), `ok` (above it) or `low` (at or below it). */
    state: text("state").notNull(),
    crossedAt: timestamp("crossed_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** On hand over the active locations when it crossed. */
    stockAtCrossing: integer("stock_at_crossing"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.variantId] }),
    variantRef("stock_alerts_variant_fk", t).onDelete("cascade"),
    index("stock_alerts_low_idx")
      .on(t.storeId, t.crossedAt)
      .where(sql`${t.state} = 'low'`),
    check("stock_alerts_state", sql`${t.state} in ('off', 'ok', 'low')`),
    check("stock_alerts_crossing", sql`(${t.state} = 'low') = (${t.crossedAt} is not null)`),
  ],
);

export const returnLines = commerce.table(
  "return_lines",
  {
    storeId: storeId(),
    returnId: uuid("return_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** What staff found when inspecting: `as_new`, `opened`, `used` or `damaged`. */
    condition: text("condition"),
    reason: text("reason"),
    /** Whether the units go back into stock. */
    restock: boolean("restock").notNull().default(false),
    /** The diminished value taken off (CRD Art. 14(2)), in the order's currency; never above the line's value. */
    deductionMinor: bigint("deduction_minor", { mode: "number" }).notNull().default(0),
    deductionNote: text("deduction_note"),
    /** `accept`, or `decline` (only for a line the law excludes, or on a voluntary return). */
    decision: text("decision").notNull().default("accept"),
    declineReason: text("decline_reason"),
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
    check("return_lines_condition", sql`${t.condition} is null or ${t.condition} in ('as_new', 'opened', 'used', 'damaged')`),
    check("return_lines_reason", sql`${t.reason} is null or ${t.reason} in (${reasonList})`),
    check("return_lines_deduction", sql`${t.deductionMinor} >= 0`),
    check("return_lines_deduction_note", sql`${t.deductionNote} is null or length(${t.deductionNote}) <= 500`),
    check("return_lines_decision", sql`${t.decision} in ('accept', 'decline')`),
    check("return_lines_decline_reason", sql`${t.decision} = 'accept' or length(trim(coalesce(${t.declineReason}, ''))) > 0`),
    check("return_lines_declined_nothing", sql`${t.decision} = 'accept' or (${t.deductionMinor} = 0 and not ${t.restock})`),
  ],
);

/**
 * A store's rules for returns (D153): one row per store (a store without one has the legal defaults, `docs/returns.md`).
 * A store setting, copied with a store; edited by owners at `/admin/{store}/settings/returns`.
 */
export const returnSettings = commerce.table(
  "return_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    /** The store's own window in days, 14 at least (the legal 14 days are never shortened). */
    windowDays: integer("window_days").notNull().default(14),
    /** Days the store allows for transit before the withdrawal period starts, when delivery is unknown. */
    transitDays: integer("transit_days").notNull().default(3),
    /** `shopper` or `store`: who pays for sending a withdrawn item back. */
    whoPaysReturn: text("who_pays_return").notNull().default("shopper"),
    /** `received` (refund once the goods are back or proof of sending is shown) or `request`. */
    refundWhen: text("refund_when").notNull().default("received"),
    /** Whether goods the law excludes can still be returned inside the store's own window. */
    acceptExcluded: boolean("accept_excluded").notNull().default(false),
    /** Shown and emailed, in the store's main language. */
    instructions: text("instructions").notNull().default(""),
    /** The instructions in the store's other languages, `{ "sv": "…" }`: written by staff or accepted from the store translation (D110). */
    instructionsTranslations: jsonb("instructions_translations").notNull().default(sql`'{}'::jsonb`),
    /** Where returns are sent: name, street, postal code, city, country; null is the store's postal address. */
    returnAddress: jsonb("return_address"),
    /** Voluntary returns for company orders. */
    b2bReturns: boolean("b2b_returns").notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("return_settings_updated_by_idx").on(t.updatedBy),
    check("return_settings_window", sql`${t.windowDays} between 14 and 100`),
    check("return_settings_transit", sql`${t.transitDays} between 0 and 14`),
    check("return_settings_who_pays", sql`${t.whoPaysReturn} in ('shopper', 'store')`),
    check("return_settings_refund_when", sql`${t.refundWhen} in ('received', 'request')`),
    check("return_settings_instructions", sql`length(${t.instructions}) <= 2000`),
  ],
);

/**
 * A store's tax registration (D157, `docs/wave-1a-tax.md`): whether it is registered for VAT and under which number,
 * where it sends goods from, its OSS and IOSS registrations. One row per store, made on first save (no row means all
 * defaults). A store setting edited by owners at `/admin/{store}/settings/tax`; a copy of a store keeps the choices but
 * never the numbers (a number belongs to one legal entity, `commerce.duplicate_store()`).
 */
export const storeTaxProfile = commerce.table(
  "store_tax_profile",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    vatRegistered: boolean("vat_registered").notNull().default(false),
    /** Normalised with its country prefix (`SE556677889901`, Greece `EL`), never typed freely. */
    vatNumber: text("vat_number"),
    /** The latest check of the number (a `vat_checks` row) and its result, copied here; saving another number clears all three. */
    vatNumberCheckId: uuid("vat_number_check_id"),
    vatNumberCheckedAt: timestamp("vat_number_checked_at", { withTimezone: true }),
    vatNumberValid: boolean("vat_number_valid"),
    /** The country goods are sent from (defaults to the company's); decides whether a consignment comes from outside the EU. */
    dispatchCountry: char("dispatch_country", { length: 2 }),
    /** `none`, `union` (registered in an EU member state) or `non_union` (a seller outside the EU, with an `EU` number). */
    ossScheme: text("oss_scheme").notNull().default("none"),
    ossMemberState: char("oss_member_state", { length: 2 }).references(() => countries.code),
    ossNumber: text("oss_number"),
    ossRegisteredOn: date("oss_registered_on"),
    /** `IM` and ten digits; held with the intermediary's name by a store outside the EU selling consignments of at most 150 EUR. */
    iossNumber: text("ioss_number"),
    iossIntermediary: text("ioss_intermediary"),
    /** The EU markets (countries) the IOSS registration is used for; checked to be EU countries by a trigger. */
    iossMarkets: text("ioss_markets").array().notNull().default(sql`'{}'::text[]`),
    iossRegisteredOn: date("ioss_registered_on"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("store_tax_profile_updated_by_idx").on(t.updatedBy),
    index("store_tax_profile_oss_member_state_idx").on(t.ossMemberState),
    foreignKey({
      name: "store_tax_profile_vat_check_fk",
      columns: [t.storeId, t.vatNumberCheckId],
      foreignColumns: [vatChecks.storeId, vatChecks.id],
    }),
    index("store_tax_profile_vat_check_idx").on(t.storeId, t.vatNumberCheckId),
    check("store_tax_profile_vat_number", sql`${t.vatNumber} is null or ${t.vatNumber} ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$'`),
    check(
      "store_tax_profile_vat_check",
      sql`${t.vatNumber} is not null or (${t.vatNumberCheckId} is null and ${t.vatNumberCheckedAt} is null and ${t.vatNumberValid} is null)`,
    ),
    check("store_tax_profile_dispatch", sql`${t.dispatchCountry} is null or ${t.dispatchCountry} ~ '^[A-Z]{2}$'`),
    check("store_tax_profile_oss_scheme", sql`${t.ossScheme} in ('none', 'union', 'non_union')`),
    check("store_tax_profile_oss_union", sql`${t.ossScheme} <> 'union' or ${t.ossMemberState} is not null`),
    check(
      "store_tax_profile_oss_number",
      sql`${t.ossNumber} is null or (${t.ossScheme} = 'non_union' and ${t.ossNumber} ~ '^EU[0-9]{9}$')`,
    ),
    check("store_tax_profile_ioss_number", sql`${t.iossNumber} is null or ${t.iossNumber} ~ '^IM[0-9]{10}$'`),
    check("store_tax_profile_ioss_intermediary", sql`${t.iossIntermediary} is null or length(${t.iossIntermediary}) between 1 and 120`),
  ],
);

/**
 * Every answer to "is this VAT number valid?" (D157): a buyer's at the cart, the seller's on the tax screen. VIES
 * (the Commission's service) or Brønnøysundregistrene for a Norwegian number. An audit log and the 24-hour cache; also
 * what the rate limit counts. Immutable (a trigger refuses an update); an unused row is pruned after 30 days by
 * `pruneVatChecks()` in application code, a used one (an order, a cart or the profile points at it) is kept by the
 * foreign keys. Never copied, never public: the name and address are VIES's and for staff only.
 */
export const vatChecks = commerce.table(
  "vat_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** `buyer` (typed at the cart) or `seller` (the store's own number). */
    purpose: text("purpose").notNull(),
    /** The cart a buyer's check was made for; no foreign key (carts expire; the rate limit counts by it). */
    cartId: uuid("cart_id"),
    /** Normalised, with the country prefix. */
    number: text("number").notNull(),
    countryPrefix: char("country_prefix", { length: 2 }).notNull(),
    /** `valid`, `invalid`, or `unavailable` (the service did not answer: never exempts, never blocks). */
    status: text("status").notNull(),
    /** `vies` or `brreg`. */
    source: text("source").notNull(),
    /** What the registry holds for the number; null where it does not say. */
    name: text("name"),
    address: text("address"),
    /** VIES's consultation number, the seller's proof of the check, when the request carried the seller's own number. */
    requestIdentifier: text("request_identifier"),
    /** A short code for an `unavailable` answer. */
    error: text("error"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("vat_checks_store_id_key").on(t.storeId, t.id),
    index("vat_checks_number_idx").on(t.storeId, t.number, t.requestedAt.desc()),
    index("vat_checks_cart_idx").on(t.storeId, t.cartId, t.requestedAt),
    check("vat_checks_purpose", sql`${t.purpose} in ('buyer', 'seller')`),
    check("vat_checks_status", sql`${t.status} in ('valid', 'invalid', 'unavailable')`),
    check("vat_checks_source", sql`${t.source} in ('vies', 'brreg')`),
    check("vat_checks_number", sql`${t.number} ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$' and left(${t.number}, 2) = ${t.countryPrefix}`),
    check("vat_checks_error", sql`${t.error} is null or length(${t.error}) <= 80`),
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

/**
 * An invoice for a shop order (D159, `docs/wave-1b-invoices.md`): made only by `commerce.make_order_invoice()` inside the payment
 * transaction (`complete_order_payment()`), one per order, its whole content frozen in `snapshot` (the document is drawn only from
 * it). Immutable: the database refuses an update (but the one-time `pdf_path`/`pdf_sha256` and the anonymising of unit 1g's
 * retention), a delete and an insert that is not by the issuing function. Unit 1c reads the columns and `snapshot.buckets`.
 */
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
    /**
     * `order`: the invoice of a shop order (one per order). `order_edit`: the additional invoice of a change staff made to it (wave 3 run 3, D174), referring to
     * the original; one per change, `order_edit_id` set exactly for it.
     */
    kind: text("kind").notNull().default("order"),
    /** The store day it was issued (never back-dated) and the day of supply (the payment day). */
    issuedOn: date("issued_on").notNull(),
    supplyDate: date("supply_date").notNull(),
    locale: text("locale").notNull(),
    netMinor: money("net_minor"),
    /** The order's VAT treatment: `standard`, `reverse_charge` or `ioss`. */
    vatKind: text("vat_kind").notNull(),
    /** The VAT in the seller's country's currency, where Directive Art. 230 needs it, with the rate it was converted at. */
    vatHomeCurrency: char("vat_home_currency", { length: 3 }),
    vatHomeMinor: bigint("vat_home_minor", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxAsOf: date("fx_as_of"),
    /** `ecb_auto` when the store keeps its rates from the ECB, `owner` otherwise. */
    fxSource: text("fx_source"),
    snapshot: jsonb("snapshot").notNull(),
    /** The hosted page's whole access (`inv_` and 43 base64url characters); null once anonymised. */
    publicToken: text("public_token"),
    /** The stored PDF (private `documents` bucket), written once. */
    pdfPath: text("pdf_path"),
    pdfSha256: text("pdf_sha256"),
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    orderEditId: uuid("order_edit_id"),
  },
  (t) => [
    unique("invoices_store_id_key").on(t.storeId, t.id),
    unique("invoices_series_number_key").on(t.storeId, t.series, t.number),
    unique("invoices_document_number_key").on(t.storeId, t.documentNumber),
    /** One original invoice per order; an order's additional invoices (`order_edit`) are one per change. Readers of an order's invoice pick `kind = 'order'`. */
    uniqueIndex("invoices_original_key")
      .on(t.storeId, t.orderId)
      .where(sql`${t.kind} = 'order'`),
    uniqueIndex("invoices_order_edit_key")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.kind} = 'order_edit'`),
    index("invoices_order_idx").on(t.storeId, t.orderId),
    foreignKey({
      name: "invoices_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    unique("invoices_public_token_key").on(t.publicToken),
    orderRef("invoices_order_fk", t),
    seriesRef("invoices_series_fk", t),
    index("invoices_issued_idx").on(t.storeId, t.issuedOn),
    index("invoices_supply_idx").on(t.storeId, t.supplyDate),
    check("invoices_kind", sql`${t.kind} in ('order', 'order_edit') and (${t.kind} = 'order_edit') = (${t.orderEditId} is not null)`),
    check("invoices_series", sql`${t.series} = 'invoice'`),
    check("invoices_vat_kind", sql`${t.vatKind} in ('standard', 'reverse_charge', 'ioss')`),
    check("invoices_total", sql`${t.totalMinor} > 0 and ${t.totalMinor} = ${t.netMinor} + ${t.taxMinor}`),
    check("invoices_reverse_charge", sql`${t.vatKind} <> 'reverse_charge' or ${t.taxMinor} = 0`),
    check("invoices_vat_home", sql`(${t.vatHomeMinor} is null) = (${t.fxRate} is null) and (${t.vatHomeMinor} is null) = (${t.vatHomeCurrency} is null)`),
    check("invoices_fx_source", sql`${t.fxSource} is null or ${t.fxSource} in ('ecb_auto', 'owner')`),
    check("invoices_public_token", sql`(${t.anonymisedAt} is null and ${t.publicToken} ~ '^inv_[A-Za-z0-9_-]{43}$') or (${t.anonymisedAt} is not null and ${t.publicToken} is null)`),
    check("invoices_pdf", sql`(${t.pdfPath} is null) = (${t.pdfSha256} is null)`),
    check("invoices_snapshot", sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'version' = '1'`),
  ],
);

/**
 * A credit note (D159): made only by `commerce.make_credit_note()`, for a refund that succeeded (any path: a deferred trigger on
 * `refunds` runs it at commit) or for a return refunded outside Kaizen (`source = 'return_outside'`, from `returns`). One per
 * refund, in its own series, referring to its invoice, and never above what the invoice left uncredited per rate bucket.
 */
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
    /**
     * `refund` (a succeeded refund), `return_outside` (a return refunded outside Kaizen's Stripe) or `order_edit` (what a change staff made to the order took off,
     * wave 3 run 3, D174: `order_edit_id` set exactly for it; the change's refund gets no note of its own).
     */
    source: text("source").notNull(),
    returnId: uuid("return_id"),
    issuedOn: date("issued_on").notNull(),
    locale: text("locale").notNull(),
    netMinor: money("net_minor"),
    /** Copied from the invoice: a credit note is converted at the invoice's rate. */
    vatHomeCurrency: char("vat_home_currency", { length: 3 }),
    vatHomeMinor: bigint("vat_home_minor", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxAsOf: date("fx_as_of"),
    fxSource: text("fx_source"),
    snapshot: jsonb("snapshot").notNull(),
    /** `crn_` and 43 base64url characters; null once anonymised. */
    publicToken: text("public_token"),
    pdfPath: text("pdf_path"),
    pdfSha256: text("pdf_sha256"),
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    orderEditId: uuid("order_edit_id"),
  },
  (t) => [
    foreignKey({
      name: "credit_notes_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    uniqueIndex("credit_notes_order_edit_key")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.source} = 'order_edit'`),
    unique("credit_notes_series_number_key").on(t.storeId, t.series, t.number),
    unique("credit_notes_document_number_key").on(t.storeId, t.documentNumber),
    unique("credit_notes_refund_key").on(t.storeId, t.refundId),
    unique("credit_notes_public_token_key").on(t.publicToken),
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
    foreignKey({
      name: "credit_notes_return_fk",
      columns: [t.storeId, t.returnId],
      foreignColumns: [returns.storeId, returns.id],
    }),
    seriesRef("credit_notes_series_fk", t),
    index("credit_notes_invoice_idx").on(t.storeId, t.invoiceId),
    index("credit_notes_return_idx").on(t.storeId, t.returnId),
    uniqueIndex("credit_notes_return_outside_key")
      .on(t.storeId, t.returnId)
      .where(sql`${t.source} = 'return_outside'`),
    index("credit_notes_issued_idx").on(t.storeId, t.issuedOn),
    check("credit_notes_series", sql`${t.series} = 'credit_note'`),
    check("credit_notes_source", sql`${t.source} in ('refund', 'return_outside', 'order_edit')`),
    check(
      "credit_notes_source_ref",
      sql`(${t.source} = 'refund' and ${t.refundId} is not null and ${t.returnId} is null and ${t.orderEditId} is null)
        or (${t.source} = 'return_outside' and ${t.returnId} is not null and ${t.refundId} is null and ${t.orderEditId} is null)
        or (${t.source} = 'order_edit' and ${t.orderEditId} is not null and ${t.refundId} is null and ${t.returnId} is null)`,
    ),
    check("credit_notes_total", sql`${t.totalMinor} > 0 and ${t.totalMinor} = ${t.netMinor} + ${t.taxMinor}`),
    check("credit_notes_vat_home", sql`(${t.vatHomeMinor} is null) = (${t.fxRate} is null) and (${t.vatHomeMinor} is null) = (${t.vatHomeCurrency} is null)`),
    check("credit_notes_fx_source", sql`${t.fxSource} is null or ${t.fxSource} in ('ecb_auto', 'owner')`),
    check("credit_notes_public_token", sql`(${t.anonymisedAt} is null and ${t.publicToken} ~ '^crn_[A-Za-z0-9_-]{43}$') or (${t.anonymisedAt} is not null and ${t.publicToken} is null)`),
    check("credit_notes_pdf", sql`(${t.pdfPath} is null) = (${t.pdfSha256} is null)`),
    check("credit_notes_snapshot", sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'version' = '1'`),
  ],
);

/**
 * A store's invoicing switch and the note printed on every invoice and credit note (D159, edited by owners at
 * `/admin/{store}/settings/invoices`). No row means invoicing is on and counts from the start; the migration wrote a row with
 * `enabled = false` for a store that already had real orders, so nothing is numbered for it until its owner chooses. Switching
 * on sets `enabled_from` (a trigger): invoices are issued from then on and never back-dated.
 */
export const invoiceSettings = commerce.table(
  "invoice_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    enabled: boolean("enabled").notNull().default(true),
    enabledFrom: timestamp("enabled_from", { withTimezone: true }),
    footerNote: text("footer_note"),
    emailWithConfirmation: boolean("email_with_confirmation").notNull().default(true),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("invoice_settings_updated_by_idx").on(t.updatedBy),
    check("invoice_settings_footer_note", sql`${t.footerNote} is null or length(${t.footerNote}) <= 1000`),
  ],
);

/** Which email carried which document, so the stand-alone email is sent only for a document no earlier email carried (D159). */
export const documentDeliveries = commerce.table(
  "document_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    emailMessageId: uuid("email_message_id")
      .notNull()
      .references(() => emailMessages.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_deliveries_key").on(t.storeId, t.documentType, t.documentId, t.emailMessageId),
    index("document_deliveries_email_idx").on(t.emailMessageId),
    check("document_deliveries_type", sql`${t.documentType} in ('invoice', 'credit_note')`),
  ],
);

/**
 * Attempts to render a document's PDF (D159): the only mutable table of the unit, with no personal data. A document that
 * failed five times is shown as "PDF not made" and retried by hand.
 */
export const documentPdfState = commerce.table(
  "document_pdf_state",
  {
    storeId: storeId().references(() => stores.id),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.documentType, t.documentId] }),
    check("document_pdf_state_type", sql`${t.documentType} in ('invoice', 'credit_note')`),
    check("document_pdf_state_error", sql`${t.lastError} is null or length(${t.lastError}) <= 200`),
  ],
);

/**
 * The European Central Bank's euro reference rates (D161, `docs/wave-1c-reports.md` 3.1): units of a currency per 1 EUR on a
 * publication day, kept for the OSS and IOSS euro figures (the rate of a period's last day). Platform-wide reference data, no
 * `store_id`. Append-only: a trigger refuses an update and a delete, because a stored rate is part of what a filed return rested
 * on; a day already stored is never replaced (the writer inserts `on conflict do nothing`).
 */
export const ecbReferenceRates = commerce.table(
  "ecb_reference_rates",
  {
    rateDate: date("rate_date").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    source: text("source").notNull().default("ecb"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.rateDate, t.currency] }),
    check("ecb_reference_rates_rate", sql`${t.rate} > 0`),
    check("ecb_reference_rates_source", sql`${t.source} in ('ecb')`),
    check("ecb_reference_rates_currency", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.currency} <> 'EUR'`),
  ],
);

/**
 * An owner's own euro rate for a currency on a day (D161, 3.2), used instead of the ECB's for that store only, with the reason
 * (audit-logged by the action). It never changes a document. An upsert: the audit log is the history.
 */
export const taxRateOverrides = commerce.table(
  "tax_rate_overrides",
  {
    storeId: storeId().references(() => stores.id),
    currency: char("currency", { length: 3 }).notNull(),
    rateDate: date("rate_date").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    setBy: uuid("set_by")
      .notNull()
      .references(() => accounts.id),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.currency, t.rateDate] }),
    index("tax_rate_overrides_set_by_idx").on(t.setBy),
    check("tax_rate_overrides_rate", sql`${t.rate} > 0`),
    check("tax_rate_overrides_currency", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.currency} <> 'EUR'`),
    check("tax_rate_overrides_reason", sql`length(btrim(${t.reason})) between 10 and 300`),
    check("tax_rate_overrides_date", sql`${t.rateDate} >= date '2021-07-01'`),
  ],
);

/**
 * A log of the VAT, OSS and IOSS exports a store made (D161, 3.2): what period, which view and mode, how many rows and the
 * totals (aggregate numbers only, never a buyer or a document number), so a later change to the period shows as drift.
 * Append-only.
 */
export const taxReportExports = commerce.table(
  "tax_report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    report: text("report").notNull(),
    scheme: text("scheme"),
    /** `2026-Q3`, `2026-09` or `2026-09-01..2026-09-30`. */
    periodKey: text("period_key").notNull(),
    mode: text("mode"),
    rows: integer("rows").notNull(),
    totals: jsonb("totals").notNull(),
    exportedBy: uuid("exported_by")
      .notNull()
      .references(() => accounts.id),
    exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tax_report_exports_period_idx").on(t.storeId, t.report, t.periodKey, t.exportedAt.desc()),
    index("tax_report_exports_exported_by_idx").on(t.exportedBy),
    check("tax_report_exports_report", sql`${t.report} in ('vat', 'oss', 'oss_detail', 'ioss', 'ioss_detail', 'reconciliation')`),
    check("tax_report_exports_scheme", sql`${t.scheme} is null or ${t.scheme} in ('union', 'non_union', 'ioss')`),
    check("tax_report_exports_mode", sql`${t.mode} is null or ${t.mode} in ('books', 'filing')`),
    check("tax_report_exports_rows", sql`${t.rows} >= 0`),
    check("tax_report_exports_totals", sql`jsonb_typeof(${t.totals}) = 'object'`),
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
    check("pages_type", sql`${t.type} in ('page', 'article', 'product_layout', 'header', 'footer', 'variant')`),
    // A test's variant of a page (D148) is a store's: it has no address of its own on the site.
    check("pages_variant_store", sql`${t.type} <> 'variant' or ${t.storeId} is not null`),
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
      sql`${t.storeId} is null or ${t.type} <> 'page' or ${t.slug} not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'deliveries', 'download', 'order', 'p', 'products', 'returns', 'search', 'subscription', 'tag', 'unsubscribe', 'wishlist', 'withdraw')`,
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
    check("page_roles_role", sql`${t.role} in ('blog', 'search', 'not_found', 'cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries', 'cookies', 'category', 'tag', ${legalRoleList})`),
  ],
);

/**
 * What a model costs per million tokens, in US dollars (D145), so the usage pages can show cost beside tokens. A price
 * never changes in place: a new price is a new row that counts from its `effective_from`, and a call is priced by the
 * row that was in force when it was made. `model` matches a call's model exactly, or as the start of its name before a
 * dash (a dated version of the model). Never a model in code: the platform's admin keeps these at `/admin/platform/ai/prices`.
 */
export const aiModelPrices = commerce.table(
  "ai_model_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** US dollars per million input tokens. */
    inputPerMillion: numeric("input_per_million", { precision: 14, scale: 6 }).notNull(),
    /** US dollars per million output tokens. */
    outputPerMillion: numeric("output_per_million", { precision: 14, scale: 6 }).notNull(),
    /** US dollars per picture made; null: the model has no per-picture price (usage in pictures is unpriced). */
    perImage: numeric("per_image", { precision: 14, scale: 6 }),
    /** US dollars per minute of audio (speech to text, live voice calls); null: none. */
    perAudioMinute: numeric("per_audio_minute", { precision: 14, scale: 6 }),
    /** US dollars per million characters spoken (text to speech); null: none. */
    perMillionCharacters: numeric("per_million_characters", { precision: 14, scale: 6 }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    unique("ai_model_prices_key").on(t.provider, t.model, t.effectiveFrom),
    index("ai_model_prices_created_by_idx").on(t.createdBy),
    check(
      "ai_model_prices_amounts",
      sql`${t.inputPerMillion} >= 0 and ${t.outputPerMillion} >= 0 and ${t.perImage} >= 0 and ${t.perAudioMinute} >= 0 and ${t.perMillionCharacters} >= 0`,
    ),
    check("ai_model_prices_names", sql`length(${t.provider}) between 1 and 60 and length(${t.model}) between 1 and 200`),
  ],
);

/**
 * Which of Kaizen's own pages has a place of its own on its site (D143), as a store's front page and special
 * pages do (D54, D112): its front page (`/`), its blog (`/blog`) and the page shown for an address that is not
 * found. Without one the site's standard page shows. A page holds at most one place, only a page of Kaizen's
 * own (type `page`, no store) can hold one (a trigger in a custom migration), and deleting it lets the place go.
 */
export const platformPageRoles = commerce.table(
  "platform_page_roles",
  {
    role: text("role").primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .unique("platform_page_roles_page_key")
      .references(() => pages.id, { onDelete: "cascade" }),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    check("platform_page_roles_role", sql`${t.role} in ('front', 'blog', 'not_found')`),
    index("platform_page_roles_updated_by_idx").on(t.updatedBy),
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
 * A row, column, component or whole page layout saved to use again (D46, D127): Kaizen's own
 * (`store_id` null) or a store's, shown under Saved in the page builder.
 * Using one puts a copy on the page; changing it later changes what the
 * next use gets, not the pages that already have it, unless it is global
 * (D98): then every page's copy is its use and follows it. Shape:
 * `PageRow`, `PageColumn` or `PageBlock` in lib/page-content, or `PageLayout` in lib/page-layout.
 */
export const savedParts = commerce.table(
  "saved_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's own. */
    storeId: uuid("store_id").references(() => stores.id),
    /** `row`, `column`, `block` or `page` (a whole page's layout, D127). */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    content: jsonb("content").notNull(),
    /** Global (D98): its uses on pages stay the same as it, and change with it. */
    global: boolean("global").notNull().default(false),
    /** A global's texts in the owner's other languages (D55), by their place in `content`. */
    translations: jsonb("translations").notNull().default({}),
    /**
     * Who else can use it as a template (D125): `private` (this store), `stores` (the other stores its
     * owner owns) or `marketplace` (every store owner). Kaizen's own (no store) are always the marketplace's.
     */
    sharing: text("sharing").notNull().default("private"),
    /** Set by a platform admin: a hidden template is in no list; copies already made stay. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: uuid("hidden_by").references(() => accounts.id),
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
    index("saved_parts_hidden_by_idx").on(t.hiddenBy),
    check("saved_parts_kind", sql`${t.kind} in ('row', 'column', 'block', 'page')`),
    // A whole page layout (D127) is never global: its uses would be whole pages.
    check("saved_parts_page_not_global", sql`${t.kind} <> 'page' or not ${t.global}`),
    check("saved_parts_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("saved_parts_sharing", sql`${t.sharing} in ('private', 'stores', 'marketplace')`),
    check("saved_parts_kaizen_sharing", sql`${t.storeId} is not null or ${t.sharing} = 'marketplace'`),
    // The marketplace's and the owner's other stores' lists.
    index("saved_parts_shared_idx").on(t.sharing, t.updatedAt).where(sql`${t.sharing} <> 'private'`),
  ],
);

/**
 * A store's choice to have a template (D125) in the page builder's Templates tab, or not: one row per store
 * and template it has switched on or off. Kaizen's own saved parts (no store) count as on until a store
 * switches them off (`coalesce(active, store_id is null)`); every other template is off until switched on.
 * A template that is deleted takes its rows with it.
 */
export const templateActivations = commerce.table(
  "template_activations",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    partId: uuid("part_id")
      .notNull()
      .references(() => savedParts.id, { onDelete: "cascade" }),
    active: boolean("active").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    changedBy: uuid("changed_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.partId] }),
    index("template_activations_part_idx").on(t.partId),
    index("template_activations_changed_by_idx").on(t.changedBy),
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
    /** Unit price (D160), on a product category only: its products (and its subcategories') need a measure. */
    requiresUnitPrice: boolean("requires_unit_price").notNull().default(false),
    /**
     * A product category's or tag's own title and description for search results and shares, per language (wave 2, D168):
     * `{ "nb-NO": { "title": "…", "description": "…" } }`, keyed by the store's locale strings as `product_translations.locale` is. The shape,
     * the languages and the lengths are `termSeoInput`'s (`src/lib/term-seo.ts`). Empty is `{}`: the page uses the term's name.
     */
    seo: jsonb("seo").notNull().default({}),
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
    check(
      "terms_requires_unit_price",
      sql`not ${t.requiresUnitPrice} or (${t.contentType} = 'product' and ${t.kind} = 'category')`,
    ),
    check("terms_not_own_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check("terms_seo_object", sql`jsonb_typeof(${t.seo}) = 'object'`),
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
 * A page of another website copied into a store's page builder by the AI (D150, `src/server/replicate.ts`): one row per
 * job, run step by step by the owner's open page (one tick of work per request), with its log for the progress panel,
 * what was captured from the original page (`capture`, never sent to the browser), and the job's working state (`work`:
 * the analysis, the assets, the style sheet and the scores of each pass). At most one job is active per store.
 */
export const pageReplications = commerce.table(
  "page_replications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => accounts.id, { onDelete: "set null" }),
    /** The address of the original page, as the owner gave it (checked by `parseReplicaUrl()`). */
    url: text("url").notNull(),
    status: text("status").notNull().default("queued"),
    /** The owner pressed Abort: the next tick stops the job. */
    abortRequested: boolean("abort_requested").notNull().default(false),
    /** How many times the AI looks at its copy and improves it, set by the owner. */
    iterationsMax: integer("iterations_max").notNull().default(3),
    iteration: integer("iteration").notNull().default(0),
    /** The step the job is at: `open`, `examine`, `copy`, `assets`, `build`, `refine`, `done`. */
    phase: text("phase").notNull().default("open"),
    /** What happened, newest last (`ReplicaLogEntry[]`), capped by the app. */
    log: jsonb("log").notNull().default([]),
    /** The original page as captured (`ReplicaCapture`): large, only read by the server. */
    capture: jsonb("capture"),
    /** The job's working state (`ReplicaWork`). */
    work: jsonb("work").notNull().default({}),
    /** The draft page the job builds, kept if the page is deleted. */
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    /** What went well and what did not (`ReplicaSummary`), written when the job ends. */
    summary: jsonb("summary"),
    /** A tick holds this until it has run, so two requests never work on one job. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("page_replications_store_created_idx").on(t.storeId, t.createdAt),
    index("page_replications_requested_by_idx").on(t.requestedBy),
    index("page_replications_page_idx").on(t.pageId),
    uniqueIndex("page_replications_one_active_idx")
      .on(t.storeId)
      .where(sql`${t.status} in ('queued', 'running')`),
    check("page_replications_status", sql`${t.status} in ('queued', 'running', 'done', 'failed', 'aborted')`),
    check("page_replications_iterations", sql`${t.iterationsMax} between 1 and 10 and ${t.iteration} between 0 and 10`),
    check("page_replications_phase", sql`${t.phase} in ('open', 'examine', 'copy', 'assets', 'build', 'refine', 'done')`),
    check("page_replications_json", sql`jsonb_typeof(${t.log}) = 'array' and jsonb_typeof(${t.work}) = 'object'`),
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
    /** The model that looks at pictures (D163): null uses the text model. Same provider and key as the text model. */
    visionModel: text("vision_model"),
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
    check("ai_providers_vision_model", sql`coalesce(length(${t.visionModel}) between 1 and 200, true)`),
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

/**
 * A WordPress site an owner connected to their stores (D169, `docs/wordpress-plugin.md`): the plugin asks the owner to approve in
 * Kaizen's admin, gets a one-time `code` (kept as a hash, five minutes) and swaps it for a token (kept as a hash, never in clear).
 * The token reads the account's stores' public catalogue and nothing else; the owner can revoke it. A row with no token yet is an
 * approval that was not collected.
 */
export const wordpressConnections = commerce.table(
  "wordpress_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The site's origin (`https://example.com`), as the plugin said and the return address agreed. */
    siteUrl: text("site_url").notNull(),
    siteName: text("site_name"),
    codeHash: text("code_hash"),
    /** S256 of the plugin's verifier: a stolen code is no use without it. */
    codeChallenge: text("code_challenge"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    tokenHash: text("token_hash"),
    createdAt: createdAt(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("wordpress_connections_code_idx").on(t.codeHash),
    uniqueIndex("wordpress_connections_token_idx").on(t.tokenHash),
    index("wordpress_connections_account_idx").on(t.accountId),
    check("wordpress_connections_site", sql`length(${t.siteUrl}) <= 300 and (${t.siteName} is null or length(${t.siteName}) <= 120)`),
  ],
);

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

// ---------------------------------------------------------------------------
// Work (D122, docs/work.md): clients, assignments, time and invoices
// ---------------------------------------------------------------------------
//
// Foreign keys that must only null their own column when the parent goes
// (`ON DELETE SET NULL (col)`), which Drizzle cannot express, are added in the
// `work_rules` migration, as the product layouts' are; their indexes are here.
// Rules (numbering, immutability, append-only records, timers) are in the same
// migration, and every table has row-level security on with no policy.

/** A store's Work settings (one row, created when the owner first saves them). Numbering is `document_series`. */
export const workSettings = commerce.table(
  "work_settings",
  {
    storeId: storeId().primaryKey().references(() => stores.id),
    /** A store that is not VAT registered invoices at 0 % with the statutory note. */
    vatRegistered: boolean("vat_registered").notNull().default(true),
    vatNumber: text("vat_number"),
    defaultPaymentDays: integer("default_payment_days").default(14),
    defaultCurrency: char("default_currency", { length: 3 }),
    /** IBAN or the country's own account number, printed on invoices. */
    bankAccount: text("bank_account"),
    bic: text("bic"),
    /** How to pay: KID, reference, anything the owner wants printed. */
    paymentNote: text("payment_note"),
    invoiceFooter: text("invoice_footer"),
    latePaymentNote: text("late_payment_note"),
    estimateAlertMinutes: integer("estimate_alert_minutes").default(10),
    estimateAlertPopup: boolean("estimate_alert_popup").notNull().default(true),
    estimateAlertSound: boolean("estimate_alert_sound").notNull().default(false),
    /** Clients see the notes on time entries (on invoices, in My account). */
    showTimeNotesToClients: boolean("show_time_notes_to_clients").notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("work_settings_updated_by_idx").on(t.updatedBy),
    check("work_settings_payment_days", sql`${t.defaultPaymentDays} is null or ${t.defaultPaymentDays} between 1 and 90`),
    check("work_settings_currency", sql`${t.defaultCurrency} is null or ${t.defaultCurrency} ~ '^[A-Z]{3}$'`),
    check("work_settings_estimate_alert", sql`${t.estimateAlertMinutes} is null or ${t.estimateAlertMinutes} between 1 and 480`),
    check("work_settings_texts", sql`length(coalesce(${t.paymentNote}, '')) <= 1000 and length(coalesce(${t.invoiceFooter}, '')) <= 2000 and length(coalesce(${t.latePaymentNote}, '')) <= 2000`),
  ],
);

/**
 * Someone the store bills. Archived, never deleted once it has an invoice
 * (`work_invoices.client_id` restricts); the legal details on an issued
 * invoice are a snapshot, so editing a client never rewrites one.
 */
export const workClients = commerce.table(
  "work_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    organisationNumber: text("organisation_number"),
    vatNumber: text("vat_number"),
    country: char("country", { length: 2 }).references(() => countries.code),
    /** `{ line1, line2, postalCode, city }`, as customers' addresses. */
    billingAddress: jsonb("billing_address").notNull().default({}),
    billingEmail: text("billing_email"),
    contactName: text("contact_name"),
    phone: text("phone"),
    /** The language of its documents, e.g. `nb-NO`. */
    locale: text("locale"),
    currency: char("currency", { length: 3 }).notNull(),
    defaultHourlyRateMinor: bigint("default_hourly_rate_minor", { mode: "number" }),
    paymentDays: integer("payment_days"),
    /** A business (may reverse-charge) or a consumer (always domestic VAT). */
    business: boolean("business").notNull().default(true),
    /** `domestic`, `reverse_charge`, `outside_scope` or `exempt` (docs/work.md 4.5). */
    vatTreatment: text("vat_treatment").notNull().default("domestic"),
    /** The store's customer company and person this client is (D108); nulled when they are deleted. */
    customerCompanyId: uuid("customer_company_id"),
    customerId: uuid("customer_id"),
    /** Hours bought in advance cover logged time before it is invoiced (later package). */
    usePrepaid: boolean("use_prepaid").notNull().default(true),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_clients_store_id_key").on(t.storeId, t.id),
    index("work_clients_sort_idx").on(t.storeId, t.sortOrder, t.name),
    index("work_clients_company_idx").on(t.storeId, t.customerCompanyId),
    index("work_clients_customer_idx").on(t.storeId, t.customerId),
    index("work_clients_country_idx").on(t.country),
    check("work_clients_name", sql`length(trim(${t.name})) between 1 and 120`),
    check("work_clients_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("work_clients_rate", sql`${t.defaultHourlyRateMinor} is null or ${t.defaultHourlyRateMinor} between 0 and 1000000000`),
    check("work_clients_payment_days", sql`${t.paymentDays} is null or ${t.paymentDays} between 1 and 90`),
    check("work_clients_vat_treatment", sql`${t.vatTreatment} in ('domestic', 'reverse_charge', 'outside_scope', 'exempt')`),
    check("work_clients_consumer_domestic", sql`${t.business} or ${t.vatTreatment} = 'domestic'`),
    check("work_clients_address", sql`jsonb_typeof(${t.billingAddress}) = 'object'`),
    check("work_clients_notes", sql`length(coalesce(${t.notes}, '')) <= 5000`),
  ],
);

/** A job for a client. Many invoices may bill one assignment, one draft at a time; `invoiced` is derived. */
export const workAssignments = commerce.table(
  "work_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    clientId: uuid("client_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    billingType: text("billing_type").notNull().default("hourly"),
    hourlyRateMinor: bigint("hourly_rate_minor", { mode: "number" }),
    fixedAmountMinor: bigint("fixed_amount_minor", { mode: "number" }),
    estimatedMinutes: integer("estimated_minutes"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    estimateAlertMinutes: integer("estimate_alert_minutes").default(10),
    estimateAlertPopup: boolean("estimate_alert_popup").notNull().default(true),
    estimateAlertSound: boolean("estimate_alert_sound").notNull().default(false),
    createdBy: uuid("created_by").references(() => accounts.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_assignments_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "work_assignments_client_fk",
      columns: [t.storeId, t.clientId],
      foreignColumns: [workClients.storeId, workClients.id],
    }),
    index("work_assignments_client_idx").on(t.storeId, t.clientId, t.sortOrder),
    index("work_assignments_status_idx").on(t.storeId, t.status),
    index("work_assignments_created_by_idx").on(t.createdBy),
    check("work_assignments_name", sql`length(trim(${t.name})) between 1 and 160`),
    check("work_assignments_status", sql`${t.status} in ('active', 'paused', 'done')`),
    check("work_assignments_billing_type", sql`${t.billingType} in ('hourly', 'fixed_fee')`),
    check("work_assignments_hourly_rate", sql`${t.hourlyRateMinor} is null or ${t.hourlyRateMinor} between 0 and 1000000000`),
    check("work_assignments_fixed_amount", sql`${t.fixedAmountMinor} is null or ${t.fixedAmountMinor} between 0 and 100000000000`),
    check("work_assignments_estimate", sql`${t.estimatedMinutes} is null or ${t.estimatedMinutes} >= 0`),
    check("work_assignments_dates", sql`${t.startDate} is null or ${t.endDate} is null or ${t.startDate} <= ${t.endDate}`),
    check("work_assignments_estimate_alert", sql`${t.estimateAlertMinutes} is null or ${t.estimateAlertMinutes} between 1 and 480`),
  ],
);

/** A piece of an assignment, with an estimate. */
export const workTasks = commerce.table(
  "work_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    assignmentId: uuid("assignment_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    estimatedMinutes: integer("estimated_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_tasks_store_id_key").on(t.storeId, t.id),
    // Lets time entries and timers point at a task of their own assignment only.
    unique("work_tasks_assignment_key").on(t.storeId, t.assignmentId, t.id),
    foreignKey({
      name: "work_tasks_assignment_fk",
      columns: [t.storeId, t.assignmentId],
      foreignColumns: [workAssignments.storeId, workAssignments.id],
    }).onDelete("cascade"),
    index("work_tasks_sort_idx").on(t.storeId, t.assignmentId, t.sortOrder),
    check("work_tasks_title", sql`length(trim(${t.title})) between 1 and 200`),
    check("work_tasks_status", sql`${t.status} in ('open', 'done')`),
    check("work_tasks_estimate", sql`${t.estimatedMinutes} is null or ${t.estimatedMinutes} >= 0`),
  ],
);

/**
 * A repeating invoice (docs/work.md 1.6): generates draft invoices for a
 * client on a schedule, and issues them by itself only when `auto_issue` is
 * on. Instances are ordinary `work_invoices` with `recurring_invoice_id` and
 * `recurring_period`. Deactivate a template rather than deleting one that
 * has produced invoices.
 */
export const workRecurringInvoices = commerce.table(
  "work_recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    clientId: uuid("client_id").notNull(),
    name: text("name").notNull(),
    /** The text of the invoice line. */
    description: text("description").notNull(),
    unit: text("unit").notNull().default("unit"),
    quantityHundredths: integer("quantity_hundredths").notNull().default(100),
    /** Net of VAT. */
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    discountBp: integer("discount_bp").notNull().default(0),
    vatCategory: text("vat_category").notNull().default("standard"),
    currency: char("currency", { length: 3 }).notNull(),
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    recurrencePeriod: text("recurrence_period").notNull().default("month"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    paymentDays: integer("payment_days"),
    /** Issue and email each generated invoice on its date; off: a draft is made and the owner is told. */
    autoIssue: boolean("auto_issue").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** Occurrences the owner deleted, never generated again. */
    skippedPeriods: date("skipped_periods", { mode: "string" }).array().notNull().default(sql`'{}'::date[]`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_recurring_invoices_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "work_recurring_invoices_client_fk",
      columns: [t.storeId, t.clientId],
      foreignColumns: [workClients.storeId, workClients.id],
    }),
    index("work_recurring_invoices_client_idx").on(t.storeId, t.clientId, t.sortOrder, t.name),
    check("work_recurring_invoices_name", sql`length(trim(${t.name})) between 1 and 120`),
    check("work_recurring_invoices_description", sql`length(trim(${t.description})) between 1 and 500`),
    check("work_recurring_invoices_unit", sql`${t.unit} in ('hour', 'unit')`),
    check("work_recurring_invoices_quantity", sql`${t.quantityHundredths} between 0 and 10000000`),
    check("work_recurring_invoices_price", sql`${t.unitPriceMinor} between 0 and 1000000000`),
    check("work_recurring_invoices_discount", sql`${t.discountBp} between 0 and 10000`),
    check("work_recurring_invoices_vat_category", sql`${t.vatCategory} in ('standard', 'exempt', 'reverse_charge', 'outside_scope')`),
    check("work_recurring_invoices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("work_recurring_invoices_interval", sql`${t.recurrenceInterval} between 1 and 4`),
    check("work_recurring_invoices_period", sql`${t.recurrencePeriod} in ('week', 'month', 'year')`),
    check("work_recurring_invoices_dates", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("work_recurring_invoices_payment_days", sql`${t.paymentDays} is null or ${t.paymentDays} between 1 and 90`),
  ],
);

/**
 * An invoice. A draft is freely editable, deletable and has no number; issuing
 * it (`commerce.issue_work_invoice`) numbers it from the store's `work_invoice`
 * series, freezes its amounts and snapshots seller, buyer and VAT notes, after
 * which only its status, `paid_at`, `sent_to` and `public_token` can change
 * (a trigger). Corrections are credit notes.
 */
export const workInvoices = commerce.table(
  "work_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    clientId: uuid("client_id").notNull(),
    assignmentId: uuid("assignment_id"),
    recurringInvoiceId: uuid("recurring_invoice_id"),
    /** The occurrence date of the repeating invoice this came from. */
    recurringPeriod: date("recurring_period", { mode: "string" }),
    /** `draft`, `sent` (issued), `paid` or `void` (fully credited). */
    status: text("status").notNull().default("draft"),
    series: text("series").notNull().default("work_invoice"),
    number: bigint("number", { mode: "number" }),
    /** Prefix and number, e.g. `W-1042`; null while a draft. An imported invoice shows its Life number here, or `Imported`. */
    documentNumber: text("document_number"),
    /** Imported from Kaizen Life (docs/work.md WP15): history that keeps its own number and amounts, never numbered from the series. */
    imported: boolean("imported").notNull().default(false),
    /** The number the invoice had in Life, when it had one (imported invoices only). */
    legacyNumber: text("legacy_number"),
    issuedOn: date("issued_on", { mode: "string" }),
    dueOn: date("due_on", { mode: "string" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale"),
    paymentDays: integer("payment_days"),
    /** The period the lines cover, from their time entries. */
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    notes: text("notes"),
    /** The client's purchase order, or a payment reference (KID). */
    reference: text("reference"),
    /** Kept current by the app while a draft; recomputed and frozen at issue. */
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    /** The VAT in the seller's own currency and the rate used (units of it per 1 of `currency`), when the invoice is in another. */
    vatHomeMinor: bigint("vat_home_minor", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    /** Snapshots at issue: names, numbers, addresses, bank details. */
    seller: jsonb("seller"),
    buyer: jsonb("buyer"),
    /** Statutory notes to print, as keys (`reverse_charge`, `outside_scope`, `exempt`, `not_registered`). */
    vatNotes: jsonb("vat_notes").notNull().default([]),
    /** The hosted invoice page's address (docs/work.md 4.7). */
    publicToken: text("public_token").unique(),
    sentTo: text("sent_to"),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_invoices_store_id_key").on(t.storeId, t.id),
    unique("work_invoices_series_number_key").on(t.storeId, t.series, t.number),
    // An imported invoice without a number of its own is only labelled `Imported`, so many share it.
    uniqueIndex("work_invoices_document_number_key")
      .on(t.storeId, t.documentNumber)
      .where(sql`not ${t.imported} or ${t.legacyNumber} is not null`),
    uniqueIndex("work_invoices_legacy_number_key")
      .on(t.storeId, t.legacyNumber)
      .where(sql`${t.legacyNumber} is not null`),
    unique("work_invoices_recurring_period_key").on(t.storeId, t.recurringInvoiceId, t.recurringPeriod),
    foreignKey({
      name: "work_invoices_client_fk",
      columns: [t.storeId, t.clientId],
      foreignColumns: [workClients.storeId, workClients.id],
    }),
    foreignKey({
      name: "work_invoices_assignment_fk",
      columns: [t.storeId, t.assignmentId],
      foreignColumns: [workAssignments.storeId, workAssignments.id],
    }),
    foreignKey({
      name: "work_invoices_recurring_fk",
      columns: [t.storeId, t.recurringInvoiceId],
      foreignColumns: [workRecurringInvoices.storeId, workRecurringInvoices.id],
    }),
    seriesRef("work_invoices_series_fk", t),
    // One open draft per assignment; drafts without an assignment are unlimited.
    uniqueIndex("work_invoices_one_draft_idx").on(t.storeId, t.assignmentId).where(sql`${t.status} = 'draft'`),
    index("work_invoices_status_idx").on(t.storeId, t.status, sql`${t.issuedOn} desc nulls last`),
    index("work_invoices_client_idx").on(t.storeId, t.clientId, t.status),
    index("work_invoices_assignment_idx").on(t.storeId, t.assignmentId),
    index("work_invoices_due_idx").on(t.storeId, t.dueOn).where(sql`${t.status} = 'sent'`),
    index("work_invoices_created_by_idx").on(t.createdBy),
    check("work_invoices_status", sql`${t.status} in ('draft', 'sent', 'paid', 'void')`),
    check("work_invoices_series", sql`${t.series} = 'work_invoice'`),
    check("work_invoices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("work_invoices_amounts", sql`${t.subtotalMinor} >= 0 and ${t.vatMinor} >= 0 and ${t.totalMinor} = ${t.subtotalMinor} + ${t.vatMinor}`),
    // Numbered exactly when issued: a draft never holds a number, so deleting one burns none.
    // (An imported invoice is the exception: issued, with no series number, see `work_imported_invoices`.)
    check(
      "work_invoices_number",
      sql`${t.imported} or ((${t.status} = 'draft') = (${t.number} is null) and (${t.number} is null) = (${t.documentNumber} is null))`,
    ),
    check("work_invoices_imported", sql`not ${t.imported} or (${t.status} <> 'draft' and ${t.number} is null and ${t.documentNumber} is not null)`),
    check("work_invoices_legacy_number", sql`${t.legacyNumber} is null or (${t.imported} and length(trim(${t.legacyNumber})) between 1 and 60)`),
    check(
      "work_invoices_issued",
      sql`${t.status} = 'draft' or (${t.issuedOn} is not null and ${t.dueOn} is not null and ${t.sentAt} is not null and ${t.seller} is not null and ${t.buyer} is not null and ${t.locale} is not null and ${t.paymentDays} is not null)`,
    ),
    check("work_invoices_recurring", sql`(${t.recurringInvoiceId} is null) = (${t.recurringPeriod} is null)`),
    check("work_invoices_payment_days", sql`${t.paymentDays} is null or ${t.paymentDays} between 1 and 90`),
    check("work_invoices_service", sql`${t.serviceFrom} is null or ${t.serviceTo} is null or ${t.serviceFrom} <= ${t.serviceTo}`),
    check("work_invoices_fx", sql`${t.fxRate} is null or ${t.fxRate} > 0`),
    check("work_invoices_texts", sql`length(coalesce(${t.notes}, '')) <= 5000 and length(coalesce(${t.reference}, '')) <= 200`),
    check("work_invoices_vat_notes", sql`jsonb_typeof(${t.vatNotes}) = 'array'`),
  ],
);

/**
 * A line on an invoice. Quantity is in hundredths (of an hour or a unit) so a
 * document can be checked by hand; amounts follow docs/work.md 4.3 exactly.
 * Lines change only while their invoice is a draft (a trigger).
 */
export const workInvoiceLines = commerce.table(
  "work_invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    invoiceId: uuid("invoice_id").notNull(),
    position: integer("position").notNull().default(0),
    /** Where the line came from; nulled (never the line) when that is deleted. */
    assignmentId: uuid("assignment_id"),
    taskId: uuid("task_id"),
    description: text("description").notNull(),
    /** `hour` or `unit`; `quantity_hundredths` counts hundredths of either. */
    unit: text("unit").notNull().default("hour"),
    quantityHundredths: integer("quantity_hundredths").notNull().default(0),
    /** Net of VAT. */
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    discountBp: integer("discount_bp").notNull().default(0),
    vatCategory: text("vat_category").notNull().default("standard"),
    /** A fraction such as 0.2500, as `order_lines.tax_rate`; recomputed from `commerce.vat_rate()` at issue. */
    vatRate: numeric("vat_rate", { precision: 6, scale: 4 }).notNull().default("0"),
    exclMinor: bigint("excl_minor", { mode: "number" }).notNull().default(0),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull().default(0),
    inclMinor: bigint("incl_minor", { mode: "number" }).notNull().default(0),
    /** Set when the owner typed or rounded the quantity: syncing time into the line skips it. */
    quantityManual: boolean("quantity_manual").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_invoice_lines_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "work_invoice_lines_invoice_fk",
      columns: [t.storeId, t.invoiceId],
      foreignColumns: [workInvoices.storeId, workInvoices.id],
    }).onDelete("cascade"),
    index("work_invoice_lines_invoice_idx").on(t.storeId, t.invoiceId, t.position),
    index("work_invoice_lines_assignment_idx").on(t.storeId, t.assignmentId).where(sql`${t.assignmentId} is not null`),
    index("work_invoice_lines_task_idx").on(t.storeId, t.taskId).where(sql`${t.taskId} is not null`),
    check("work_invoice_lines_description", sql`length(trim(${t.description})) between 1 and 500`),
    check("work_invoice_lines_unit", sql`${t.unit} in ('hour', 'unit')`),
    check("work_invoice_lines_quantity", sql`${t.quantityHundredths} between 0 and 10000000`),
    check("work_invoice_lines_price", sql`${t.unitPriceMinor} between 0 and 1000000000`),
    check("work_invoice_lines_discount", sql`${t.discountBp} between 0 and 10000`),
    check("work_invoice_lines_vat_category", sql`${t.vatCategory} in ('standard', 'exempt', 'reverse_charge', 'outside_scope')`),
    check("work_invoice_lines_vat_rate", sql`${t.vatRate} >= 0 and ${t.vatRate} < 1 and (${t.vatCategory} = 'standard' or ${t.vatRate} = 0)`),
    check("work_invoice_lines_amounts", sql`${t.exclMinor} >= 0 and ${t.vatMinor} >= 0 and ${t.inclMinor} = ${t.exclMinor} + ${t.vatMinor}`),
  ],
);

/**
 * Time worked. Attached to at most one invoice line (`invoice_line_id`), so
 * nothing is billed twice; once that line's invoice is issued the entry cannot
 * change or be deleted (a trigger), and it is released again only when the
 * invoice is fully credited.
 */
export const workTimeEntries = commerce.table(
  "work_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    assignmentId: uuid("assignment_id").notNull(),
    /** Nulled when the task is deleted (foreign key in the rules migration: it names the assignment as well). */
    taskId: uuid("task_id"),
    /** Who worked. */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    workDate: date("work_date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    billable: boolean("billable").notNull().default(true),
    note: text("note"),
    /** The minutes an hour package already paid for (later package); 0 until then. */
    prepaidMinutes: integer("prepaid_minutes").notNull().default(0),
    /** The draft line billing it, kept when issued, nulled if the draft line is deleted (rules migration). */
    invoiceLineId: uuid("invoice_line_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("work_time_entries_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "work_time_entries_assignment_fk",
      columns: [t.storeId, t.assignmentId],
      foreignColumns: [workAssignments.storeId, workAssignments.id],
    }),
    index("work_time_entries_assignment_idx").on(t.storeId, t.assignmentId, sql`${t.workDate} desc`),
    index("work_time_entries_task_idx").on(t.storeId, t.assignmentId, t.taskId),
    index("work_time_entries_date_idx").on(t.storeId, sql`${t.workDate} desc`),
    index("work_time_entries_account_date_idx").on(t.storeId, t.accountId, sql`${t.workDate} desc`),
    index("work_time_entries_account_idx").on(t.accountId),
    index("work_time_entries_line_idx").on(t.storeId, t.invoiceLineId),
    check("work_time_entries_minutes", sql`${t.minutes} between 1 and 1440`),
    check("work_time_entries_note", sql`length(coalesce(${t.note}, '')) <= 500`),
    check("work_time_entries_prepaid", sql`${t.prepaidMinutes} between 0 and ${t.minutes}`),
  ],
);

/**
 * A running timer: one per person across all their stores (D123; the primary key
 * is still store and person, the unique index on the person is the rule). Start and
 * stop are the functions `commerce.work_start_timer` and `commerce.work_stop_timer`.
 */
export const workTimers = commerce.table(
  "work_timers",
  {
    storeId: storeId().references(() => stores.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    assignmentId: uuid("assignment_id").notNull(),
    taskId: uuid("task_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.accountId] }),
    foreignKey({
      name: "work_timers_assignment_fk",
      columns: [t.storeId, t.assignmentId],
      foreignColumns: [workAssignments.storeId, workAssignments.id],
    }).onDelete("cascade"),
    // A timer's task is one of its own assignment's; deleting the task stops the timer.
    foreignKey({
      name: "work_timers_task_fk",
      columns: [t.storeId, t.assignmentId, t.taskId],
      foreignColumns: [workTasks.storeId, workTasks.assignmentId, workTasks.id],
    }).onDelete("cascade"),
    uniqueIndex("work_timers_account_idx").on(t.accountId),
    index("work_timers_assignment_idx").on(t.storeId, t.assignmentId, t.taskId),
  ],
);

/**
 * Money received for an invoice. Append-only: a mistake is reversed by a
 * negative row (`reverses`), a refund is a negative row too. The invoice
 * becomes `paid` when payments and credit notes cover its total, and `sent`
 * again if a reversal drops it below (a trigger).
 */
export const workInvoicePayments = commerce.table(
  "work_invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    invoiceId: uuid("invoice_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    /** The Stripe Checkout session, for an online payment (later package). */
    providerReference: text("provider_reference"),
    /** The payment this negative row takes back. */
    reverses: uuid("reverses"),
    recordedBy: uuid("recorded_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("work_invoice_payments_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "work_invoice_payments_invoice_fk",
      columns: [t.storeId, t.invoiceId],
      foreignColumns: [workInvoices.storeId, workInvoices.id],
    }),
    foreignKey({
      name: "work_invoice_payments_reverses_fk",
      columns: [t.storeId, t.reverses],
      foreignColumns: [t.storeId, t.id],
    }),
    index("work_invoice_payments_invoice_idx").on(t.storeId, t.invoiceId, t.receivedOn),
    index("work_invoice_payments_recorded_by_idx").on(t.recordedBy),
    uniqueIndex("work_invoice_payments_reverses_idx").on(t.storeId, t.reverses).where(sql`${t.reverses} is not null`),
    uniqueIndex("work_invoice_payments_provider_idx").on(t.storeId, t.providerReference).where(sql`${t.providerReference} is not null`),
    check("work_invoice_payments_amount", sql`${t.amountMinor} <> 0`),
    check("work_invoice_payments_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("work_invoice_payments_method", sql`${t.method} in ('bank', 'card', 'cash', 'other', 'stripe', 'prepaid')`),
    check("work_invoice_payments_reversal", sql`${t.reverses} is null or ${t.amountMinor} < 0`),
    check("work_invoice_payments_texts", sql`length(coalesce(${t.reference}, '')) <= 200`),
  ],
);

/**
 * A credit note against an issued invoice, numbered from the store's
 * `work_credit_note` series by `commerce.credit_work_invoice`. Append-only.
 * Amounts are positive; the document says credit. A full credit voids the
 * invoice.
 */
export const workCreditNotes = commerce.table(
  "work_credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    invoiceId: uuid("invoice_id").notNull(),
    series: text("series").notNull().default("work_credit_note"),
    number: bigint("number", { mode: "number" }).notNull(),
    documentNumber: text("document_number").notNull(),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    reason: text("reason"),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    vatHomeMinor: bigint("vat_home_minor", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    /** The credited lines, as they were on the invoice, with the credited quantity and amounts. */
    lines: jsonb("lines").notNull(),
    seller: jsonb("seller").notNull(),
    buyer: jsonb("buyer").notNull(),
    vatNotes: jsonb("vat_notes").notNull().default([]),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("work_credit_notes_store_id_key").on(t.storeId, t.id),
    unique("work_credit_notes_series_number_key").on(t.storeId, t.series, t.number),
    unique("work_credit_notes_document_number_key").on(t.storeId, t.documentNumber),
    foreignKey({
      name: "work_credit_notes_invoice_fk",
      columns: [t.storeId, t.invoiceId],
      foreignColumns: [workInvoices.storeId, workInvoices.id],
    }),
    seriesRef("work_credit_notes_series_fk", t),
    index("work_credit_notes_invoice_idx").on(t.storeId, t.invoiceId),
    index("work_credit_notes_created_by_idx").on(t.createdBy),
    check("work_credit_notes_series", sql`${t.series} = 'work_credit_note'`),
    check("work_credit_notes_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("work_credit_notes_amounts", sql`${t.subtotalMinor} >= 0 and ${t.vatMinor} >= 0 and ${t.totalMinor} > 0 and ${t.totalMinor} = ${t.subtotalMinor} + ${t.vatMinor}`),
    check("work_credit_notes_lines", sql`jsonb_typeof(${t.lines}) = 'array' and jsonb_array_length(${t.lines}) > 0`),
    check("work_credit_notes_reason", sql`length(coalesce(${t.reason}, '')) <= 1000`),
  ],
);

/**
 * What happened to a client, invoice, payment or entry: the invoice's history
 * panel and the Work activity list. Append-only. `account_id` is null for the
 * system (the cron). No secrets and no client email in `data`.
 */
export const workEvents = commerce.table(
  "work_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId().references(() => stores.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    /** `invoice.issued`, `payment.recorded`, … (docs/work.md 7.4). */
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    accountId: uuid("account_id").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("work_events_entity_idx").on(t.storeId, t.entityType, t.entityId, t.createdAt),
    index("work_events_store_idx").on(t.storeId, t.createdAt),
    index("work_events_account_idx").on(t.accountId),
    check("work_events_names", sql`length(${t.entityType}) between 1 and 40 and length(${t.type}) between 1 and 60`),
    check("work_events_data", sql`jsonb_typeof(${t.data}) = 'object'`),
  ],
);

/**
 * A store duplicated from another (D129, `docs/store-copy.md`): one row per copy, kept for its progress page and
 * for the job in the five-minute cron, which does the media, customers and orders phase by phase and can pick a
 * copy up again where it stopped. The settings, pages, products and posts are copied at once by
 * `commerce.duplicate_store()`; `counts` holds what was asked for and what is done, `cursor` where the batches are.
 */
export const storeCopies = commerce.table(
  "store_copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceStoreId: uuid("source_store_id")
      .notNull()
      .references(() => stores.id),
    newStoreId: uuid("new_store_id")
      .notNull()
      .references(() => stores.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => accounts.id),
    /** What the owner chose (`StoreCopyOptions`, `src/lib/store-copy.ts`). */
    options: jsonb("options").notNull(),
    status: text("status").notNull().default("running"),
    /** `queued`, `content`, `media`, `people`, `orders`, `finishing` or `done`. */
    phase: text("phase").notNull().default("queued"),
    /** Per kind `{ done, total }`. */
    counts: jsonb("counts").notNull().default({}),
    /** Where the batches stand (the last customer and order handled), so a rerun goes on from there. */
    cursor: jsonb("cursor").notNull().default({}),
    /** Pictures and files that could not be copied and were left out, never left pointing at the original. */
    mediaLeftOut: integer("media_left_out").notNull().default(0),
    /** Plain-English reason when it failed. */
    problem: text("problem"),
    /** How many times the job took it up; the job gives up past a limit. */
    attempts: integer("attempts").notNull().default(0),
    /** One run at a time: a run holds the copy until this time. */
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("store_copies_source_idx").on(t.sourceStoreId),
    index("store_copies_new_idx").on(t.newStoreId),
    index("store_copies_requested_by_idx").on(t.requestedBy),
    index("store_copies_open_idx").on(t.status, t.claimedUntil),
    check("store_copies_status", sql`${t.status} in ('running', 'done', 'failed')`),
    check(
      "store_copies_phase",
      sql`${t.phase} in ('queued', 'content', 'media', 'people', 'orders', 'finishing', 'done')`,
    ),
    check("store_copies_different", sql`${t.sourceStoreId} <> ${t.newStoreId}`),
  ],
);

/**
 * Which new address a file of the original got in a copy (D129): what makes the media phase resumable and lets a
 * rerun copy nothing twice. `new_url` is null for a file that could not be copied (left out).
 */
export const storeCopyFiles = commerce.table(
  "store_copy_files",
  {
    copyId: uuid("copy_id")
      .notNull()
      .references(() => storeCopies.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    newUrl: text("new_url"),
    /** The file's own address, as against its small copy's (`thumbnail_url`), so a copy counts files, not addresses. */
    main: boolean("main").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.copyId, t.sourceUrl] })],
);

/**
 * A store's bonus program (D130, `src/lib/bonus.ts`, `docs/bonus.md`): off until the owner turns it on. The credits are
 * money in `currency`, pinned when the program is first saved (the store's main currency then), so a balance never
 * changes currency under a customer. A store without a row has the defaults and the program off.
 */
export const bonusSettings = commerce.table(
  "bonus_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    enabled: boolean("enabled").notNull().default(false),
    /** Credits earned per 100 paid, in basis points: 500 is 5 %. */
    earnBps: integer("earn_bps").notNull().default(500),
    /** Days after an order is paid before its credits can be used (the return period). */
    pendingDays: integer("pending_days").notNull().default(14),
    /** The most of an order's goods credits may pay for, in percent. */
    maxRedeemPercent: integer("max_redeem_percent").notNull().default(50),
    /** The least a customer can use at once, in minor units of `currency`. */
    minRedeemMinor: bigint("min_redeem_minor", { mode: "number" }).notNull().default(0),
    /** Months after which unused credits expire, counted from when they become usable; null for never. */
    expiresMonths: integer("expires_months"),
    /** The credits' currency: what the ledger's amounts are in. */
    currency: char("currency", { length: 3 }).notNull(),
    /**
     * Since when the program has been off (its own switch, or the store feature `bonus` with what it needs, D178); null while it
     * is on. Kept by the database (`commerce.bonus_pause_sync()`): nothing expires while it is off, and when it comes back on,
     * credits whose expiry passed meanwhile get their date moved by as long as it was off (`commerce.bonus_resume()`).
     */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("bonus_settings_updated_by_idx").on(t.updatedBy),
    check("bonus_settings_earn", sql`${t.earnBps} between 0 and 5000`),
    check("bonus_settings_pending", sql`${t.pendingDays} between 0 and 90`),
    check("bonus_settings_max_redeem", sql`${t.maxRedeemPercent} between 1 and 90`),
    check("bonus_settings_min_redeem", sql`${t.minRedeemMinor} between 0 and 1000000`),
    check("bonus_settings_expiry", sql`${t.expiresMonths} is null or ${t.expiresMonths} between 1 and 60`),
  ],
);

/**
 * The bonus ledger (D130): every grant and use of a customer's credits, append-only (a trigger refuses any change, and
 * any delete but the customer's own deletion). Amounts are signed minor units in the program's credits currency. A
 * positive entry is a *lot* (`earn`, `restore`, a positive `adjust`): credits usable from `available_at` until
 * `expires_at`; a negative one (`redeem`, `reverse`, `expire`, a negative `adjust`) is paid out of lots through
 * `bonus_allocations`, oldest expiry first, so what is left of a lot is always worked out from the ledger and a balance
 * can never go below zero. `idempotency_key` makes every grant, use, return and expiry happen once. Everything that
 * writes here is a `commerce.bonus_*` function holding the customer's row lock.
 */
export const bonusEntries = commerce.table(
  "bonus_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    customerId: uuid("customer_id").notNull(),
    /** `earn`, `redeem`, `restore`, `reverse`, `expire`, `adjust` or `referral` (`BonusEntryKind`). */
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    orderId: uuid("order_id"),
    refundId: uuid("refund_id"),
    /** For a lot: when it can be used. */
    availableAt: timestamp("available_at", { withTimezone: true }),
    /** For a lot: when what is left of it expires, if ever. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    /** The staff member behind an adjustment. */
    createdBy: uuid("created_by").references(() => accounts.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("bonus_entries_store_id_key").on(t.storeId, t.id),
    unique("bonus_entries_idempotency_key").on(t.storeId, t.idempotencyKey),
    foreignKey({
      name: "bonus_entries_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bonus_entries_order_fk",
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
    foreignKey({
      name: "bonus_entries_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    index("bonus_entries_customer_idx").on(t.storeId, t.customerId, t.createdAt),
    index("bonus_entries_order_idx").on(t.storeId, t.orderId),
    index("bonus_entries_refund_idx").on(t.storeId, t.refundId),
    index("bonus_entries_created_by_idx").on(t.createdBy),
    index("bonus_entries_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.amountMinor} > 0 and ${t.expiresAt} is not null`),
    check("bonus_entries_kind", sql`${t.kind} in ('earn', 'redeem', 'restore', 'reverse', 'expire', 'adjust', 'referral')`),
    check("bonus_entries_amount", sql`${t.amountMinor} <> 0`),
    check(
      "bonus_entries_sign",
      sql`(${t.kind} in ('earn', 'restore', 'referral') and ${t.amountMinor} > 0) or (${t.kind} in ('redeem', 'reverse', 'expire') and ${t.amountMinor} < 0) or ${t.kind} = 'adjust'`,
    ),
    check("bonus_entries_lot", sql`${t.amountMinor} < 0 or ${t.availableAt} is not null`),
    check("bonus_entries_note", sql`length(${t.note}) <= 500`),
  ],
);

/** What of a lot a negative entry took (D130): the lot's remaining credits are its amount less these. Append-only. */
export const bonusAllocations = commerce.table(
  "bonus_allocations",
  {
    storeId: storeId().references(() => stores.id),
    /** The positive entry credits were taken from, and the negative entry that took them. */
    lotId: uuid("lot_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.lotId, t.entryId] }),
    foreignKey({
      name: "bonus_allocations_lot_fk",
      columns: [t.storeId, t.lotId],
      foreignColumns: [bonusEntries.storeId, bonusEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bonus_allocations_entry_fk",
      columns: [t.storeId, t.entryId],
      foreignColumns: [bonusEntries.storeId, bonusEntries.id],
    }).onDelete("cascade"),
    index("bonus_allocations_entry_idx").on(t.storeId, t.entryId),
    check("bonus_allocations_amount", sql`${t.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// The affiliate program (D131, docs/affiliates.md): two levels, each its own set of tables.
// ---------------------------------------------------------------------------

/**
 * Kaizen's referral program (D131, `src/lib/referrals.ts`), one row: store owners refer other store owners and earn a
 * share of the fees the referred store pays Kaizen, as credit against their own Kaizen invoices. Off until a platform
 * admin turns it on.
 */
export const referralSettings = commerce.table(
  "referral_settings",
  {
    id: boolean("id").primaryKey().default(true),
    enabled: boolean("enabled").notNull().default(false),
    /** The share of the referred store's plan fees and Kaizen's sale fees that the referrer earns, in basis points. */
    commissionBps: integer("commission_bps").notNull().default(1000),
    /** How many months after the referred store was created its fees earn commission. */
    months: integer("months").notNull().default(12),
    /** Days after a fee is paid before its credit can be used (fees can be refunded). */
    pendingDays: integer("pending_days").notNull().default(30),
    /** Days the referral cookie lasts, once the visitor has allowed it. */
    cookieDays: integer("cookie_days").notNull().default(30),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("referral_settings_updated_by_idx").on(t.updatedBy),
    check("referral_settings_singleton", sql`${t.id}`),
    check("referral_settings_commission", sql`${t.commissionBps} between 0 and 5000`),
    check("referral_settings_months", sql`${t.months} between 1 and 60`),
    check("referral_settings_pending", sql`${t.pendingDays} between 0 and 90`),
    check("referral_settings_cookie", sql`${t.cookieDays} between 1 and 90`),
  ],
);

/** An account's referral code (D131): made the first time its owner opens Referrals; one per account. */
export const referrers = commerce.table(
  "referrers",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Lower case letters and digits, 6 to 16 (`REFERRAL_CODE` in lib/referrals). */
    code: text("code").notNull().unique(),
    /** A platform admin stopped the account earning; what it has earned stays, nothing new is earned. */
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [check("referrers_code", sql`${t.code} ~ '^[a-z0-9]{6,16}$'`)],
);

/**
 * A store that came through a referral (D131): made when the request with the code is approved. Fees the store pays
 * Kaizen in `[created_at, created_at + months)` earn the referrer commission, at the rate and months set when it was
 * made (so a later change never reaches an earlier promise).
 */
export const referrals = commerce.table(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerAccountId: uuid("referrer_account_id")
      .notNull()
      .references(() => referrers.accountId, { onDelete: "cascade" }),
    /** The store that was opened; one referral each. */
    storeId: uuid("store_id")
      .notNull()
      .unique()
      .references(() => stores.id),
    accessRequestId: uuid("access_request_id").references(() => accessRequests.id),
    commissionBps: integer("commission_bps").notNull(),
    months: integer("months").notNull(),
    /** `active`, or `void` when staff found it was not genuine (self-referral): it earns nothing more. */
    status: text("status").notNull().default("active"),
    voidReason: text("void_reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("referrals_referrer_idx").on(t.referrerAccountId, t.createdAt),
    index("referrals_access_request_idx").on(t.accessRequestId),
    check("referrals_status", sql`${t.status} in ('active', 'void')`),
  ],
);

/**
 * The referral credit ledger (D131), like the bonus ledger (D130) but per account and currency: append-only, signed minor
 * units, every grant a lot usable from `available_at`, every use or take-back paid out of lots through
 * `referral_allocations`, each entry once per idempotency key. Applied to the account's own Kaizen plan invoices
 * (`apply`, `invoice_ref` the Stripe invoice). Only `commerce.referral_*` functions write here.
 */
export const referralEntries = commerce.table(
  "referral_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    currency: char("currency", { length: 3 }).notNull(),
    /** `earn`, `apply`, `restore`, `reverse` or `adjust`. */
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** For an `earn`: what paid the commission, `plan_invoice` (a Stripe invoice id) or `sale_fee` (a payment id). */
    sourceKind: text("source_kind"),
    sourceRef: text("source_ref"),
    referralId: uuid("referral_id").references(() => referrals.id),
    /** For an `apply` or `restore`: the Kaizen invoice the credit was put on. */
    invoiceRef: text("invoice_ref"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => accounts.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("referral_entries_account_idx").on(t.accountId, t.currency, t.createdAt),
    index("referral_entries_referral_idx").on(t.referralId),
    index("referral_entries_source_idx").on(t.sourceKind, t.sourceRef),
    index("referral_entries_invoice_idx").on(t.invoiceRef),
    index("referral_entries_created_by_idx").on(t.createdBy),
    check("referral_entries_kind", sql`${t.kind} in ('earn', 'apply', 'restore', 'reverse', 'adjust')`),
    check("referral_entries_amount", sql`${t.amountMinor} <> 0`),
    check(
      "referral_entries_sign",
      sql`(${t.kind} in ('earn', 'restore') and ${t.amountMinor} > 0) or (${t.kind} in ('apply', 'reverse') and ${t.amountMinor} < 0) or ${t.kind} = 'adjust'`,
    ),
    check("referral_entries_lot", sql`${t.amountMinor} < 0 or ${t.availableAt} is not null`),
    check("referral_entries_note", sql`length(${t.note}) <= 500`),
  ],
);

/** What of a lot a negative referral entry took (D131); append-only, as `bonus_allocations`. */
export const referralAllocations = commerce.table(
  "referral_allocations",
  {
    lotId: uuid("lot_id")
      .notNull()
      .references(() => referralEntries.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => referralEntries.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lotId, t.entryId] }),
    index("referral_allocations_entry_idx").on(t.entryId),
    check("referral_allocations_amount", sql`${t.amountMinor} > 0`),
  ],
);

/**
 * A store's affiliate program (D131, `src/lib/affiliates.ts`): its signed-in customers refer friends. The referrer earns
 * bonus credits (D130, kind `referral`) on the friend's paid orders and the friend gets a welcome discount on their first
 * order. Off until the owner turns it on, and needs the bonus program on. A store without a row has the defaults, off.
 */
export const affiliateSettings = commerce.table(
  "affiliate_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    enabled: boolean("enabled").notNull().default(false),
    /** The referrer's credits per 100 the friend pays for goods, in basis points: 500 is 5 %. */
    rewardBps: integer("reward_bps").notNull().default(500),
    /** How many of the friend's paid orders earn the referrer credits; null for every one. */
    rewardOrders: integer("reward_orders").default(1),
    /** The friend's welcome discount on their first order, in percent of goods; 0 for none. */
    friendPercent: integer("friend_percent").notNull().default(10),
    /** The most the welcome discount takes off, in minor units of the store's main currency; null for no limit. */
    friendMaxMinor: bigint("friend_max_minor", { mode: "number" }),
    /** The most one referrer can earn in a calendar month, in minor units of the credits' currency; null for no limit. */
    monthlyCapMinor: bigint("monthly_cap_minor", { mode: "number" }),
    /** Days the link's cookie lasts once the visitor has allowed it. */
    cookieDays: integer("cookie_days").notNull().default(30),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("affiliate_settings_updated_by_idx").on(t.updatedBy),
    check("affiliate_settings_reward", sql`${t.rewardBps} between 0 and 5000`),
    check("affiliate_settings_orders", sql`${t.rewardOrders} is null or ${t.rewardOrders} between 1 and 100`),
    check("affiliate_settings_friend", sql`${t.friendPercent} between 0 and 50`),
    check("affiliate_settings_friend_max", sql`${t.friendMaxMinor} is null or ${t.friendMaxMinor} between 0 and 100000000`),
    check("affiliate_settings_cap", sql`${t.monthlyCapMinor} is null or ${t.monthlyCapMinor} between 0 and 1000000000`),
    check("affiliate_settings_cookie", sql`${t.cookieDays} between 1 and 90`),
  ],
);

/** A customer's referral code in a store (D131): made the first time they open Refer a friend; one per customer. */
export const affiliates = commerce.table(
  "affiliates",
  {
    storeId: storeId().references(() => stores.id),
    customerId: uuid("customer_id").notNull(),
    /** Lower case letters and digits, 6 to 16, unique in the store. */
    code: text("code").notNull(),
    /** Staff stopped them earning; what they have earned stays, nothing new is earned. */
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.customerId] }),
    unique("affiliates_code_key").on(t.storeId, t.code),
    foreignKey({
      name: "affiliates_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    check("affiliates_code", sql`${t.code} ~ '^[a-z0-9]{6,16}$'`),
  ],
);

/**
 * One attributed order (D131): who referred it, the friend's welcome discount, and the credits the referrer earned
 * (in the program's credits currency; `rewarded_at` when they were granted). `status` follows the order: `pending` until
 * it is paid, `rewarded` once paid, `reversed` when it is cancelled or fully refunded, `rejected` when a guard stopped the
 * reward (`reject_reason`: `self`, `not_new`, `blocked`, `cap`, `limit`, `off`). At most one per order.
 */
export const affiliateAttributions = commerce.table(
  "affiliate_attributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    orderId: uuid("order_id").notNull(),
    affiliateCustomerId: uuid("affiliate_customer_id").notNull(),
    /** The friend, when signed in; null for a guest (who gets no welcome discount). */
    friendCustomerId: uuid("friend_customer_id"),
    code: text("code").notNull(),
    discountMinor: money("discount_minor").default(0),
    rewardMinor: bigint("reward_minor", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("affiliate_attributions_store_id_key").on(t.storeId, t.id),
    unique("affiliate_attributions_order_key").on(t.storeId, t.orderId),
    foreignKey({
      name: "affiliate_attributions_order_fk",
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "affiliate_attributions_affiliate_fk",
      columns: [t.storeId, t.affiliateCustomerId],
      foreignColumns: [affiliates.storeId, affiliates.customerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "affiliate_attributions_friend_fk",
      columns: [t.storeId, t.friendCustomerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("set null"),
    index("affiliate_attributions_affiliate_idx").on(t.storeId, t.affiliateCustomerId, t.createdAt),
    index("affiliate_attributions_friend_idx").on(t.storeId, t.friendCustomerId),
    check("affiliate_attributions_status", sql`${t.status} in ('pending', 'rewarded', 'reversed', 'rejected')`),
    check("affiliate_attributions_reward", sql`${t.rewardMinor} >= 0`),
  ],
);

/**
 * Visits to a referral link, counted by day and code, with nothing about the visitor (D131): `store_id` null is Kaizen's
 * own program. Only for the dashboards' "visits".
 */
export const referralVisits = commerce.table(
  "referral_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id),
    code: text("code").notNull(),
    day: date("day").notNull(),
    visits: integer("visits").notNull().default(0),
  },
  (t) => [
    uniqueIndex("referral_visits_key").on(sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.code, t.day),
    index("referral_visits_store_idx").on(t.storeId),
    check("referral_visits_count", sql`${t.visits} >= 0`),
  ],
);

/**
 * The platform's list of features (D132, `src/lib/plan-features.ts`): what Kaizen can tell a store owner a plan includes,
 * in rows grouped by `category`. The matrix of which plan has which feature is `plan_feature_grants`. It is what the
 * plan comparison shows; it does not switch anything on or off by itself.
 */
export const planFeatures = commerce.table(
  "plan_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Order within the whole list; a category shows where its first feature is. */
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("plan_features_updated_by_idx").on(t.updatedBy),
    check("plan_features_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("plan_features_category", sql`length(trim(${t.category})) between 1 and 60`),
    check("plan_features_description", sql`length(${t.description}) <= 300`),
  ],
);

/** A feature a plan includes (D132): a row means included; none means not. */
export const planFeatureGrants = commerce.table(
  "plan_feature_grants",
  {
    featureId: uuid("feature_id")
      .notNull()
      .references(() => planFeatures.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.planId] }), index("plan_feature_grants_plan_idx").on(t.planId)],
);

/**
 * A store's own agreement with a shipping carrier (D133, `src/lib/shipping-carriers.ts`): the carrier's API details the
 * store saved from Integrations, prepared before the carrier's connection exists. Non-secret details are in `details`;
 * the secrets (API keys) are one encrypted JSON in `secrets_encrypted`, with `secret_hints` (their last four
 * characters) to recognise them by. Nothing is sent to a carrier from this row yet.
 */
export const shippingCarriers = commerce.table(
  "shipping_carriers",
  {
    storeId: storeId().references(() => stores.id),
    /** `bring`, `postnord`, `porterbuddy` or `helthjem`. */
    carrier: text("carrier").notNull(),
    /** `test` or `live`. */
    environment: text("environment").notNull().default("test"),
    details: jsonb("details").notNull().default({}),
    secretsEncrypted: text("secrets_encrypted"),
    secretHints: jsonb("secret_hints").notNull().default({}),
    /** The countries (markets) the store wants to ship to with it. */
    countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
    /** Every detail the carrier needs is saved. */
    complete: boolean("complete").notNull().default(false),
    /** The last "Check connection" (D134): when, whether the carrier accepted the agreement, and what it said. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkOk: boolean("check_ok"),
    checkMessage: text("check_message"),
    /**
     * Its services offered to shoppers at checkout (D135): on or off, which services, what is added to the carrier's price
     * (a percentage of the price with VAT and a fixed amount, in the country's currency), the basket value over which
     * it is free, and the weight of a parcel when what is bought has none.
     */
    checkoutEnabled: boolean("checkout_enabled").notNull().default(false),
    checkoutServices: text("checkout_services").array().notNull().default(sql`'{}'::text[]`),
    markupPercent: integer("markup_percent").notNull().default(0),
    markupMinor: integer("markup_minor").notNull().default(0),
    freeOverMinor: integer("free_over_minor"),
    defaultWeightGrams: integer("default_weight_grams").notNull().default(1000),
    /** What the store charges for the services of a carrier that has no price service (D136, PostNord), by country: `{ NO: { freeOverMinor, services: { "19": 9900 } } }`, with VAT, in the country's own currency. */
    checkoutPrices: jsonb("checkout_prices").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.carrier] }),
    check("shipping_carriers_markup", sql`${t.markupPercent} between 0 and 100 and ${t.markupMinor} >= 0`),
    check("shipping_carriers_free_over", sql`${t.freeOverMinor} is null or ${t.freeOverMinor} > 0`),
    check("shipping_carriers_default_weight", sql`${t.defaultWeightGrams} between 1 and 35000`),
    index("shipping_carriers_updated_by_idx").on(t.updatedBy),
    check("shipping_carriers_carrier", sql`${t.carrier} in ('bring', 'postnord', 'porterbuddy', 'helthjem')`),
    check("shipping_carriers_environment", sql`${t.environment} in ('test', 'live')`),
  ],
);

/**
 * What a carrier offered a cart at checkout (D135), one row per service shown, kept so the shopper's choice is priced
 * as it was shown and `cartSummary()` and `placeOrder()` read the same price without calling the carrier again. Amounts
 * are in the country's own currency, with VAT, after the store's markup; the order is in the currency shown.
 */
export const deliveryQuotes = commerce.table(
  "delivery_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    cartId: uuid("cart_id").notNull(),
    carrier: text("carrier").notNull(),
    serviceId: text("service_id").notNull(),
    label: text("label").notNull(),
    amountMinor: money("amount_minor").notNull(),
    freeOverMinor: bigint("free_over_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull(),
    country: char("country", { length: 2 }).notNull(),
    postalCode: text("postal_code").notNull(),
    /** Days, as `{ minDays, maxDays }`, when the carrier said. */
    estimate: jsonb("estimate"),
    /** The delivery window the shopper chose among (D137, Porterbuddy): the service is delivered within it. */
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    /** Whether the shopper must choose one of `pickup_points`. */
    needsPickupPoint: boolean("needs_pickup_point").notNull().default(false),
    /** Near the postal code, as the carrier gave them: `{ id, name, street, postalCode, city, distanceMeters }`. */
    pickupPoints: jsonb("pickup_points").notNull().default([]),
    /** The one the shopper chose, from `pickup_points`. */
    pickupPointId: text("pickup_point_id"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("delivery_quotes_store_id_key").on(t.storeId, t.id),
    check("delivery_quotes_amount", sql`${t.amountMinor} >= 0`),
    check("delivery_quotes_window", sql`(${t.windowStart} is null) = (${t.windowEnd} is null) and (${t.windowStart} is null or ${t.windowEnd} > ${t.windowStart})`),
    cartRef("delivery_quotes_cart_fk", t).onDelete("cascade"),
    index("delivery_quotes_cart_idx").on(t.storeId, t.cartId),
    index("delivery_quotes_expires_idx").on(t.expiresAt),
  ],
);

/**
 * A store's product recommendations (D139): whether they are on, whether the store's AI may re-rank them, the share of
 * visitors who get the plain ranking so the two can be compared, how much dearer than the product an upsell may be, and
 * a monthly cap on the AI's tokens (null for none). Off until the owner switches it on.
 */
export const recommendationSettings = commerce.table(
  "recommendation_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** Whether the store's text model may re-rank candidates; the ranking without it is always the fallback. */
    ai: boolean("ai").notNull().default(true),
    /** The share of visitors (by tab) who get the plain ranking, so the AI's can be measured against it. */
    holdoutPercent: integer("holdout_percent").notNull().default(10),
    /** An upsell costs at most this much more than the product it is an upsell of, in percent. */
    upsellCeilingPercent: integer("upsell_ceiling_percent").notNull().default(50),
    /** The most tokens the recommendations may use of the AI in a calendar month; null for no cap. */
    monthlyTokenCap: bigint("monthly_token_cap", { mode: "number" }).default(1_000_000),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("recommendation_settings_updated_by_idx").on(t.updatedBy),
    check("recommendation_settings_holdout", sql`${t.holdoutPercent} between 0 and 50`),
    check("recommendation_settings_ceiling", sql`${t.upsellCeilingPercent} between 0 and 500`),
    check("recommendation_settings_cap", sql`${t.monthlyTokenCap} is null or ${t.monthlyTokenCap} >= 0`),
  ],
);

/**
 * What the owner decides about the recommendations (D139): `goes_with` (product → other: the other is offered with the
 * product, ahead of what the engine finds), `never_with` (the other is never offered with the product) and `hide` (the
 * product is never recommended anywhere; no other).
 */
export const recommendationRules = commerce.table(
  "recommendation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    productId: uuid("product_id").notNull(),
    otherProductId: uuid("other_product_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("recommendation_rules_store_id_key").on(t.storeId, t.id),
    check("recommendation_rules_kind", sql`${t.kind} in ('goes_with', 'never_with', 'hide')`),
    check("recommendation_rules_other", sql`(${t.kind} = 'hide') = (${t.otherProductId} is null)`),
    check("recommendation_rules_not_self", sql`${t.otherProductId} is null or ${t.otherProductId} <> ${t.productId}`),
    productRef("recommendation_rules_product_fk", t),
    foreignKey({
      name: "recommendation_rules_other_fk",
      columns: [t.storeId, t.otherProductId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete("cascade"),
    uniqueIndex("recommendation_rules_pair_key")
      .on(t.storeId, t.kind, t.productId, t.otherProductId)
      .where(sql`${t.otherProductId} is not null`),
    uniqueIndex("recommendation_rules_hide_key").on(t.storeId, t.productId).where(sql`${t.kind} = 'hide'`),
    index("recommendation_rules_product_idx").on(t.storeId, t.productId),
  ],
);

/**
 * What shoppers did with recommendations (D139), for measuring them: a product shown or clicked in a placement, by a
 * random id the shopper's tab made (kept in the tab only, never linked to a person) and the arm it was in (`ai` or the
 * `baseline` ranking). Kept 90 days.
 */
export const recommendationEvents = commerce.table(
  "recommendation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    session: text("session").notNull(),
    arm: text("arm").notNull(),
    /** Where it was shown: `product`, `listing`, `article`, `page` or `other`. */
    placement: text("placement").notNull(),
    productId: uuid("product_id").notNull(),
    event: text("event").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("recommendation_events_store_idx").on(t.storeId, t.createdAt),
    index("recommendation_events_created_idx").on(t.createdAt),
    check("recommendation_events_arm", sql`${t.arm} in ('ai', 'baseline')`),
    check("recommendation_events_placement", sql`${t.placement} in ('product', 'listing', 'article', 'page', 'other')`),
    check("recommendation_events_event", sql`${t.event} in ('impression', 'click')`),
  ],
);

/**
 * A recommended product put in a cart (D139): the cart and product, the tab's id, the arm and the placement. An order of
 * that cart that holds the product, placed within the attribution window, counts towards the recommendation's revenue.
 * Not tied to the cart row, so it outlives the cart's own expiry; kept 90 days.
 */
export const recommendationAdds = commerce.table(
  "recommendation_adds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    cartId: uuid("cart_id").notNull(),
    productId: uuid("product_id").notNull(),
    session: text("session").notNull(),
    arm: text("arm").notNull(),
    placement: text("placement").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("recommendation_adds_cart_product_key").on(t.storeId, t.cartId, t.productId),
    index("recommendation_adds_store_idx").on(t.storeId, t.createdAt),
    index("recommendation_adds_created_idx").on(t.createdAt),
    check("recommendation_adds_arm", sql`${t.arm} in ('ai', 'baseline')`),
    check("recommendation_adds_placement", sql`${t.placement} in ('product', 'listing', 'article', 'page', 'other')`),
  ],
);

/**
 * An A/B test of a page (D148, docs/ab-testing.md): one question about one page of a store. The page under test is the
 * control (variant `a`); the others are copies of it (pages of type `variant`, with no address on the site). A test is
 * built as a draft and, once it runs, cannot be changed but for its name, its hypothesis and its planned end, so what
 * the results say is about what was started. One running test per page, and five per store (rules in the migration).
 */
export const experiments = commerce.table(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    /** The page under test: a published page of the store. */
    targetPageId: uuid("target_page_id").notNull(),
    /** A part of the page under test (D148, phase 2): its id and its kind (`row`, `column` or `block`). Both null: the whole page. */
    targetPart: text("target_part"),
    targetPartKind: text("target_part_kind"),
    /** `draft`, `scheduled` (starts at `scheduled_start`), `running`, `stopped`, then `applied` (a variant became the page) or `discarded`. */
    status: text("status").notNull().default("draft"),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    /** Why a scheduled start did not happen: said to the owner, who finds the test a draft again. */
    scheduleProblem: text("schedule_problem"),
    /** The share of eligible visitors who are enrolled; the rest see the original and are not counted. */
    trafficShare: numeric("traffic_share", { precision: 4, scale: 3 }).notNull().default("1"),
    /** Narrowing of who is enrolled: `markets`, `devices`, `returning`. Empty: everyone who is eligible. */
    audience: jsonb("audience").notNull().default({}),
    /** What counts as success: `orders`, `revenue`, `cart`, `checkout` or `click` (with the block in `goal_params`). */
    primaryGoal: text("primary_goal").notNull(),
    goalParams: jsonb("goal_params").notNull().default({}),
    /** The least visitors per variant and the least days before a verdict is given. */
    minVisitors: integer("min_visitors").notNull().default(0),
    minDays: integer("min_days").notNull().default(14),
    plannedEnd: timestamp("planned_end", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** Why a test stopped: `person`, `guardrail` or `planned_end`. */
    stopReason: text("stop_reason"),
    appliedVariant: text("applied_variant"),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("experiments_store_id_key").on(t.storeId, t.id),
    foreignKey({ name: "experiments_target_fk", columns: [t.storeId, t.targetPageId], foreignColumns: [pages.storeId, pages.id] }),
    uniqueIndex("experiments_running_target_key").on(t.storeId, t.targetPageId).where(sql`${t.status} = 'running'`),
    index("experiments_store_status_idx").on(t.storeId, t.status),
    index("experiments_target_idx").on(t.storeId, t.targetPageId),
    index("experiments_created_by_idx").on(t.createdBy),
    index("experiments_updated_by_idx").on(t.updatedBy),
    check("experiments_status", sql`${t.status} in ('draft', 'scheduled', 'running', 'stopped', 'applied', 'discarded')`),
    check(
      "experiments_part",
      sql`(${t.targetPart} is null and ${t.targetPartKind} is null) or (${t.targetPart} is not null and length(${t.targetPart}) between 1 and 64 and coalesce(${t.targetPartKind} in ('row', 'column', 'block'), false))`,
    ),
    check("experiments_scheduled", sql`${t.status} <> 'scheduled' or ${t.scheduledStart} is not null`),
    check("experiments_goal", sql`${t.primaryGoal} in ('orders', 'revenue', 'cart', 'checkout', 'click', 'form')`),
    check("experiments_name", sql`length(${t.name}) between 1 and 120 and length(${t.hypothesis}) <= 500`),
    check("experiments_traffic", sql`${t.trafficShare} > 0 and ${t.trafficShare} <= 1`),
    check("experiments_minimums", sql`${t.minVisitors} >= 0 and ${t.minDays} between 1 and 90`),
    check("experiments_stop_reason", sql`${t.stopReason} is null or ${t.stopReason} in ('person', 'guardrail', 'planned_end')`),
    check("experiments_applied", sql`(${t.appliedVariant} is not null) = (${t.status} = 'applied')`),
  ],
);

/** A version of the page in a test: `a` is the original (no page of its own), `b` to `d` are copies with their share of the enrolled. */
export const experimentVariants = commerce.table(
  "experiment_variants",
  {
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    experimentId: uuid("experiment_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** The copy that is this version (a page of type `variant`); null for the original. */
    pageId: uuid("page_id"),
    share: numeric("share", { precision: 4, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.key] }),
    foreignKey({ name: "experiment_variants_experiment_fk", columns: [t.storeId, t.experimentId], foreignColumns: [experiments.storeId, experiments.id] }).onDelete("cascade"),
    foreignKey({ name: "experiment_variants_page_fk", columns: [t.storeId, t.pageId], foreignColumns: [pages.storeId, pages.id] }),
    uniqueIndex("experiment_variants_page_key").on(t.pageId).where(sql`${t.pageId} is not null`),
    index("experiment_variants_page_idx").on(t.storeId, t.pageId),
    check("experiment_variants_key_format", sql`${t.key} in ('a', 'b', 'c', 'd')`),
    check("experiment_variants_control", sql`(${t.key} = 'a') = (${t.pageId} is null)`),
    check("experiment_variants_share", sql`${t.share} >= 0 and ${t.share} <= 1`),
    check("experiment_variants_name", sql`length(${t.name}) between 1 and 60`),
  ],
);

/**
 * A visitor who was shown a version of a tested page (D148), once per visitor and test (the first time counts, the
 * version never changes). `visitor` is a random id the browser keeps for this store, never anything about the person.
 */
export const experimentExposures = commerce.table(
  "experiment_exposures",
  {
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    experimentId: uuid("experiment_id").notNull(),
    visitor: text("visitor").notNull(),
    variant: text("variant").notNull(),
    market: text("market").notNull().default(""),
    device: text("device").notNull().default("desktop"),
    returning: boolean("returning").notNull().default(false),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.visitor] }),
    foreignKey({ name: "experiment_exposures_variant_fk", columns: [t.experimentId, t.variant], foreignColumns: [experimentVariants.experimentId, experimentVariants.key] }).onDelete("cascade"),
    foreignKey({ name: "experiment_exposures_experiment_fk", columns: [t.storeId, t.experimentId], foreignColumns: [experiments.storeId, experiments.id] }).onDelete("cascade"),
    index("experiment_exposures_seen_idx").on(t.storeId, t.firstSeen),
    index("experiment_exposures_visitor_idx").on(t.storeId, t.visitor),
    check("experiment_exposures_visitor", sql`length(${t.visitor}) between 8 and 64`),
    check("experiment_exposures_device", sql`${t.device} in ('mobile', 'tablet', 'desktop')`),
  ],
);

/** What an exposed visitor did that a test counts (a cart, a checkout, a click on the chosen block), once per visitor and thing. Orders are read from orders. */
export const experimentEvents = commerce.table(
  "experiment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    experimentId: uuid("experiment_id").notNull(),
    visitor: text("visitor").notNull(),
    variant: text("variant").notNull(),
    goal: text("goal").notNull(),
    /** What was clicked (the block's id), empty for a cart or a checkout. */
    ref: text("ref").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("experiment_events_once_key").on(t.experimentId, t.visitor, t.goal, t.ref),
    foreignKey({ name: "experiment_events_exposure_fk", columns: [t.experimentId, t.visitor], foreignColumns: [experimentExposures.experimentId, experimentExposures.visitor] }).onDelete("cascade"),
    index("experiment_events_store_idx").on(t.storeId, t.occurredAt),
    check("experiment_events_goal", sql`${t.goal} in ('cart', 'checkout', 'click', 'form')`),
    check("experiment_events_ref", sql`length(${t.ref}) <= 80`),
  ],
);

/**
 * The visitor of a cart (D148), so a paid order can be traced to the version its cart's visitor was shown. Not tied to
 * the cart row, like `recommendation_adds`; kept 90 days.
 */
export const experimentCarts = commerce.table(
  "experiment_carts",
  {
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    cartId: uuid("cart_id").notNull(),
    visitor: text("visitor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.cartId] }),
    index("experiment_carts_visitor_idx").on(t.storeId, t.visitor),
    index("experiment_carts_created_idx").on(t.createdAt),
    check("experiment_carts_visitor", sql`length(${t.visitor}) between 8 and 64`),
  ],
);

/**
 * A store's cost assumptions for the analytics (D152, `docs/analytics.md`): what its estimates of payment fees,
 * shipping and fixed costs use, all in the main currency. A store without a row has the defaults (everything zero, which
 * the pages say is "not entered", never a profit).
 */
export const analyticsSettings = commerce.table(
  "analytics_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Estimated payment fee per paid order, in basis points of its total: 290 is 2.9 %. */
    paymentFeeBps: integer("payment_fee_bps").notNull().default(0),
    /** Plus this fixed amount per paid order. */
    paymentFeeFixedMinor: bigint("payment_fee_fixed_minor", { mode: "number" }).notNull().default(0),
    /** What sending one order costs the store, per paid order with a physical line. */
    shippingCostMinor: bigint("shipping_cost_minor", { mode: "number" }).notNull().default(0),
    /** Rent, pay and other fixed costs for a month; taken pro rata by day. */
    fixedCostsMonthlyMinor: bigint("fixed_costs_monthly_minor", { mode: "number" }).notNull().default(0),
    /** Years a customer is expected to keep buying, for the predicted lifetime value. */
    ltvLifespanYears: integer("ltv_lifespan_years").notNull().default(3),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("analytics_settings_fee_bps", sql`${t.paymentFeeBps} between 0 and 10000`),
    check("analytics_settings_amounts", sql`${t.paymentFeeFixedMinor} >= 0 and ${t.shippingCostMinor} >= 0 and ${t.fixedCostsMonthlyMinor} >= 0`),
    check("analytics_settings_lifespan", sql`${t.ltvLifespanYears} between 1 and 10`),
  ],
);

/** A month's net revenue target (D152); `month` is its first day. */
export const analyticsTargets = commerce.table(
  "analytics_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    month: date("month", { mode: "string" }).notNull(),
    revenueTargetMinor: bigint("revenue_target_minor", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("analytics_targets_month_key").on(t.storeId, t.month),
    check("analytics_targets_first_of_month", sql`${t.month} = date_trunc('month', ${t.month}::timestamp)::date`),
    check("analytics_targets_amount", sql`${t.revenueTargetMinor} > 0`),
  ],
);

/**
 * Marketing spend the owner entered (D152): what was paid for a channel (and a campaign within it) on a day, in the
 * store's main currency. Entered by hand, so the pages say when none has been.
 */
export const marketingSpend = commerce.table(
  "marketing_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    channel: text("channel").notNull(),
    /** The campaign within the channel, empty for the channel as a whole. */
    campaign: text("campaign").notNull().default(""),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("marketing_spend_key").on(t.storeId, t.day, t.channel, t.campaign),
    check("marketing_spend_channel", sql`${t.channel} in (${channelList})`),
    check("marketing_spend_campaign", sql`length(${t.campaign}) <= 100`),
    check("marketing_spend_amount", sql`${t.amountMinor} > 0`),
    check("marketing_spend_note", sql`length(${t.note}) <= 500`),
  ],
);

/**
 * One visitor on one day (D152, `docs/analytics.md`): written only while the store's `visit_counting` is on. The visitor
 * is a keyed hash that changes every day, so nobody can be followed from one day to the next; no IP address and no user
 * agent is kept. Deleted after 25 months.
 */
export const visits = commerce.table(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    /** The day in the store's time zone. */
    day: date("day", { mode: "string" }).notNull(),
    /** 24 hex characters of the daily keyed hash. */
    visitor: text("visitor").notNull(),
    marketCode: char("market_code", { length: 2 }),
    device: text("device").notNull(),
    /** Decided once, on the visitor-day's first page view (`classifyChannel()`). */
    channel: text("channel").notNull(),
    source: text("source").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    landingPath: text("landing_path").notNull(),
    pageViews: integer("page_views").notNull().default(1),
    productViews: integer("product_views").notNull().default(0),
    /** When the visitor first reached checkout that day. */
    checkoutAt: timestamp("checkout_at", { withTimezone: true }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("visits_day_visitor_key").on(t.storeId, t.day, t.visitor),
    index("visits_store_day_idx").on(t.storeId, t.day),
    check("visits_visitor", sql`${t.visitor} ~ '^[0-9a-f]{24}$'`),
    check("visits_device", sql`${t.device} in ('mobile', 'tablet', 'desktop')`),
    check("visits_channel", sql`${t.channel} in (${channelList})`),
    check("visits_text_lengths", sql`length(${t.source}) <= 100 and length(${t.campaign}) <= 100 and length(${t.landingPath}) <= 300`),
    check("visits_counts", sql`${t.pageViews} >= 0 and ${t.productViews} >= 0`),
  ],
);

/** How often a product's page was viewed on a day (D152), while the store counts visits; no visitor in it. */
export const productViews = commerce.table(
  "product_views",
  {
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    productId: uuid("product_id").notNull(),
    views: integer("views").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.day, t.productId] }),
    productRef("product_views_product_fk", t),
    check("product_views_views", sql`${t.views} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Legal pages, terms at checkout and accessibility (wave 1, 1e: docs/wave-1-trust.md)
// ---------------------------------------------------------------------------

/**
 * The text of a store's terms, privacy statement and the like as a shopper was shown it when ordering: the localised
 * published page (title and rows as `PageContent`) with its role, locale and a hash of a canonical form of the two. One
 * row per `(store, role, locale, hash)`, so ten thousand orders under one unchanged page share a row and a changed page
 * makes a new one. Never changed or deleted (the rules migration). `page_id` has no foreign key: the page may be
 * deleted, the snapshot is the record. Never copied with a store.
 */
export const legalSnapshots = commerce.table(
  "legal_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    role: text("role").notNull(),
    locale: text("locale").notNull(),
    pageId: uuid("page_id"),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("legal_snapshots_store_id_key").on(t.storeId, t.id),
    unique("legal_snapshots_text_key").on(t.storeId, t.role, t.locale, t.contentHash),
    index("legal_snapshots_store_idx").on(t.storeId),
    check("legal_snapshots_role", sql`${t.role} in (${legalRoleList})`),
    check("legal_snapshots_hash", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * That a shopper pressed pay while a store's terms were shown (`link`) or ticked (`checkbox`), one row per order, with
 * which snapshots they were shown: `[{ role, snapshotId, hash, title }]`. A side table, not columns on `orders`, so the
 * money paths keep their own schema; read as `OrderView.terms`. Never changed or deleted; a copied order (`C-…`) never
 * has one; never copied with a store.
 */
export const orderTerms = commerce.table(
  "order_terms",
  {
    orderId: uuid("order_id").primaryKey(),
    storeId: storeId().references(() => stores.id),
    mode: text("mode").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    locale: text("locale").notNull(),
    snapshots: jsonb("snapshots").notNull(),
  },
  (t) => [
    orderRef("order_terms_order_fk", t),
    index("order_terms_store_idx").on(t.storeId, t.acceptedAt),
    check("order_terms_mode", sql`${t.mode} in ('link', 'checkbox')`),
    check("order_terms_snapshots", sql`jsonb_typeof(${t.snapshots}) = 'array' and jsonb_array_length(${t.snapshots}) between 1 and 2`),
  ],
);

/**
 * What the owner says about the store's accessibility, the input of the statement generator (EAA, `src/lib/a11y-statement.ts`).
 * `full` needs who assessed and on what date; the default is "has not been assessed". Never copied: an audit claim
 * belongs to the site it was made for.
 */
export const accessibilitySettings = commerce.table(
  "accessibility_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    status: text("status").notNull().default("not_assessed"),
    assessedBy: text("assessed_by"),
    assessedOn: date("assessed_on", { mode: "string" }),
    reportUrl: text("report_url"),
    assessmentNote: text("assessment_note"),
    /** The owner's tick that the business is a microenterprise (EAA Art. 4(5)). */
    microenterprise: boolean("microenterprise").notNull().default(false),
    knownIssues: text("known_issues").notNull().default(""),
    contactEmail: text("contact_email"),
    preparedOn: date("prepared_on", { mode: "string" }),
    reviewedOn: date("reviewed_on", { mode: "string" }),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("accessibility_settings_updated_by_idx").on(t.updatedBy),
    check("accessibility_settings_status", sql`${t.status} in ('not_assessed', 'partial', 'full')`),
    check(
      "accessibility_settings_full",
      sql`${t.status} <> 'full' or (nullif(btrim(${t.assessedBy}), '') is not null and ${t.assessedOn} is not null)`,
    ),
    check("accessibility_settings_known_issues", sql`length(${t.knownIssues}) <= 4000`),
    check("accessibility_settings_note", sql`${t.assessmentNote} is null or length(${t.assessmentNote}) <= 2000`),
  ],
);

// ---------------------------------------------------------------------------
// Staff security (wave 1, 1f)
// ---------------------------------------------------------------------------

/**
 * An account's recovery codes for the second step: ten to a set (`batch`), stored only as an HMAC of the normalised
 * code (never the code), single use (`used_at` is set once, by one `update … where used_at is null returning`), a new
 * set revokes the old (`revoked_at`). The rules migration lets an update only set those two columns once. Used and
 * revoked rows are pruned after 12 months by the daily job. An account's, not a store's: no `store_id`.
 */
export const accountRecoveryCodes = commerce.table(
  "account_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    batch: uuid("batch").notNull(),
    codeHash: text("code_hash").notNull(),
    createdAt: createdAt(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("account_recovery_codes_hash_key").on(t.accountId, t.codeHash),
    index("account_recovery_codes_account_idx").on(t.accountId),
    check("account_recovery_codes_hash", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
  ],
);


// ---------------------------------------------------------------------------
// GDPR export, erasure and retention (wave 1, 1g, D162, docs/wave-1g-gdpr.md)
// ---------------------------------------------------------------------------

/**
 * How long a kind of data is kept (D162): the platform's schedule, with where each period comes from and when it was checked.
 * A row is never edited in place: `commerce.set_retention_rule()` closes the old one and adds a new one (and refuses a
 * bookkeeping period under five years); a platform admin marks a row reviewed (`verified_at`). Read only through
 * `commerce.retention_rule(kind, country, at)` and the server's `retentionRule()`. A `country` of null is the default for every
 * country. The seed is `RETENTION_SEED` (`src/lib/retention.ts`). Platform data: no `store_id`, not copied with a store.
 */
export const retentionRules = commerce.table(
  "retention_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    country: char("country", { length: 2 }).references(() => countries.code),
    periodValue: integer("period_value").notNull(),
    periodUnit: text("period_unit").notNull(),
    countsFrom: text("counts_from").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    basis: text("basis").notNull(),
    checkedOn: date("checked_on").notNull(),
    validFrom: date("valid_from").notNull(),
    /** The first day the rule no longer applies; null while it is the current one. */
    validTo: date("valid_to"),
    /** The job step or pruner that applies it. */
    enforcedBy: text("enforced_by").notNull(),
    note: text("note").notNull().default(""),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => accounts.id),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("retention_rules_period_key").on(t.kind, sql`coalesce(${t.country}, '__')`, t.validFrom),
    uniqueIndex("retention_rules_current_key").on(t.kind, sql`coalesce(${t.country}, '__')`).where(sql`${t.validTo} is null`),
    index("retention_rules_country_idx").on(t.country),
    index("retention_rules_verified_by_idx").on(t.verifiedBy),
    index("retention_rules_created_by_idx").on(t.createdBy),
    check("retention_rules_kind", sql`${t.kind} in (${retentionKindList})`),
    check("retention_rules_value", sql`${t.periodValue} > 0`),
    check("retention_rules_unit", sql`${t.periodUnit} in (${sqlList(PERIOD_UNITS)})`),
    check("retention_rules_counts_from", sql`${t.countsFrom} in (${sqlList(COUNTS_FROM)})`),
    check(
      "retention_rules_year_end",
      sql`${t.countsFrom} = 'event' or (${t.periodUnit} = 'months' and ${t.periodValue} % 12 = 0)`,
    ),
    check("retention_rules_basis", sql`${t.basis} in (${sqlList(RETENTION_BASES)})`),
    check("retention_rules_period", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    check("retention_rules_source", sql`length(${t.source}) between 8 and 1000`),
    check("retention_rules_verified", sql`(${t.verifiedAt} is null) = (${t.verifiedBy} is null)`),
  ],
);

/**
 * A request to see or erase a person's data, with the one-month clock of GDPR Art. 12(3) (D162): staff log one that arrives by
 * email, post or phone (`channel = 'staff'`, `received_at` the day it arrived, because the clock runs from receipt); a shopper's
 * own download or delete is logged by the system as a request already done. `subject_customer_id` has no foreign key: the
 * erasure deletes the account. An erasure that is done keeps no email (`subject_email` null, a check); a finished request is
 * kept 24 months, then deleted by the retention job (the one deletion its trigger allows). `plan_summary` and `steps` hold
 * counts and step names only, never a value. Store-owned, never copied.
 */
export const privacyRequests = commerce.table(
  "privacy_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** `export` or `erasure`. */
    kind: text("kind").notNull(),
    /** `shopper` (their own self-service) or `staff` (logged by a member). */
    channel: text("channel").notNull(),
    status: text("status").notNull().default("open"),
    subjectCustomerId: uuid("subject_customer_id"),
    subjectEmail: text("subject_email"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Once, with a reason, before the due date, to at most received + 3 months (Art. 12(3)). */
    extendedUntil: timestamp("extended_until", { withTimezone: true }),
    extensionReason: text("extension_reason"),
    /** When staff recorded a doubt about who asked; the law's pause is for staff to apply, nothing is paused here. */
    identityDoubtAt: timestamp("identity_doubt_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outcome: text("outcome"),
    refusalReason: text("refusal_reason"),
    refusalNote: text("refusal_note"),
    note: text("note").notNull().default(""),
    /** Counts only (per register entry and action), written by the preview. */
    planSummary: jsonb("plan_summary"),
    /** Which steps of an erasure ran (names and times), so a failed run is resumed where it stopped. */
    steps: jsonb("steps").notNull().default(sql`'{}'::jsonb`),
    handledBy: uuid("handled_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("privacy_requests_status_idx").on(t.storeId, t.status, t.dueAt),
    index("privacy_requests_handled_by_idx").on(t.handledBy),
    uniqueIndex("privacy_requests_open_erasure_key")
      .on(t.storeId, t.subjectEmail)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'erasure'`),
    check("privacy_requests_kind", sql`${t.kind} in ('export', 'erasure')`),
    check("privacy_requests_channel", sql`${t.channel} in ('shopper', 'staff')`),
    check("privacy_requests_status", sql`${t.status} in ('open', 'done', 'refused', 'cancelled')`),
    check("privacy_requests_email", sql`${t.subjectEmail} is null or ${t.subjectEmail} = lower(${t.subjectEmail})`),
    check("privacy_requests_due", sql`${t.dueAt} >= ${t.receivedAt}`),
    check(
      "privacy_requests_extension",
      sql`${t.extendedUntil} is null or (${t.extendedUntil} > ${t.dueAt} and ${t.extendedUntil} <= ${t.receivedAt} + interval '3 months')`,
    ),
    check("privacy_requests_outcome", sql`${t.outcome} is null or ${t.outcome} in ('exported', 'erased', 'no_data', 'refused', 'cancelled')`),
    check(
      "privacy_requests_refusal_reason",
      sql`${t.refusalReason} is null or ${t.refusalReason} in ('identity_not_confirmed', 'manifestly_unfounded', 'excessive', 'legal_hold', 'other')`,
    ),
    check(
      "privacy_requests_state",
      sql`(${t.status} = 'open' and ${t.completedAt} is null and ${t.outcome} is null)
        or (${t.status} = 'done' and ${t.completedAt} is not null and coalesce(${t.outcome} in ('exported', 'erased', 'no_data'), false))
        or (${t.status} = 'refused' and ${t.completedAt} is not null and coalesce(${t.outcome} = 'refused', false) and ${t.refusalReason} is not null)
        or (${t.status} = 'cancelled' and ${t.completedAt} is not null and coalesce(${t.outcome} = 'cancelled', false))`,
    ),
    check("privacy_requests_erased_email", sql`not (${t.kind} = 'erasure' and ${t.status} = 'done') or ${t.subjectEmail} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Data in and out (wave 2, D165, docs/wave-2-data.md): one job table for imports and exports, and the bulk editor's record
// ---------------------------------------------------------------------------

/**
 * One import or export (`docs/wave-2-data.md` 3.1): a product import (a dry run, then an apply), a product, order or customer
 * export. A job is a row, claimed with an expiry (as `store_copies` are) and run in ticks by the open page, `after()` and the
 * five-minute cron, so it can stop and go on. Its files are in the private `imports` and `exports` buckets and are deleted by
 * application code (`pruneDataJobs()`, never SQL). `options` holds the member's choices and never a cell of a file or an email;
 * `counts` and `cursor` are numbers and keys. The status moves forward only (the database refuses a backwards move, with one
 * exception: a `checked` import may be checked again after its options changed) and the file an import was checked against
 * cannot be swapped before it is applied. One active product import per store (a unique index); the active export limit is
 * counted under a lock by `commerce.start_export_job()`.
 */
export const dataJobs = commerce.table(
  "data_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** `product_import`, `product_export`, `order_export`, `customer_export`, `redirect_import`, `redirect_export` (wave 2, D168), `inventory_import`, `inventory_export` (wave 3, D172). */
    kind: text("kind").notNull(),
    /** `uploaded`, `checking`, `checked`, `queued`, `running`, `done`, `failed`, `cancelled`, `expired` (`src/lib/data-job.ts`). */
    status: text("status").notNull(),
    /** `check` or `apply` for an import, `write` or `assemble` for an export. */
    phase: text("phase"),
    /** `kaizen` or `shopify` for an import, `kaizen` for an export. */
    format: text("format"),
    /** What the member chose: filters, dialect, profile, import options. Never a cell and never an email address. */
    options: jsonb("options").notNull().default({}),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => accounts.id),
    /** An import's file in the `imports` bucket, `{store}/{uuid}/{safe name}`; its size and SHA-256 (the apply checks it is the same file). */
    inputPath: text("input_path"),
    inputName: text("input_name"),
    inputBytes: integer("input_bytes"),
    inputSha256: text("input_sha256"),
    rowsTotal: integer("rows_total"),
    rowsDone: integer("rows_done"),
    /** `created`, `updated`, `unchanged`, `skipped`, `drafted`, `failed`, `warnings`, `pricesChanged`, `picturesFetched`, `termsCreated`. */
    counts: jsonb("counts").notNull().default({}),
    /** Where to go on: the product index of an import, the export's key and part number. */
    cursor: jsonb("cursor").notNull().default({}),
    /** An export's parts, `[{ path, name, rows, bytes, sha256 }]`, in the `exports` bucket. */
    files: jsonb("files").notNull().default([]),
    /** The plain reason a job failed. */
    problem: text("problem"),
    attempts: integer("attempts").notNull().default(0),
    /** One run at a time: a run holds the job until this time. */
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** When the job's files are deleted: an export's 7 days after it is done, an import's file 30 days after it ends. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** When the files were removed. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [
    unique("data_jobs_store_id_key").on(t.storeId, t.id),
    index("data_jobs_store_kind_idx").on(t.storeId, t.kind, t.createdAt.desc()),
    index("data_jobs_requested_by_idx").on(t.requestedBy),
    index("data_jobs_open_idx").on(t.status, t.claimedUntil),
    index("data_jobs_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.purgedAt} is null and ${t.expiresAt} is not null`),
    uniqueIndex("data_jobs_one_active_import_idx")
      .on(t.storeId)
      .where(sql`${t.kind} = 'product_import' and ${t.status} in ('uploaded', 'checking', 'checked', 'queued', 'running')`),
    // One redirect import is open per store at a time (wave 2, D168), beside the product import.
    uniqueIndex("data_jobs_one_active_redirect_import_idx")
      .on(t.storeId)
      .where(sql`${t.kind} = 'redirect_import' and ${t.status} in ('uploaded', 'checking', 'checked', 'queued', 'running')`),
    // One stock import is open per store at a time (wave 3, D172), beside the product and redirect imports.
    uniqueIndex("data_jobs_one_active_inventory_import_idx")
      .on(t.storeId)
      .where(sql`${t.kind} = 'inventory_import' and ${t.status} in ('uploaded', 'checking', 'checked', 'queued', 'running')`),
    check(
      "data_jobs_kind",
      sql`${t.kind} in ('product_import', 'product_export', 'order_export', 'customer_export', 'redirect_import', 'redirect_export', 'inventory_import', 'inventory_export')`,
    ),
    check(
      "data_jobs_status",
      sql`${t.status} in ('uploaded', 'checking', 'checked', 'queued', 'running', 'done', 'failed', 'cancelled', 'expired')`,
    ),
    check("data_jobs_phase", sql`${t.phase} is null or ${t.phase} in ('check', 'apply', 'write', 'assemble')`),
    check("data_jobs_format", sql`${t.format} is null or ${t.format} in ('kaizen', 'shopify')`),
    check("data_jobs_rows", sql`${t.rowsTotal} is null or ${t.rowsTotal} >= 0`),
    check(
      "data_jobs_rows_done",
      sql`${t.rowsDone} is null or (${t.rowsDone} >= 0 and (${t.rowsTotal} is null or ${t.rowsDone} <= ${t.rowsTotal}))`,
    ),
    check("data_jobs_input_bytes", sql`${t.inputBytes} is null or ${t.inputBytes} between 0 and 15728640`),
    check("data_jobs_input_sha256", sql`${t.inputSha256} is null or ${t.inputSha256} ~ '^[0-9a-f]{64}$'`),
    check("data_jobs_attempts", sql`${t.attempts} >= 0`),
    check(
      "data_jobs_json",
      sql`jsonb_typeof(${t.options}) = 'object' and jsonb_typeof(${t.counts}) = 'object' and jsonb_typeof(${t.cursor}) = 'object' and jsonb_typeof(${t.files}) = 'array'`,
    ),
    // An export has no input file, an import has no output files, and the format of an export is Kaizen's own.
    check(
      "data_jobs_export_no_input",
      sql`${t.kind} in ('product_import', 'redirect_import', 'inventory_import') or (${t.inputPath} is null and ${t.inputSha256} is null and ${t.format} is distinct from 'shopify')`,
    ),
    check("data_jobs_import_no_files", sql`${t.kind} not in ('product_import', 'redirect_import', 'inventory_import') or ${t.files} = '[]'::jsonb`),
    // An ended job says when.
    check(
      "data_jobs_finished",
      sql`${t.status} not in ('done', 'failed', 'cancelled', 'expired') or ${t.finishedAt} is not null`,
    ),
    check("data_jobs_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
  ],
);

/**
 * One product of an import, or one finding about the file (`docs/wave-2-data.md` 3.2). Written with `on conflict (job_id, seq) do
 * update`, so a resumed job writes each once. A sentence may name a handle, a SKU or a column and never quotes a cell. Kept 90 days
 * after the job ends.
 */
export const dataJobItems = commerce.table(
  "data_job_items",
  {
    storeId: storeId(),
    jobId: uuid("job_id").notNull(),
    seq: integer("seq").notNull(),
    /** `product` (one product of the file), `redirect` (one line of a redirect file, wave 2, D168), `stock` (one row of a stock file, wave 3, D172) or `file` (a finding about the file as a whole). */
    kind: text("kind").notNull(),
    /** The handle, or null. */
    ref: text("ref"),
    /** The file's row numbers (a spreadsheet's: the header is row 1). */
    rows: integer("rows").array().notNull().default(sql`'{}'::integer[]`),
    /** `created`, `updated`, `unchanged`, `skipped`, `drafted`, `failed` or `checked` (the dry run's). */
    outcome: text("outcome").notNull(),
    /** `[{ severity, code, column, text }]`. */
    messages: jsonb("messages").notNull().default([]),
    /** A short summary: `{ prices: n, fields: [names], stock: bool }`. */
    changes: jsonb("changes").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.seq] }),
    foreignKey({
      name: "data_job_items_job_fk",
      columns: [t.storeId, t.jobId],
      foreignColumns: [dataJobs.storeId, dataJobs.id],
    }).onDelete("cascade"),
    index("data_job_items_job_idx").on(t.storeId, t.jobId, t.outcome),
    check("data_job_items_seq", sql`${t.seq} >= 0`),
    check("data_job_items_kind", sql`${t.kind} in ('product', 'redirect', 'stock', 'file')`),
    check("data_job_items_outcome", sql`${t.outcome} in ('created', 'updated', 'unchanged', 'skipped', 'drafted', 'failed', 'checked')`),
    check("data_job_items_json", sql`jsonb_typeof(${t.messages}) = 'array' and jsonb_typeof(${t.changes}) = 'object'`),
  ],
);

/**
 * A picture an import fetched, by its address (`docs/wave-2-data.md` 3.3): what lets a resumed job fetch nothing twice.
 * `library_url` is null for a picture that could not be fetched, with the `reason`. Deleted with the job's items.
 */
export const dataJobAssets = commerce.table(
  "data_job_assets",
  {
    storeId: storeId(),
    jobId: uuid("job_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    libraryUrl: text("library_url"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.sourceUrl] }),
    foreignKey({
      name: "data_job_assets_job_fk",
      columns: [t.storeId, t.jobId],
      foreignColumns: [dataJobs.storeId, dataJobs.id],
    }).onDelete("cascade"),
    index("data_job_assets_job_idx").on(t.storeId, t.jobId),
    check("data_job_assets_result", sql`${t.libraryUrl} is not null or ${t.reason} is not null`),
  ],
);

/**
 * One bulk edit of the products list (`docs/wave-2-data.md` 3.4): what was done, kept so it can be undone for seven days. An undo is
 * a batch of its own (`action = 'undo'`, `undo_of` the batch it undoes). Append-only: a trigger refuses every change but `undone_at`,
 * set once. `params` holds figures, markets and term ids, no free text.
 */
export const bulkEditBatches = commerce.table(
  "bulk_edit_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => accounts.id),
    /** `status`, `archive`, `unarchive`, `terms_add`, `terms_remove`, `price`, `stock`, `grid` or `undo`. */
    action: text("action").notNull(),
    params: jsonb("params").notNull().default({}),
    /** The batch this one undoes, for an `undo`. */
    undoOf: uuid("undo_of"),
    /** `{ products, changed, unchanged, failed }`. */
    counts: jsonb("counts").notNull().default({}),
    createdAt: createdAt(),
    /** Set once, when an undo of this batch was made. */
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    unique("bulk_edit_batches_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "bulk_edit_batches_undo_of_fk",
      columns: [t.storeId, t.undoOf],
      foreignColumns: [t.storeId, t.id],
    }),
    index("bulk_edit_batches_store_idx").on(t.storeId, t.createdAt.desc()),
    index("bulk_edit_batches_requested_by_idx").on(t.requestedBy),
    // A batch is undone once: its undo is the one batch that names it.
    uniqueIndex("bulk_edit_batches_one_undo_idx")
      .on(t.storeId, t.undoOf)
      .where(sql`${t.undoOf} is not null`),
    check(
      "bulk_edit_batches_action",
      sql`${t.action} in ('status', 'archive', 'unarchive', 'terms_add', 'terms_remove', 'price', 'stock', 'grid', 'undo')`,
    ),
    check("bulk_edit_batches_undo", sql`(${t.action} = 'undo') = (${t.undoOf} is not null)`),
    check("bulk_edit_batches_json", sql`jsonb_typeof(${t.params}) = 'object' and jsonb_typeof(${t.counts}) = 'object'`),
  ],
);

/**
 * One changed cell of a bulk edit, with its value before and after (`docs/wave-2-data.md` 3.4): figures and codes, never personal
 * data. `product_id` and `variant_id` are recorded as they were, with no foreign key: a product that is gone cannot be undone and
 * the undo says so. An undone item's outcome becomes `undone`, the one change the append-only trigger allows.
 */
export const bulkEditItems = commerce.table(
  "bulk_edit_items",
  {
    storeId: storeId(),
    batchId: uuid("batch_id").notNull(),
    seq: integer("seq").notNull(),
    productId: uuid("product_id").notNull(),
    /** Null for a field of the product itself (status, terms). */
    variantId: uuid("variant_id"),
    /** `status`, `archived`, `terms`, `price:{COUNTRY}`, `stock`, `cost` or `sku`. */
    field: text("field").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    /** `changed`, `unchanged`, `failed`, or `undone` once an undo has put it back. */
    outcome: text("outcome").notNull(),
    /** A failure's sentence (the editor's own). */
    reason: text("reason"),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.seq] }),
    foreignKey({
      name: "bulk_edit_items_batch_fk",
      columns: [t.storeId, t.batchId],
      foreignColumns: [bulkEditBatches.storeId, bulkEditBatches.id],
    }).onDelete("cascade"),
    index("bulk_edit_items_batch_idx").on(t.storeId, t.batchId),
    index("bulk_edit_items_product_idx").on(t.storeId, t.productId),
    check("bulk_edit_items_seq", sql`${t.seq} >= 0`),
    check("bulk_edit_items_outcome", sql`${t.outcome} in ('changed', 'unchanged', 'failed', 'undone')`),
    check(
      "bulk_edit_items_field",
      sql`${t.field} in ('status', 'archived', 'terms', 'stock', 'cost', 'sku') or ${t.field} ~ '^price:[A-Z]{2}$'`,
    ),
    check("bulk_edit_items_failed_reason", sql`${t.outcome} <> 'failed' or length(trim(coalesce(${t.reason}, ''))) > 0`),
    check("bulk_edit_items_reason", sql`${t.reason} is null or length(${t.reason}) <= 500`),
  ],
);

// ---------------------------------------------------------------------------
// Redirects and the 404 report (wave 2, second run, D168, docs/wave-2-redirects.md): addresses that moved, and the ones nobody had
// ---------------------------------------------------------------------------

/**
 * A redirect (`docs/wave-2-redirects.md` 3.1): an address of the store's that sends the shopper somewhere else, permanently (308). `source` and
 * `target` are market-relative (`/p/old-cup`, not `/no/p/old-cup`), so one redirect serves every country and language; `source` is in the normal form
 * of `src/lib/redirect-path.ts`. A redirect is looked up only where a request would be a 404, never for a live address.
 *
 * Four kinds. A **manual** one (`target` set) is made by staff, an import or the assistant and written only by `src/server/redirects.ts`; the three
 * **automatic** ones (`product`, `category`, `tag`) are made by database triggers when a product's handle or a category's or tag's slug changes, point
 * at the THING (`product_id` or `term_id`), not at an address, so they never chain, and are immutable except `hits` and `last_hit_at` (staff may delete
 * one). A thing taking an address deletes the automatic redirect from it. Pages and articles keep `page_redirects` (D42, D57). The database refuses a
 * manual redirect that closes a loop (`commerce.redirects_no_loop()`). `hits` is a lower bound (a request answered from a cache is not seen).
 */
export const redirects = commerce.table(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** `manual`, `product`, `category` or `tag`. */
    kind: text("kind").notNull(),
    /** The address that redirects: market-relative, lower case, a leading `/`, no trailing `/`, no query or fragment, at most 500 characters. */
    source: text("source").notNull(),
    /** Manual only: where to go, market-relative (a path with an optional `?query` and `#fragment`, at most 2,000 characters); `/` is the front page. */
    target: text("target"),
    /** Product only: the product whose handle it was. */
    productId: uuid("product_id"),
    /** Category and tag only: the term whose address it was. */
    termId: uuid("term_id").references(() => terms.id, { onDelete: "cascade" }),
    /** `editor`, `import`, `report` (made from the 404 report), `assistant`, or `system` (made by a database trigger). */
    origin: text("origin").notNull(),
    /** Requests that were redirected, a lower bound. */
    hits: bigint("hits", { mode: "number" }).notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    /** Null for a system row. */
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("redirects_store_id_key").on(t.storeId, t.id),
    unique("redirects_store_source_key").on(t.storeId, t.source),
    foreignKey({
      name: "redirects_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete("cascade"),
    index("redirects_store_kind_idx").on(t.storeId, t.kind),
    // The composite foreign key (store, product) is indexed by its own columns, as the neighbours' are.
    index("redirects_product_idx").on(t.storeId, t.productId),
    index("redirects_term_idx").on(t.termId),
    index("redirects_created_by_idx").on(t.createdBy),
    check("redirects_kind", sql`${t.kind} in ('manual', 'product', 'category', 'tag')`),
    check("redirects_origin", sql`${t.origin} in ('editor', 'import', 'report', 'assistant', 'system')`),
    check(
      "redirects_kind_columns",
      sql`(${t.kind} = 'manual' and ${t.target} is not null and ${t.productId} is null and ${t.termId} is null)
        or (${t.kind} = 'product' and ${t.target} is null and ${t.productId} is not null and ${t.termId} is null)
        or (${t.kind} in ('category', 'tag') and ${t.target} is null and ${t.productId} is null and ${t.termId} is not null)`,
    ),
    // An automatic redirect is the triggers' (`system`); a manual one is a person's or an import's.
    check("redirects_origin_kind", sql`(${t.kind} = 'manual') = (${t.origin} <> 'system')`),
    // The normal form of 4.1: a leading slash, no query, no fragment, no space or control character, no backslash, no `//`, no trailing slash, no capital.
    check(
      "redirects_source_shape",
      sql`${t.source} ~ '^/[^[:space:][:cntrl:]?#]+$' and strpos(${t.source}, chr(92)) = 0 and ${t.source} !~ '//' and ${t.source} !~ '/$' and ${t.source} !~ '[A-Z]' and length(${t.source}) <= 500`,
    ),
    check(
      "redirects_target_shape",
      sql`${t.target} is null or (${t.target} ~ '^/[^[:space:][:cntrl:]]*$' and strpos(${t.target}, chr(92)) = 0 and ${t.target} !~ '^//' and length(${t.target}) <= 2000)`,
    ),
    check("redirects_hits", sql`${t.hits} >= 0`),
  ],
);

/**
 * What the 404 report counts (`docs/wave-2-redirects.md` 3.2, 4.6): a market-less address that was asked for and the store did not have, per
 * UTC day, with the requests and how many were robots (a flag taken from the request, never a user agent text). No IP address, cookie, referrer,
 * query string or header is kept, and addresses that could hold a person's data are never recorded (`recordablePath()`). A null `path` is the one
 * row of a day that counts what was not recorded because the day's cap was reached. Written only by `commerce.record_not_found()`; rows are
 * deleted 90 days after their day by `pruneNotFound()` (application code). Counts are lower bounds.
 */
export const notFoundHits = commerce.table(
  "not_found_hits",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** The UTC day of the request. */
    day: date("day", { mode: "string" }).notNull(),
    path: text("path"),
    hits: integer("hits").notNull().default(0),
    crawlerHits: integer("crawler_hits").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("not_found_hits_key").on(t.storeId, t.day, t.path).nullsNotDistinct(),
    // The key's own index serves the report (store, day); this one serves the daily prune across stores.
    index("not_found_hits_day_idx").on(t.day),
    check("not_found_hits_counts", sql`${t.hits} >= 0 and ${t.crawlerHits} between 0 and ${t.hits}`),
    check("not_found_hits_path", sql`${t.path} is null or (length(${t.path}) <= 200 and ${t.path} ~ '^/')`),
  ],
);

/** An address staff hid from the 404 report (`docs/wave-2-redirects.md` 3.2), at most 1,000 a store (checked by the service under the store's lock). */
export const notFoundIgnored = commerce.table(
  "not_found_ignored",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.path] }),
    index("not_found_ignored_created_by_idx").on(t.createdBy),
    check("not_found_ignored_path", sql`length(${t.path}) <= 200 and ${t.path} ~ '^/'`),
  ],
);

// ---------------------------------------------------------------------------
// Orders: tags, saved views, settings, draft orders (wave 3, run 2, D173, docs/wave-3-orders.md 3.2)
// ---------------------------------------------------------------------------

/**
 * A staff tag on an order (D173): one row per tag. `key` is the tag trimmed and case-folded (two tags with the same key are one tag on an
 * order), `label` the first spelling written on that order. At most 250 per order (the trigger `order_tags_limit()` holds it under a lock),
 * 40 characters, no comma or control character. Copied orders (D129) may have tags: the copied-order guards are not installed here. Written only
 * by `src/server/order-tags.ts`; the daily clean-up deletes the tags of an anonymised order.
 */
export const orderTags = commerce.table(
  "order_tags",
  {
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.key] }),
    orderRef("order_tags_order_fk", t).onDelete("restrict"),
    index("order_tags_key_idx").on(t.storeId, t.key, t.orderId),
    index("order_tags_order_idx").on(t.storeId, t.orderId),
    index("order_tags_created_by_idx").on(t.createdBy),
    check("order_tags_key", sql`char_length(${t.key}) between 1 and ${lit(TAG_MAX_LENGTH)} and ${t.key} = btrim(${t.key})`),
    check("order_tags_label", sql`char_length(${t.label}) between 1 and ${lit(TAG_MAX_LENGTH)} and ${t.label} = btrim(${t.label})`),
    /** No comma, no control character, none of the bidirectional controls (`src/lib/order-tags.ts`). */
    check("order_tags_label_chars", sql`${t.label} !~ '[,\\x01-\\x1f\\x7f\\u202a-\\u202e\\u2066-\\u2069]'`),
  ],
);

/**
 * A saved view of the order list (D173): a name, the parameters of the address (`parseOrderListParams()` validates them on the way in and out)
 * and the columns. The store's, shared by everyone who can read orders; at most 30 a store (a trigger). The column is `title`, not `name`, so the
 * privacy detector does not read it as a person's name; a saved search text is in `params.q`.
 */
export const orderViews = commerce.table(
  "order_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    params: jsonb("params").notNull().default({}),
    columns: text("columns").array(),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("order_views_store_id_key").on(t.storeId, t.id),
    uniqueIndex("order_views_title_key").on(t.storeId, sql`lower(${t.title})`),
    index("order_views_position_idx").on(t.storeId, t.position),
    index("order_views_created_by_idx").on(t.createdBy),
    check("order_views_title", sql`char_length(${t.title}) between 1 and ${lit(VIEW_TITLE_MAX)} and ${t.title} = btrim(${t.title})`),
    check("order_views_params", sql`jsonb_typeof(${t.params}) = 'object' and octet_length(${t.params}::text) < 4096`),
    check("order_views_columns", sql`${t.columns} is null or cardinality(${t.columns}) <= 12`),
    check("order_views_position", sql`${t.position} >= 0`),
  ],
);

/**
 * The store's order settings (D173), one row a store made lazily with the defaults when first read: gift messages (off), automatic archiving
 * (off), how long a draft's pay link is valid, whether staff other than the owner may record a payment taken outside Kaizen, and the draft
 * counter (`commerce.next_draft_number()` is its only writer). A copy starts with the defaults (`never` in `COPY_RULES`).
 */
export const orderSettings = commerce.table(
  "order_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    giftMessages: boolean("gift_messages").notNull().default(false),
    /** Null: no automatic archiving. */
    autoArchiveDays: integer("auto_archive_days"),
    draftValidDays: integer("draft_valid_days").notNull().default(7),
    staffMarkPaid: boolean("staff_mark_paid").notNull().default(false),
    /** The next draft's number (`D-{n}`); a counter that promises no gaps, never an order number (D141). */
    nextDraftNumber: bigint("next_draft_number", { mode: "number" }).notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "order_settings_auto_archive",
      sql`${t.autoArchiveDays} is null or ${t.autoArchiveDays} between ${lit(AUTO_ARCHIVE_MIN_DAYS)} and ${lit(AUTO_ARCHIVE_MAX_DAYS)}`,
    ),
    check("order_settings_draft_valid", sql`${t.draftValidDays} between ${lit(DRAFT_VALID_DAYS_MIN)} and ${lit(DRAFT_VALID_DAYS_MAX)}`),
    check("order_settings_next_draft", sql`${t.nextDraftNumber} >= 1`),
  ],
);

/**
 * A draft order (D173): a staff-made, editable quote that becomes a real order when sent (`docs/wave-3-orders.md` 4.5). While `open` it holds
 * no stock and no number; *Send* makes the order (`orders.source = 'draft'`, `orders.draft_id` this id, numbered from D141's sequence) and the
 * draft `sent`; paying marks it `paid` (`orders_draft_follow()`), an unpaid expiry `expired`, and *Reopen* returns it to `open`. The lifecycle,
 * the freezing of everything but notes once it is not open, and the rule that a sent draft names its order are `draft_orders_rules()`.
 * Holds a buyer's contact data typed by staff: deleted after 90 days untouched (open) or 30 days after it ended, and with the person by an erasure.
 * Only the pay token's SHA-256 is kept. Written only by `src/server/draft-orders.ts`, `draft-pay.ts` and the triggers.
 */
export const draftOrders = commerce.table(
  "draft_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** `D-{n}`, unique per store. */
    number: text("number").notNull(),
    status: text("status").notNull().default("open"),
    /** Raised by every save: a second save of an old version is refused (two staff at once). */
    version: integer("version").notNull().default(1),
    marketCode: char("market_code", { length: 2 }).notNull(),
    /** The market's address as shown (`no`, `no-en-eur`, D109), and the currency and locale that view shows: the draft is priced in them. */
    marketSlug: text("market_slug").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    customerId: uuid("customer_id"),
    email: text("email"),
    phone: text("phone"),
    shippingAddress: jsonb("shipping_address").notNull().default({}),
    billingAddress: jsonb("billing_address").notNull().default({}),
    companyName: text("company_name"),
    organisationNumber: text("organisation_number"),
    /** Shown to the buyer on the pay page and in the email; cleaned like any shopper-bound text. */
    noteToBuyer: text("note_to_buyer"),
    /** Never shown to the buyer. */
    internalNote: text("internal_note"),
    /** The tags (labels) carried to the order when the draft is sent. */
    tags: jsonb("tags").notNull().default([]),
    /** `percent` (basis points, 1 to 10,000) or `amount` (minor units, in the draft's currency); with a label the buyer sees. */
    discountKind: text("discount_kind"),
    discountValue: bigint("discount_value", { mode: "number" }),
    discountLabel: text("discount_label"),
    /** `rate` (the market's flat rate), `free` or `custom` (`shipping_minor`, VAT included). */
    shippingKind: text("shipping_kind").notNull().default("rate"),
    shippingMinor: bigint("shipping_minor", { mode: "number" }),
    /** The validity chosen on the send dialog; null until sent (the store's `draft_valid_days` is the default). */
    validDays: integer("valid_days"),
    /** The order the send made (a reopen clears it; the order keeps `draft_id`). */
    orderId: uuid("order_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** SHA-256 (hex) of the 32-byte pay token; the token is shown once and never stored. A new token replaces the old. */
    payTokenHash: text("pay_token_hash"),
    /** How many times the link was sent today (`pay_sent_on`, the store's day): the abuse brake of `DRAFT_SENDS_PER_DAY`. */
    paySendsToday: integer("pay_sends_today").notNull().default(0),
    paySentOn: date("pay_sent_on", { mode: "string" }),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** The inactivity clock of an open draft: the last edit by a person. */
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("draft_orders_store_id_key").on(t.storeId, t.id),
    unique("draft_orders_store_number_key").on(t.storeId, t.number),
    marketCountryRef("draft_orders_market_fk", t),
    customerRef("draft_orders_customer_fk", t),
    orderRef("draft_orders_order_fk", t),
    index("draft_orders_store_idx").on(t.storeId, t.status, t.updatedAt.desc()),
    index("draft_orders_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'sent'`),
    uniqueIndex("draft_orders_token_idx")
      .on(t.payTokenHash)
      .where(sql`${t.payTokenHash} is not null`),
    index("draft_orders_market_idx").on(t.storeId, t.marketCode),
    index("draft_orders_customer_idx").on(t.storeId, t.customerId),
    index("draft_orders_order_idx").on(t.storeId, t.orderId),
    index("draft_orders_created_by_idx").on(t.createdBy),
    check("draft_orders_status", sql`${t.status} in (${sqlList(DRAFT_STATUSES)})`),
    check("draft_orders_number", sql`${t.number} ~ '^D-[0-9]+$'`),
    check("draft_orders_version", sql`${t.version} >= 1`),
    check("draft_orders_email", sql`${t.email} is null or char_length(${t.email}) <= 254`),
    check("draft_orders_notes", sql`char_length(${t.noteToBuyer}) <= ${lit(DRAFT_NOTE_TO_BUYER_MAX)} and char_length(${t.internalNote}) <= ${lit(DRAFT_INTERNAL_NOTE_MAX)}`),
    check("draft_orders_tags", sql`jsonb_typeof(${t.tags}) = 'array' and jsonb_array_length(${t.tags}) <= 250`),
    check("draft_orders_addresses", sql`jsonb_typeof(${t.shippingAddress}) = 'object' and jsonb_typeof(${t.billingAddress}) = 'object'`),
    check(
      "draft_orders_discount",
      sql`(${t.discountKind} is null) = (${t.discountValue} is null) and (${t.discountKind} is null) = (${t.discountLabel} is null)
        and (${t.discountKind} is null or ${t.discountKind} in ('percent', 'amount'))
        and (${t.discountKind} is distinct from 'percent' or ${t.discountValue} between ${lit(DISCOUNT_BPS_MIN)} and ${lit(DISCOUNT_BPS_MAX)})
        and (${t.discountKind} is distinct from 'amount' or ${t.discountValue} > 0)
        and (${t.discountLabel} is null or char_length(${t.discountLabel}) between 1 and ${lit(DRAFT_DISCOUNT_LABEL_MAX)})`,
    ),
    check(
      "draft_orders_shipping",
      sql`${t.shippingKind} in ('rate', 'free', 'custom') and (${t.shippingKind} = 'custom') = (${t.shippingMinor} is not null) and (${t.shippingMinor} is null or ${t.shippingMinor} >= 0)`,
    ),
    check("draft_orders_valid_days", sql`${t.validDays} is null or ${t.validDays} between ${lit(DRAFT_VALID_DAYS_MIN)} and ${lit(DRAFT_VALID_DAYS_MAX)}`),
    check("draft_orders_pay_sends", sql`${t.paySendsToday} >= 0`),
    /**
     * Where the order, the times and the paid moment may be set by status: an open draft has none (a reopen clears them); a sent one names its
     * order and the times; a paid one also when; an expired or cancelled one is a sent one that ended unpaid. The pay token may stay on a
     * finished draft (the page then says what became of it) but never on an open one.
     */
    check(
      "draft_orders_lifecycle",
      sql`(${t.status} = 'open' and ${t.orderId} is null and ${t.sentAt} is null and ${t.expiresAt} is null and ${t.paidAt} is null and ${t.payTokenHash} is null)
        or (${t.status} in ('sent', 'expired', 'cancelled') and ${t.orderId} is not null and ${t.sentAt} is not null and ${t.expiresAt} is not null and ${t.expiresAt} > ${t.sentAt} and ${t.paidAt} is null)
        or (${t.status} = 'paid' and ${t.orderId} is not null and ${t.sentAt} is not null and ${t.expiresAt} is not null and ${t.paidAt} is not null)`,
    ),
  ],
);

/**
 * A line of a draft order (D173): a variant of goods at a price (the list price as shown, or a custom price staff typed, VAT included, in the
 * draft's currency), or a custom item (a service with no stock, a VAT category). At most 100 a draft (a trigger). Locked with the draft once it
 * is not open. Draft prices are the draft's own: no campaign, code or credit applies (`priceDraft()`).
 */
export const draftOrderLines = commerce.table(
  "draft_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    draftId: uuid("draft_id").notNull(),
    position: integer("position").notNull().default(0),
    variantId: uuid("variant_id"),
    title: text("title").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    /** A catalogue line's list price as shown when it was added (information only); null for a custom item. */
    listPriceMinor: bigint("list_price_minor", { mode: "number" }),
    /** A custom item's VAT category (`vat_categories`); null for a catalogue line. */
    vatCategory: text("vat_category").references(() => vatCategories.code),
    /** `physical` for a variant of goods, `service` for a custom item. */
    delivery: text("delivery").notNull().default("physical"),
  },
  (t) => [
    foreignKey({
      name: "draft_order_lines_draft_fk",
      columns: [t.storeId, t.draftId],
      foreignColumns: [draftOrders.storeId, draftOrders.id],
    }).onDelete("cascade"),
    variantRef("draft_order_lines_variant_fk", t),
    index("draft_order_lines_draft_idx").on(t.storeId, t.draftId, t.position),
    index("draft_order_lines_variant_idx").on(t.storeId, t.variantId),
    index("draft_order_lines_vat_category_idx").on(t.vatCategory),
    check("draft_order_lines_position", sql`${t.position} >= 0`),
    check("draft_order_lines_title", sql`char_length(${t.title}) between 1 and ${lit(DRAFT_LINE_TITLE_COLUMN_MAX)}`),
    check("draft_order_lines_quantity", sql`${t.quantity} between 1 and ${lit(DRAFT_QUANTITY_MAX)}`),
    check("draft_order_lines_prices", sql`${t.unitPriceMinor} >= 0 and (${t.listPriceMinor} is null or ${t.listPriceMinor} >= 0)`),
    check("draft_order_lines_delivery", sql`${t.delivery} in ('physical', 'service')`),
    /** A custom item has no variant, a category, is a service and has no list price; a catalogue line has a variant, a list price and no category. */
    check(
      "draft_order_lines_kind",
      sql`(${t.variantId} is null and ${t.vatCategory} is not null and ${t.delivery} = 'service' and ${t.listPriceMinor} is null)
        or (${t.variantId} is not null and ${t.vatCategory} is null and ${t.delivery} = 'physical' and ${t.listPriceMinor} is not null)`,
    ),
  ],
);

/** The most lines a draft holds (`src/lib/order-limits.ts`); the trigger `draft_order_lines_limit()` says the same number. */
export const DRAFT_LINES_LIMIT = DRAFT_LINES_MAX;

// ---------------------------------------------------------------------------
// Fulfilment: parcels with their lines, order changes after purchase (wave 3, run 3, D174, docs/wave-3-fulfilment.md 3.2)
// ---------------------------------------------------------------------------

/**
 * Which units went in which parcel (D174): one row per order line in a shipment, with how many of its units. Written only by `markSent()` with its shipment,
 * append-only (a trigger refuses an update or a delete). The database holds that a line belongs to a physical line of the shipment's own order and that the
 * units of a line in all its parcels never exceed its quantity (`shipment_lines_rules()`, under the order line's lock). A shipment from before this run is
 * `legacy` and counts as everything sent; the rules migration back-filled its lines. Holds no personal data.
 */
export const shipmentLines = commerce.table(
  "shipment_lines",
  {
    storeId: storeId(),
    shipmentId: uuid("shipment_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.shipmentId, t.orderLineId] }),
    foreignKey({
      name: "shipment_lines_shipment_fk",
      columns: [t.storeId, t.shipmentId],
      foreignColumns: [shipments.storeId, shipments.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_lines_order_line_fk",
      columns: [t.storeId, t.orderLineId],
      foreignColumns: [orderLines.storeId, orderLines.id],
    }).onDelete("restrict"),
    index("shipment_lines_order_line_idx").on(t.storeId, t.orderLineId),
    index("shipment_lines_shipment_idx").on(t.storeId, t.shipmentId),
    check("shipment_lines_quantity", sql`${t.quantity} > 0`),
  ],
);

/**
 * A change staff made to a paid order's goods and shipping after purchase (D174, `docs/wave-3-fulfilment.md` 4.3 to 4.6), numbered per order (`E{seq}`).
 * A change with a lower or equal total is written `applied` with the order's new lines and totals in one transaction (`applyOrderEdit()`, the only writer of
 * the edit context); one with a higher total is `awaiting_payment` with the added units held and a pay link (only the token's SHA-256, base64url, is kept)
 * until it is paid (`applied`), cancelled or expired. The lifecycle, the per-order number and its limit, and that an applied change is final are
 * `order_edits_rules()`; the money it moved is held at commit by `order_edits_settled()`. Never deleted; holds no personal data (staff's note is only in the
 * history event's `data.note`).
 */
export const orderEdits = commerce.table(
  "order_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    /** 1, 2, … per order, given by the trigger under the order's lock. */
    seq: integer("seq").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    notify: boolean("notify").notNull(),
    restock: boolean("restock").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** The order as it was previewed (its money columns and every line's id and quantity), compared under the lock before the change is applied. */
    base: jsonb("base").notNull(),
    /** The order's figures before and after, in its currency; `difference_minor = total_after - total_before`. */
    totalBefore: money("total_before"),
    totalAfter: money("total_after"),
    subtotalDelta: money("subtotal_delta"),
    shippingBefore: money("shipping_before"),
    shippingAfter: money("shipping_after"),
    discountDelta: money("discount_delta"),
    taxDelta: money("tax_delta"),
    differenceMinor: money("difference_minor"),
    /** The payment of the difference (a higher total), once captured. */
    paymentId: uuid("payment_id"),
    /** The refund of the difference (a lower total). */
    refundId: uuid("refund_id"),
    /** SHA-256 (base64url) of the 32-byte pay token of a change waiting for payment; kept when it ends, so the page can say what became of it. */
    payTokenHash: text("pay_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    madeBy: uuid("made_by")
      .notNull()
      .references(() => accounts.id),
    documents: text("documents").notNull().default("none"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** When a change waiting for payment was cancelled or expired. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  // Annotated: payments, refunds and the documents name a change and a change names its payment and refund, so the types would otherwise infer in a circle.
  (t): PgTableExtraConfigValue[] => [
    unique("order_edits_store_id_key").on(t.storeId, t.id),
    unique("order_edits_order_seq_key").on(t.storeId, t.orderId, t.seq),
    orderRef("order_edits_order_fk", t).onDelete("restrict"),
    foreignKey({
      name: "order_edits_payment_fk",
      columns: [t.storeId, t.paymentId],
      foreignColumns: [payments.storeId, payments.id],
    }),
    foreignKey({
      name: "order_edits_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    /** One change waiting for payment per order. */
    uniqueIndex("order_edits_awaiting_key")
      .on(t.storeId, t.orderId)
      .where(sql`${t.status} = 'awaiting_payment'`),
    index("order_edits_expiry_idx")
      .on(t.storeId, t.status, t.expiresAt)
      .where(sql`${t.status} = 'awaiting_payment'`),
    index("order_edits_order_idx").on(t.storeId, t.orderId),
    index("order_edits_payment_idx").on(t.storeId, t.paymentId),
    index("order_edits_refund_idx").on(t.storeId, t.refundId),
    index("order_edits_made_by_idx").on(t.madeBy),
    uniqueIndex("order_edits_token_key")
      .on(t.payTokenHash)
      .where(sql`${t.payTokenHash} is not null`),
    check("order_edits_seq", sql`${t.seq} >= 1`),
    check("order_edits_status", sql`${t.status} in (${sqlList(ORDER_EDIT_STATUSES)})`),
    check("order_edits_reason", sql`${t.reason} in (${sqlList(ORDER_EDIT_REASONS)})`),
    check("order_edits_documents", sql`${t.documents} in (${sqlList(ORDER_EDIT_DOCUMENTS)})`),
    check("order_edits_base", sql`jsonb_typeof(${t.base}) = 'object'`),
    check(
      "order_edits_amounts",
      sql`${t.totalBefore} >= 0 and ${t.totalAfter} >= 0 and ${t.shippingBefore} >= 0 and ${t.shippingAfter} >= 0 and ${t.differenceMinor} = ${t.totalAfter} - ${t.totalBefore}`,
    ),
    check("order_edits_token", sql`${t.payTokenHash} is null or ${t.payTokenHash} ~ '^[A-Za-z0-9_-]{43}$'`),
    /**
     * Where each status leaves the moments, the link and the money: a change waiting for payment has a higher total, a link and its end, nothing applied or
     * ended and no payment or refund named; an applied one has its moment; a cancelled or expired one was waiting (a higher total and a link) and has ended with
     * nothing applied. The money an applied change moved is checked at commit (`order_edits_settled()`), because its payment or refund row names the change.
     */
    check(
      "order_edits_lifecycle",
      sql`(${t.status} = 'awaiting_payment' and ${t.differenceMinor} > 0 and ${t.payTokenHash} is not null and ${t.expiresAt} is not null
            and ${t.appliedAt} is null and ${t.endedAt} is null and ${t.paymentId} is null and ${t.refundId} is null and ${t.documents} = 'none')
        or (${t.status} = 'applied' and ${t.appliedAt} is not null and ${t.endedAt} is null)
        or (${t.status} in ('cancelled', 'expired') and ${t.differenceMinor} > 0 and ${t.payTokenHash} is not null and ${t.endedAt} is not null
            and ${t.appliedAt} is null and ${t.paymentId} is null and ${t.refundId} is null and ${t.documents} = 'none')`,
    ),
    check(
      "order_edits_money",
      sql`(${t.differenceMinor} >= 0 or ${t.paymentId} is null) and (${t.differenceMinor} <= 0 or ${t.refundId} is null)`,
    ),
  ],
);

/**
 * A line of an order change (D174): units added (`add`, a new order line), a line taken off (`remove`; the order line is deleted and its whole row kept in
 * `before`) or a quantity lowered (`reduce`; the units and the money taken off, `before` the line as it was). The amounts are what the change added or took
 * off, in the order's currency, VAT included: for `remove` and `reduce` they are the line as sold less what it keeps (`splitLine()`), so kept and removed add up
 * to the line exactly. `order_line_id` has no foreign key (a removed line is gone); for an `add` it is written once, when the change is applied. Written with
 * its change in one transaction and never changed after (but that one id) or deleted.
 */
export const orderEditLines = commerce.table(
  "order_edit_lines",
  {
    storeId: storeId(),
    orderEditId: uuid("order_edit_id").notNull(),
    n: integer("n").notNull(),
    kind: text("kind").notNull(),
    orderLineId: uuid("order_line_id"),
    variantId: uuid("variant_id"),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor"),
    /** An added line's list price as shown in the order's view (information only; the price charged is `unit_price_minor`). */
    listPriceMinor: bigint("list_price_minor", { mode: "number" }),
    totalMinor: money("total_minor"),
    discountMinor: money("discount_minor"),
    taxMinor: money("tax_minor"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull(),
    /** The discount parts taken off with the units: `{ member, campaign, bonus, referral, staff, relief }` in minor units; all 0 for `add`. */
    parts: jsonb("parts").notNull().default({}),
    /** The whole order line as it was, for `remove` and `reduce`. */
    before: jsonb("before"),
    /** For `add`: the units sold on backorder and the delivery time stated (D172). */
    backorderQuantity: integer("backorder_quantity").notNull().default(0),
    backorderDays: integer("backorder_days"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orderEditId, t.n] }),
    foreignKey({
      name: "order_edit_lines_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }).onDelete("restrict"),
    variantRef("order_edit_lines_variant_fk", t),
    index("order_edit_lines_edit_idx").on(t.storeId, t.orderEditId),
    index("order_edit_lines_variant_idx").on(t.storeId, t.variantId),
    index("order_edit_lines_order_line_idx")
      .on(t.storeId, t.orderLineId)
      .where(sql`${t.orderLineId} is not null`),
    check("order_edit_lines_n", sql`${t.n} >= 1`),
    check("order_edit_lines_kind", sql`${t.kind} in (${sqlList(ORDER_EDIT_LINE_KINDS)})`),
    check("order_edit_lines_quantity", sql`${t.quantity} > 0`),
    check(
      "order_edit_lines_amounts",
      sql`${t.unitPriceMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.totalMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.taxMinor} <= ${t.totalMinor}
        and ${t.totalMinor} = ${t.unitPriceMinor} * ${t.quantity} - ${t.discountMinor} and (${t.listPriceMinor} is null or ${t.listPriceMinor} >= 0)`,
    ),
    check("order_edit_lines_rate", sql`${t.taxRate} >= 0 and ${t.taxRate} < 1`),
    check("order_edit_lines_parts", sql`jsonb_typeof(${t.parts}) = 'object'`),
    check(
      "order_edit_lines_shape",
      sql`(${t.kind} = 'add' and ${t.before} is null and ${t.discountMinor} = 0 and ${t.variantId} is not null)
        or (${t.kind} in ('remove', 'reduce') and ${t.before} is not null and jsonb_typeof(${t.before}) = 'object' and ${t.orderLineId} is not null
            and ${t.backorderQuantity} = 0 and ${t.backorderDays} is null)`,
    ),
    check(
      "order_edit_lines_backorder",
      sql`${t.backorderQuantity} between 0 and ${t.quantity} and (${t.backorderDays} is null or ${t.backorderDays} between 1 and 90)
        and (${t.backorderQuantity} = 0 or ${t.backorderDays} is not null)`,
    ),
  ],
);

/**
 * Units of an order line that will not be sent (D174, `docs/wave-3-fulfilment.md` 3.2 and "Closing units that will not be sent"): staff refunded or put back
 * units of a paid order that were never in a parcel and ticked *not sent*, so they come off what is still to send (`commerce.line_to_send()` subtracts
 * `commerce.closed_quantity()`). An explicit record, never a guess from stock movements (a plain refund's restock may be a sent unit that came back). Written
 * only by `refundOrder()` with `notSent` (one row per line, with the refund it came with when money moved); the trigger `unsent_closures_rules()` locks the
 * order and refuses more units than are still to send, a line that is not shipped, a copied order and an order that is not `paid`; the rows are append-only.
 * Holds no personal field (the staff account that closed them only).
 */
export const unsentClosures = commerce.table(
  "unsent_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** The refund the units were closed with (its first row when it was split), or null when nothing was refunded (a restock with 0 to refund). */
    refundId: uuid("refund_id"),
    /** The staff member who closed them. */
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    orderRef("unsent_closures_order_fk", t).onDelete("restrict"),
    foreignKey({
      name: "unsent_closures_order_line_fk",
      columns: [t.storeId, t.orderLineId],
      foreignColumns: [orderLines.storeId, orderLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "unsent_closures_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }).onDelete("restrict"),
    index("unsent_closures_order_idx").on(t.storeId, t.orderId),
    index("unsent_closures_order_line_idx").on(t.storeId, t.orderLineId),
    index("unsent_closures_refund_idx")
      .on(t.storeId, t.refundId)
      .where(sql`${t.refundId} is not null`),
    index("unsent_closures_created_by_idx").on(t.createdBy),
    check("unsent_closures_quantity", sql`${t.quantity} > 0`),
  ],
);
