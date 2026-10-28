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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { CHANNEL_KEYS } from "../lib/analytics-channels";
import { LIMIT_KEYS } from "../lib/limits";
import { USAGE_METRIC_IDS } from "../lib/usage-metrics";
import { AUDIT_AREA_KEYS } from "../lib/audit";
import { MOVEMENT_REASONS, MOVEMENT_SOURCES } from "../lib/inventory";
import { WORKFLOW_TRIGGERS } from "../lib/workflows";
import { CUSTOMER_NOTE_MAX } from "../lib/customer-staff";
import {
  EXCHANGE_LINES_MAX,
  EXCHANGE_QUANTITY_MAX,
  EXCHANGE_WISH_NOTE_MAX,
  EXCHANGES_PER_RETURN_MAX,
} from "../lib/exchange-limits";
import { EXCHANGE_CHANNELS, EXCHANGE_SHIPPING_KINDS, EXCHANGE_STATUSES, LABEL_SOURCES, REFUND_KINDS } from "../lib/exchange-status";
import { DISPUTE_STATUSES, RISK_LEVELS } from "../lib/payment-facts";
import { CAPTURE_MODES, CAPTURE_SETTINGS } from "../lib/capture";
import { PAYOUT_LINE_KINDS, PAYOUT_STATUSES } from "../lib/payouts";
import { CARRIER_IDS } from "../lib/shipping-carriers";
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
import { EDITABLE_NOTIFICATIONS, NOTIFICATION_IDS, REQUIRED_NOTIFICATIONS } from "../lib/notifications";
import { STAFF_ALERT_EVENTS } from "../lib/staff-alerts";
import { CONSENT_EVENT_KINDS, SUBSCRIBE_SOURCES, SUBSCRIBER_STATUSES, UNSUBSCRIBE_SOURCES } from "../lib/marketing-consent";
import { PAYMENT_TERMS } from "../lib/payment-terms";
import { BROADCAST_AUDIENCES, BROADCAST_STATUSES, RECIPIENT_STATUSES } from "../lib/broadcast-status";
import { AUTOMATION_KINDS, SEND_OUTCOMES, STOCK_REQUEST_STATUSES } from "../lib/automation-kinds";
import {
  HIDE_REASONS,
  PUBLISH_MODES,
  REQUEST_DAYS_DEFAULT,
  REQUEST_DAYS_MAX,
  REQUEST_DAYS_MIN,
  REVIEW_PICTURE_BYTES,
  REVIEW_PICTURE_SIZE,
  REVIEW_PICTURE_TYPES,
  REVIEW_PICTURES_MAX,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
  REVIEW_THUMB_BYTES,
} from "../lib/review-status";
import { TRACKING_PHASES, TRACKING_STOPS } from "../lib/tracking-phases";
import { PAGE_JOB_KINDS, PAGE_JOB_STATUSES, PAGE_JOB_TRIES } from "../lib/page-jobs";
import {
  ESTIMATE_DAYS_MAX,
  INFO_MAX,
  INSTRUCTIONS_MAX,
  NAME_MAX,
  NOTE_MAX,
  PATTERNS_MAX,
  RADIUS_KM_MAX,
  RADIUS_KM_MIN,
  READY_HOURS_MAX,
  WEIGHT_GRAMS_MAX,
} from "../lib/shipping-limits";

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
/**
 * Who a gift card is sent to (D300 F2, `src/lib/gift-card-line.ts`): nothing for a card the buyer keeps, else the recipient's email and the day,
 * with an optional name, sender and message inside the gift message's limits. Cart lines and order lines share it.
 */
const giftCardFieldsCheck = (t: { to: AnyPgColumn; toName: AnyPgColumn; from: AnyPgColumn; message: AnyPgColumn; sendOn: AnyPgColumn }) =>
  sql`((${t.to} is null and ${t.toName} is null and ${t.from} is null and ${t.message} is null and ${t.sendOn} is null)
      or (${t.to} is not null and ${t.sendOn} is not null))
    and char_length(${t.to}) <= 254 and char_length(${t.toName}) <= ${lit(GIFT_NAME_MAX)} and char_length(${t.from}) <= ${lit(GIFT_NAME_MAX)}
    and char_length(${t.message}) <= ${lit(GIFT_MESSAGE_MAX)}
    and (${t.message} is null or cardinality(string_to_array(${t.message}, chr(10))) <= ${lit(GIFT_MESSAGE_LINES)})`;
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
  /** D289: the card is held, not charged; nothing counts as a sale until it is captured (`paid`). */
  "authorized",
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
    /** The admin's colour scheme for them (D221, `ADMIN_SCHEMES` in `src/lib/admin-schemes.ts`); a new scheme widens the check. */
    adminScheme: text("admin_scheme").notNull().default("meadow"),
    /**
     * The language the admin is shown in for them (D312 A0, `ADMIN_LANGS` in `src/lib/admin-lang.ts`): `en` or `nb-NO`, set from their
     * browser at their first sign-in, then their own choice; a new language widens the check. Never per store.
     */
    adminLocale: text("admin_locale"),
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
    /**
     * How the account came (D317): `store` through a store (an approved request, an invitation, the platform's own), `domain` by buying a
     * domain without a store, so the domain shop can be counted as a way in.
     */
    origin: text("origin").notNull().default("store"),
    /** The holder lets the AI manager change DNS records of the domains they hold without asking (D317, as `stores.domain_dns_auto`). */
    domainDnsAuto: boolean("domain_dns_auto").notNull().default(false),
    /** Kaizena Flow's Stripe customer for what the account buys without a store (D317: domains), per mode. */
    stripeCustomerTest: text("stripe_customer_test"),
    stripeCustomerLive: text("stripe_customer_live"),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("accounts_email_idx").on(sql`lower(${t.email})`),
    check("accounts_origin", sql`${t.origin} in ('store', 'domain')`),
    check("accounts_color_mode", sql`${t.colorMode} in ('system', 'light', 'dark')`),
    check("accounts_admin_scheme", sql`${t.adminScheme} in ('meadow', 'indigo')`),
    check("accounts_admin_locale", sql`${t.adminLocale} in ('en', 'nb-NO')`),
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
    /** A domain the requester holds, to connect to the store when it is approved (D317 4: *Start a store on {domain}*). */
    domain: text("domain"),
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
    /**
     * The design profile's preset the requester chose (`docs/theme-showcase-phase-1.md` step 4), by its key, kept only when the profile's
     * published version has it; applied with the profile. Null: the profile's own look.
     */
    designVariation: text("design_variation"),
    /** The language the request was made in (D312 P6), its locale (`en`, `nb-NO`): its emails are written in it, and the account's admin starts in it. Null: English. */
    locale: text("locale"),
    /**
     * Made through self-serve sign-up (D359): the store is made when the person confirms their address, with no platform admin. The link's
     * token is kept only as its SHA-256 (`confirm_hash`, cleared when used), good until `confirm_expires_at`; `confirmed_at` is when it was
     * pressed (a request confirmed whose store could not be made stays pending for a platform admin).
     */
    selfServe: boolean("self_serve").notNull().default(false),
    confirmHash: text("confirm_hash"),
    confirmExpiresAt: timestamp("confirm_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("access_requests_confirm", sql`${t.confirmHash} is null or (${t.selfServe} and ${t.confirmExpiresAt} is not null)`),
    uniqueIndex("access_requests_confirm_hash_idx").on(t.confirmHash),
    check("access_requests_locale", sql`${t.locale} is null or ${t.locale} in ('en', 'nb-NO')`),
    check(
      "access_requests_design_variation",
      sql`${t.designVariation} is null or (${t.designPresetId} is not null and ${t.designVariation} ~ '^[a-z0-9][a-z0-9-]{0,39}$')`,
    ),
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
    /** The AI manager may change DNS records of the store's kept zones without asking (D315 decision 5, `docs/domains.md` 7.1). */
    domainDnsAuto: boolean("domain_dns_auto").notNull().default(false),
    /** A platform admin opened buying domains for this store before it opens to all (D315 decision 9). */
    domainBuying: boolean("domain_buying").notNull().default(false),
    /**
     * What checkout says about the store's terms (wave 1, 1e): `link` (a sentence with links, the default), `checkbox`
     * (the same with a required tick) or `off` (nothing drawn, nothing recorded). A copy of a store starts with `link`.
     */
    termsAtCheckout: text("terms_at_checkout").notNull().default("link"),
    /**
     * Customer accounts (wave 10 unit B, D365): `optional` (shoppers may check out as guests or with an account), `required` (only a signed-in
     * customer buys) or `off` (the store draws no sign-in or account). Read only through `accountsMode()`, written only by `saveAccountsMode()`.
     */
    customerAccounts: text("customer_accounts").notNull().default("optional"),
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
    /**
     * Private mode (D339, `src/server/private-mode.ts`, its only writer): visitors without the unlock pass see the landing page (the page
     * role `private`). On for a new store until it opens (decision 5); a store template or demo store is never private, whatever this says.
     */
    privateMode: boolean("private_mode").notNull().default(true),
    /** The password that lets visitors in, as a scrypt hash (`scrypt$…`); none: only staff get in. Never copied with a store. */
    privatePassword: text("private_password"),
    /** Raised when the password changes or the owner signs everyone out: a password pass given under another version no longer opens. */
    privateVersion: integer("private_version").notNull().default(1),
    /**
     * Shopping agents (wave 8 unit I, D353, `src/server/shopping-agents.ts`): the store's public MCP endpoint for AI shopping agents
     * (`/api/ucp/{store}/mcp`) and its UCP profile answer only while this is on. Off by default (decision 4); written only by
     * `src/server/shopping-agent-settings.ts`. Never copied with a store.
     */
    shoppingAgents: boolean("shopping_agents").notNull().default(false),
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
    check("stores_customer_accounts", sql`${t.customerAccounts} in ('optional', 'required', 'off')`),
    check("stores_modules", sql`${t.modules} <@ array['bookings', 'deliveries', 'work']::text[]`),
    check(
      "stores_features",
      sql`${t.features} <@ array['shop', 'subscriptions', 'boxes', 'appointments', 'bookings', 'countries', 'languages', 'currencies', 'business', 'bonus', 'referrals', 'gift_cards', 'reviews']::text[]`,
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
      sql`${t.slug} not in ('account', 'admin', 'api', 'app', 'auth', 'forgot-password', 'help', 'hosting', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'stores', 'support', 'themes', 'www')`,
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
 * What a new store came with from its store template (`docs/theme-showcase-phase-1.md` step 4b): its products, its own pages and articles
 * and its categories and tags, each marked when the store was made (`markDemoContent()`), so *Remove demo content* takes out what
 * the owner has not changed since (`updated_at` after `marked_at` is theirs). A row goes when its thing is removed or becomes the owner's.
 */
export const storeDemoItems = commerce.table(
  "store_demo_items",
  {
    storeId: uuid("store_id")
      .notNull()
      .references((): AnyPgColumn => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    refId: uuid("ref_id").notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.kind, t.refId] }),
    check("store_demo_items_kind", sql`${t.kind} in ('product', 'page', 'term')`),
  ],
);

/**
 * A demo store's home page an existing store took as its front page (`docs/theme-showcase-phase-1.md` step 4c): the copy made, the content
 * pack it came from and the front page the store had before, so *Put back your front page* can undo it. Written only by
 * `src/server/home-takes.ts`; `undone_at` is set once.
 */
export const storeHomeTakes = commerce.table(
  "store_home_takes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references((): AnyPgColumn => stores.id, { onDelete: "cascade" }),
    pack: text("pack").notNull(),
    pageId: uuid("page_id").references((): AnyPgColumn => pages.id, { onDelete: "set null" }),
    previousFrontPageId: uuid("previous_front_page_id").references((): AnyPgColumn => pages.id, { onDelete: "set null" }),
    takenBy: uuid("taken_by").references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("store_home_takes_store_idx").on(t.storeId, t.takenAt),
    index("store_home_takes_page_idx").on(t.pageId),
    index("store_home_takes_previous_idx").on(t.previousFrontPageId),
    index("store_home_takes_taken_by_idx").on(t.takenBy),
    check("store_home_takes_pack", sql`${t.pack} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`),
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
    /**
     * One of Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2, `CONTENT_PACKS` in `src/lib/content-packs.ts`): its key,
     * so `syncContentPacks()` finds it again, the version of the code's definition last written into its store (null until then), and the
     * pictures made for it so far by slot (`hero`, `story`, `product:{handle}`: `{ url, width, height, alt }`). Null for a template an admin made.
     */
    packKey: text("pack_key"),
    packVersion: integer("pack_version"),
    packPictures: jsonb("pack_pictures").notNull().default({}),
    /**
     * *Make the pictures* (D271): the platform admin who asked for the pack's pictures, and when. The job (`runPackPictures()`) makes them
     * one at a time in that person's name until none is missing, Stop is pressed or three tries in a row fail. Null: not asked.
     */
    picturesWantedBy: uuid("pictures_wanted_by").references(() => accounts.id),
    picturesWantedAt: timestamp("pictures_wanted_at", { withTimezone: true }),
    /** A run is making one of the pack's pictures until then; a run that died gives it back when the time passes. */
    pictureClaimedUntil: timestamp("picture_claimed_until", { withTimezone: true }),
    /** Tries in a row that failed, and why the last one did (shown on the Store templates page). */
    pictureFailures: smallint("picture_failures").notNull().default(0),
    pictureProblem: text("picture_problem"),
    /**
     * The theme this is the own content of (D275, `docs/themes-content-and-demo-stores.md`): what its preview and photographs draw and what a
     * new store started from it is copied from. One per theme; a content pack's template may be a launch theme's. Null: a demo store or
     * starting content only.
     */
    designPresetId: uuid("design_preset_id").references((): AnyPgColumn => designPresets.id, { onDelete: "set null" }),
    /**
     * What it is (D277, `docs/themes-content-and-demo-stores.md` section 4): `content`, a starting point new stores and themes are copied
     * from (frozen on Publish, D177), or `demo`, a live store a platform admin dresses in a theme: published as it stands, never frozen, never
     * a new store's content, shown under *See it live* on the theme it wears. Fixed once made.
     */
    kind: text("kind").notNull().default("content"),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("store_starters_store_idx").on(t.storeId),
    uniqueIndex("store_starters_pack_key_idx").on(t.packKey),
    uniqueIndex("store_starters_design_preset_idx").on(t.designPresetId),
    check("store_starters_pack", sql`${t.packVersion} is null or (${t.packKey} is not null and ${t.packVersion} > 0)`),
    check("store_starters_pack_pictures", sql`jsonb_typeof(${t.packPictures}) = 'object'`),
    check("store_starters_pictures_wanted", sql`(${t.picturesWantedBy} is null) = (${t.picturesWantedAt} is null) and (${t.picturesWantedAt} is null or ${t.packKey} is not null)`),
    check("store_starters_picture_failures", sql`${t.pictureFailures} between 0 and 20`),
    check("store_starters_picture_problem", sql`${t.pictureProblem} is null or length(${t.pictureProblem}) <= 500`),
    index("store_starters_pictures_wanted_by_idx").on(t.picturesWantedBy),
    index("store_starters_recommended_design_idx").on(t.recommendedDesign),
    index("store_starters_published_store_idx").on(t.publishedStoreId),
    index("store_starters_archived_by_idx").on(t.archivedBy),
    check("store_starters_archived_unpublished", sql`not (${t.published} and ${t.archivedAt} is not null)`),
    check("store_starters_kind", sql`${t.kind} in ('content', 'demo')`),
    check(
      "store_starters_demo",
      sql`${t.kind} <> 'demo' or (${t.designPresetId} is null and ${t.packKey} is null and ${t.publishedStoreId} is null)`,
    ),
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
 * `src/lib/design-presets.ts` (versioned, `v` 1, or 2 with its presets, `variations`): the theme's settings, the chosen header, footer
 * and standard product layout as rows, and the site's CSS, cleaned of everything that points into the store it came from. Not store-owned (no `store_id`: the source is only
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
    /**
     * One of Kaizena Flow's launch themes (D246, `LAUNCH_THEMES` in `src/lib/launch-themes.ts`): its key there, so `syncLaunchThemes()` finds
     * it again, and the version of the code's definition last published (null until its first Publish). Null for a theme an admin made.
     */
    launchKey: text("launch_key"),
    launchVersion: integer("launch_version"),
    /**
     * Its place in the theme store (`docs/theme-phase-3.md`): the address `/themes/{slug}` (null: not listed yet) and the listing,
     * `{ kinds, styles }` (`parseListing()` in `src/lib/theme-store.ts`). Not a draft: shown while the theme is published.
     */
    slug: text("slug"),
    listing: jsonb("listing").notNull().default({}),
    /**
     * Who made it, when it came from outside (D344, `src/server/theme-submissions.ts`): the account that submitted it and the name shown as
     * its author (*By …*). Both null for Kaizena Flow's own. Such a theme is free (no price, `theme_prices_author_free()`).
     */
    authorId: uuid("author_id").references(() => accounts.id),
    authorName: text("author_name"),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("design_presets_offered_idx").on(t.published, t.position),
    index("design_presets_author_idx").on(t.authorId),
    check(
      "design_presets_author",
      sql`(${t.authorId} is null and ${t.authorName} is null) or (${t.authorId} is not null and ${t.authorName} is not null and length(btrim(${t.authorName})) between 1 and 80)`,
    ),
    uniqueIndex("design_presets_launch_key_idx").on(t.launchKey),
    uniqueIndex("design_presets_slug_idx").on(t.slug),
    check("design_presets_slug", sql`${t.slug} is null or ${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'`),
    check("design_presets_listing", sql`jsonb_typeof(${t.listing}) = 'object'`),
    check("design_presets_launch", sql`${t.launchVersion} is null or (${t.launchKey} is not null and ${t.launchVersion} > 0)`),
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
      sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'v' in ('1', '2') and octet_length(${t.snapshot}::text) <= 2000000`,
    ),
  ],
);

/**
 * A look submitted as a theme from outside (D344, `docs/wave-7-storefront.md` J): a store's live look as `takeSnapshot()` took it when it was
 * submitted, by an account that may change that store's website, as a new theme (`kind` `theme`) or an update of the author's own (`update`,
 * `preset_id` the theme). Written only by `src/server/theme-submissions.ts`; the database moves `status` only forward (`waiting` →
 * `reviewing` → `approved`, or `rejected`/`withdrawn` while open) and keeps who, what and the snapshot as submitted.
 */
export const themeSubmissions = commerce.table(
  "theme_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    kind: text("kind").notNull(),
    /** The theme: an update's from the start, a new theme's once it is reviewed. */
    presetId: uuid("preset_id").references(() => designPresets.id),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    /** An update's *What's new*, in the author's words. */
    notes: text("notes"),
    authorName: text("author_name").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    status: text("status").notNull().default("waiting"),
    /** Why it was rejected, for the author. */
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => accounts.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("theme_submissions_account_idx").on(t.accountId, t.createdAt),
    index("theme_submissions_status_idx").on(t.status, t.createdAt),
    index("theme_submissions_store_idx").on(t.storeId),
    index("theme_submissions_preset_idx").on(t.presetId),
    index("theme_submissions_decided_by_idx").on(t.decidedBy),
    check("theme_submissions_kind", sql`${t.kind} in ('theme', 'update')`),
    check("theme_submissions_status", sql`${t.status} in ('waiting', 'reviewing', 'approved', 'rejected', 'withdrawn')`),
    check("theme_submissions_update_preset", sql`${t.kind} = 'theme' or ${t.presetId} is not null`),
    check("theme_submissions_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("theme_submissions_summary", sql`length(${t.summary}) <= 200`),
    check("theme_submissions_description", sql`length(${t.description}) <= 2000`),
    check("theme_submissions_notes", sql`${t.notes} is null or length(${t.notes}) <= 2000`),
    check("theme_submissions_author_name", sql`length(btrim(${t.authorName})) between 1 and 80`),
    check("theme_submissions_reason", sql`${t.reason} is null or length(btrim(${t.reason})) between 1 and 1000`),
    check("theme_submissions_rejected_reason", sql`${t.status} <> 'rejected' or ${t.reason} is not null`),
    check(
      "theme_submissions_snapshot",
      sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'v' in ('1', '2') and octet_length(${t.snapshot}::text) <= 2000000`,
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
    /** The install this use made live (theme store phase 1, D241); null for a use from before installs, or once the install was removed. */
    installId: uuid("install_id").references((): AnyPgColumn => storeThemeInstalls.id, { onDelete: "set null" }),
    /** The install that was live before it, which *Put back the look from before* switches to while it is still installed. */
    previousInstallId: uuid("previous_install_id").references((): AnyPgColumn => storeThemeInstalls.id, { onDelete: "set null" }),
  },
  (t) => [
    index("design_preset_uses_install_idx").on(t.installId),
    index("design_preset_uses_previous_install_idx").on(t.previousInstallId),
    index("design_preset_uses_store_idx").on(t.storeId, t.appliedAt),
    index("design_preset_uses_preset_idx").on(t.presetId),
    index("design_preset_uses_saved_theme_idx").on(t.savedThemeId),
    index("design_preset_uses_applied_by_idx").on(t.appliedBy),
    index("design_preset_uses_restored_by_idx").on(t.restoredBy),
    check("design_preset_uses_previous", sql`jsonb_typeof(${t.previous}) = 'object'`),
  ],
);

/**
 * The published versions of a theme (D241, `docs/theme-store.md` 5; a theme is a design profile, `design_presets`, in code): each Publish whose
 * look differs from the version before adds one, numbered from 1, never edited or deleted (`design_preset_versions_rules()`). A store's
 * install names the version it came from, so a later Publish never changes what a store has.
 */
export const designPresetVersions = commerce.table(
  "design_preset_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid("published_by").references(() => accounts.id),
    /** *What's new* in this version, as the platform's admin wrote it at Publish (D245); facts are added in code (`whatsNew()`). */
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("design_preset_versions_number_idx").on(t.presetId, t.number),
    check("design_preset_versions_notes", sql`${t.notes} is null or length(${t.notes}) <= 2000`),
    index("design_preset_versions_published_by_idx").on(t.publishedBy),
    check("design_preset_versions_number", sql`${t.number} >= 1`),
    check(
      "design_preset_versions_snapshot",
      sql`jsonb_typeof(${t.snapshot}) = 'object' and ${t.snapshot} ->> 'v' in ('1', '2') and octet_length(${t.snapshot}::text) <= 2000000`,
    ),
  ],
);

/**
 * A theme's presets as drafted (`docs/theme-showcase-phase-1.md` step 1; *Presets* in the interface, variations in code, as `design_presets`
 * are themes): each a whole look over the theme (`theme`: the D60 template and settings) with a fixed `key` and a `name`, at most
 * `VARIATIONS_MAX` a theme, the key fixed (`design_variations_rules()`). Publish copies them into the version's snapshot
 * (`DesignSnapshot.variations`), which is what stores, previews and the theme store read. Deleted with its theme; no store, so outside
 * `COPY_RULES`.
 */
export const designVariations = commerce.table(
  "design_variations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    theme: jsonb("theme").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("design_variations_key_idx").on(t.presetId, t.key),
    index("design_variations_created_by_idx").on(t.createdBy),
    index("design_variations_updated_by_idx").on(t.updatedBy),
    check("design_variations_key", sql`${t.key} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`),
    check("design_variations_name", sql`length(btrim(${t.name})) between 1 and 40`),
    check("design_variations_theme", sql`jsonb_typeof(${t.theme}) = 'object' and octet_length(${t.theme}::text) <= 300000`),
  ],
);

/**
 * The photographs of a theme's looks (`docs/theme-showcase-phase-2.md` step 1): one unit of work per look of a version, the store it is
 * shown on and a width (`kind`; `highlights` are composed from a look's two, step 2), and what it made (`pictures`, by kind of picture; `parts`,
 * the page's measured boxes). Wanted units are inserted by `queueThemeShots()` and taken by the job (`/api/cron/theme-shots`); a unit no longer
 * wanted (a newer version, a showcase published again) is `superseded`, and its files and row go a week later (`pruneThemeShots()`).
 * `showcase_store_id` names the store photographed, never an owner (so no `store_id`, outside `COPY_RULES`); the starter and the store are a
 * record of what was drawn, not references, so a unit outlives a template taken away and is pruned as not wanted.
 */
export const themeShots = commerce.table(
  "theme_shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** The preset's key (`design_variations.key`); null for the theme's own look. */
    variation: text("variation"),
    /** The showcase's store template (`store_starters.id`); null for the Standard store. */
    starterId: uuid("starter_id"),
    showcaseStoreId: uuid("showcase_store_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("waiting"),
    tries: smallint("tries").notNull().default(0),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    problem: text("problem"),
    pictures: jsonb("pictures"),
    parts: jsonb("parts"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    unique("theme_shots_unit").on(t.presetId, t.version, t.variation, t.showcaseStoreId, t.kind).nullsNotDistinct(),
    index("theme_shots_queue_idx").on(t.createdAt).where(sql`${t.status} in ('waiting', 'running')`),
    check("theme_shots_version", sql`${t.version} >= 1`),
    check("theme_shots_variation", sql`${t.variation} is null or ${t.variation} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`),
    check("theme_shots_kind", sql`${t.kind} in ('computer', 'phone', 'highlights')`),
    check("theme_shots_status", sql`${t.status} in ('waiting', 'running', 'done', 'failed', 'superseded')`),
    check("theme_shots_tries", sql`${t.tries} between 0 and 20`),
    check("theme_shots_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
    check("theme_shots_pictures", sql`${t.pictures} is null or (jsonb_typeof(${t.pictures}) = 'object' and octet_length(${t.pictures}::text) <= 20000)`),
    check("theme_shots_parts", sql`${t.parts} is null or (jsonb_typeof(${t.parts}) = 'object' and octet_length(${t.parts}::text) <= 200000)`),
    check("theme_shots_done", sql`${t.status} <> 'done' or (${t.pictures} is not null and ${t.finishedAt} is not null)`),
    check("theme_shots_superseded", sql`(${t.status} = 'superseded') = (${t.supersededAt} is not null)`),
  ],
);

/**
 * Kaizena Flow's own installed themes (phase 4 of `docs/theme-store.md`, `docs/theme-phase-4.md`): as a store's (`store_theme_installs`), one
 * live, whose look is `platform_settings`' columns (`theme`, `fonts`, `custom_css`, `header_id`, `footer_id`), so `look` is null for it; an
 * install that is not live keeps its look in `look` (`PlatformLook`: the theme as stored, the fonts, the CSS and the chosen layouts' page ids).
 * Seeded with a live *Custom* for the look the site has. Written only by `src/server/platform-theme-installs.ts` and
 * `installPresetOnPlatform()` (a scan test).
 */
export const platformThemeInstalls = commerce.table(
  "platform_theme_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The theme it came from; null: *Custom*, Kaizena Flow's own look. */
    presetId: uuid("preset_id").references(() => designPresets.id),
    versionId: uuid("version_id").references(() => designPresetVersions.id),
    title: text("title").notNull(),
    look: jsonb("look"),
    live: boolean("live").notNull().default(false),
    installedBy: uuid("installed_by").references(() => accounts.id, { onDelete: "set null" }),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    switchedAt: timestamp("switched_at", { withTimezone: true }),
    /** What was placed when it was added or last updated (as `store_theme_installs.placed`, D245), so an update keeps the admins' changes. */
    placed: jsonb("placed"),
    /** Whether a new version of its theme reaches it by itself (D253, as `store_theme_installs.follows_updates`); on until switched off. */
    followsUpdates: boolean("follows_updates").notNull().default(true),
    /**
     * The theme's preset it was added with (`docs/theme-showcase-phase-1.md`, its key); null: the theme's own look. Fixed like the theme, also
     * while a later version has no such preset (the install then has the theme's own look until a version brings it back).
     */
    variation: text("variation"),
  },
  (t) => [
    uniqueIndex("platform_theme_installs_live_idx").on(t.live).where(sql`${t.live}`),
    index("platform_theme_installs_preset_idx").on(t.presetId),
    index("platform_theme_installs_version_idx").on(t.versionId),
    index("platform_theme_installs_installed_by_idx").on(t.installedBy),
    check("platform_theme_installs_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("platform_theme_installs_look", sql`(${t.live} and ${t.look} is null) or (not ${t.live} and coalesce(jsonb_typeof(${t.look}) = 'object', false))`),
    check("platform_theme_installs_placed", sql`${t.placed} is null or jsonb_typeof(${t.placed}) = 'object'`),
  ],
);

/**
 * Updates of Kaizena Flow's own installed themes (D253, `docs/theme-phase-4.md` step 3), as `theme_install_updates` are a store's (D245): the
 * look before and after each update, for its undo, and what was kept as the admins' own. Written only by `updatePlatformInstall()` and
 * `undoPlatformThemeUpdate()` in `src/server/design-presets.ts`; only `undone_at` changes, once (`platform_theme_install_updates_rules()`);
 * deleted after `THEME_UPDATE_KEEP_DAYS` (`pruneThemeUpdates()`).
 */
export const platformThemeInstallUpdates = commerce.table(
  "platform_theme_install_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installId: uuid("install_id")
      .notNull()
      .references(() => platformThemeInstalls.id, { onDelete: "cascade" }),
    fromVersionId: uuid("from_version_id").references(() => designPresetVersions.id, { onDelete: "set null" }),
    toVersionId: uuid("to_version_id").references(() => designPresetVersions.id, { onDelete: "set null" }),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    kept: jsonb("kept").notNull().default(sql`'{}'::jsonb`),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("platform_theme_install_updates_created_idx").on(t.createdAt),
    index("platform_theme_install_updates_install_idx").on(t.installId),
    index("platform_theme_install_updates_from_idx").on(t.fromVersionId),
    index("platform_theme_install_updates_to_idx").on(t.toVersionId),
    index("platform_theme_install_updates_by_idx").on(t.updatedBy),
    check(
      "platform_theme_install_updates_looks",
      sql`jsonb_typeof(${t.before}) = 'object' and jsonb_typeof(${t.after}) = 'object' and jsonb_typeof(${t.kept}) = 'object'`,
    ),
  ],
);

/**
 * The themes installed in a store (D241, `docs/theme-store.md` 4.5 and 5): several, one live. The live install's look is the store's own columns
 * (`stores.theme`, `custom_css`, `header_id`, `footer_id`, `product_layout_id`), read as ever, so `look` is null for it; an install that is not live
 * keeps its look in `look` (`InstalledLook`: the theme as stored, the chosen layouts' page ids and the CSS) until it is switched to. Every store
 * has one from its first moment (a trigger on `stores`: *Custom*, `preset_id` null, the store's own look). Written only by
 * `src/server/theme-installs.ts` and `applyDesignPreset()` (a scan test). Never copied with a store: a copy starts with its own *Custom*.
 */
export const storeThemeInstalls = commerce.table(
  "store_theme_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    /** The theme it came from; null: *Custom*, the store's own look. */
    presetId: uuid("preset_id").references(() => designPresets.id),
    /** The version installed; null for *Custom* and for an unpublished theme tried on a store template. */
    versionId: uuid("version_id").references(() => designPresetVersions.id),
    title: text("title").notNull(),
    look: jsonb("look"),
    live: boolean("live").notNull().default(false),
    installedBy: uuid("installed_by").references(() => accounts.id, { onDelete: "set null" }),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    /** When it was last made live or put away. */
    switchedAt: timestamp("switched_at", { withTimezone: true }),
    /**
     * Whether a new version of its theme is applied by itself (D245); the owner switches it per install. Off for a new install (D344,
     * decision 4: an update is offered, with *What's new*, and made by the owner's press); installs that followed before keep following.
     */
    followsUpdates: boolean("follows_updates").notNull().default(false),
    /**
     * What was placed when it was applied or last updated (D245, `Placed` in `src/lib/theme-update.ts`): the settings and CSS written and each
     * layout page with its fingerprint, so an update can tell the owner's changes from the theme's. Null for installs from before.
     */
    placed: jsonb("placed"),
    /**
     * The theme's preset it was added with (`docs/theme-showcase-phase-1.md`, its key); null: the theme's own look. Fixed like the theme, also
     * while a later version has no such preset (the install then has the theme's own look until a version brings it back).
     */
    variation: text("variation"),
  },
  (t) => [
    uniqueIndex("store_theme_installs_live_idx").on(t.storeId).where(sql`${t.live}`),
    check("store_theme_installs_placed", sql`${t.placed} is null or jsonb_typeof(${t.placed}) = 'object'`),
    index("store_theme_installs_store_idx").on(t.storeId, t.installedAt),
    index("store_theme_installs_preset_idx").on(t.presetId),
    index("store_theme_installs_version_idx").on(t.versionId),
    index("store_theme_installs_installed_by_idx").on(t.installedBy),
    check("store_theme_installs_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("store_theme_installs_look", sql`(${t.live} and ${t.look} is null) or (not ${t.live} and coalesce(jsonb_typeof(${t.look}) = 'object', false))`),
  ],
);

/**
 * A theme's price (D286, `docs/theme-prices.md`): what a store pays Kaizena Flow once to use it, without VAT, one row per currency. A theme
 * with no row is free. Written only by `setThemePrices()` (`src/server/theme-prices.ts`) and the launch themes' sync when it makes one;
 * read for a store through `commerce.theme_price_for()`.
 */
export const themePrices = commerce.table(
  "theme_prices",
  {
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id, { onDelete: "cascade" }),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.presetId, t.currency] }),
    check("theme_prices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("theme_prices_amount", sql`${t.amountMinor} between 1 and 100000000`),
    index("theme_prices_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * A store's purchase of a premium theme (D286): made by the database when a priced theme goes live on a store that does not have it
 * (`commerce.theme_installs_charge()`): `owed` while the store is not open yet, `due` once it is (opening turns `owed` into `due`), then
 * `invoiced` by Kaizena Flow's Stripe billing (`chargeDueThemePurchases()`) and `paid` when Stripe says so. `granted`: the store has it
 * without paying (it used the theme before the theme had a price, or Kaizena Flow gave it); `cancelled`: no longer owed (another theme went
 * live before the store opened, or the theme was made free before it was charged); `void`: the invoice was voided. One live purchase per store
 * and theme; the steps only go forward, and a purchase is never deleted (`commerce.theme_purchases_rules()`). A store that has the theme keeps
 * it, with every preset and update.
 */
export const themePurchases = commerce.table(
  "theme_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    presetId: uuid("preset_id")
      .notNull()
      .references(() => designPresets.id),
    status: text("status").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** What is charged, without VAT; 0 for a theme given. */
    amountMinor: money("amount_minor"),
    /** The Stripe mode it was invoiced in, its invoice and how it is collected: `card` (the plan's card) or `invoice` (due in 14 days). */
    mode: text("mode"),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    invoiceNumber: text("invoice_number"),
    invoiceUrl: text("invoice_url"),
    collection: text("collection"),
    /** Why the last try to invoice it failed, in plain words, and when it is tried again. */
    problem: text("problem"),
    tries: integer("tries").notNull().default(0),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    /** Who made it live (the account whose choice it was), when known. */
    chosenBy: uuid("chosen_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("theme_purchases_status", sql`${t.status} in ('owed', 'due', 'invoiced', 'paid', 'granted', 'cancelled', 'void')`),
    check("theme_purchases_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("theme_purchases_amount", sql`${t.amountMinor} >= 0 and (${t.amountMinor} > 0 or ${t.status} in ('granted', 'cancelled'))`),
    check("theme_purchases_mode", sql`${t.mode} is null or ${t.mode} in ('test', 'live')`),
    check("theme_purchases_collection", sql`${t.collection} is null or ${t.collection} in ('card', 'invoice')`),
    check("theme_purchases_invoiced", sql`(${t.status} in ('invoiced', 'paid', 'void')) = (${t.stripeInvoiceId} is not null) or ${t.status} = 'due'`),
    check("theme_purchases_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
    uniqueIndex("theme_purchases_one_idx")
      .on(t.storeId, t.presetId)
      .where(sql`${t.status} in ('owed', 'due', 'invoiced', 'paid', 'granted')`),
    index("theme_purchases_store_idx").on(t.storeId, t.createdAt),
    index("theme_purchases_preset_idx").on(t.presetId),
    index("theme_purchases_due_idx").on(t.dueAt).where(sql`${t.status} = 'due'`),
    index("theme_purchases_chosen_by_idx").on(t.chosenBy),
  ],
);

/**
 * The page migration of `docs/theme-store.md` 4.4 as it was run on a store (D243, `docs/theme-phase-2.md` step 2): one row per page it changed,
 * with the page's draft and published content before and after, so the run can be undone while the page is still as the run left it. Written
 * only by `src/server/theme-detach.ts`; pruned after `THEME_DETACH_KEEP_DAYS`.
 */
export const pageThemeDetaches = commerce.table(
  "page_theme_detaches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    /** The run it belongs to: every page one press changed shares it. */
    runId: uuid("run_id").notNull(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    draftBefore: jsonb("draft_before"),
    draftAfter: jsonb("draft_after"),
    publishedBefore: jsonb("published_before"),
    publishedAfter: jsonb("published_after"),
    /** How many settings it took out (draft and published together), and how many it kept as the store's own. */
    followed: integer("followed").notNull(),
    kept: integer("kept").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("page_theme_detaches_store_idx").on(t.storeId, t.createdAt),
    index("page_theme_detaches_run_idx").on(t.runId),
    index("page_theme_detaches_page_idx").on(t.pageId),
    index("page_theme_detaches_created_by_idx").on(t.createdBy),
    check("page_theme_detaches_counts", sql`${t.followed} >= 0 and ${t.kept} >= 0`),
  ],
);

/**
 * The updates of a store's installed themes to a new version (D245, `docs/theme-phase-2.md` step 4): the look before and after (the theme as
 * stored, the CSS, the chosen layouts, the version and what was placed), what was kept as the owner's, by whom (null: applied by itself), so
 * an update can be undone while the look is still what it left. Only `undone_at` changes, once; pruned after 90 days
 * (`pruneThemeInstallUpdates()`). Never copied with a store.
 */
export const themeInstallUpdates = commerce.table(
  "theme_install_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    installId: uuid("install_id")
      .notNull()
      .references(() => storeThemeInstalls.id, { onDelete: "cascade" }),
    fromVersionId: uuid("from_version_id").references(() => designPresetVersions.id, { onDelete: "set null" }),
    toVersionId: uuid("to_version_id").references(() => designPresetVersions.id, { onDelete: "set null" }),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    /** What was kept as the owner's: settings' paths, the CSS, layouts. */
    kept: jsonb("kept").notNull().default(sql`'{}'::jsonb`),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("theme_install_updates_store_idx").on(t.storeId, t.createdAt),
    index("theme_install_updates_install_idx").on(t.installId),
    index("theme_install_updates_from_idx").on(t.fromVersionId),
    index("theme_install_updates_to_idx").on(t.toVersionId),
    index("theme_install_updates_by_idx").on(t.updatedBy),
    check("theme_install_updates_looks", sql`jsonb_typeof(${t.before}) = 'object' and jsonb_typeof(${t.after}) = 'object' and jsonb_typeof(${t.kept}) = 'object'`),
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
      sql`${t.template} is null or ${t.template} in ('orders', 'products', 'marketing', 'content', 'analytics', 'support', 'read_only')`,
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
    /** Who acted (D309): the person, the AI manager in their name, or the autopilot; written by `audit()` from `actingAs()`. */
    actedBy: text("acted_by").notNull().default("person"),
  },
  (t) => [
    check("audit_log_acted_by", sql`${t.actedBy} in ('person', 'ai_manager', 'autopilot')`),
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
    /** Buying domains is open to every store (D315 decision 9: once moving away is built); until then only where `stores.domain_buying` is on. */
    domainsOpen: boolean("domains_open").notNull().default(false),
    /**
     * Domains are sold to people without a store (D317, `docs/domains-standalone.md`): off until the spikes of its section 12 are answered
     * (Vercel's written yes, VAT, withdrawal), then turned on from Platform → Settings → Domains.
     */
    domainsPublic: boolean("domains_public").notNull().default(false),
    /** Self-serve sign-up (D359): `/sign-up` makes the account and a store once the address is confirmed; off, a request waits for approval. */
    selfServeSignup: boolean("self_serve_signup").notNull().default(false),
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
     * Kaizen's own theme (D235), in a store's shape (`{ base, savedId, settings }`, read by `parseStoreTheme()`): null is Minimal,
     * which is what Kaizen's site always looked like. The page builder's Theme tab and saved colours write it; its fonts are
     * `fonts` above, laid over it when read.
     */
    theme: jsonb("theme"),
    /**
     * The languages Kaizena Flow's own site is offered in (D312, docs/platform-admin-i18n.md 3.1), English first; a language is
     * turned on at once from Platform → Languages (D312).
     */
    locales: text("locales").array().notNull().default(sql`'{en-GB}'::text[]`),
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
    // English always, first; the other languages the site has (`PLATFORM_LANGS`).
    check("platform_settings_locales", sql`coalesce(${t.locales}[1] = 'en-GB', false) and ${t.locales} <@ array['en-GB', 'nb-NO']::text[]`),
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
    /** The end of a self-serve store's trial (D359): its first plan chosen before then is free until then (Stripe's `trial_end`). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
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
// Shipping methods, zones and profiles, pickup and local delivery (wave 3, D237, docs/wave-3-shipping-methods.md 3.2). The rules the
// database holds beyond these checks (tiers without gaps, patterns in one zone of a market, limits, places of the right kind) are triggers in
// the rules migration. Every amount is in the market's own currency, with VAT, as `shipping_rates`; weights in grams.
// ---------------------------------------------------------------------------

/** The store's shipping settings (D237): the weight of one unit of goods with no weight of its own, in methods' weight tiers. Made with the defaults when first read. */
export const shippingSettings = commerce.table(
  "shipping_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    defaultWeightGrams: integer("default_weight_grams").notNull().default(500),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    check("shipping_settings_default_weight", sql`${t.defaultWeightGrams} between 1 and ${lit(WEIGHT_GRAMS_MAX)}`),
    index("shipping_settings_updated_by_idx").on(t.updatedBy),
  ],
);

/** A named group of products with rates of their own (D237); General is every product with none (`products.shipping_profile_id` null). */
export const shippingProfiles = commerce.table(
  "shipping_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("shipping_profiles_store_id_key").on(t.storeId, t.id),
    uniqueIndex("shipping_profiles_name_key").on(t.storeId, sql`lower(${t.name})`),
    check("shipping_profiles_name", sql`char_length(${t.name}) between 1 and ${lit(NAME_MAX)} and ${t.name} = btrim(${t.name})`),
  ],
);

/**
 * A named group of postal-code patterns inside one market's country (D237): exact codes (`0150`) and prefixes (`01*`), the most specific
 * matching pattern deciding a code's zone. A pattern is in one zone of a market at most (trigger `shipping_zones_patterns`).
 */
export const shippingZones = commerce.table(
  "shipping_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    name: text("name").notNull(),
    patterns: text("patterns").array().notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("shipping_zones_store_id_key").on(t.storeId, t.id),
    marketCountryRef("shipping_zones_market_fk", t).onDelete("cascade"),
    index("shipping_zones_market_idx").on(t.storeId, t.marketCode, t.position),
    check("shipping_zones_name", sql`char_length(${t.name}) between 1 and ${lit(NAME_MAX)} and ${t.name} = btrim(${t.name})`),
    check("shipping_zones_patterns_count", sql`cardinality(${t.patterns}) between 1 and ${lit(PATTERNS_MAX)}`),
  ],
);

/**
 * A named way of shipping in one market that the store prices itself (D237): *Standard*, *Express*. Its rates are `shipping_method_rates`;
 * `names` holds its name in the store's other languages, `free_over_minor` makes it free from a basket value (as shown, in the market's currency).
 */
export const shippingMethods = commerce.table(
  "shipping_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    name: text("name").notNull(),
    names: jsonb("names").notNull().default({}),
    estimateMinDays: integer("estimate_min_days"),
    estimateMaxDays: integer("estimate_max_days"),
    freeOverMinor: bigint("free_over_minor", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("shipping_methods_store_id_key").on(t.storeId, t.id),
    marketRef("shipping_methods_market_fk", t).onDelete("cascade"),
    index("shipping_methods_market_idx").on(t.storeId, t.marketCode, t.currency, t.position),
    check("shipping_methods_name", sql`char_length(${t.name}) between 1 and ${lit(NAME_MAX)} and ${t.name} = btrim(${t.name})`),
    check("shipping_methods_names", sql`jsonb_typeof(${t.names}) = 'object'`),
    check(
      "shipping_methods_estimate",
      sql`(${t.estimateMinDays} is null) = (${t.estimateMaxDays} is null) and (${t.estimateMinDays} is null or (${t.estimateMinDays} between 0 and ${t.estimateMaxDays} and ${t.estimateMaxDays} <= ${lit(ESTIMATE_DAYS_MAX)}))`,
    ),
    check("shipping_methods_free_over", sql`${t.freeOverMinor} is null or ${t.freeOverMinor} > 0`),
  ],
);

/**
 * What a method costs one profile's part of a basket in one zone (D237): `basis` `flat` (one row), `weight` (grams) or `value` (the part's
 * value as shown, in the market's minor units) with tiers from `min_value` (inclusive) to `max_value` (exclusive, null = and above). `zone_id`
 * null is Rest of country, `profile_id` null is General. The tiers of a group meet without gaps (trigger `shipping_rates_tiers`, at commit).
 */
export const shippingMethodRates = commerce.table(
  "shipping_method_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    methodId: uuid("method_id").notNull(),
    zoneId: uuid("zone_id"),
    profileId: uuid("profile_id"),
    basis: text("basis").notNull(),
    minValue: bigint("min_value", { mode: "number" }).notNull().default(0),
    maxValue: bigint("max_value", { mode: "number" }),
    amountMinor: money("amount_minor"),
  },
  (t) => [
    unique("shipping_method_rates_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "shipping_method_rates_method_fk",
      columns: [t.storeId, t.methodId],
      foreignColumns: [shippingMethods.storeId, shippingMethods.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shipping_method_rates_zone_fk",
      columns: [t.storeId, t.zoneId],
      foreignColumns: [shippingZones.storeId, shippingZones.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shipping_method_rates_profile_fk",
      columns: [t.storeId, t.profileId],
      foreignColumns: [shippingProfiles.storeId, shippingProfiles.id],
    }).onDelete("cascade"),
    index("shipping_method_rates_group_idx").on(t.storeId, t.methodId, t.zoneId, t.profileId),
    index("shipping_method_rates_zone_idx").on(t.storeId, t.zoneId),
    index("shipping_method_rates_profile_idx").on(t.storeId, t.profileId),
    check("shipping_method_rates_basis", sql`${t.basis} in ('flat', 'weight', 'value')`),
    check("shipping_method_rates_amount", sql`${t.amountMinor} >= 0`),
    check("shipping_method_rates_range", sql`${t.minValue} >= 0 and (${t.maxValue} is null or ${t.maxValue} > ${t.minValue})`),
    check("shipping_method_rates_flat", sql`${t.basis} <> 'flat' or (${t.minValue} = 0 and ${t.maxValue} is null)`),
  ],
);

/**
 * Collecting at one of the store's places (D237): a place of kind `shop` or `pickup` in the market's country (trigger), with a price (0 =
 * free, in the market's currency), the usual time to get an order ready (0 = no promise) and instructions (`instructions_t` by locale).
 */
export const pickupOptions = commerce.table(
  "pickup_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    locationId: uuid("location_id").notNull(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor").default(0),
    readyInHours: integer("ready_in_hours").notNull().default(0),
    instructions: text("instructions").notNull().default(""),
    instructionsT: jsonb("instructions_t").notNull().default({}),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("pickup_options_store_id_key").on(t.storeId, t.id),
    unique("pickup_options_location_key").on(t.storeId, t.locationId),
    foreignKey({
      name: "pickup_options_location_fk",
      columns: [t.storeId, t.locationId],
      foreignColumns: [storeLocations.storeId, storeLocations.id],
    }).onDelete("cascade"),
    marketRef("pickup_options_market_fk", t).onDelete("cascade"),
    index("pickup_options_market_idx").on(t.storeId, t.marketCode, t.currency),
    check("pickup_options_amount", sql`${t.amountMinor} >= 0`),
    check("pickup_options_ready", sql`${t.readyInHours} between 0 and ${lit(READY_HOURS_MAX)}`),
    check("pickup_options_instructions", sql`char_length(${t.instructions}) <= ${lit(INSTRUCTIONS_MAX)} and jsonb_typeof(${t.instructionsT}) = 'object'`),
  ],
);

/**
 * An area the store's own drivers deliver to (D237): by postal-code patterns (`postal`) or within a radius of a place (`radius`, measured
 * between postal-code centres of `postal_points`), with a price, an optional minimum basket and a free-above value (as shown, in the
 * market's currency). Several areas may cover a code: the cheapest for the basket is offered.
 */
export const localDeliveryAreas = commerce.table(
  "local_delivery_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    locationId: uuid("location_id"),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    name: text("name").notNull(),
    names: jsonb("names").notNull().default({}),
    kind: text("kind").notNull(),
    patterns: text("patterns").array().notNull().default(sql`'{}'::text[]`),
    radiusKm: numeric("radius_km", { precision: 5, scale: 1 }),
    amountMinor: money("amount_minor"),
    minBasketMinor: bigint("min_basket_minor", { mode: "number" }),
    freeOverMinor: bigint("free_over_minor", { mode: "number" }),
    info: text("info").notNull().default(""),
    infoT: jsonb("info_t").notNull().default({}),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("local_delivery_areas_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "local_delivery_areas_location_fk",
      columns: [t.storeId, t.locationId],
      foreignColumns: [storeLocations.storeId, storeLocations.id],
    }).onDelete("cascade"),
    marketRef("local_delivery_areas_market_fk", t).onDelete("cascade"),
    index("local_delivery_areas_market_idx").on(t.storeId, t.marketCode, t.currency),
    index("local_delivery_areas_location_idx").on(t.storeId, t.locationId),
    check("local_delivery_areas_name", sql`char_length(${t.name}) between 1 and ${lit(NAME_MAX)} and ${t.name} = btrim(${t.name})`),
    check("local_delivery_areas_texts", sql`jsonb_typeof(${t.names}) = 'object' and jsonb_typeof(${t.infoT}) = 'object' and char_length(${t.info}) <= ${lit(INFO_MAX)}`),
    check(
      "local_delivery_areas_kind",
      sql`(${t.kind} = 'postal' and cardinality(${t.patterns}) between 1 and ${lit(PATTERNS_MAX)} and ${t.radiusKm} is null)
        or (${t.kind} = 'radius' and ${t.locationId} is not null and cardinality(${t.patterns}) = 0 and ${t.radiusKm} between ${lit(RADIUS_KM_MIN)} and ${lit(RADIUS_KM_MAX)})`,
    ),
    check("local_delivery_areas_amounts", sql`${t.amountMinor} >= 0 and (${t.minBasketMinor} is null or ${t.minBasketMinor} > 0) and (${t.freeOverMinor} is null or ${t.freeOverMinor} > 0)`),
  ],
);

/**
 * Postal-code centres (D237, reference data): GeoNames' postal codes (CC BY 4.0, https://download.geonames.org/export/zip/), loaded by a
 * migration made once by `scripts/postal-points.mjs` for the countries listed there. `accuracy` is GeoNames' (1 estimated, 4 by geonameid,
 * 6 centroid of addresses or shape). Read by everyone, written only by migrations; no `store_id`.
 */
export const postalPoints = commerce.table(
  "postal_points",
  {
    country: char("country", { length: 2 }).notNull(),
    postalCode: text("postal_code").notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    accuracy: smallint("accuracy"),
  },
  (t) => [
    primaryKey({ columns: [t.country, t.postalCode] }),
    check("postal_points_position", sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`),
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
    /** The product's shipping profile (D237): the rates its part of a basket takes; null is General. Moved to General before a profile is deleted. */
    shippingProfileId: uuid("shipping_profile_id"),
    /**
     * A bundle's price (wave 6 unit D, D322): `fixed` (its variant's own prices) or `computed` (its components' prices less
     * `bundle_percent_off`, written by `commerce.refresh_bundle_prices()`); null for every other kind.
     */
    bundlePricing: text("bundle_pricing"),
    /** A computed bundle's whole percent off its components' sum, 0 to 90; null otherwise. */
    bundlePercentOff: integer("bundle_percent_off"),
    /**
     * The standard product taxonomy's category (wave 6 unit I, D327): Shopify's stable id (`aa-1-1`), apart from the store's own
     * categories and the tax code; null for none. Checked against the release by `standardProblems()` in `saveProduct()`.
     */
    standardCategory: text("standard_category"),
    /** The category's attributes' chosen values: an attribute id to its value ids (`{"1": [2503]}`); `{}` for none. */
    standardAttributes: jsonb("standard_attributes").notNull().default({}),
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
    check("products_kind", sql`${t.kind} in ('goods', 'appointment', 'stay', 'rental', 'gift_card', 'bundle')`),
    check(
      "products_bundle_pricing",
      sql`(${t.kind} = 'bundle') = (${t.bundlePricing} is not null) and (${t.bundlePricing} is null or ${t.bundlePricing} in ('fixed', 'computed'))
        and (${t.bundlePercentOff} is null) = (${t.bundlePricing} is distinct from 'computed') and (${t.bundlePercentOff} is null or ${t.bundlePercentOff} between 0 and 90)`,
    ),
    check("products_handle_format", sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("products_download_limit_positive", sql`${t.downloadLimit} > 0`),
    check("products_download_days_positive", sql`${t.downloadDays} > 0`),
    check("products_sold_by_measure_goods", sql`not ${t.soldByMeasure} or ${t.kind} = 'goods'`),
    foreignKey({
      name: "products_shipping_profile_fk",
      columns: [t.storeId, t.shippingProfileId],
      foreignColumns: [shippingProfiles.storeId, shippingProfiles.id],
    }),
    index("products_shipping_profile_idx").on(t.storeId, t.shippingProfileId),
    check("products_standard_category", sql`${t.standardCategory} ~ '^[a-z]{2}(-[0-9]+)*$'`),
    check("products_standard_attributes", sql`jsonb_typeof(${t.standardAttributes}) = 'object' and (${t.standardCategory} is not null or ${t.standardAttributes} = '{}'::jsonb)`),
    index("products_standard_category_idx").on(t.storeId, t.standardCategory),
    index("products_standard_attributes_idx").using("gin", t.standardAttributes.op("jsonb_path_ops")),
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
    /** A short text of its own for lists and content grids; empty uses the start of the description. */
    excerpt: text("excerpt").notNull().default(""),
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
    /** Sent on to a page by a search redirect (D324), so nothing was searched and none found. */
    redirected: boolean("redirected").notNull().default(false),
    /**
     * The day's visit of the same hashed visitor (D347), only while the store counts visits and never with a privacy signal: what ties a
     * search to the orders paid from that visit's carts after it. Gone with the visit.
     */
    visitId: uuid("visit_id").references((): AnyPgColumn => visits.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("search_queries_store_idx").on(t.storeId, t.createdAt),
    index("search_queries_visit_idx").on(t.visitId),
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
 * A store's search synonyms per language (wave 6 unit F1, D324, `docs/wave-6-catalogue.md` F.1): `both` (every word in `words` means the
 * others) or `one_way` (each of `words` also finds `means`). Words are kept as `normalizeQuery()` leaves them, checked by `synonymInput`.
 * Written only by `src/server/search-synonyms.ts`; read per search by `synonymsFor()`. Copied with the store.
 */
export const searchSynonyms = commerce.table(
  "search_synonyms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    /** One of the store's languages, as a market's `locale` (`nb-NO`, `en`). */
    locale: text("locale").notNull(),
    kind: text("kind").notNull(),
    words: text("words").array().notNull(),
    means: text("means").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("search_synonyms_store_idx").on(t.storeId, t.locale),
    check("search_synonyms_kind", sql`${t.kind} in ('both', 'one_way')`),
    check("search_synonyms_locale", sql`length(${t.locale}) between 2 and 20`),
    check(
      "search_synonyms_words",
      sql`case when ${t.kind} = 'both' then cardinality(${t.words}) between 2 and 20 and cardinality(${t.means}) = 0
        else cardinality(${t.words}) between 1 and 20 and cardinality(${t.means}) between 1 and 20 end`,
    ),
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

/**
 * How fast one page load was for a visitor (D336, `docs/analytics.md` "Speed"): the Core Web Vitals the speed beacon measured, with the
 * page's kind and the screen only. No address, visitor, IP address or user agent; written only by `src/server/analytics-speed.ts`, at
 * most `SPEED_SAMPLES_PER_STORE_DAY` a store day, deleted after `SPEED_KEEP_DAYS`.
 */
export const speedSamples = commerce.table(
  "speed_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    /** The store's calendar day the page was loaded on. */
    day: date("day").notNull(),
    /** `home`, `product`, `category`, `list` or `page` (`SPEED_KINDS`). */
    kind: text("kind").notNull(),
    /** `phone` or `computer`. */
    screen: text("screen").notNull(),
    lcpMs: integer("lcp_ms"),
    inpMs: integer("inp_ms"),
    /** Cumulative Layout Shift in thousandths. */
    clsMilli: integer("cls_milli"),
    ttfbMs: integer("ttfb_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("speed_samples_store_day_idx").on(t.storeId, t.day),
    check("speed_samples_kind", sql`${t.kind} in ('home', 'product', 'category', 'list', 'page')`),
    check("speed_samples_screen", sql`${t.screen} in ('phone', 'computer')`),
    check(
      "speed_samples_values",
      sql`coalesce(${t.lcpMs}, ${t.inpMs}, ${t.clsMilli}, ${t.ttfbMs}) is not null
        and (${t.lcpMs} is null or ${t.lcpMs} between 0 and 120000) and (${t.inpMs} is null or ${t.inpMs} between 0 and 60000)
        and (${t.clsMilli} is null or ${t.clsMilli} between 0 and 50000) and (${t.ttfbMs} is null or ${t.ttfbMs} between 0 and 120000)`,
    ),
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
    /**
     * A picture, a video or a 3D model (D325). `url` and `thumbnail_url` are always the item's picture (a video's or model's poster), so
     * every reader of a product's picture reads the first row's and needs no kind; only the gallery and the editor read these.
     */
    kind: text("kind").notNull().default("image"),
    /** A video's: `upload`, `youtube` or `vimeo`. */
    source: text("source"),
    /** A video's file or YouTube or Vimeo address, or a model's GLB file. */
    mediaUrl: text("media_url"),
  },
  (t) => [
    productRef("product_media_product_fk", t),
    index("product_media_product_idx").on(t.storeId, t.productId, t.position),
    check(
      "product_media_kind",
      sql`case ${t.kind}
        when 'image' then ${t.source} is null and ${t.mediaUrl} is null
        when 'video' then ${t.source} in ('upload', 'youtube', 'vimeo') and ${t.mediaUrl} is not null
        when 'model' then ${t.source} is null and ${t.mediaUrl} is not null
        else false end`,
    ),
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
    /**
     * How many at a time (wave 6 unit E, D323, `docs/wave-6-catalogue.md` E.1): a line holds at least `minQuantity`, at most `maxQuantity` (null: twenty
     * steps from the minimum, `lineMax()`) and whole `quantityStep`s, read only through `src/lib/quantity-rules.ts`. Goods and bundles only.
     */
    minQuantity: integer("min_quantity").notNull().default(1),
    maxQuantity: integer("max_quantity"),
    quantityStep: integer("quantity_step").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("product_variants_store_id_key").on(t.storeId, t.id),
    check("product_variants_quantity_rule", sql`${t.minQuantity} between 1 and 9999 and ${t.quantityStep} between 1 and 9999 and ${t.minQuantity} % ${t.quantityStep} = 0`),
    check(
      "product_variants_quantity_max",
      sql`${t.maxQuantity} is null or (${t.maxQuantity} between ${t.minQuantity} and 9999 and ${t.maxQuantity} % ${t.quantityStep} = 0)`,
    ),
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
 * What a bundle is made of (wave 6 unit D, D322): a component variant and how many of it go in one bundle. Keyed by the bundle's variant (a
 * bundle has one). A component is a goods variant delivered physically, of the bundle's store and VAT category, never a bundle's own; at most
 * 20 a bundle (the database's `bundle_components_rules()`); the count of units is the editor's rule.
 */
export const bundleComponents = commerce.table(
  "bundle_components",
  {
    storeId: storeId(),
    bundleVariantId: uuid("bundle_variant_id").notNull(),
    componentVariantId: uuid("component_variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "bundle_components_pkey", columns: [t.bundleVariantId, t.componentVariantId] }),
    foreignKey({ name: "bundle_components_bundle_fk", columns: [t.storeId, t.bundleVariantId], foreignColumns: [productVariants.storeId, productVariants.id] }).onDelete("cascade"),
    variantRef("bundle_components_component_fk", { storeId: t.storeId, variantId: t.componentVariantId }),
    index("bundle_components_bundle_idx").on(t.storeId, t.bundleVariantId),
    index("bundle_components_component_idx").on(t.storeId, t.componentVariantId),
    check("bundle_components_quantity", sql`${t.quantity} between 1 and 99`),
    check("bundle_components_not_itself", sql`${t.bundleVariantId} <> ${t.componentVariantId}`),
  ],
);

/**
 * A product's price breaks (wave 6 unit E2, D323, `docs/wave-6-catalogue.md` E.2): from `fromQuantity` units in one line, a whole `percent` off the
 * market price or `amounts`, a unit price per market code with VAT in the country's own currency (as `prices` keeps them), for one variant or every
 * variant (`variantId` null). A line's price is only `commerce.line_price()`. At most 10 a product (`price_breaks_rules()`).
 */
export const priceBreaks = commerce.table(
  "price_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    fromQuantity: integer("from_quantity").notNull(),
    percent: integer("percent"),
    amounts: jsonb("amounts").$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("price_breaks_store_id_key").on(t.storeId, t.id),
    unique("price_breaks_step_key").on(t.productId, t.variantId, t.fromQuantity).nullsNotDistinct(),
    productRef("price_breaks_product_fk", t),
    variantRef("price_breaks_variant_fk", { storeId: t.storeId, variantId: t.variantId }).onDelete("cascade"),
    index("price_breaks_product_idx").on(t.storeId, t.productId),
    index("price_breaks_variant_idx").on(t.storeId, t.variantId),
    check("price_breaks_from", sql`${t.fromQuantity} between 2 and 9999`),
    check("price_breaks_percent", sql`${t.percent} between 1 and 99`),
    check("price_breaks_one", sql`(${t.percent} is null) <> (${t.amounts} is null)`),
  ],
);

/**
 * What a store does not sell in one of its countries (wave 7 unit A1, D335, `docs/wave-7-storefront.md` A.1): a row with no variant switches the
 * whole product off in that market, a row with one switches that variant off; no row means sold, while it has a price there. The price is kept
 * (`commerce.prices` is never touched): `commerce.current_prices` leaves out a variant that is off in a market, so every shopper-facing read
 * treats it as not sold there, and the admin's own price reads use `commerce.kept_prices`. Written only by `saveProduct()`
 * (`writeAvailability()` in `src/server/products.ts`).
 */
/**
 * A product's description for one country, over its language's (D338, `docs/wave-7-storefront.md` D1): a German text for Austria beside the one
 * for Germany. Written only by `saveProduct()`; read by the product page and its structured data in that country, the language's text otherwise.
 * The title stays the language's everywhere (carts, orders, invoices, feeds and search name a product one way).
 */
export const productMarketTexts = commerce.table(
  "product_market_texts",
  {
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    locale: text("locale").notNull(),
    description: text("description").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.marketCode, t.locale] }),
    productRef("product_market_texts_product_fk", t),
    foreignKey({
      name: "product_market_texts_market_fk",
      columns: [t.storeId, t.marketCode],
      foreignColumns: [markets.storeId, markets.code],
    }).onDelete("cascade"),
    index("product_market_texts_market_idx").on(t.storeId, t.marketCode),
    // The product foreign key (store, product) has a covering index of its own (the advisors, 2026-10-27).
    index("product_market_texts_product_idx").on(t.storeId, t.productId),
    check("product_market_texts_description", sql`length(${t.description}) between 1 and 20000`),
  ],
);

export const marketAvailability = commerce.table(
  "market_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id"),
    marketCode: char("market_code", { length: 2 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("market_availability_key").on(t.productId, t.variantId, t.marketCode).nullsNotDistinct(),
    productRef("market_availability_product_fk", t),
    variantRef("market_availability_variant_fk", { storeId: t.storeId, variantId: t.variantId }).onDelete("cascade"),
    foreignKey({
      name: "market_availability_market_fk",
      columns: [t.storeId, t.marketCode],
      foreignColumns: [markets.storeId, markets.code],
    }).onDelete("cascade"),
    index("market_availability_product_idx").on(t.storeId, t.productId, t.marketCode),
  ],
);

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
    /** Product categories and tags it reaches (a category the ones under it too), beside `product_ids` (D299 E1). */
    termIds: jsonb("term_ids").notNull().default([]),
    /** The least number of units of what it reaches, bought once; null for none. */
    minQuantity: integer("min_quantity"),
    /** Only signed-in customers in one of these customer groups, or one of these named customers; none of either for everyone. */
    tierIds: jsonb("tier_ids").notNull().default([]),
    customerIds: jsonb("customer_ids").notNull().default([]),
    /** Its own text is a name only: shoppers use its generated single-use codes (`discount_code_items`). */
    uniqueCodes: boolean("unique_codes").notNull().default(false),
    /** The classes of other codes it may be used with on one order (D299 E2: `products`, `order`, `shipping`); empty, alone. */
    combinesWith: jsonb("combines_with").notNull().default([]),
    /** Whether it may be used on an order a campaign also reduces (D367); off, the basket takes whichever gives the shopper more. */
    combinesWithCampaigns: boolean("combines_with_campaigns").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("discount_codes_store_id_key").on(t.storeId, t.id),
    check(
      "discount_codes_combines_with",
      sql`jsonb_typeof(${t.combinesWith}) = 'array' and ${t.combinesWith} <@ '["products", "order", "shipping"]'::jsonb`,
    ),
    check("discount_codes_min_quantity", sql`${t.minQuantity} is null or ${t.minQuantity} between 1 and 1000`),
    check("discount_codes_term_ids", sql`jsonb_typeof(${t.termIds}) = 'array'`),
    check("discount_codes_tier_ids", sql`jsonb_typeof(${t.tierIds}) = 'array'`),
    check("discount_codes_customer_ids", sql`jsonb_typeof(${t.customerIds}) = 'array' and jsonb_array_length(${t.customerIds}) <= 100`),
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
 * A code's generated single-use codes (D299 E1, `docs/wave-5-marketing.md` 7.1): each works once, on an order not cancelled or copied; its text
 * is unique across the store's codes and generated codes (a trigger). Deleted with its code; an order keeps the text it used. Not personal.
 */
export const discountCodeItems = commerce.table(
  "discount_code_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    discountId: uuid("discount_id").notNull(),
    /** In capitals. */
    code: text("code").notNull(),
    batch: integer("batch").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("discount_code_items_store_id_key").on(t.storeId, t.id),
    unique("discount_code_items_store_code_key").on(t.storeId, t.code),
    index("discount_code_items_discount_idx").on(t.storeId, t.discountId, t.batch),
    foreignKey({
      name: "discount_code_items_discount_fk",
      columns: [t.storeId, t.discountId],
      foreignColumns: [discountCodes.storeId, discountCodes.id],
    }).onDelete("cascade"),
    check("discount_code_items_batch", sql`${t.batch} > 0`),
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

/**
 * An owner's own kinds of entries (wave 6 unit H, D326): a store's, or Kaizena Flow's own site's (`store_id` null). `fields` are custom
 * field definitions (`FieldDef[]`, checked by `contentTypeInput`); `key` is made once and never changes, so fields and grids naming a
 * type survive a store's copy. Written only by `src/server/content-types.ts`.
 */
export const contentTypes = commerce.table(
  "content_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own site. */
    storeId: uuid("store_id").references(() => stores.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** The address part of its entries' pages; fixed once an entry of it has been published. */
    slug: text("slug").notNull(),
    fields: jsonb("fields").notNull().default([]),
    titleField: text("title_field").notNull(),
    summaryField: text("summary_field"),
    pictureField: text("picture_field"),
    hasPages: boolean("has_pages").notNull().default(false),
    /** The page its entries are drawn with (an `entry_layout`, H2); null: the standard view. */
    layoutId: uuid("layout_id").references(() => pages.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("content_types_store_key_key").on(t.storeId, t.key).nullsNotDistinct(),
    unique("content_types_store_slug_key").on(t.storeId, t.slug).nullsNotDistinct(),
    index("content_types_layout_idx").on(t.layoutId),
    index("content_types_updated_by_idx").on(t.updatedBy),
    check("content_types_key", sql`${t.key} ~ '^t_[0-9a-f]{12}$'`),
    check("content_types_name", sql`length(trim(${t.name})) between 1 and 80`),
    check("content_types_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 60`),
    check("content_types_fields", sql`jsonb_typeof(${t.fields}) = 'array'`),
    check("content_types_title_field", sql`${t.titleField} ~ '^f_[a-z0-9]{6,24}$'`),
    check("content_types_position", sql`${t.position} between 0 and 1000`),
  ],
);

/**
 * The entries of a content type (D326): a draft and, once published, what the site shows (`EntryContent`: the values as custom fields
 * keep them, and the search texts per language). Written only by `src/server/content-entries.ts`; its owner is its type's.
 */
export const contentEntries = commerce.table(
  "content_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id),
    typeId: uuid("type_id")
      .notNull()
      .references(() => contentTypes.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    draft: jsonb("draft").notNull(),
    published: jsonb("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("content_entries_type_slug_key").on(t.typeId, t.slug),
    index("content_entries_store_type_idx").on(t.storeId, t.typeId, t.position),
    index("content_entries_created_by_idx").on(t.createdBy),
    index("content_entries_updated_by_idx").on(t.updatedBy),
    check("content_entries_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 120 and ${t.slug} <> 'ab'`),
    check("content_entries_draft", sql`jsonb_typeof(${t.draft}) = 'object'`),
    check("content_entries_published", sql`(${t.published} is null) = (${t.publishedAt} is null)`),
    check("content_entries_position", sql`${t.position} >= 0`),
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
    /** What an `amount` campaign takes off, per market in the country's own currency (D299 E3). */
    amounts: jsonb("amounts").notNull().default({}),
    /** What a `tiered` campaign's steps count: units (`quantity`) or what the lines come to (`spend`). */
    tierBasis: text("tier_basis"),
    /** A `tiered` campaign's steps: `[{ quantity, percent }]` or `[{ amounts: { market: minor }, percent }]`, two to five. */
    tiers: jsonb("tiers").notNull().default([]),
    /** Buy X get Y (D299 E4): what one use asks of the buy set (`product_ids`, `term_ids`): units, or an amount per market. */
    buyMinQuantity: integer("buy_min_quantity"),
    buyMinAmounts: jsonb("buy_min_amounts").notNull().default({}),
    /** The get set; both empty: the same as the buy set. */
    getProductIds: jsonb("get_product_ids").notNull().default([]),
    getTermIds: jsonb("get_term_ids").notNull().default([]),
    /** Units given per use, and what each gets: `free`, `percent` (`get_percent`) or an amount per market (`get_amounts`). */
    getQuantity: integer("get_quantity").notNull().default(0),
    getKind: text("get_kind"),
    getPercent: integer("get_percent"),
    getAmounts: jsonb("get_amounts").notNull().default({}),
    /** How many times one order may use it; null: as often as the basket allows. */
    usesPerOrder: integer("uses_per_order"),
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
    /** Whether a discount code may be used on an order it reduces (D367); off, the basket takes whichever gives the shopper more. */
    combinesWithCodes: boolean("combines_with_codes").notNull().default(true),
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
    check("campaigns_kind", sql`${t.kind} in ('percent', 'multi_buy', 'gift', 'amount', 'free_shipping', 'tiered', 'bxgy')`),
    check(
      "campaigns_bxgy",
      sql`coalesce(jsonb_typeof(${t.buyMinAmounts}) = 'object' and jsonb_typeof(${t.getProductIds}) = 'array' and jsonb_typeof(${t.getTermIds}) = 'array' and jsonb_typeof(${t.getAmounts}) = 'object' and (
        (${t.kind} = 'bxgy'
          and ((${t.buyMinQuantity} between 1 and 100 and ${t.buyMinAmounts} = '{}'::jsonb) or (${t.buyMinQuantity} is null and ${t.buyMinAmounts} <> '{}'::jsonb))
          and ${t.getQuantity} between 1 and 20
          and ((${t.getKind} = 'free' and ${t.getPercent} is null and ${t.getAmounts} = '{}'::jsonb)
            or (${t.getKind} = 'percent' and ${t.getPercent} between 1 and 100 and ${t.getAmounts} = '{}'::jsonb)
            or (${t.getKind} = 'amount' and ${t.getPercent} is null and ${t.getAmounts} <> '{}'::jsonb))
          and (${t.usesPerOrder} is null or ${t.usesPerOrder} between 1 and 100))
        or (${t.kind} <> 'bxgy' and ${t.buyMinQuantity} is null and ${t.buyMinAmounts} = '{}'::jsonb and ${t.getProductIds} = '[]'::jsonb
          and ${t.getTermIds} = '[]'::jsonb and ${t.getQuantity} = 0 and ${t.getKind} is null and ${t.getPercent} is null
          and ${t.getAmounts} = '{}'::jsonb and ${t.usesPerOrder} is null)), false)`,
    ),
    check("campaigns_amounts", sql`jsonb_typeof(${t.amounts}) = 'object' and (${t.kind} = 'amount' or ${t.amounts} = '{}'::jsonb)`),
    check(
      "campaigns_tiers",
      sql`jsonb_typeof(${t.tiers}) = 'array' and ((${t.kind} = 'tiered' and ${t.tierBasis} in ('quantity', 'spend') and jsonb_array_length(${t.tiers}) between 2 and 5) or (${t.kind} <> 'tiered' and ${t.tierBasis} is null and ${t.tiers} = '[]'::jsonb))`,
    ),
    check("campaigns_percent", sql`(${t.kind} = 'percent' and ${t.percent} between 1 and 100) or (${t.kind} <> 'percent' and ${t.percent} = 0)`),
    check(
      "campaigns_multi_buy",
      sql`(${t.kind} = 'multi_buy' and ${t.buyQuantity} between 2 and 20 and ${t.payQuantity} between 1 and ${t.buyQuantity} - 1) or (${t.kind} <> 'multi_buy' and ${t.buyQuantity} = 0 and ${t.payQuantity} = 0)`,
    ),
    check("campaigns_gift", sql`(${t.kind} = 'gift' and ${t.giftVariantId} is not null and ${t.giftQuantity} between 1 and 5) or (${t.kind} <> 'gift' and ${t.giftVariantId} is null)`),
    check("campaigns_usage_limit", sql`${t.usageLimit} is null or ${t.usageLimit} > 0`),
    check("campaigns_per_customer_limit", sql`${t.perCustomerLimit} is null or ${t.perCustomerLimit} > 0`),
    check("campaigns_stacks", sql`not ${t.stacks} or ${t.kind} in ('percent', 'multi_buy', 'tiered')`),
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
 * A market whose prices are worked out from another's (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2): each variant's price in the base
 * market, its VAT taken off and the market's put back (`basis` `net`) or kept as it is (`gross`), converted at the store's rates, changed by
 * `percentBps` and rounded to `roundToMinor` (and, with `endingMinor`, up to the next price with that ending). Worked out only by `derivedPrice()`
 * and written only by `src/server/market-prices.ts` through `commerce.set_price`, as `prices.derived`; a price typed by hand is fixed and kept.
 * A base market has no rule of its own (`market_price_rules_rules()`), so rules never chain.
 */
export const marketPriceRules = commerce.table(
  "market_price_rules",
  {
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    baseMarket: char("base_market", { length: 2 }).notNull(),
    percentBps: integer("percent_bps").notNull().default(0),
    basis: text("basis").notNull().default("net"),
    roundToMinor: integer("round_to_minor").notNull().default(1),
    endingMinor: integer("ending_minor"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "market_price_rules_pkey", columns: [t.storeId, t.marketCode] }),
    foreignKey({ name: "market_price_rules_market_fk", columns: [t.storeId, t.marketCode], foreignColumns: [markets.storeId, markets.code] }).onDelete("cascade"),
    foreignKey({ name: "market_price_rules_base_fk", columns: [t.storeId, t.baseMarket], foreignColumns: [markets.storeId, markets.code] }).onDelete("cascade"),
    check("market_price_rules_not_itself", sql`${t.marketCode} <> ${t.baseMarket}`),
    check("market_price_rules_percent", sql`${t.percentBps} between -9000 and 100000`),
    check("market_price_rules_basis", sql`${t.basis} in ('net', 'gross')`),
    check("market_price_rules_round", sql`${t.roundToMinor} between 1 and 100000`),
    check("market_price_rules_ending", sql`${t.endingMinor} is null or (${t.endingMinor} >= 0 and ${t.endingMinor} < ${t.roundToMinor})`),
  ],
);

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
    /** Written by a market price rule (D335 A.2, `src/server/market-prices.ts`); false for a price an owner typed, which the rule never overrides. */
    derived: boolean("derived").notNull().default(false),
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
 * market, e.g. a packaging or electrical-equipment registration number
 * (D342): written only by `src/server/producer-registrations.ts`. A row with
 * an `exemption` says, in the owner's words, why no registration is needed
 * there (no scheme in that country, below its threshold) and has no number.
 * `show_number` puts the number on the market's product pages.
 */
export const producerRegistrations = commerce.table(
  "producer_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    scheme: producerScheme("scheme").notNull(),
    registrationNumber: text("registration_number"),
    authority: text("authority"),
    exemption: text("exemption"),
    showNumber: boolean("show_number").notNull().default(false),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    // A registration has its number and authority; an exemption has its reason and no number.
    check(
      "producer_registrations_number_or_exemption",
      sql`(${t.exemption} is null and ${t.registrationNumber} is not null and ${t.authority} is not null) or (${t.exemption} is not null and ${t.registrationNumber} is null)`,
    ),
  ],
);

/**
 * The platform's duty rates (wave 7 unit I, D343, decision 2 of `docs/wave-7-storefront.md`): kept by hand by platform admins at
 * `/admin/platform/duty-rates`, written only by `src/server/duty-rates.ts` (audited), read only by `src/server/customs.ts`. Reference data, no store.
 *
 * A row is for a destination (an ISO country, or `EU` for every member state) and an HS heading prefix (digits; `''` is the destination's base row):
 * - the base row holds what applies to a whole consignment: the duty threshold (`threshold_minor` in `threshold_currency`, at or below which no
 *   duty is due, per consignment or per item), the import VAT threshold (`vat_threshold_minor`: at or below it VAT is collected at the sale, not at
 *   the border), a fixed duty per distinct tariff sub-heading under the threshold (`per_item_minor`, the EU's 3 EUR from 1 July 2026), whether the
 *   shipping is part of the customs value, the import VAT rate where it differs from the goods' own (`import_vat_bps`), and optionally a default
 *   rate for headings not listed;
 * - a heading row holds the duty rate for goods whose HS code starts with its prefix, optionally only for an origin (a country or `EU`).
 * `applies_to` limits a row to consignments whose VAT is collected at the sale under the destination's scheme (`scheme`: IOSS into the EU, VOEC
 * into Norway) or not (`no_scheme`). Every row cites its source; `verified` is set only by a person who checked it. Rates are estimates.
 */
export const dutyRates = commerce.table(
  "duty_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    destination: text("destination").notNull(),
    hsPrefix: text("hs_prefix").notNull().default(""),
    origin: text("origin"),
    appliesTo: text("applies_to").notNull().default("any"),
    /** Basis points of the customs value (1250 = 12.5 %); null on a base row that states no default rate. */
    dutyRateBps: integer("duty_rate_bps"),
    perItemMinor: bigint("per_item_minor", { mode: "number" }),
    thresholdMinor: bigint("threshold_minor", { mode: "number" }),
    vatThresholdMinor: bigint("vat_threshold_minor", { mode: "number" }),
    thresholdCurrency: char("threshold_currency", { length: 3 }),
    thresholdPer: text("threshold_per").notNull().default("consignment"),
    importVatBps: integer("import_vat_bps"),
    shippingInValue: boolean("shipping_in_value").notNull().default(true),
    source: text("source").notNull(),
    note: text("note").notNull().default(""),
    checkedOn: date("checked_on").notNull(),
    verified: boolean("verified").notNull().default(false),
    validFrom: date("valid_from"),
    /** The last day the row applies (inclusive); null while it has no end. */
    validTo: date("valid_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("duty_rates_destination_idx").on(t.destination, t.hsPrefix),
    index("duty_rates_updated_by_idx").on(t.updatedBy),
    check("duty_rates_destination", sql`${t.destination} ~ '^[A-Z]{2}$'`),
    check("duty_rates_prefix", sql`${t.hsPrefix} ~ '^[0-9]{0,10}$'`),
    check("duty_rates_origin", sql`${t.origin} is null or ${t.origin} ~ '^[A-Z]{2}$'`),
    check("duty_rates_applies_to", sql`${t.appliesTo} in ('any', 'scheme', 'no_scheme')`),
    check("duty_rates_rate", sql`${t.dutyRateBps} is null or ${t.dutyRateBps} between 0 and 100000`),
    check("duty_rates_import_vat", sql`${t.importVatBps} is null or ${t.importVatBps} between 0 and 10000`),
    check("duty_rates_threshold_per", sql`${t.thresholdPer} in ('consignment', 'item')`),
    check(
      "duty_rates_amounts",
      sql`(${t.thresholdMinor} is null or ${t.thresholdMinor} >= 0) and (${t.vatThresholdMinor} is null or ${t.vatThresholdMinor} >= 0) and (${t.perItemMinor} is null or ${t.perItemMinor} >= 0)`,
    ),
    // An amount needs its currency; a heading row carries a rate and nothing of the consignment's.
    check(
      "duty_rates_currency",
      sql`(${t.thresholdMinor} is null and ${t.vatThresholdMinor} is null and ${t.perItemMinor} is null) or (${t.thresholdCurrency} is not null and ${t.thresholdCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "duty_rates_heading_row",
      sql`${t.hsPrefix} = '' or (${t.dutyRateBps} is not null and ${t.thresholdMinor} is null and ${t.vatThresholdMinor} is null and ${t.perItemMinor} is null)`,
    ),
    check("duty_rates_base_origin", sql`${t.hsPrefix} <> '' or ${t.origin} is null`),
    check("duty_rates_source", sql`${t.source} ~ '^https://' and length(${t.source}) <= 400`),
    check("duty_rates_period", sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

/**
 * A store's customs choice per country (wave 7 unit I, D343): `dap` (the default: the carrier collects duties and import VAT from the recipient)
 * or `ddp` (collected at checkout, a payment beside the order's total), and whether the store is registered to collect that country's VAT at the
 * sale under its scheme (`vat_scheme`: VOEC in Norway; into the EU, IOSS is read from the tax profile). Written only by `src/server/customs.ts`
 * (`settings:write`); no row is DAP. Never copied (`COPY_RULES` `never`): a registration is the company's.
 */
export const customsSettings = commerce.table(
  "customs_settings",
  {
    storeId: storeId(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    mode: text("mode").notNull().default("dap"),
    vatScheme: boolean("vat_scheme").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.marketCode] }),
    foreignKey({
      name: "customs_settings_market_fk",
      columns: [t.storeId, t.marketCode],
      foreignColumns: [markets.storeId, markets.code],
    }),
    check("customs_settings_mode", sql`${t.mode} in ('dap', 'ddp')`),
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
    /** Payment terms (D293): its members may buy now and pay within `net_15`, `net_30` or `net_60` days; null pays at once. Staff set it. */
    paymentTerms: text("payment_terms"),
    /** The most it may owe on terms at once (D293), in `credit_currency` (the store's main currency when it was set); null is no limit. */
    creditLimitMinor: bigint("credit_limit_minor", { mode: "number" }),
    creditCurrency: char("credit_currency", { length: 3 }),
    /** Buying rules (D321 C.2): a PO number on every order, and the most an orderer's order may come to before it waits for an approver (null: no limit). */
    poRequired: boolean("po_required").notNull().default(false),
    approvalLimitMinor: bigint("approval_limit_minor", { mode: "number" }),
    approvalCurrency: char("approval_currency", { length: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_companies_store_id_key").on(t.storeId, t.id),
    check("customer_companies_terms", sql`${t.paymentTerms} is null or ${t.paymentTerms} in (${sqlList(PAYMENT_TERMS)})`),
    check(
      "customer_companies_credit",
      sql`(${t.creditLimitMinor} is null) = (${t.creditCurrency} is null) and (${t.creditLimitMinor} is null or ${t.creditLimitMinor} >= 0)`,
    ),
    check(
      "customer_companies_approval",
      sql`(${t.approvalLimitMinor} is null) = (${t.approvalCurrency} is null) and (${t.approvalLimitMinor} is null or ${t.approvalLimitMinor} > 0)`,
    ),
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
    /** The discount code the shopper entered (D31), checked again at checkout; the first of them since D299 E2. */
    discountCode: text("discount_code"),
    /** The codes entered after the first (D299 E2), in the order typed; five in all at most. */
    moreCodes: text("more_codes").array().notNull().default(sql`'{}'::text[]`),
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
     * The store's own delivery the shopper chose (D237): a shipping method, a pickup option or a local delivery area; at most one of these and
     * `delivery_quote_id` (`carts_one_delivery`). Plain foreign keys on the id, cleared when the thing goes. `delivery_postal_code` is the postal
     * code the shopper typed for pricing (written only by `setDeliveryPostalCode()` after `cleanPostalCode()`); `delivery_note` the note for the
     * driver of a local delivery (cleaned by `cleanShopperText()`, cleared with the area).
     */
    shippingMethodId: uuid("shipping_method_id").references((): AnyPgColumn => shippingMethods.id, { onDelete: "set null" }),
    pickupOptionId: uuid("pickup_option_id").references((): AnyPgColumn => pickupOptions.id, { onDelete: "set null" }),
    localAreaId: uuid("local_area_id").references((): AnyPgColumn => localDeliveryAreas.id, { onDelete: "set null" }),
    deliveryPostalCode: text("delivery_postal_code"),
    deliveryNote: text("delivery_note"),
    /**
     * The visitor-day that made the cart (D152, only while the store counts visits), which is how a paid order knows
     * its channel and device. The visit is deleted after 25 months; the cart then keeps nothing.
     */
    visitId: uuid("visit_id").references((): AnyPgColumn => visits.id, { onDelete: "set null" }),
    /** When the shopper allowed marketing while this cart was open (D303 I2), and the ad platforms' ids then (`cleanAdSignals()`); null without. */
    adConsentAt: timestamp("ad_consent_at", { withTimezone: true }),
    adSignals: jsonb("ad_signals"),
    /**
     * A cart made on another site (D170, the WordPress plugin) is opened here by a one-time link: the hash of its secret, when it
     * runs out, and where it goes (the cart or the checkout). The link sets the browser's cart cookie once and is then cleared.
     */
    handoffHash: text("handoff_hash"),
    handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }),
    handoffTo: text("handoff_to"),
    /** Where a cart was made when not by a shopper in the store (D353): `agent`, a shopping agent's `create_cart`. Its order counts as AI agents'. */
    source: text("source"),
    /**
     * A gift message (wave 3, run 2, D173): the shopper marks the order as a gift and may write a name, a sender and a message
     * (`src/lib/gift.ts` cleans them and refuses a text over the limit; only when the store's `order_settings.gift_messages` is on).
     * Copied to the order when it is placed, cleared with the cart. Never sent to anyone but the buyer.
     */
    isGift: boolean("is_gift").notNull().default(false),
    giftTo: text("gift_to"),
    giftFrom: text("gift_from"),
    giftMessage: text("gift_message"),
    /** A company member's purchase (D321 C.2): the location the order is for and the PO number, checked again by `placeOrder()`. */
    companyLocationId: uuid("company_location_id"),
    poNumber: text("po_number"),
    /** The shopper's answers to the store's checkout fields (D357), as checked by `cleanAnswers()`; copied to the order by `placeOrder()`. */
    checkoutAnswers: jsonb("checkout_answers"),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("carts_store_id_key").on(t.storeId, t.id),
    uniqueIndex("carts_handoff_idx").on(t.handoffHash),
    check("carts_handoff_to", sql`${t.handoffTo} is null or ${t.handoffTo} in ('cart', 'checkout')`),
    check("carts_source", sql`${t.source} is null or ${t.source} in ('agent')`),
    check("carts_gift_fields", giftFieldsCheck(t)),
    check("carts_bonus_request", sql`${t.bonusRequestMinor} >= 0`),
    check("carts_po_number", sql`${t.poNumber} is null or char_length(${t.poNumber}) between 1 and 40`),
    check(
      "carts_one_delivery",
      sql`num_nonnulls(${t.deliveryQuoteId}, ${t.shippingMethodId}, ${t.pickupOptionId}, ${t.localAreaId}) <= 1`,
    ),
    check("carts_delivery_postal_code", sql`${t.deliveryPostalCode} is null or ${t.deliveryPostalCode} ~ '^[A-Z0-9-]{3,12}$'`),
    check(
      "carts_delivery_note",
      sql`${t.deliveryNote} is null or (${t.localAreaId} is not null and char_length(${t.deliveryNote}) between 1 and ${lit(NOTE_MAX)})`,
    ),
    index("carts_shipping_method_idx").on(t.shippingMethodId),
    index("carts_pickup_option_idx").on(t.pickupOptionId),
    index("carts_local_area_idx").on(t.localAreaId),
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
    /**
     * A gift card sent to someone (D300 F2): its recipient, sender, message and day, and the key those make (`giftCardKey()`), so two cards of
     * one amount for two people are two lines; all null for anything else, or a card the buyer keeps.
     */
    giftCardKey: text("gift_card_key"),
    giftCardTo: text("gift_card_to"),
    giftCardToName: text("gift_card_to_name"),
    giftCardFrom: text("gift_card_from"),
    giftCardMessage: text("gift_card_message"),
    giftCardSendOn: date("gift_card_send_on"),
  },
  (t) => [
    unique("cart_lines_cart_variant_plan_key")
      .on(t.cartId, t.variantId, t.sellingPlanId, t.startsAt, t.giftCardKey)
      .nullsNotDistinct(),
    check(
      "cart_lines_gift_card",
      sql`(${t.giftCardKey} is null) = (${t.giftCardTo} is null) and ${giftCardFieldsCheck({ to: t.giftCardTo, toName: t.giftCardToName, from: t.giftCardFrom, message: t.giftCardMessage, sendOn: t.giftCardSendOn })}`,
    ),
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
    /** Copied from its cart when the order is made (D303 I2, trigger `orders_ad_consent()`), set once; the ids are cleared 90 days after the purchase was sent. */
    adConsentAt: timestamp("ad_consent_at", { withTimezone: true }),
    adSignals: jsonb("ad_signals"),
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
    /** The campaign that made the order's shipping free (D299 E3): `{ id, name, minor }`, part of `campaign_discount_minor`; null without. */
    campaignShipping: jsonb("campaign_shipping"),
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
    /** The generated single-use code used (D299 E1); its text is in `discount_code`. No foreign key: a deleted code's orders keep the text. */
    discountCodeItemId: uuid("discount_code_item_id"),
    /** Every code the cart held when the order was placed (D299 E2), so a changed cart is told from what was entered, not what applied. */
    enteredCodes: text("entered_codes").array(),
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
     * A company's purchase (D321 C.2): the location it is for (no foreign key: a location may go once no order waits at it), the buyer's PO number
     * (at most 40 characters, on its invoice and credit notes) and its approval (`waiting`, `approved`, `declined`; null for an order that needed
     * none), all kept as placed (`orders_company_purchase()`), the approval moving only from waiting.
     */
    companyLocationId: uuid("company_location_id"),
    poNumber: text("po_number"),
    approval: text("approval"),
    approvalDecidedBy: uuid("approval_decided_by"),
    approvalDecidedAt: timestamp("approval_decided_at", { withTimezone: true }),
    /**
     * When staff last applied a change to the order's goods (wave 3 run 3, D174, `order_edits`): the list's *Edited* badge. Written only under the edit context
     * (`kaizen.order_edit`, `applyOrderEdit()`); the money columns above change after `pending_payment` only there too (`orders_settled_guard()`).
     */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /**
     * How the goods reach the buyer (D237): `ship` (the flat rate, a shipping method or a carrier's service: a parcel), `pickup` (collected at
     * `pickup_location_id`, a place of the store; no foreign key, the place may go once nothing waits for it) or `local` (the store's own driver).
     * Frozen with `delivery` and `pickup_location_id` once the order leaves `pending_payment` (`orders_delivery_frozen()`).
     */
    deliveryMethod: text("delivery_method").notNull().default("ship"),
    pickupLocationId: uuid("pickup_location_id"),
    /** When staff marked a pickup order ready (`markReadyForPickup()`, which emails the buyer once). */
    readyForPickupAt: timestamp("ready_for_pickup_at", { withTimezone: true }),
    /** The buyer's note for the driver of a local delivery (personal data: null when the order is anonymised). */
    deliveryNote: text("delivery_note"),
    /** When the address Stripe collected turned out to have another postal code than the one the delivery was priced for (flag for staff only). */
    deliveryMismatchAt: timestamp("delivery_mismatch_at", { withTimezone: true }),
    /**
     * Who set `delivered_at` (wave 3, D238, `docs/wave-3-notifications.md` 3.1): `staff` (*Mark delivered*), `handover` (*Collected*, the local driver's
     * *Delivered*) or `carrier` (a verified delivered event, written only by `commerce.record_carrier_delivery()`). Cleared with the date. Rows from before
     * the column keep a null source with a date, read as `staff`.
     */
    deliveredSource: text("delivered_source"),
    /**
     * A fulfilment hold (D238 3.1, 4.9): while set, nothing of the order can be sent or handed over (`commerce.shipments_not_held()`). Put by a rule
     * (`held_by_rule`, no foreign key: a deleted rule leaves its id) or a person (`held_by`); the reason is at most 200 characters (a person's is replaced by
     * the marker when the order is anonymised). Written only by `src/server/order-hold.ts`.
     */
/**
     * Authorise now, capture later (D289): the later capture the order was checked out under (`when_sent`, `by_hand`; null: captured at checkout),
     * and while it is `authorized`, when Stripe lets the hold go (`capture_before`). Staff are told a day ahead (`capture_warned_at`).
     */
    captureMode: text("capture_mode"),
    captureBefore: timestamp("capture_before", { withTimezone: true }),
    captureWarnedAt: timestamp("capture_warned_at", { withTimezone: true }),
    /**
     * The shopper finished paying with a bank method whose money arrives days later (SEPA Direct Debit, D291): the order waits for the bank,
     * `pending_payment` with its stock held (`commerce.await_bank_payment()`), until Stripe says the payment succeeded or failed.
     */
    awaitingBankSince: timestamp("awaiting_bank_since", { withTimezone: true }),
    /**
     * Customs and duties (wave 7 unit I, D343, `src/lib/duties.ts`, `src/server/customs.ts`): what the shopper paid at checkout for duties and import VAT
     * (DDP, the store's choice for the market), in the order's currency. Outside `total_minor` (the goods, shipping and their VAT, which the invoice
     * and every sales figure read): the payment taken is the total plus this. 0 when nothing was collected (DAP, or no border crossed).
     */
    dutiesMinor: money("duties_minor").default(0),
    /**
     * What the order says about customs as it was placed (`OrderCustoms`, `src/lib/duties.ts`): who pays duties and import VAT (`ddp`: paid at
     * checkout; `dap`: the recipient pays the carrier on delivery), the estimate with its sources and whether every rate was verified, or why there
     * is none. Null when the goods cross no customs border. Kept as placed; never copied.
     */
    customs: jsonb("customs"),
    /**
     * The answers to the store's checkout fields as placed (D357, `CheckoutAnswer[]`: the question in the store's main words and the answer), shown to
     * staff and in the order's export; null when the store asked none. Cleared when the order is anonymised.
     */
    checkoutAnswers: jsonb("checkout_answers"),
    /** The payment methods a checkout rule left out for this order (D357), passed to Stripe with the owner's own choices; never cards. */
    ruleHiddenMethods: text("rule_hidden_methods").array().notNull().default(sql`'{}'::text[]`),
    /** The checkout rules that applied to the basket when it was placed (D357), by id: which of the store's rules changed what it was offered. */
    checkoutRulesApplied: uuid("checkout_rules_applied").array().notNull().default(sql`'{}'::uuid[]`),
        heldAt: timestamp("held_at", { withTimezone: true }),
    heldReason: text("held_reason"),
    heldByRule: uuid("held_by_rule"),
    heldBy: uuid("held_by").references(() => accounts.id),
    /**
     * The exchange this order was made for (wave 3, D239, `docs/wave-3-exchanges.md` 3.1): set exactly when `source = 'exchange'`, written by `insertOrder()`
     * under the exchange context (`kaizen.exchange`) and frozen after (`orders_exchange_rules()`). A copy of the order (D129) never carries it.
     */
    exchangeId: uuid("exchange_id"),
    createdAt: createdAt(),
  },
  // Annotated: an order names its exchange and an exchange names its orders, so the types would otherwise infer in a circle.
  (t): PgTableExtraConfigValue[] => [
    check("orders_capture_mode", sql`${t.captureMode} is null or ${t.captureMode} in (${sqlList(CAPTURE_MODES)})`),
    /** Only an order waiting for its capture has a deadline (D289); it is kept after for the history. */
    check("orders_capture_before", sql`${t.status} <> 'authorized' or (${t.captureMode} is not null and ${t.captureBefore} is not null)`),
    index("orders_authorized_idx")
      .on(t.captureBefore)
      .where(sql`${t.status} = 'authorized'`),
    foreignKey({
      name: "orders_exchange_fk",
      columns: [t.storeId, t.exchangeId],
      foreignColumns: [returnExchanges.storeId, returnExchanges.id],
    }).onDelete("restrict"),
    index("orders_exchange_idx")
      .on(t.storeId, t.exchangeId)
      .where(sql`${t.exchangeId} is not null`),
    /** One exchange order that is not cancelled per exchange (3.3 point 3). */
    uniqueIndex("orders_exchange_live_key")
      .on(t.storeId, t.exchangeId)
      .where(sql`${t.exchangeId} is not null and ${t.status} <> 'cancelled'`),
    check("orders_source_exchange", sql`(${t.source} = 'exchange') = (${t.exchangeId} is not null)`),
    check("orders_delivered_source", sql`${t.deliveredSource} is null or (${t.deliveredAt} is not null and ${t.deliveredSource} in ('staff', 'handover', 'carrier'))`),
    check(
      "orders_held",
      sql`(${t.heldAt} is not null or (${t.heldReason} is null and ${t.heldByRule} is null and ${t.heldBy} is null)) and not (${t.heldByRule} is not null and ${t.heldBy} is not null) and (${t.heldReason} is null or char_length(${t.heldReason}) between 1 and 200)`,
    ),
    index("orders_held_by_idx").on(t.heldBy),
    index("orders_held_idx").on(t.storeId, t.heldAt).where(sql`${t.heldAt} is not null`),
    check("orders_delivery_method", sql`${t.deliveryMethod} in ('ship', 'pickup', 'local')`),
    check("orders_po_number", sql`${t.poNumber} is null or char_length(${t.poNumber}) between 1 and 40`),
    check("orders_approval", sql`${t.approval} is null or ${t.approval} in ('waiting', 'approved', 'declined')`),
    index("orders_approval_idx").on(t.storeId, t.approval).where(sql`${t.approval} is not null`),
    check("orders_pickup_location", sql`(${t.deliveryMethod} = 'pickup') = (${t.pickupLocationId} is not null)`),
    check("orders_ready_for_pickup", sql`${t.readyForPickupAt} is null or ${t.deliveryMethod} = 'pickup'`),
    check(
      "orders_delivery_note",
      sql`${t.deliveryNote} is null or (${t.deliveryMethod} = 'local' and char_length(${t.deliveryNote}) between 1 and ${lit(NOTE_MAX)})`,
    ),
    index("orders_delivery_method_idx")
      .on(t.storeId, t.deliveryMethod, t.status)
      .where(sql`${t.deliveryMethod} <> 'ship'`),
    index("orders_pickup_location_idx")
      .on(t.storeId, t.pickupLocationId)
      .where(sql`${t.pickupLocationId} is not null`),
    check("orders_archived_not_pending", sql`${t.archivedAt} is null or ${t.status} <> 'pending_payment'`),
    check("orders_source", sql`${t.source} in ('checkout', 'draft', 'exchange')`),
    /** A draft's order names its draft; a staff-made order (a draft's, or an exchange's, D239) names the staff member who made it. */
    check(
      "orders_source_draft",
      sql`(${t.source} = 'draft') = (${t.draftId} is not null) and (${t.source} in ('draft', 'exchange')) = (${t.madeBy} is not null)`,
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
    index("orders_discount_code_item_idx").on(t.storeId, t.discountCodeItemId).where(sql`${t.discountCodeItemId} is not null`),
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
      sql`${t.anonymisedAt} is null or (${t.email} = '[removed]' and ${t.billingAddress} = '{}'::jsonb and ${t.shippingAddress} = '{}'::jsonb and ${t.companyName} is null and ${t.organisationNumber} is null and not ${t.isGift} and ${t.giftTo} is null and ${t.giftFrom} is null and ${t.giftMessage} is null and ${t.deliveryNote} is null)`,
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
    check("orders_duties_non_negative", sql`${t.dutiesMinor} >= 0`),
    check(
      "orders_total_adds_up",
      sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor} - ${t.discountMinor}`,
    ),
    check("orders_member_discount", sql`${t.memberDiscountMinor} between 0 and ${t.discountMinor}`),
    check("orders_campaign_discount", sql`${t.campaignDiscountMinor} between 0 and ${t.discountMinor}`),
    check(
      "orders_campaign_shipping",
      sql`${t.campaignShipping} is null or (jsonb_typeof(${t.campaignShipping}) = 'object' and (${t.campaignShipping} ->> 'minor')::bigint between 0 and ${t.campaignDiscountMinor})`,
    ),
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
    /** The price list that priced the line (wave 6 unit C, D321), kept for the record; null for the market price. Lists may go, so no key. */
    priceListId: uuid("price_list_id"),
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
    /**
     * A gift card sent to someone (D300 F2): its cart line's recipient, sender, message and day, frozen when the order is placed (each card of
     * the line goes to them); all null for anything else, or a card the buyer keeps. Personal data: cleared when the order is anonymised.
     */
    giftCardTo: text("gift_card_to"),
    giftCardToName: text("gift_card_to_name"),
    giftCardFrom: text("gift_card_from"),
    giftCardMessage: text("gift_card_message"),
    giftCardSendOn: date("gift_card_send_on"),
  },
  (t) => [
    unique("order_lines_store_id_key").on(t.storeId, t.id),
    check(
      "order_lines_gift_card",
      giftCardFieldsCheck({ to: t.giftCardTo, toName: t.giftCardToName, from: t.giftCardFrom, message: t.giftCardMessage, sendOn: t.giftCardSendOn }),
    ),
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
 * A bundle's components as sold (wave 6 unit D, D322): written by `placeOrder()` with the order line, frozen (the database refuses a change or
 * a deletion). What payment draws (`commerce.draw_order_stock()`), what a restock puts back (`planRestock()`) and what the slips list.
 */
export const orderLineComponents = commerce.table(
  "order_line_components",
  {
    storeId: storeId(),
    orderLineId: uuid("order_line_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    /** Units of it in ONE bundle; the line's quantity times this is what the line takes. */
    quantity: integer("quantity").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "order_line_components_pkey", columns: [t.orderLineId, t.variantId] }),
    orderLineRef("order_line_components_line_fk", t),
    variantRef("order_line_components_variant_fk", t),
    index("order_line_components_line_idx").on(t.storeId, t.orderLineId),
    index("order_line_components_variant_idx").on(t.storeId, t.variantId),
    check("order_line_components_quantity", sql`${t.quantity} between 1 and 99`),
  ],
);

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
    /**
     * A payment of an exchange order (wave 3, D239): the credit moved from the return (`provider = 'exchange'`, no provider call), the pay link's Stripe
     * payment of the difference, or one recorded as paid outside Kaizen. `applySession()` routes by it and never calls `complete_order_payment()` for it.
     */
    exchangeId: uuid("exchange_id"),
    /** For `provider = 'exchange'`: the original order's `transfer` refund it is paid from (equal in amount and currency, checked at commit). */
    transferRefundId: uuid("transfer_refund_id"),
    /**
     * For `provider = 'gift_card'` (D300 F3): the card that pays. Held by a trigger when the row is made (`gift_card_hold()`), spent when it is captured with
     * its order, released when it ends unpaid; a refund of it goes back on the card. No provider is asked: the card's ledger is the money.
     */
    giftCardId: uuid("gift_card_id"),
    /**
     * What a Stripe payment was (wave 4 unit A, D288), read once from its charge after capture (`src/server/payment-facts.ts`) and kept as Stripe gave
     * it: the method (`payment_method_details.type`), the card's wallet and brand, the risk outcome and the charge's id. All null until read, and for any
     * other provider; `facts_read_at` says the read was made (a value Stripe did not give stays null and is *Unknown*).
     */
    methodType: text("method_type"),
    wallet: text("wallet"),
    cardBrand: text("card_brand"),
    riskLevel: text("risk_level"),
    riskScore: smallint("risk_score"),
    chargeReference: text("charge_reference"),
    factsReadAt: timestamp("facts_read_at", { withTimezone: true }),
    /**
     * What Stripe took for the payment (wave 4 unit C, D290), from its charge's balance transaction (`fee_details`): Stripe's own fee (with any tax on it)
     * and the application fee (Kaizena Flow's) told apart, in the balance transaction's currency (the account's settlement currency, which may not be the
     * payment's). Null until read: from the charge with the payment's facts, or from the payout that settles it.
     */
    providerFeeMinor: bigint("provider_fee_minor", { mode: "number" }),
    applicationFeeMinor: bigint("application_fee_minor", { mode: "number" }),
    feeCurrency: char("fee_currency", { length: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("payments_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "payments_exchange_fk",
      columns: [t.storeId, t.exchangeId],
      foreignColumns: [returnExchanges.storeId, returnExchanges.id],
    }),
    index("payments_exchange_idx")
      .on(t.storeId, t.exchangeId)
      .where(sql`${t.exchangeId} is not null`),
    foreignKey({
      name: "payments_transfer_refund_fk",
      columns: [t.storeId, t.transferRefundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    uniqueIndex("payments_transfer_refund_key")
      .on(t.storeId, t.transferRefundId)
      .where(sql`${t.transferRefundId} is not null`),
    check(
      "payments_exchange_transfer",
      sql`(${t.provider} = 'exchange') = (${t.transferRefundId} is not null) and (${t.provider} <> 'exchange' or ${t.exchangeId} is not null)`,
    ),
    foreignKey({
      name: "payments_order_edit_fk",
      columns: [t.storeId, t.orderEditId],
      foreignColumns: [orderEdits.storeId, orderEdits.id],
    }),
    index("payments_order_edit_idx")
      .on(t.storeId, t.orderEditId)
      .where(sql`${t.orderEditId} is not null`),
    foreignKey({
      name: "payments_gift_card_fk",
      columns: [t.storeId, t.giftCardId],
      foreignColumns: [giftCards.storeId, giftCards.id],
    }),
    index("payments_gift_card_idx")
      .on(t.storeId, t.giftCardId)
      .where(sql`${t.giftCardId} is not null`),
    check("payments_gift_card", sql`(${t.provider} = 'gift_card') = (${t.giftCardId} is not null) and (${t.provider} <> 'gift_card' or ${t.providerAccount} is null)`),
    check("payments_received_manual", sql`${t.receivedOn} is null or ${t.provider} = 'manual'`),
    index("payments_recorded_by_idx").on(t.recordedBy),
    check("payments_manual_method", sql`(${t.provider} = 'manual') = (${t.method} is not null) and (${t.method} is null or ${t.method} in ('cash', 'bank_transfer', 'other'))`),
    check("payments_manual_recorded", sql`${t.provider} <> 'manual' or ${t.recordedBy} is not null`),
    /** A payment taken outside Kaizen is real money whatever mode Stripe is in (`payments_venue_mode` only marks venue payments). */
    check("payments_manual_real", sql`${t.provider} <> 'manual' or not ${t.testMode}`),
    check("payments_risk_level", sql`${t.riskLevel} is null or ${t.riskLevel} in (${sqlList(RISK_LEVELS)})`),
    check("payments_risk_score", sql`${t.riskScore} is null or ${t.riskScore} between 0 and 100`),
    check(
      "payments_facts_stripe",
      sql`${t.provider} = 'stripe' or (${t.methodType} is null and ${t.wallet} is null and ${t.cardBrand} is null and ${t.riskLevel} is null and ${t.chargeReference} is null)`,
    ),
    check(
      "payments_provider_fee",
      sql`(${t.providerFeeMinor} is null) = (${t.feeCurrency} is null) and (${t.applicationFeeMinor} is null or ${t.providerFeeMinor} is not null)
        and (${t.providerFeeMinor} is null or (${t.provider} = 'stripe' and ${t.providerFeeMinor} >= 0 and coalesce(${t.applicationFeeMinor}, 0) >= 0))`,
    ),
    index("payments_charge_idx")
      .on(t.storeId, t.chargeReference)
      .where(sql`${t.chargeReference} is not null`),
    index("payments_facts_due_idx")
      .on(t.createdAt)
      .where(sql`${t.provider} = 'stripe' and ${t.status} = 'captured' and ${t.factsReadAt} is null`),
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
    /**
     * The exchange a refund belongs to (wave 3, D239): the `transfer` of a return's credit to an exchange order, the remainder refunded through Stripe, or
     * the refund of an exchange payment that came when the exchange could no longer settle. The first two get no credit note of their own (the return's
     * `return_exchange` credit note covers them).
     */
    exchangeId: uuid("exchange_id"),
    /**
     * `money` (a refund through the provider or recorded outside), `transfer` (the credit moved to an exchange order: no provider call, created `succeeded`),
     * `release` (D289), `void` (D293: an unpaid order on terms cancelled, only its credit note) or `store_credit` (D364: paid back as a gift card of the
     * store's, no provider call, created `succeeded`); `REFUND_KINDS`.
     */
    kind: text("kind").notNull().default("money"),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("refunds_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "refunds_exchange_fk",
      columns: [t.storeId, t.exchangeId],
      foreignColumns: [returnExchanges.storeId, returnExchanges.id],
    }),
    index("refunds_exchange_idx")
      .on(t.storeId, t.exchangeId)
      .where(sql`${t.exchangeId} is not null`),
    check("refunds_kind", sql`${t.kind} in (${sqlList(REFUND_KINDS)})`),
    check(
      "refunds_transfer",
      sql`${t.kind} <> 'transfer' or (${t.exchangeId} is not null and ${t.providerReference} is null and ${t.status} = 'succeeded')`,
    ),
    check("refunds_release", sql`${t.kind} <> 'release' or (${t.providerReference} is null and ${t.status} = 'succeeded' and ${t.exchangeId} is null and ${t.orderEditId} is null)`),
    check("refunds_void", sql`${t.kind} <> 'void' or (${t.providerReference} is null and ${t.status} = 'succeeded' and ${t.exchangeId} is null and ${t.orderEditId} is null)`),
    check("refunds_store_credit", sql`${t.kind} <> 'store_credit' or (${t.status} = 'succeeded' and ${t.exchangeId} is null and ${t.orderEditId} is null)`),
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
 * A dispute (chargeback or inquiry) on a payment (wave 4 unit A, D288, `docs/wave-4-payments.md` 3), as the provider reports it: written only by
 * `src/server/payment-disputes.ts` from the connected account's `charge.dispute.*` events and its re-reads, one row per dispute. Amounts are in the
 * dispute's own currency (the payment's); `funds_withdrawn_minor` and `fee_minor` are what the provider's balance transactions say in that currency,
 * null when they are in another or not known. A lost dispute is money out in the finance analytics in the period it closed, never a refund.
 */
export const paymentDisputes = commerce.table(
  "payment_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    provider: text("provider").notNull(),
    /** The provider's id (`dp_…`). */
    providerReference: text("provider_reference").notNull(),
    chargeReference: text("charge_reference"),
    amountMinor: money("amount_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    reason: text("reason"),
    status: text("status").notNull(),
    evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
    /** `won` or `lost` once closed (an inquiry closed or a prevented dispute is `won`: it took nothing). */
    outcome: text("outcome"),
    fundsWithdrawnMinor: bigint("funds_withdrawn_minor", { mode: "number" }),
    feeMinor: bigint("fee_minor", { mode: "number" }),
    /** Whether the dispute was made in the provider's test mode. */
    testMode: boolean("test_mode").notNull().default(false),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** When staff were emailed that its deadline is near (once). */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("payment_disputes_store_id_key").on(t.storeId, t.id),
    unique("payment_disputes_reference_key").on(t.storeId, t.provider, t.providerReference),
    orderRef("payment_disputes_order_fk", t),
    foreignKey({
      name: "payment_disputes_payment_fk",
      columns: [t.storeId, t.paymentId],
      foreignColumns: [payments.storeId, payments.id],
    }),
    index("payment_disputes_order_idx").on(t.storeId, t.orderId),
    index("payment_disputes_payment_idx").on(t.storeId, t.paymentId),
    index("payment_disputes_due_idx")
      .on(t.evidenceDueBy)
      .where(sql`${t.closedAt} is null and ${t.remindedAt} is null`),
    check("payment_disputes_provider", sql`${t.provider} in ('stripe', 'mollie')`),
    check("payment_disputes_amount", sql`${t.amountMinor} > 0`),
    check("payment_disputes_status", sql`${t.status} in (${sqlList(DISPUTE_STATUSES)})`),
    check("payment_disputes_outcome", sql`${t.outcome} is null or ${t.outcome} in ('won', 'lost')`),
    check("payment_disputes_closed", sql`(${t.closedAt} is null) = (${t.outcome} is null)`),
    check("payment_disputes_money", sql`(${t.fundsWithdrawnMinor} is null or ${t.fundsWithdrawnMinor} >= 0) and (${t.feeMinor} is null or ${t.feeMinor} >= 0)`),
    check("payment_disputes_reason", sql`${t.reason} is null or char_length(${t.reason}) <= 80`),
  ],
);

/**
 * A store's payout from its Stripe account to its bank (wave 4 unit C, D290, `src/server/payouts.ts`): as Stripe reported it, from `payout.*` on the
 * connected-account webhook and the daily read back 30 days. One row per provider reference; written only by `applyPayout()`. Amounts in the payout's
 * own currency. A payout made in Stripe's test mode says so.
 */
export const payouts = commerce.table(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    provider: text("provider").notNull(),
    /** The provider's id (`po_…`). */
    providerReference: text("provider_reference").notNull(),
    /** The connected account it was paid from. */
    providerAccount: text("provider_account").notNull(),
    testMode: boolean("test_mode").notNull().default(false),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status").notNull(),
    /** Stripe's own payouts (`automatic`) list what they settle; a manual payout does not. */
    automatic: boolean("automatic").notNull(),
    /** The day Stripe said it reaches the bank. */
    arrivalOn: date("arrival_on", { mode: "string" }),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }).notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    /** When its balance transactions were read, and whether all of them were (`PAYOUT_LINES_MAX`). */
    linesReadAt: timestamp("lines_read_at", { withTimezone: true }),
    linesComplete: boolean("lines_complete").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("payouts_store_id_key").on(t.storeId, t.id),
    unique("payouts_reference_key").on(t.storeId, t.provider, t.providerReference),
    index("payouts_arrival_idx").on(t.storeId, t.arrivalOn),
    index("payouts_lines_due_idx")
      .on(t.providerCreatedAt)
      .where(sql`${t.linesReadAt} is null and ${t.status} = 'paid' and ${t.automatic}`),
    check("payouts_provider", sql`${t.provider} in ('stripe')`),
    check("payouts_status", sql`${t.status} in (${sqlList(PAYOUT_STATUSES)})`),
    check("payouts_failure", sql`(${t.failureCode} is null or char_length(${t.failureCode}) <= 80) and (${t.failureMessage} is null or char_length(${t.failureMessage}) <= 300)`),
  ],
);

/**
 * What a payout settles (wave 4 unit C, D290): each balance transaction Stripe lists for it, with Stripe's gross, fee and net in the payout's currency,
 * and, where Kaizena Flow knows it, the payment, refund or dispute and the order it is for. Written only with its payout's read (`readPayoutLines()`), each
 * once by its provider reference; nothing of the person.
 */
export const payoutLines = commerce.table(
  "payout_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    payoutId: uuid("payout_id").notNull(),
    /** The balance transaction's id (`txn_…`). */
    providerReference: text("provider_reference").notNull(),
    kind: text("kind").notNull(),
    /** Stripe's balance transaction type, as given. */
    providerType: text("provider_type").notNull(),
    /** The source's id (`ch_…`, `re_…`, `dp_…`, `py_…`). */
    sourceReference: text("source_reference"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    feeMinor: bigint("fee_minor", { mode: "number" }).notNull().default(0),
    netMinor: bigint("net_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    paymentId: uuid("payment_id"),
    refundId: uuid("refund_id"),
    disputeId: uuid("dispute_id"),
    orderId: uuid("order_id"),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("payout_lines_reference_key").on(t.storeId, t.payoutId, t.providerReference),
    foreignKey({ name: "payout_lines_payout_fk", columns: [t.storeId, t.payoutId], foreignColumns: [payouts.storeId, payouts.id] }),
    foreignKey({ name: "payout_lines_payment_fk", columns: [t.storeId, t.paymentId], foreignColumns: [payments.storeId, payments.id] }),
    foreignKey({ name: "payout_lines_refund_fk", columns: [t.storeId, t.refundId], foreignColumns: [refunds.storeId, refunds.id] }),
    foreignKey({ name: "payout_lines_dispute_fk", columns: [t.storeId, t.disputeId], foreignColumns: [paymentDisputes.storeId, paymentDisputes.id] }),
    orderRef("payout_lines_order_fk", t),
    index("payout_lines_payout_idx").on(t.storeId, t.payoutId),
    index("payout_lines_payment_idx")
      .on(t.storeId, t.paymentId)
      .where(sql`${t.paymentId} is not null`),
    index("payout_lines_refund_idx")
      .on(t.storeId, t.refundId)
      .where(sql`${t.refundId} is not null`),
    index("payout_lines_dispute_idx")
      .on(t.storeId, t.disputeId)
      .where(sql`${t.disputeId} is not null`),
    index("payout_lines_order_idx")
      .on(t.storeId, t.orderId)
      .where(sql`${t.orderId} is not null`),
    check("payout_lines_kind", sql`${t.kind} in (${sqlList(PAYOUT_LINE_KINDS)})`),
    check("payout_lines_net", sql`${t.netMinor} = ${t.amountMinor} - ${t.feeMinor}`),
  ],
);

/** When a store's payouts were last read back (wave 4 unit C, D290): the daily read takes the stores read longest ago, a few a run. */
export const payoutReads = commerce.table("payout_reads", {
  storeId: uuid("store_id")
    .primaryKey()
    .references(() => stores.id),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  problem: text("problem"),
});

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
    /**
     * What left the store (D237): `parcel` (sent, the default and every row before D237), or a handover: `pickup` (the buyer collected it) or `local`
     * (the store's own driver took it out). A handover has no carrier, tracking, booking or label and sends no shipped email.
     */
    method: text("method").notNull().default("parcel"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shipments_store_id_key").on(t.storeId, t.id),
    check("shipments_method", sql`${t.method} in ('parcel', 'pickup', 'local')`),
    check(
      "shipments_handover_bare",
      sql`${t.method} = 'parcel' or (${t.carrier} = '' and ${t.trackingNumber} = '' and ${t.trackingUrl} is null and ${t.carrierId} is null and ${t.consignmentNumber} is null and ${t.labelUrl} is null)`,
    ),
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
    /** The customer asked for an exchange on the status page or the request form (D239 2.1): when, and their words (plain text, blanked by the anonymising). */
    exchangeWishAt: timestamp("exchange_wish_at", { withTimezone: true }),
    exchangeWishNote: text("exchange_wish_note"),
    /**
     * The return's label (D239 3.1): `pasted` (D153's `label_url`, typed by staff; set by a trigger whenever `label_url` is) or `carrier` (booked with the
     * store's carrier: the columns below). The pairing of `pasted` with `label_url` is held by `returns_label_pasted`, added by the rules migration after its
     * back-fill (the code running during the deploy writes `label_url` alone, which the trigger completes).
     */
    labelSource: text("label_source"),
    labelCarrierId: text("label_carrier_id"),
    labelService: text("label_service"),
    labelConsignmentNumber: text("label_consignment_number"),
    labelTrackingNumber: text("label_tracking_number"),
    labelTrackingUrl: text("label_tracking_url"),
    /** The label's address at the carrier: private (it needs the store's keys); the shopper opens it only through `/returns/{token}/label`. */
    labelCarrierUrl: text("label_carrier_url"),
    /** What the label cost the store, VAT included, in the order's currency (converted once at the store's rates); null when not known. */
    labelCostMinor: bigint("label_cost_minor", { mode: "number" }),
    /** The price as the carrier gave it: `{ amountMinor, currency, vatIncluded }`. */
    labelCostCarrier: jsonb("label_cost_carrier"),
    /** Booked in the carrier's test environment: shown as a test and never offered as usable. */
    labelTest: boolean("label_test").notNull().default(false),
    labelBookedAt: timestamp("label_booked_at", { withTimezone: true }),
    /** How many times the five-minute job tried to book a withdrawal return's label (`LABEL_TRIES`). */
    labelTries: integer("label_tries").notNull().default(0),
  },
  (t) => [
    unique("returns_store_id_key").on(t.storeId, t.id),
    check("returns_exchange_wish", sql`${t.exchangeWishNote} is null or (${t.exchangeWishAt} is not null and char_length(${t.exchangeWishNote}) <= ${lit(EXCHANGE_WISH_NOTE_MAX)})`),
    check("returns_label_source", sql`${t.labelSource} is null or ${t.labelSource} in (${sqlList(LABEL_SOURCES)})`),
    check(
      "returns_label_carrier",
      sql`(${t.labelSource} is not distinct from 'carrier') = (${t.labelCarrierId} is not null and ${t.labelBookedAt} is not null)
        and (${t.labelCarrierId} is null or ${t.labelCarrierId} in (${sqlList(CARRIER_IDS)}))
        and (${t.labelSource} is not distinct from 'carrier' or (${t.labelService} is null and ${t.labelConsignmentNumber} is null and ${t.labelTrackingNumber} is null
             and ${t.labelTrackingUrl} is null and ${t.labelCarrierUrl} is null and ${t.labelCostMinor} is null and ${t.labelCostCarrier} is null and not ${t.labelTest}))`,
    ),
    check("returns_label_urls", sql`(${t.labelTrackingUrl} is null or ${t.labelTrackingUrl} ~ '^https://') and (${t.labelCarrierUrl} is null or ${t.labelCarrierUrl} ~ '^https://')`),
    check("returns_label_cost", sql`(${t.labelCostMinor} is null or ${t.labelCostMinor} >= 0) and (${t.labelCostCarrier} is null or jsonb_typeof(${t.labelCostCarrier}) = 'object')`),
    check("returns_label_tries", sql`${t.labelTries} >= 0`),
    /** The job's scan: withdrawal returns with no label yet (D239 3.5). */
    index("returns_label_pending_idx")
      .on(t.storeId, t.createdAt)
      .where(sql`${t.kind} = 'withdrawal' and ${t.labelSource} is null`),
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
    check("returns_outcome", sql`${t.outcome} is null or ${t.outcome} in ('refunded', 'declined', 'no_refund', 'cancelled', 'exchanged')`),
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
    /** Offer exchanges on returns (D239 2.2); on by default. */
    exchanges: boolean("exchanges").notNull().default(true),
    /** The carrier return labels are booked with, and its return service when the owner set another than the carrier's default (D239 2.3). */
    labelCarrier: text("label_carrier"),
    labelService: text("label_service"),
    /** Book a withdrawal return's label by the five-minute job (off by default; needs `label_carrier`). */
    labelAuto: boolean("label_auto").notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    index("return_settings_updated_by_idx").on(t.updatedBy),
    check("return_settings_label_carrier", sql`${t.labelCarrier} is null or ${t.labelCarrier} in (${sqlList(CARRIER_IDS)})`),
    check("return_settings_label_service", sql`${t.labelService} is null or (${t.labelCarrier} is not null and char_length(${t.labelService}) between 1 and 20)`),
    check("return_settings_label_auto", sql`not ${t.labelAuto} or ${t.labelCarrier} is not null`),
    check("return_settings_window", sql`${t.windowDays} between 14 and 100`),
    check("return_settings_transit", sql`${t.transitDays} between 0 and 14`),
    check("return_settings_who_pays", sql`${t.whoPaysReturn} in ('shopper', 'store')`),
    check("return_settings_refund_when", sql`${t.refundWhen} in ('received', 'request')`),
    check("return_settings_instructions", sql`length(${t.instructions}) <= 2000`),
  ],
);

/**
 * An exchange of a return (wave 3, D239, `docs/wave-3-exchanges.md` 3.2): one proposal of replacement goods for one return, numbered per return (`seq`, under
 * the return's lock, at most `EXCHANGES_PER_RETURN_MAX`), priced by `priceExchange()` in the original order's currency and market view. Its life is
 * `return_exchanges_rules()` (the table of `src/lib/exchange-status.ts`); only one per return is open at a time. Confirmed by the customer's press on the
 * exchange page (the token is kept only as a SHA-256 hash, base64url), or for a voluntary return by staff recording the customer's agreement; processed into
 * an exchange order (`orders.exchange_id`) and settled when the order is paid and the return's refund recorded. Never deleted; holds no personal field but
 * the delivery address (replaced by the marker when the order is anonymised); staff's note is only in the history event's `data.note`.
 */
export const returnExchanges = commerce.table(
  "return_exchanges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    returnId: uuid("return_id").notNull(),
    /** The original order (the return's). */
    orderId: uuid("order_id").notNull(),
    /** 1, 2, … per return, given by the trigger under the return's lock. */
    seq: integer("seq").notNull(),
    status: text("status").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** The original order's market view (`{country}[-{lang}][-{currency}]`), which prices the replacements and serves the exchange page. */
    marketSlug: text("market_slug").notNull(),
    shippingKind: text("shipping_kind").notNull().default("free"),
    shippingMinor: money("shipping_minor").default(0),
    /** Name, street, postal code, city, country (the market's), phone optional. */
    deliveryAddress: jsonb("delivery_address").notNull(),
    /** As proposed (and confirmed): the credit C (`refundFor()`'s), the replacement total T, and `T − C`. */
    creditMinor: money("credit_minor"),
    totalMinor: money("total_minor"),
    differenceMinor: bigint("difference_minor", { mode: "number" }).notNull(),
    /** C and T − C worked out again when the exchange was processed. */
    creditAtProcessing: bigint("credit_at_processing", { mode: "number" }),
    differenceAtProcessing: bigint("difference_at_processing", { mode: "number" }),
    /** SHA-256 (base64url) of the 32-byte page token; cleared 90 days after the exchange ended (`pruneExchangeTokens()`). */
    tokenHash: text("token_hash"),
    /** The end of the proposal's link, then of the pay step's (capped at a withdrawal's refund deadline). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** The terms the page showed: `[{ role, snapshotId, hash }]` (`legal_snapshots`), written to the exchange order's `order_terms`. */
    terms: jsonb("terms"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** `customer` (the press on the page, channel `web`) or `staff` (an agreement recorded for a voluntary return only). */
    confirmedBy: text("confirmed_by"),
    confirmedChannel: text("confirmed_channel"),
    exchangeOrderId: uuid("exchange_order_id"),
    /** The remainder's refund through Stripe (C > T). */
    refundId: uuid("refund_id"),
    /** The (first) transfer refund on the original order; every one is `refunds.exchange_id` = this with `kind = 'transfer'`. */
    transferRefundId: uuid("transfer_refund_id"),
    madeBy: uuid("made_by")
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("return_exchanges_store_id_key").on(t.storeId, t.id),
    unique("return_exchanges_return_seq_key").on(t.storeId, t.returnId, t.seq),
    foreignKey({
      name: "return_exchanges_return_fk",
      columns: [t.storeId, t.returnId],
      foreignColumns: [returns.storeId, returns.id],
    }).onDelete("restrict"),
    orderRef("return_exchanges_order_fk", t).onDelete("restrict"),
    foreignKey({
      name: "return_exchanges_exchange_order_fk",
      columns: [t.storeId, t.exchangeOrderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "return_exchanges_refund_fk",
      columns: [t.storeId, t.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    foreignKey({
      name: "return_exchanges_transfer_refund_fk",
      columns: [t.storeId, t.transferRefundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
    /** One exchange per return that has not ended. */
    uniqueIndex("return_exchanges_open_key")
      .on(t.storeId, t.returnId)
      .where(sql`${t.status} in ('draft', 'proposed', 'confirmed', 'processed')`),
    index("return_exchanges_expiry_idx")
      .on(t.storeId, t.status, t.expiresAt)
      .where(sql`${t.status} in ('proposed', 'confirmed', 'processed')`),
    index("return_exchanges_return_idx").on(t.storeId, t.returnId),
    index("return_exchanges_order_idx").on(t.storeId, t.orderId),
    index("return_exchanges_exchange_order_idx").on(t.storeId, t.exchangeOrderId),
    index("return_exchanges_refund_idx").on(t.storeId, t.refundId),
    index("return_exchanges_transfer_refund_idx").on(t.storeId, t.transferRefundId),
    index("return_exchanges_made_by_idx").on(t.madeBy),
    uniqueIndex("return_exchanges_token_key")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    check("return_exchanges_seq", sql`${t.seq} between 1 and ${lit(EXCHANGES_PER_RETURN_MAX)}`),
    check("return_exchanges_status", sql`${t.status} in (${sqlList(EXCHANGE_STATUSES)})`),
    check("return_exchanges_shipping", sql`${t.shippingKind} in (${sqlList(EXCHANGE_SHIPPING_KINDS)}) and ${t.shippingMinor} >= 0 and (${t.shippingKind} <> 'free' or ${t.shippingMinor} = 0)`),
    check(
      "return_exchanges_amounts",
      sql`${t.creditMinor} >= 0 and ${t.totalMinor} >= 0 and ${t.differenceMinor} = ${t.totalMinor} - ${t.creditMinor}
        and (${t.creditAtProcessing} is null or ${t.creditAtProcessing} >= 0) and (${t.creditAtProcessing} is null) = (${t.differenceAtProcessing} is null)`,
    ),
    check("return_exchanges_address", sql`jsonb_typeof(${t.deliveryAddress}) = 'object'`),
    check("return_exchanges_terms", sql`${t.terms} is null or jsonb_typeof(${t.terms}) = 'array'`),
    check("return_exchanges_token", sql`${t.tokenHash} is null or ${t.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("return_exchanges_market_slug", sql`${t.marketSlug} ~ '^[a-z]{2}(-[a-z0-9]{2,8}){0,3}$'`),
    check(
      "return_exchanges_confirmation",
      sql`(${t.confirmedAt} is null) = (${t.confirmedBy} is null) and (${t.confirmedAt} is null) = (${t.confirmedChannel} is null)
        and (${t.confirmedBy} is null or ${t.confirmedBy} in ('customer', 'staff'))
        and (${t.confirmedChannel} is null or ${t.confirmedChannel} in (${sqlList(EXCHANGE_CHANNELS)}))
        and ((${t.confirmedBy} = 'customer') = (${t.confirmedChannel} = 'web') or ${t.confirmedBy} is null)`,
    ),
    /**
     * Where each status leaves the moments, the link and the order (3.3 point 1). An ended exchange may have lost its token hash (cleared 90 days after it
     * ended). The money a settled exchange moved is checked at commit (`return_exchanges_settled()`), because its refunds and payments name the exchange.
     */
    check(
      "return_exchanges_lifecycle",
      sql`(${t.status} = 'draft' and ${t.confirmedAt} is null and ${t.exchangeOrderId} is null and ${t.processedAt} is null and ${t.settledAt} is null and ${t.endedAt} is null)
        or (${t.status} = 'proposed' and ${t.tokenHash} is not null and ${t.expiresAt} is not null and ${t.confirmedAt} is null and ${t.exchangeOrderId} is null
            and ${t.processedAt} is null and ${t.settledAt} is null and ${t.endedAt} is null)
        or (${t.status} = 'confirmed' and ${t.tokenHash} is not null and ${t.expiresAt} is not null and ${t.confirmedAt} is not null and ${t.exchangeOrderId} is null
            and ${t.processedAt} is null and ${t.settledAt} is null and ${t.endedAt} is null)
        or (${t.status} = 'processed' and ${t.confirmedAt} is not null and ${t.exchangeOrderId} is not null and ${t.processedAt} is not null
            and ${t.creditAtProcessing} is not null and ${t.settledAt} is null and ${t.endedAt} is null)
        or (${t.status} = 'settled' and ${t.confirmedAt} is not null and ${t.exchangeOrderId} is not null and ${t.processedAt} is not null
            and ${t.creditAtProcessing} is not null and ${t.settledAt} is not null and ${t.endedAt} is null)
        or (${t.status} in ('declined_by_customer', 'cancelled', 'expired', 'superseded') and ${t.endedAt} is not null and ${t.settledAt} is null)`,
    ),
  ],
);

/**
 * A replacement of an exchange (D239 3.2): a catalogue goods variant, its quantity, the list price as shown when proposed and the price charged (never above
 * the list price). Written with its exchange while it is a draft (and changed or removed only then) or in the transaction that proposes it; never after.
 */
export const returnExchangeLines = commerce.table(
  "return_exchange_lines",
  {
    storeId: storeId(),
    exchangeId: uuid("exchange_id").notNull(),
    n: integer("n").notNull(),
    variantId: uuid("variant_id").notNull(),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    listPriceMinor: money("list_price_minor"),
    unitPriceMinor: money("unit_price_minor"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.exchangeId, t.n] }),
    foreignKey({
      name: "return_exchange_lines_exchange_fk",
      columns: [t.storeId, t.exchangeId],
      foreignColumns: [returnExchanges.storeId, returnExchanges.id],
    }).onDelete("restrict"),
    variantRef("return_exchange_lines_variant_fk", t).onDelete("restrict"),
    index("return_exchange_lines_exchange_idx").on(t.storeId, t.exchangeId),
    index("return_exchange_lines_variant_idx").on(t.storeId, t.variantId),
    check("return_exchange_lines_n", sql`${t.n} between 1 and ${lit(EXCHANGE_LINES_MAX)}`),
    check("return_exchange_lines_quantity", sql`${t.quantity} between 1 and ${lit(EXCHANGE_QUANTITY_MAX)}`),
    check("return_exchange_lines_prices", sql`${t.unitPriceMinor} >= 0 and ${t.listPriceMinor} >= 0 and ${t.unitPriceMinor} <= ${t.listPriceMinor}`),
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
    check("credit_notes_source", sql`${t.source} in ('refund', 'return_outside', 'order_edit', 'return_exchange')`),
    /** One credit note for an exchanged return (D239 3.3 point 6(b)): the return's full credit, its refunds getting none of their own. */
    uniqueIndex("credit_notes_return_exchange_key")
      .on(t.storeId, t.returnId)
      .where(sql`${t.source} = 'return_exchange'`),
    check(
      "credit_notes_source_ref",
      sql`(${t.source} = 'refund' and ${t.refundId} is not null and ${t.returnId} is null and ${t.orderEditId} is null)
        or (${t.source} in ('return_outside', 'return_exchange') and ${t.returnId} is not null and ${t.refundId} is null and ${t.orderEditId} is null)
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
    /** What Stripe last said of each of Kaizena Flow's payment capabilities on this account (`capabilityStates()`, D291): status and Stripe's reason. */
    methodStates: jsonb("method_states").notNull().default({}),
    /**
     * What Stripe last said of each web address registered on this account (D373, `checkWalletDomains()`): by host, whether it is on and
     * Apple Pay's, Google Pay's, Link's and Klarna's state with Stripe's reason. Read on the Payments page.
     */
    walletDomains: jsonb("wallet_domains").notNull().default({}),
    /** When `wallet_domains` was read; null: never, so the page says *not read* rather than *not registered*. */
    walletDomainsAt: timestamp("wallet_domains_at", { withTimezone: true }),
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

/**
 * A store's Mollie connection (wave 4 unit E, D292): the owner approved Kaizena Flow's Mollie app at Mollie (OAuth), and Kaizena Flow keeps the refresh
 * token encrypted (`SETTINGS_ENCRYPTION_KEY`, never shown again) and the access token it last had, with when it ends. One per store: test payments are the
 * same connection with Mollie's `testmode`. Written only by `src/server/mollie.ts`.
 */
export const mollieConnections = commerce.table(
  "mollie_connections",
  {
    storeId: storeId().references(() => stores.id).primaryKey(),
    organizationId: text("organization_id").notNull(),
    organizationName: text("organization_name"),
    /** The website profile payments are made on (Mollie asks for one with an OAuth token). */
    profileId: text("profile_id").notNull(),
    profileName: text("profile_name"),
    scopes: text("scopes").notNull(),
    refreshToken: text("refresh_token").notNull(),
    accessToken: text("access_token"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    connectedBy: uuid("connected_by").references(() => accounts.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("mollie_connections_connected_by_idx").on(t.connectedBy),
    check("mollie_connections_ids", sql`${t.organizationId} ~ '^org_[A-Za-z0-9]+$' and ${t.profileId} ~ '^pfl_[A-Za-z0-9]+$'`),
    check("mollie_connections_names", sql`(${t.organizationName} is null or length(${t.organizationName}) <= 200) and (${t.profileName} is null or length(${t.profileName}) <= 200)`),
  ],
);

/** Which provider a store's checkout uses in a mode (D292): no row is Stripe, every store's default. */
export const checkoutProviders = commerce.table(
  "checkout_providers",
  {
    storeId: storeId().references(() => stores.id),
    mode: paymentMode("mode").notNull(),
    provider: text("provider").notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.mode] }),
    index("checkout_providers_updated_by_idx").on(t.updatedBy),
    check("checkout_providers_provider", sql`${t.provider} in ('stripe', 'mollie')`),
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
    /** Where it is (D237), for local delivery by radius: from its postal code's centre in `postal_points` when saved, or typed by the owner. */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("store_locations_store_id_key").on(t.storeId, t.id),
    check(
      "store_locations_position",
      sql`(${t.latitude} is null) = (${t.longitude} is null) and (${t.latitude} is null or (${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180))`,
    ),
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
 * A workflow (D356, `src/server/workflows.ts`, its only writer with the runner): a trigger (an event of the store or a schedule), conditions on
 * the event's fields and up to ten actions, as JSON checked by `workflowInputSchema` and `workflowProblems()`. Saved off; `version` rises
 * with each save and it may be switched on only once `tested_version` equals it.
 */
export const workflows = commerce.table(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(),
    schedule: jsonb("schedule"),
    conditions: jsonb("conditions").notNull().default(sql`'[]'::jsonb`),
    actions: jsonb("actions").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    testedVersion: integer("tested_version"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("workflows_store_id_key").on(t.storeId, t.id),
    index("workflows_store_trigger_idx").on(t.storeId, t.trigger).where(sql`${t.enabled}`),
    index("workflows_created_by_idx").on(t.createdBy),
    index("workflows_updated_by_idx").on(t.updatedBy),
    check("workflows_name", sql`char_length(${t.name}) between 1 and 80`),
    check("workflows_trigger", sql`${t.trigger} in (${sqlList(WORKFLOW_TRIGGERS)})`),
    check("workflows_on_when_tested", sql`not ${t.enabled} or ${t.testedVersion} = ${t.version}`),
  ],
);

/**
 * One run of a workflow (D356): once per event (`event_key`: the event, its subject and the transaction it happened in, or a schedule's
 * day), claimed by the runner, with whether its conditions held and each action's outcome. Kept 90 days.
 */
export const workflowRuns = commerce.table(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    subjectId: uuid("subject_id"),
    eventKey: text("event_key").notNull(),
    status: text("status").notNull().default("pending"),
    matched: boolean("matched"),
    outcome: jsonb("outcome"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("workflow_runs_once_key").on(t.workflowId, t.eventKey),
    index("workflow_runs_due_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
    index("workflow_runs_workflow_idx").on(t.workflowId, t.createdAt),
    index("workflow_runs_store_idx").on(t.storeId, t.createdAt),
    check("workflow_runs_status", sql`${t.status} in ('pending', 'done', 'failed', 'capped')`),
  ],
);

/**
 * A staging set of a store's site (D358, `src/server/site-staging.ts`, its only writer): page drafts chosen to go live together, a theme
 * installed but not live to make live with them, and changes to menus kept here until then. One open set a store; published or discarded,
 * it is kept with what became of each part (`outcome`).
 */
export const siteStagings = commerce.table(
  "site_stagings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("open"),
    installId: uuid("install_id").references(() => storeThemeInstalls.id, { onDelete: "set null" }),
    /** Staged menus by id: `{ name, items }` as the menu editor sends them, saved by the menu saver when the set goes live. */
    menus: jsonb("menus").notNull().default(sql`'{}'::jsonb`),
    outcome: jsonb("outcome"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    publishedBy: uuid("published_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    unique("site_stagings_store_id_key").on(t.storeId, t.id),
    uniqueIndex("site_stagings_one_open").on(t.storeId).where(sql`${t.status} = 'open'`),
    index("site_stagings_install_idx").on(t.installId),
    index("site_stagings_created_by_idx").on(t.createdBy),
    index("site_stagings_published_by_idx").on(t.publishedBy),
    check("site_stagings_name", sql`char_length(${t.name}) between 1 and 80`),
    check("site_stagings_status", sql`${t.status} in ('open', 'published', 'discarded')`),
  ],
);

/** A page whose draft a staging set publishes (D358). */
export const siteStagingPages = commerce.table(
  "site_staging_pages",
  {
    stagingId: uuid("staging_id")
      .notNull()
      .references(() => siteStagings.id, { onDelete: "cascade" }),
    storeId: storeId().references(() => stores.id),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.stagingId, t.pageId] }), index("site_staging_pages_page_idx").on(t.pageId), index("site_staging_pages_store_idx").on(t.storeId)],
);

/**
 * A checkout rule (D357, `src/server/checkout-rules.ts`, its only writer): conditions on the basket and one effect, evaluated in `position` order by
 * `applyCheckoutRules()` in the cart and checkout alike. Saved off or on; never a price, VAT or a legal page.
 */
export const checkoutRules = commerce.table(
  "checkout_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    conditions: jsonb("conditions").notNull().default(sql`'[]'::jsonb`),
    effect: jsonb("effect").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("checkout_rules_store_id_key").on(t.storeId, t.id),
    index("checkout_rules_store_idx").on(t.storeId, t.position).where(sql`${t.enabled}`),
    index("checkout_rules_created_by_idx").on(t.createdBy),
    index("checkout_rules_updated_by_idx").on(t.updatedBy),
    check("checkout_rules_name", sql`char_length(${t.name}) between 1 and 80`),
    check("checkout_rules_effect", sql`${t.effect} ->> 'kind' in ('hide_shipping', 'rename_shipping', 'hide_payment_method', 'refuse')`),
  ],
);

/** A rule left out (D357): it named something gone or could not be read. One row per rule and reason, counted, for the owner to put right. */
export const checkoutRuleSkips = commerce.table(
  "checkout_rule_skips",
  {
    storeId: storeId().references(() => stores.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => checkoutRules.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    count: integer("count").notNull().default(1),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.reason] }),
    index("checkout_rule_skips_store_idx").on(t.storeId),
    check("checkout_rule_skips_reason", sql`${t.reason} in ('gone', 'unreadable')`),
  ],
);

/** A question in the checkout (D357, written only by `src/server/checkout-rules.ts`): a text or a box, required or not, its words per language. */
export const checkoutFields = commerce.table(
  "checkout_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    kind: text("kind").notNull(),
    required: boolean("required").notNull().default(false),
    label: jsonb("label").notNull(),
    help: jsonb("help"),
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("checkout_fields_store_id_key").on(t.storeId, t.id),
    index("checkout_fields_store_idx").on(t.storeId, t.position),
    check("checkout_fields_kind", sql`${t.kind} in ('text', 'checkbox')`),
  ],
);

/**
 * A token for the Admin API (D355, `src/server/api-tokens.ts`, its only writer): one store, a name, the scopes it may use, kept only as the
 * SHA-256 of the token (shown once, `kf_…`) with its first characters to tell tokens apart. It acts as the owner who made it, read again on
 * every call: a maker no longer an owner, or a revoked token, is refused.
 */
export const apiTokens = commerce.table(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    scopes: text("scopes").array().notNull(),
    tokenHash: text("token_hash").notNull(),
    /** The token's first characters (`kf_ab12`), shown in the list. */
    prefix: text("prefix").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("api_tokens_hash_key").on(t.tokenHash),
    unique("api_tokens_store_id_key").on(t.storeId, t.id),
    index("api_tokens_store_idx").on(t.storeId),
    index("api_tokens_created_by_idx").on(t.createdBy),
    check("api_tokens_name", sql`char_length(${t.name}) between 1 and 80`),
    check("api_tokens_scopes", sql`cardinality(${t.scopes}) between 1 and 20`),
  ],
);

/**
 * An endpoint of the owner's own (D354, `src/server/webhook-endpoints.ts`, its only writer): an HTTPS address that gets the topics chosen,
 * each delivery signed with the endpoint's secret (`Kaizena-Webhook-Signature`). The address and the secret are encrypted; the secret is
 * shown once. Switched off by Kaizena Flow after three days of failed deliveries (`disabled_reason = 'failing'`) and its owners told.
 */
export const webhookEndpoints = commerce.table(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    urlEncrypted: text("url_encrypted").notNull(),
    /** The address with its path hidden, shown to staff: `hooks.example.com/…`. */
    hint: text("hint").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    topics: text("topics").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** When its deliveries began failing without a success since; null while they arrive. */
    failingSince: timestamp("failing_since", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("webhook_endpoints_store_id_key").on(t.storeId, t.id),
    index("webhook_endpoints_store_idx").on(t.storeId),
    index("webhook_endpoints_created_by_idx").on(t.createdBy),
    check("webhook_endpoints_name", sql`char_length(${t.name}) between 1 and 80`),
    check("webhook_endpoints_topics", sql`cardinality(${t.topics}) between 1 and 40`),
    check("webhook_endpoints_reason", sql`${t.disabledReason} is null or ${t.disabledReason} in ('failing', 'owner')`),
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
    /** The owner's endpoint it goes to (D354), for the provider `webhook`. */
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, { onDelete: "cascade" }),
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
    index("integration_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    check("integration_deliveries_endpoint", sql`(${t.provider} = 'webhook') = (${t.endpointId} is not null)`),
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
    check("pages_type", sql`${t.type} in ('page', 'article', 'product_layout', 'header', 'footer', 'variant', 'entry_layout')`),
    // A test's variant of a page (D148) is a store's: it has no address of its own on the site.
    check("pages_variant_store", sql`${t.type} <> 'variant' or ${t.storeId} is not null`),
    // Product layouts (D79) are a store's: Kaizen has no products of its own.
    check("pages_product_layout_store", sql`${t.type} <> 'product_layout' or ${t.storeId} is not null`),
    // For stores' front pages (D54): a store can only choose a page of its own.
    unique("pages_store_id_key").on(t.storeId, t.id),
    index("pages_created_by_idx").on(t.createdBy),
    index("pages_updated_by_idx").on(t.updatedBy),
    // A page's address may be nested under another page's (`projects/project-a`, at most four parts, each at most 80 characters); only pages nest.
    check(
      "pages_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*){0,3}$' and length(${t.slug}) <= 240 and ${t.slug} !~ '[^/]{81}' and (${t.type} = 'page' or position('/' in ${t.slug}) = 0)`,
    ),
    // The platform's own routes at the root of the site (category and tag listings: D50).
    check(
      "pages_slug_not_reserved",
      sql`${t.storeId} is not null or ${t.type} <> 'page' or split_part(${t.slug}, '/', 1) not in ('account', 'admin', 'api', 'app', 'auth', 'blog', 'category', 'cookies', 'da', 'en', 'forgot-password', 'help', 'mail', 'nb', 'nn', 'no', 'platform', 'robots', 's', 'setup', 'sign-in', 'sign-up', 'sitemap', 'status', 'stores', 'support', 'sv', 'tag', 'themes', 'unsubscribe', 'www')`,
    ),
    // A store's own routes inside each of its markets (D53).
    check(
      "pages_store_slug_not_reserved",
      sql`${t.storeId} is null or ${t.type} <> 'page' or split_part(${t.slug}, '/', 1) not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'deliveries', 'download', 'order', 'p', 'products', 'returns', 'search', 'subscription', 'tag', 'unsubscribe', 'wishlist', 'withdraw')`,
    ),
    // The blog's own routes (D57): /blog/category/…, /blog/tag/… and pages of the list.
    check("pages_article_slug_not_reserved", sql`${t.type} <> 'article' or ${t.slug} not in ('category', 'page', 'tag')`),
    check("pages_published_together", sql`(${t.published} is null) = (${t.publishedAt} is null)`),
  ],
);

/**
 * A page's versions (D305, `src/server/page-versions.ts`): what each save, publish and change on the live site left, kept so a person can
 * take an earlier version back into the page builder. Written only by `keepVersion()`, never changed (a trigger refuses it); a page keeps
 * its newest fifty, and its versions go with it when it is deleted.
 */
export const pageVersions = commerce.table(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own pages, as on `pages`. */
    storeId: uuid("store_id").references(() => stores.id),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** What made it: `saved`, `published`, `site_text` (D192) or `site_css` (D306). */
    kind: text("kind").notNull(),
    content: jsonb("content").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [
    index("page_versions_page_idx").on(t.pageId, t.createdAt),
    index("page_versions_store_idx").on(t.storeId),
    index("page_versions_created_by_idx").on(t.createdBy),
    check("page_versions_kind", sql`${t.kind} in ('saved', 'published', 'site_text', 'site_css')`),
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
    check("page_roles_role", sql`${t.role} in ('blog', 'search', 'not_found', 'cart', 'checkout', 'order', 'account', 'sign_in', 'wishlist', 'subscription', 'deliveries', 'cookies', 'category', 'tag', 'private', ${legalRoleList})`),
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
    /** US dollars per thousand web searches (D329); null: none. */
    perThousandSearches: numeric("per_thousand_searches", { precision: 14, scale: 6 }),
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
      sql`${t.inputPerMillion} >= 0 and ${t.outputPerMillion} >= 0 and ${t.perImage} >= 0 and ${t.perAudioMinute} >= 0 and ${t.perMillionCharacters} >= 0 and ${t.perThousandSearches} >= 0`,
    ),
    check("ai_model_prices_names", sql`length(${t.provider}) between 1 and 60 and length(${t.model}) between 1 and 200`),
  ],
);

/**
 * Which of Kaizen's own pages has a place of its own on its site (D143), as a store's front page and special
 * pages do (D54, D112): its front page (`/`), its blog (`/blog`) and the page shown for an address that is not
 * found, and the theme store's list and a theme's page (D285). Without one the site's standard page shows. A page holds at most one place, only a page of Kaizen's
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
    check("platform_page_roles_role", sql`${t.role} in ('front', 'blog', 'not_found', 'themes', 'theme')`),
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
 * A store's blogs (wave 7 unit G, D341, `src/server/blogs.ts`, the only writer): the first (`main`) is at `/blog`, made for every store
 * by a trigger (`stores_first_blog()`), the others at `/blogs/{handle}`. An article names its blog in its content (`PageContent.blogId`);
 * one that names none, or a blog that is gone, is the first blog's. `titles` is the blog's name per locale; `listing_page_id` a
 * published page drawn at the blog's address instead of the standard list (the first blog's is the `blog` page role, D112, so it
 * stays null there); `comments` whether visitors may comment and how their comments are shown (decision 3 of the wave's spec).
 */
export const blogs = commerce.table(
  "blogs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    handle: text("handle").notNull(),
    main: boolean("main").notNull().default(false),
    titles: jsonb("titles").notNull().default({}),
    listingPageId: uuid("listing_page_id").references(() => pages.id, { onDelete: "set null" }),
    comments: text("comments").notNull().default("moderated"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("blogs_store_handle_key").on(t.storeId, t.handle),
    unique("blogs_store_id_key").on(t.storeId, t.id),
    uniqueIndex("blogs_one_main_idx").on(t.storeId).where(sql`${t.main}`),
    index("blogs_listing_page_idx").on(t.listingPageId),
    check("blogs_handle_format", sql`${t.handle} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(${t.handle}) <= 60`),
    check("blogs_comments", sql`${t.comments} in ('off', 'moderated', 'automatic')`),
    check("blogs_main_lists_by_role", sql`not ${t.main} or ${t.listingPageId} is null`),
  ],
);

/**
 * The people a store's articles are written by (D341, `src/server/blogs.ts`): a name, a picture from the store's media library, a short
 * text and a link (checked by `isSafeAddress()`), chosen on an article (`PageContent.authorId`) and shown on it and in its JSON-LD. An
 * article without one keeps its free-text author name (D57).
 */
export const blogAuthors = commerce.table(
  "blog_authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    pictureUrl: text("picture_url"),
    bio: text("bio").notNull().default(""),
    link: text("link"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("blog_authors_store_id_key").on(t.storeId, t.id),
    check("blog_authors_name", sql`length(btrim(${t.name})) between 1 and 100`),
    check("blog_authors_bio", sql`length(${t.bio}) <= 600`),
    check("blog_authors_link", sql`${t.link} is null or length(${t.link}) <= 500`),
  ],
);

/**
 * Visitors' comments on a store's articles (D341, `src/server/blog-comments.ts`, the only writer): a name, an optional email (never
 * shown), plain text, the article, and a status: `pending` (held for staff, the default), `approved` (shown), `rejected` or `spam`
 * (never shown; deleted 30 days later by `runRetention()`). `spam_reasons` is what the check in code found; `body_hash` the normalised
 * text's hash, so the same text posted again is found. No IP address or cookie is kept. Personal data (D162): exported and erased by
 * the email.
 */
export const blogComments = commerce.table(
  "blog_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    pageId: uuid("page_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    locale: text("locale").notNull(),
    status: text("status").notNull().default("pending"),
    spamReasons: text("spam_reasons").array().notNull().default(sql`'{}'::text[]`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "blog_comments_page_fk", columns: [t.storeId, t.pageId], foreignColumns: [pages.storeId, pages.id] }).onDelete("cascade"),
    index("blog_comments_page_idx").on(t.storeId, t.pageId, t.status, t.createdAt),
    index("blog_comments_status_idx").on(t.storeId, t.status, t.createdAt),
    index("blog_comments_hash_idx").on(t.storeId, t.bodyHash, t.createdAt),
    index("blog_comments_email_idx").on(t.storeId, sql`lower(${t.email})`),
    index("blog_comments_decided_by_idx").on(t.decidedBy),
    check("blog_comments_status", sql`${t.status} in ('pending', 'approved', 'rejected', 'spam')`),
    check("blog_comments_name", sql`length(btrim(${t.name})) between 1 and 80`),
    check("blog_comments_body", sql`length(btrim(${t.body})) between 1 and 2000`),
    check("blog_comments_email", sql`${t.email} is null or length(${t.email}) <= 254`),
  ],
);

/**
 * A page's draft published at a set time (D341 for articles and pages; D340, `docs/wave-7-storefront.md` F, adds headers, footers and a
 * way back): written only by `src/server/page-schedules.ts`, run by `runSchedules()` in the five-minute dispatcher in the name of
 * `scheduled_by`, read again then (`passMembership()`). One waiting schedule per page; `acknowledged` holds the checker's blocking issues
 * the person chose to publish with (as the builder's Publish anyway). The way back (D340) is a second leg: at `revert_at` the published
 * content from before (`before_content`; null: the page was not published, so it is taken off the site) is put back, only while the page is
 * still live as the publish left it (`published_hash`); `page_schedules_rules()` settles each leg once.
 */
export const pageSchedules = commerce.table(
  "page_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    pageId: uuid("page_id").notNull(),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    scheduledBy: uuid("scheduled_by").references(() => accounts.id, { onDelete: "set null" }),
    acknowledged: text("acknowledged").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("waiting"),
    problem: text("problem"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
    /** When the version before is put back (D340); null: no way back. */
    revertAt: timestamp("revert_at", { withTimezone: true }),
    /** The way back's own leg: `waiting`, `done`, `failed` or `cancelled`; null exactly when `revert_at` is. */
    revertStatus: text("revert_status"),
    revertProblem: text("revert_problem"),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    /** The published content the publish replaced (null: none, so going back takes the page off the site). */
    beforeContent: jsonb("before_content"),
    /** md5 of the content the publish put live, so the way back touches only a page still as it left it. */
    publishedHash: text("published_hash"),
  },
  (t) => [
    foreignKey({ name: "page_schedules_page_fk", columns: [t.storeId, t.pageId], foreignColumns: [pages.storeId, pages.id] }).onDelete("cascade"),
    uniqueIndex("page_schedules_one_waiting_idx").on(t.pageId).where(sql`${t.status} = 'waiting'`),
    uniqueIndex("page_schedules_one_revert_idx").on(t.pageId).where(sql`${t.revertStatus} = 'waiting'`),
    index("page_schedules_due_idx").on(t.publishAt).where(sql`${t.status} = 'waiting'`),
    index("page_schedules_revert_due_idx").on(t.revertAt).where(sql`${t.revertStatus} = 'waiting'`),
    index("page_schedules_store_idx").on(t.storeId, t.pageId),
    index("page_schedules_scheduled_by_idx").on(t.scheduledBy),
    check("page_schedules_status", sql`${t.status} in ('waiting', 'done', 'failed', 'cancelled')`),
    check("page_schedules_revert_status", sql`${t.revertStatus} is null or ${t.revertStatus} in ('waiting', 'done', 'failed', 'cancelled')`),
    check("page_schedules_revert", sql`(${t.revertAt} is null) = (${t.revertStatus} is null) and (${t.revertAt} is null or ${t.revertAt} > ${t.publishAt})`),
  ],
);

/**
 * A store's plan to make one of its installed themes live at a set time, and optionally to put the theme that was live back at another
 * (D340, `docs/wave-7-storefront.md` F): written only by `src/server/theme-schedules.ts`, run by `runSchedules()` in the name of
 * `scheduled_by` (read again then), through `switchToInstall()`. One waiting plan and one waiting way back per store; each leg settled once
 * (`theme_schedules_rules()`). A removed install leaves its plan with no install (it fails, its record kept).
 */
export const themeSchedules = commerce.table(
  "theme_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    installId: uuid("install_id").references(() => storeThemeInstalls.id, { onDelete: "set null" }),
    liveAt: timestamp("live_at", { withTimezone: true }).notNull(),
    revertAt: timestamp("revert_at", { withTimezone: true }),
    scheduledBy: uuid("scheduled_by").references(() => accounts.id, { onDelete: "set null" }),
    status: text("status").notNull().default("waiting"),
    problem: text("problem"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    revertStatus: text("revert_status"),
    revertProblem: text("revert_problem"),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    /** The install that was live when the plan ran: the one the way back makes live again. */
    beforeInstallId: uuid("before_install_id").references(() => storeThemeInstalls.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("theme_schedules_one_waiting_idx").on(t.storeId).where(sql`${t.status} = 'waiting'`),
    uniqueIndex("theme_schedules_one_revert_idx").on(t.storeId).where(sql`${t.revertStatus} = 'waiting'`),
    index("theme_schedules_due_idx").on(t.liveAt).where(sql`${t.status} = 'waiting'`),
    index("theme_schedules_revert_due_idx").on(t.revertAt).where(sql`${t.revertStatus} = 'waiting'`),
    index("theme_schedules_store_idx").on(t.storeId, t.createdAt),
    index("theme_schedules_install_idx").on(t.installId),
    index("theme_schedules_before_install_idx").on(t.beforeInstallId),
    index("theme_schedules_scheduled_by_idx").on(t.scheduledBy),
    check("theme_schedules_status", sql`${t.status} in ('waiting', 'done', 'failed', 'cancelled')`),
    check("theme_schedules_revert_status", sql`${t.revertStatus} is null or ${t.revertStatus} in ('waiting', 'done', 'failed', 'cancelled')`),
    check("theme_schedules_revert", sql`(${t.revertAt} is null) = (${t.revertStatus} is null) and (${t.revertAt} is null or ${t.revertAt} > ${t.liveAt})`),
  ],
);

/**
 * A link that opens one unpublished page's draft or one installed theme without signing in (D340, `docs/wave-7-storefront.md` F): the
 * token kept only as its SHA-256, an expiry of at most 30 days, revoked once. Written only by `src/server/preview-links.ts`; a token is read
 * only by `previewLinkOf()`. Never copied with a store.
 */
export const previewLinks = commerce.table(
  "preview_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    pageId: uuid("page_id"),
    installId: uuid("install_id").references(() => storeThemeInstalls.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [
    foreignKey({ name: "preview_links_page_fk", columns: [t.storeId, t.pageId], foreignColumns: [pages.storeId, pages.id] }).onDelete("cascade"),
    uniqueIndex("preview_links_token_idx").on(t.tokenHash),
    index("preview_links_page_idx").on(t.storeId, t.pageId),
    index("preview_links_install_idx").on(t.installId),
    index("preview_links_created_by_idx").on(t.createdBy),
    index("preview_links_revoked_by_idx").on(t.revokedBy),
    check("preview_links_target", sql`num_nonnulls(${t.pageId}, ${t.installId}) = 1`),
    check("preview_links_token", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("preview_links_expiry", sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '30 days'`),
  ],
);

/**
 * The live look as each save left it (D340, `docs/wave-7-storefront.md` F): the whole `stores.theme` after a save in Design settings
 * (`design`), the page builder's Theme tab (`theme_tab`) or its saved colours (`colours`). Written only by `keepLookVersion()` in the save's
 * own transaction, never changed, the newest 50 per store; taken back into the theme editor as unsaved changes.
 */
export const lookVersions = commerce.table(
  "look_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    kind: text("kind").notNull(),
    theme: jsonb("theme").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("look_versions_store_idx").on(t.storeId, t.createdAt),
    index("look_versions_created_by_idx").on(t.createdBy),
    check("look_versions_kind", sql`${t.kind} in ('design', 'theme_tab', 'colours')`),
    check("look_versions_theme", sql`jsonb_typeof(${t.theme}) = 'object'`),
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
    /**
     * When the file was last compressed until it was as small as it could be while it still looked the same (D213): at upload
     * or by the library's Compress. Null for files from before, which Compress offers; a compressed file is never compressed
     * again, so a picture cannot lose a little more each time.
     */
    compressedAt: timestamp("compressed_at", { withTimezone: true }),
    /** Who made the file (D349): `person` (an upload), `ai_made` (by the site's picture model from a description) or `ai_edited` (a library picture changed by its edit model). */
    madeBy: text("made_by").notNull().default("person"),
    /** The library picture an `ai_edited` one was made from; the original is never overwritten. */
    editedFrom: uuid("edited_from").references((): AnyPgColumn => media.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("media_url_key").on(t.url),
    index("media_edited_from_idx").on(t.editedFrom),
    check("media_made_by", sql`${t.madeBy} in ('person', 'ai_made', 'ai_edited')`),
    check("media_edited", sql`(${t.madeBy} = 'ai_edited') or ${t.editedFrom} is null`),
    // The site finds a picture's alt text by either address (D89).
    index("media_thumbnail_url_idx").on(t.thumbnailUrl),
    index("media_store_created_idx").on(t.storeId, t.createdAt),
    index("media_created_by_idx").on(t.createdBy),
    check("media_kind", sql`${t.kind} in ('image', 'video', 'model')`),
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
    /**
     * A store's product category's or tag's own page (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.1): a description in the main language (Tiptap JSON,
     * cleaned by `cleanRichText()`, null when none) and a picture from the media library with its small copy.
     */
    description: jsonb("description"),
    imageUrl: text("image_url"),
    imageThumbnailUrl: text("image_thumbnail_url"),
    /**
     * The name and description in the store's other languages (D319): `{ "sv-SE": { "name": "…", "description": {…} } }`, keyed as `seo` is, read only
     * through `termTextFor()` (`src/lib/term-texts.ts`): a language's own, else the main language's, never another language's.
     */
    texts: jsonb("texts").notNull().default({}),
    /**
     * A collection filled by rules (D319, `docs/wave-6-catalogue.md` 3.3): `{ match, conditions }` as `termRulesSchema` (`src/lib/term-rules.ts`) checks
     * it, null for one the owner fills by hand. Its products are worked out when read (`commerce.product_matches_rules()`), never `product_terms` rows.
     */
    rules: jsonb("rules"),
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
    check("terms_texts_object", sql`jsonb_typeof(${t.texts}) = 'object'`),
    check("terms_description_doc", sql`${t.description} is null or jsonb_typeof(${t.description}) = 'object'`),
    check(
      "terms_page_parts",
      sql`(${t.description} is null and ${t.imageUrl} is null and ${t.texts} = '{}'::jsonb) or (${t.contentType} = 'product' and ${t.storeId} is not null)`,
    ),
    check("terms_image_pair", sql`${t.imageThumbnailUrl} is null or ${t.imageUrl} is not null`),
    check(
      "terms_rules",
      sql`${t.rules} is null or (jsonb_typeof(${t.rules}) = 'object' and ${t.contentType} = 'product' and ${t.storeId} is not null and not ${t.requiresUnitPrice})`,
    ),
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
    /**
     * The product's place in the owner's order of the term (wave 6 unit A, D319): 0, 1, 2 … as `setTermOrder()` wrote them; null is not placed by hand
     * (a product added since), listed after the placed ones by when it was made.
     */
    position: integer("position"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.termId] }),
    // Cover both composite foreign keys.
    index("product_terms_product_idx").on(t.storeId, t.productId),
    index("product_terms_term_idx").on(t.storeId, t.contentType, t.termId),
    check("product_terms_content_type", sql`${t.contentType} = 'product'`),
    check("product_terms_position", sql`${t.position} is null or ${t.position} >= 0`),
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
 * A store's search merchandising (wave 6 unit F2, D324, `docs/wave-6-catalogue.md` F.2): a product put first (`pin`, in `position` order), a
 * product or a category or tag moved up (`boost`) or down (`bury`), or a search sent to a page of the store (`redirect`, `target` in
 * `normaliseTarget()`'s normal form). For searches holding one of `queries` (`contains`) or being one (`exact`); boosts and buries with none
 * are for every search. Written only by `src/server/search-rules.ts`, at most 200 a store (`search_rules_rules()`).
 */
export const searchRules = commerce.table(
  "search_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    action: text("action").notNull(),
    productId: uuid("product_id"),
    termId: uuid("term_id"),
    /** Always `product`: a term of the catalogue, for the composite key to `terms`. */
    contentType: text("content_type").notNull().default("product"),
    target: text("target"),
    queries: text("queries").array().notNull().default(sql`'{}'::text[]`),
    match: text("match").notNull().default("contains"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("search_rules_store_idx").on(t.storeId, t.position),
    index("search_rules_product_idx").on(t.storeId, t.productId),
    index("search_rules_term_idx").on(t.storeId, t.contentType, t.termId),
    productRef("search_rules_product_fk", t),
    foreignKey({
      name: "search_rules_term_fk",
      columns: [t.storeId, t.contentType, t.termId],
      foreignColumns: [terms.storeId, terms.contentType, terms.id],
    }).onDelete("cascade"),
    check("search_rules_action", sql`${t.action} in ('pin', 'boost', 'bury', 'redirect')`),
    check("search_rules_match", sql`${t.match} in ('contains', 'exact')`),
    check("search_rules_content_type", sql`${t.contentType} = 'product'`),
    check("search_rules_position", sql`${t.position} between 0 and 1000`),
    check("search_rules_queries", sql`cardinality(${t.queries}) <= 20`),
    check(
      "search_rules_shape",
      sql`case ${t.action}
        when 'pin' then ${t.productId} is not null and ${t.termId} is null and ${t.target} is null and cardinality(${t.queries}) >= 1
        when 'redirect' then ${t.target} is not null and ${t.productId} is null and ${t.termId} is null and cardinality(${t.queries}) >= 1
        else ${t.target} is null and ((${t.productId} is null) <> (${t.termId} is null)) end`,
    ),
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
    /** The language (two letters) this domain is the store's address for (D313); null for every language (the primary's). */
    language: text("language"),
    /** The country (a market code) this domain is the store's address for (D338); never with a language, nor on the primary. */
    market: char("market", { length: 2 }),
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
    uniqueIndex("store_domains_language_idx").on(t.storeId, t.language).where(sql`${t.language} is not null`),
    check("store_domains_language", sql`${t.language} is null or ${t.language} ~ '^[a-z]{2}$'`),
    check("store_domains_primary_language", sql`not ${t.isPrimary} or ${t.language} is null`),
    uniqueIndex("store_domains_market_idx").on(t.storeId, t.market).where(sql`${t.market} is not null`),
    check("store_domains_market", sql`${t.market} is null or ${t.market} ~ '^[A-Z]{2}$'`),
    check("store_domains_primary_market", sql`not ${t.isPrimary} or ${t.market} is null`),
    check("store_domains_language_or_market", sql`${t.language} is null or ${t.market} is null`),
    check(
      "store_domains_hostname",
      sql`${t.hostname} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$' and length(${t.hostname}) <= 253`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Domains bought and DNS kept by Kaizena Flow (D315, docs/domains.md)
// ---------------------------------------------------------------------------

/**
 * Who a domain is registered to (D315 decision 1): the store's owner or their company, never Kaizena Flow. Filled in from the store's
 * business details and confirmed by the owner; `extra` holds the fields a TLD asks for. Personal data (`PERSONAL_DATA`): kept while a
 * registration uses it.
 */
export const domainRegistrants = commerce.table(
  "domain_registrants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The store that uses it (D317: a domain may be held by an account and used by no store). */
    storeId: uuid("store_id").references(() => stores.id),
    /** Who holds it (D317, `docs/domains-standalone.md` 2): the account, whether or not a store uses it. */
    accountId: uuid("account_id").references(() => accounts.id),
    kind: text("kind").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    companyName: text("company_name"),
    orgNumber: text("org_number"),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    address1: text("address1").notNull(),
    address2: text("address2"),
    city: text("city").notNull(),
    state: text("state").notNull().default(""),
    postalCode: text("postal_code").notNull(),
    country: char("country", { length: 2 }).notNull(),
    extra: jsonb("extra").notNull().default({}),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("domain_registrants_kind", sql`${t.kind} in ('person', 'company')`),
    check("domain_registrants_company", sql`${t.kind} = 'person' or ${t.companyName} is not null`),
    check("domain_registrants_country", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "domain_registrants_lengths",
      sql`length(${t.firstName}) between 1 and 100 and length(${t.lastName}) between 1 and 100 and length(${t.email}) between 3 and 254
        and length(${t.phone}) between 4 and 20 and length(${t.address1}) between 1 and 200 and length(${t.city}) between 1 and 100
        and length(${t.postalCode}) between 1 and 20`,
    ),
    index("domain_registrants_store_idx").on(t.storeId),
    index("domain_registrants_created_by_idx").on(t.createdBy),
    check("domain_registrants_holder", sql`${t.storeId} is not null or ${t.accountId} is not null`),
    index("domain_registrants_account_idx").on(t.accountId),
  ],
);

/**
 * A domain Kaizena Flow registered for a store (D315 4.4): one live row per name. `renew` is the owner's choice; the registrar's own
 * auto-renew follows it (`docs/domains.md` 9.1). A registration moved to another registrar ends as `transferred_out`; nothing is deleted.
 */
export const domainRegistrations = commerce.table(
  "domain_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The store that uses it (D317: a domain may be held by an account and used by no store). */
    storeId: uuid("store_id").references(() => stores.id),
    /** Who holds it (D317, `docs/domains-standalone.md` 2): the account, whether or not a store uses it. */
    accountId: uuid("account_id").references(() => accounts.id),
    apex: text("apex").notNull(),
    registrar: text("registrar").notNull(),
    status: text("status").notNull().default("active"),
    registrantId: uuid("registrant_id").references(() => domainRegistrants.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    renew: boolean("renew").notNull().default(true),
    /** What the registrar's own auto-renew is set to, as Kaizena Flow last set it. */
    registrarRenews: boolean("registrar_renews").notNull().default(true),
    contactVerified: boolean("contact_verified"),
    contactCheckedAt: timestamp("contact_checked_at", { withTimezone: true }),
    transferredOutAt: timestamp("transferred_out_at", { withTimezone: true }),
    /** When the owner was shown the transfer code (D315 8.1): the move is watched from then until it completes or is given up. */
    transferStartedAt: timestamp("transfer_started_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("domain_registrations_registrar", sql`${t.registrar} in ('vercel')`),
    check("domain_registrations_status", sql`${t.status} in ('active', 'expired', 'transferring_out', 'transferred_out')`),
    check("domain_registrations_apex", sql`${t.apex} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'`),
    uniqueIndex("domain_registrations_live_idx").on(t.apex).where(sql`${t.status} <> 'transferred_out'`),
    index("domain_registrations_store_idx").on(t.storeId),
    index("domain_registrations_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'active'`),
    index("domain_registrations_registrant_idx").on(t.registrantId),
    index("domain_registrations_created_by_idx").on(t.createdBy),
    check("domain_registrations_holder", sql`${t.storeId} is not null or ${t.accountId} is not null`),
    index("domain_registrations_account_idx").on(t.accountId),
  ],
);

/**
 * Money for a domain (D315 4.4): paid first, registered after. `quoted` once the owner pressed the button that named the price, `invoiced`
 * on Kaizena Flow's Stripe account, `paid` when Stripe says so, `registering` while the registrar works, `done`; or `failed` and `refunded`
 * (the registration could not be made, so the money goes back), `void` (an invoice never paid). Only forward, never deleted
 * (`commerce.domain_purchases_rules()`). The price is ours, without VAT, in the store's billing currency; `cost` is the registrar's.
 */
export const domainPurchases = commerce.table(
  "domain_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The store that uses it (D317: a domain may be held by an account and used by no store). */
    storeId: uuid("store_id").references(() => stores.id),
    /** Who holds it (D317, `docs/domains-standalone.md` 2): the account, whether or not a store uses it. */
    accountId: uuid("account_id").references(() => accounts.id),
    registrationId: uuid("registration_id").references(() => domainRegistrations.id),
    registrantId: uuid("registrant_id").references(() => domainRegistrants.id),
    apex: text("apex").notNull(),
    kind: text("kind").notNull(),
    years: integer("years").notNull().default(1),
    status: text("status").notNull().default("quoted"),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    registrar: text("registrar").notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }).notNull(),
    costCurrency: char("cost_currency", { length: 3 }).notNull(),
    /** Whether the store is connected to the name once registered (the owner may buy one only to keep). */
    connect: boolean("connect").notNull().default(true),
    mode: text("mode"),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    invoiceNumber: text("invoice_number"),
    invoiceUrl: text("invoice_url"),
    collection: text("collection"),
    registrarOrderId: text("registrar_order_id"),
    /**
     * A transfer's code from the losing registrar (D315 8.5), encrypted with `SETTINGS_ENCRYPTION_KEY` while the purchase waits for its
     * payment, and cleared the moment it is handed to the registrar, or when the purchase fails or is voided. Never shown or logged.
     */
    authCodeBox: text("auth_code_box"),
    /** Who buys, for a purchase made without a store (D317 6): a consumer or a business; null for a store's (billed as a business). */
    buyer: text("buyer"),
    /** The VAT the invoice carries (D317 6): Norwegian MVA, reverse charge (the buyer's number), or outside the scope of VAT. */
    vatKind: text("vat_kind"),
    vatNumber: text("vat_number"),
    /** A consumer's express consent that registration starts now and the right of withdrawal ends with it (D317 7), and its words. */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentText: text("consent_text"),
    /** Why a paid purchase waits for a platform admin before the registrar is asked (D317 10): a name to look at, or a risky payment. */
    review: text("review"),
    reviewOutcome: text("review_outcome"),
    reviewedBy: uuid("reviewed_by").references(() => accounts.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    problem: text("problem"),
    tries: integer("tries").notNull().default(0),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    chosenBy: uuid("chosen_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("domain_purchases_kind", sql`${t.kind} in ('register', 'renew', 'transfer')`),
    check("domain_purchases_status", sql`${t.status} in ('quoted', 'invoiced', 'paid', 'registering', 'done', 'failed', 'refunded', 'void')`),
    check("domain_purchases_years", sql`${t.years} between 1 and 10`),
    check("domain_purchases_amount", sql`${t.amountMinor} > 0`),
    check("domain_purchases_currency", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.costCurrency} ~ '^[A-Z]{3}$'`),
    check("domain_purchases_registrar", sql`${t.registrar} in ('vercel')`),
    check("domain_purchases_mode", sql`${t.mode} is null or ${t.mode} in ('test', 'live')`),
    check("domain_purchases_collection", sql`${t.collection} is null or ${t.collection} in ('card', 'invoice')`),
    check("domain_purchases_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
    uniqueIndex("domain_purchases_open_idx")
      .on(t.apex, t.kind)
      .where(sql`${t.status} in ('quoted', 'invoiced', 'paid', 'registering')`),
    index("domain_purchases_store_idx").on(t.storeId, t.createdAt),
    index("domain_purchases_work_idx").on(t.status, t.nextTryAt).where(sql`${t.status} in ('quoted', 'paid', 'registering', 'failed')`),
    index("domain_purchases_registration_idx").on(t.registrationId),
    index("domain_purchases_registrant_idx").on(t.registrantId),
    index("domain_purchases_chosen_by_idx").on(t.chosenBy),
    check("domain_purchases_holder", sql`${t.storeId} is not null or ${t.accountId} is not null`),
    index("domain_purchases_reviewed_by_idx").on(t.reviewedBy),
    index("domain_purchases_account_idx").on(t.accountId),
    check("domain_purchases_buyer", sql`${t.buyer} is null or ${t.buyer} in ('consumer', 'business')`),
    check("domain_purchases_vat_kind", sql`${t.vatKind} is null or ${t.vatKind} in ('mva', 'reverse_charge', 'outside_scope')`),
    check("domain_purchases_review", sql`${t.review} is null or ${t.review} in ('name', 'risk')`),
    check("domain_purchases_review_outcome", sql`${t.reviewOutcome} is null or ${t.reviewOutcome} in ('approved', 'refused')`),
  ],
);

/**
 * How Kaizena Flow prices domains in a currency (D315 decision 3): the registrar's price converted at the ECB reference rate, plus the margin,
 * rounded up to `round_minor`, never below `minimum_minor` a year. Set by platform admins at `/admin/platform/domains`; a currency with no
 * row is not sold in. Never a price in code.
 */
export const domainPricing = commerce.table(
  "domain_pricing",
  {
    currency: char("currency", { length: 3 }).primaryKey(),
    marginBps: integer("margin_bps").notNull().default(2500),
    minimumMinor: bigint("minimum_minor", { mode: "number" }).notNull(),
    roundMinor: bigint("round_minor", { mode: "number" }).notNull().default(100),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("domain_pricing_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("domain_pricing_margin", sql`${t.marginBps} between 0 and 50000`),
    check("domain_pricing_minimum", sql`${t.minimumMinor} >= 0`),
    check("domain_pricing_round", sql`${t.roundMinor} between 1 and 100000`),
    index("domain_pricing_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * A domain whose DNS Kaizena Flow keeps for a store on Vercel DNS (D315 5): its records are Vercel's, read live; this row says it is the
 * store's. `leaving` while the owner moves DNS away (`docs/domains.md` 8.2), `left` after. With cells (D314) zones stay in the control
 * plane's team.
 */
export const dnsZones = commerce.table(
  "dns_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The store that uses it (D317: a domain may be held by an account and used by no store). */
    storeId: uuid("store_id").references(() => stores.id),
    /** Who holds it (D317, `docs/domains-standalone.md` 2): the account, whether or not a store uses it. */
    accountId: uuid("account_id").references(() => accounts.id),
    apex: text("apex").notNull(),
    host: text("host").notNull().default("vercel"),
    status: text("status").notNull().default("active"),
    /**
     * When public DNS first showed Vercel's nameservers for it (D315 5.4): until then a zone moving here is filled and checked, but the
     * internet still asks the old provider. Bought here, it arrives at once.
     */
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    /** When the nameservers moved away (D315 8.2): the zone is kept read-only, with *Switch back*, for 30 days from then. */
    leavingAt: timestamp("leaving_at", { withTimezone: true }),
    /** The nameservers it moved to, as the owner gave them. */
    movedTo: jsonb("moved_to"),
    leftAt: timestamp("left_at", { withTimezone: true }),
    /** What the domain shows while no store uses it (D317 8): a holding page, a redirect to `holding_redirect`, or nothing. */
    holding: text("holding").notNull().default("parked"),
    holdingRedirect: text("holding_redirect"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("dns_zones_host", sql`${t.host} in ('vercel')`),
    check("dns_zones_status", sql`${t.status} in ('active', 'leaving', 'left')`),
    uniqueIndex("dns_zones_live_idx").on(t.apex).where(sql`${t.status} <> 'left'`),
    index("dns_zones_store_idx").on(t.storeId),
    index("dns_zones_created_by_idx").on(t.createdBy),
    check("dns_zones_holder", sql`${t.storeId} is not null or ${t.accountId} is not null`),
    index("dns_zones_account_idx").on(t.accountId),
    check("dns_zones_holding", sql`${t.holding} in ('parked', 'redirect', 'off') and (${t.holding} <> 'redirect' or ${t.holdingRedirect} is not null)`),
  ],
);

/**
 * Every change to a kept zone's records (D315 5.1), whoever made it: the records before and after (`DnsRecord` lists, ids included), where
 * it came from and who. Append-only by trigger; only `undone_at` is set, once, by `undoDnsChange()`.
 */
export const dnsChanges = commerce.table(
  "dns_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => dnsZones.id),
    /** The store that uses it (D317: a domain may be held by an account and used by no store). */
    storeId: uuid("store_id").references(() => stores.id),
    source: text("source").notNull(),
    summary: text("summary").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    undoOf: uuid("undo_of"),
    actorId: uuid("actor_id").references(() => accounts.id, { onDelete: "set null" }),
    automatic: boolean("automatic").notNull().default(false),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("dns_changes_source", sql`${t.source} in ('editor', 'ai_manager', 'recipe', 'kaizena', 'undo', 'import')`),
    check("dns_changes_summary", sql`length(${t.summary}) between 1 and 2000`),
    index("dns_changes_zone_idx").on(t.zoneId, t.createdAt),
    index("dns_changes_store_idx").on(t.storeId, t.createdAt),
    index("dns_changes_undo_of_idx").on(t.undoOf),
    index("dns_changes_actor_idx").on(t.actorId),
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
    /** The model that edits pictures (D349), at the picture provider's `/images/edits`; none leaves editing unavailable. */
    imageEditModel: text("image_edit_model"),
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
    /** How its picture is framed on the site (`AvatarStyle`, `src/lib/chat-avatar.ts`): fill behind it, border and shadow; null is the standard look. */
    avatarStyle: jsonb("avatar_style"),
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
 * What a store used, per UTC day and metric (D314, `docs/capacity.md` 3): gauges as measured that day, counters summed over it
 * (`USAGE_METRICS` in `src/lib/usage-metrics.ts`). `store_id` null is Kaizena Flow's own site. Written only by
 * `src/server/usage-meter.ts` and the traffic drain (`src/server/usage-traffic.ts`); kept 25 months. Counts and bytes only: no person,
 * address, path or query.
 */
export const storeUsageDaily = commerce.table(
  "store_usage_daily",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    /** Scaled up from a sample (traffic with a drain sampling rate below 1). */
    estimated: boolean("estimated").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("store_usage_daily_key").on(t.storeId, t.day, t.metric).nullsNotDistinct(),
    index("store_usage_daily_day_idx").on(t.day),
    check("store_usage_daily_value", sql`${t.value} >= 0`),
    check("store_usage_daily_metric", sql`${t.metric} in (${sqlList(USAGE_METRIC_IDS)})`),
  ],
);

/**
 * A plan's limits (D314, `docs/capacity.md` 4): one row per plan and `LIMITS` key; `plan_id` null is the platform default. A row whose
 * value is null means unlimited; no row means the next source decides (`effectiveLimit()`). Edited on the platform's Plans page.
 */
export const planLimits = commerce.table(
  "plan_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: bigint("value", { mode: "number" }),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id),
  },
  (t) => [
    unique("plan_limits_key").on(t.planId, t.key).nullsNotDistinct(),
    index("plan_limits_updated_by_idx").on(t.updatedBy),
    check("plan_limits_value", sql`${t.value} is null or ${t.value} >= 0`),
    check("plan_limits_known", sql`${t.key} in (${sqlList(LIMIT_KEYS)})`),
  ],
);

/** A platform admin's limit for one store or one owner (D314), above or below the plan's, with the reason and an optional end. */
export const limitOverrides = commerce.table(
  "limit_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: bigint("value", { mode: "number" }),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    unique("limit_overrides_key").on(t.storeId, t.accountId, t.key).nullsNotDistinct(),
    index("limit_overrides_account_idx").on(t.accountId),
    index("limit_overrides_created_by_idx").on(t.createdBy),
    check("limit_overrides_target", sql`(${t.storeId} is null) <> (${t.accountId} is null)`),
    check("limit_overrides_reason", sql`length(trim(${t.reason})) between 1 and 300`),
    check("limit_overrides_value", sql`${t.value} is null or ${t.value} >= 0`),
    check("limit_overrides_known", sql`${t.key} in (${sqlList(LIMIT_KEYS)})`),
  ],
);

/**
 * A busy time an owner told Kaizena Flow about (D314, `docs/capacity.md` 6, step 4.1): a sale or a launch, so the platform can make
 * room before it and traffic warnings wait. At most 14 days long; kept 12 months.
 */
export const capacityEvents = commerce.table(
  "capacity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** `busy` or `very_busy`. */
    expected: text("expected").notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => accounts.id),
  },
  (t) => [
    index("capacity_events_store_idx").on(t.storeId, t.startsAt),
    index("capacity_events_starts_idx").on(t.startsAt),
    index("capacity_events_created_by_idx").on(t.createdBy),
    check("capacity_events_expected", sql`${t.expected} in ('busy', 'very_busy')`),
    check("capacity_events_span", sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} <= ${t.startsAt} + interval '14 days'`),
    check("capacity_events_note", sql`length(${t.note}) <= 300`),
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
    /** The autopilot's step that kept this call (D309): its decision settles the step (`settleStepApproval()`). */
    planStepId: uuid("plan_step_id"),
  },
  (t) => [
    foreignKey({ name: "assistant_approvals_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("cascade"),
    foreignKey({ name: "assistant_approvals_plan_step_fk", columns: [t.planStepId], foreignColumns: [assistantPlanSteps.id] }).onDelete("set null"),
    index("assistant_approvals_plan_step_idx").on(t.planStepId),
    index("assistant_approvals_conversation_idx").on(t.conversationId, t.createdAt),
    index("assistant_approvals_store_idx").on(t.storeId, t.status),
    index("assistant_approvals_account_idx").on(t.accountId),
    check("assistant_approvals_category", sql`${t.category} in ('send', 'public', 'spend', 'domain', 'access', 'plan')`),
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
    /** Web searches made (D329). */
    searches: integer("searches").notNull().default(0),
    /** The tokens are counted here (about four characters each) because the provider did not say. */
    estimated: boolean("estimated").notNull().default(false),
    /** A live voice call's session at its provider, to add its length when it ends. */
    sessionRef: text("session_ref"),
    /** Who made the call (`currentActor()`): the autopilot's budget counts every call it made, whatever the feature. */
    actedBy: text("acted_by").notNull().default("person"),
  },
  (t) => [
    index("ai_usage_created_idx").on(t.createdAt),
    index("ai_usage_store_idx").on(t.storeId, t.createdAt),
    index("ai_usage_owner_idx").on(t.ownerAccountId, t.createdAt),
    index("ai_usage_actor_idx").on(t.actorAccountId),
    index("ai_usage_autopilot_idx").on(t.storeId, t.createdAt).where(sql`${t.actedBy} = 'autopilot'`),
    check("ai_usage_acted_by", sql`${t.actedBy} in ('person', 'ai_manager', 'autopilot')`),
    check("ai_usage_source", sql`${t.source} in ('platform', 'store')`),
    check("ai_usage_kind", sql`${t.kind} in ('text', 'embedding', 'transcription', 'speech', 'image', 'live', 'search')`),
    check(
      "ai_usage_amounts",
      sql`${t.requests} >= 0 and ${t.failed} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.characters} >= 0 and ${t.audioBytes} >= 0 and ${t.audioSeconds} >= 0 and ${t.images} >= 0 and ${t.searches} >= 0`,
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

/**
 * Gift cards (wave 5 unit F, D300, `docs/wave-5-marketing.md` 8): money paid now for someone to spend later in the same store, a
 * multi-purpose voucher (no VAT when sold). A card's balance is only `commerce.gift_card_balance()` over its ledger, which only the
 * `gift_card_*` SQL functions write. The code is never stored: `code_hash` is its HMAC, `last4` what people see.
 */
export const giftCards = commerce.table(
  "gift_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** HMAC-SHA-256 of the normalised code; null only between the card's row and its code being made. */
    codeHash: text("code_hash"),
    last4: text("last4"),
    currency: char("currency", { length: 3 }).notNull(),
    initialMinor: bigint("initial_minor", { mode: "number" }).notNull(),
    /** `order` (bought), `staff` (issued by hand) or `refund` (store credit from a refund of the order, D364). */
    source: text("source").notNull(),
    orderId: uuid("order_id"),
    /** The `store_credit` refund this card was issued for (D364); one card a refund. */
    refundId: uuid("refund_id"),
    orderLineId: uuid("order_line_id"),
    /** Which of the line's units this card is (1, 2, …): a line of three cards issues three, once each. */
    unitIndex: integer("unit_index"),
    issuedBy: uuid("issued_by").references(() => accounts.id),
    note: text("note").notNull().default(""),
    /** `active` or `deactivated`; spent and expired are read from the balance and the date. */
    status: text("status").notNull().default("active"),
    /** A card issued for a Stripe test-mode payment: never spent in live mode. */
    testMode: boolean("test_mode").notNull().default(false),
    /** Who it was issued to when they were signed in (cleared by erasure). */
    customerId: uuid("customer_id"),
    recipientEmail: text("recipient_email"),
    recipientName: text("recipient_name"),
    message: text("message"),
    sendAt: timestamp("send_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedBy: uuid("deactivated_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gift_cards_store_id_key").on(t.storeId, t.id),
    uniqueIndex("gift_cards_code_key").on(t.storeId, t.codeHash).where(sql`${t.codeHash} is not null`),
    uniqueIndex("gift_cards_order_line_key").on(t.storeId, t.orderLineId, t.unitIndex).where(sql`${t.orderLineId} is not null`),
    uniqueIndex("gift_cards_refund_key").on(t.storeId, t.refundId).where(sql`${t.refundId} is not null`),
    foreignKey({ name: "gift_cards_refund_fk", columns: [t.storeId, t.refundId], foreignColumns: [refunds.storeId, refunds.id] }),
    foreignKey({ name: "gift_cards_order_fk", columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }),
    index("gift_cards_order_idx").on(t.storeId, t.orderId).where(sql`${t.orderId} is not null`),
    index("gift_cards_customer_idx").on(t.storeId, t.customerId).where(sql`${t.customerId} is not null`),
    index("gift_cards_issued_by_idx").on(t.issuedBy),
    index("gift_cards_deactivated_by_idx").on(t.deactivatedBy),
    index("gift_cards_to_send_idx").on(t.sendAt).where(sql`${t.sentAt} is null and ${t.codeHash} is not null`),
    check("gift_cards_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gift_cards_initial", sql`${t.initialMinor} > 0`),
    check("gift_cards_source", sql`(${t.source} = 'order' and ${t.orderId} is not null and ${t.orderLineId} is not null and ${t.unitIndex} >= 1) or (${t.source} = 'staff' and ${t.orderId} is null and ${t.orderLineId} is null and ${t.unitIndex} is null and ${t.issuedBy} is not null) or (${t.source} = 'refund' and ${t.orderId} is not null and ${t.refundId} is not null and ${t.orderLineId} is null and ${t.unitIndex} is null)`),
    check("gift_cards_status", sql`${t.status} in ('active', 'deactivated') and ((${t.status} = 'deactivated') = (${t.deactivatedAt} is not null))`),
    check("gift_cards_code", sql`(${t.codeHash} is null) = (${t.last4} is null) and (${t.last4} is null or ${t.last4} ~ '^[A-Z0-9]{4}$')`),
    check("gift_cards_recipient", sql`(${t.recipientEmail} is null or length(${t.recipientEmail}) <= 254) and (${t.recipientName} is null or length(${t.recipientName}) <= 80) and (${t.message} is null or length(${t.message}) <= 500)`),
    check("gift_cards_note", sql`length(${t.note}) <= 500`),
  ],
);

/** A gift card's ledger (D300): append-only, written only by the `gift_card_*` functions, each once per key. */
export const giftCardEntries = commerce.table(
  "gift_card_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    cardId: uuid("card_id").notNull(),
    /** `issue`, `hold`, `release`, `spend`, `refund`, `adjust`, `expire` or `void`. */
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    orderId: uuid("order_id"),
    accountId: uuid("account_id").references(() => accounts.id),
    note: text("note").notNull().default(""),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gift_card_entries_key").on(t.storeId, t.cardId, t.idempotencyKey),
    foreignKey({ name: "gift_card_entries_card_fk", columns: [t.storeId, t.cardId], foreignColumns: [giftCards.storeId, giftCards.id] }),
    foreignKey({ name: "gift_card_entries_order_fk", columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }),
    index("gift_card_entries_card_idx").on(t.storeId, t.cardId, t.createdAt),
    index("gift_card_entries_order_idx").on(t.storeId, t.orderId).where(sql`${t.orderId} is not null`),
    index("gift_card_entries_account_idx").on(t.accountId),
    check("gift_card_entries_kind", sql`${t.kind} in ('issue', 'hold', 'release', 'spend', 'refund', 'adjust', 'expire', 'void')`),
    check(
      "gift_card_entries_sign",
      sql`(${t.kind} in ('issue', 'release', 'refund') and ${t.amountMinor} > 0) or (${t.kind} in ('hold', 'expire', 'void') and ${t.amountMinor} < 0)
        or (${t.kind} = 'spend' and ${t.amountMinor} = 0) or (${t.kind} = 'adjust' and ${t.amountMinor} <> 0)`,
    ),
    check("gift_card_entries_order", sql`${t.kind} not in ('hold', 'release', 'spend', 'refund') or ${t.orderId} is not null`),
    // A person adjusts; a card is voided by a person, or by its order's withdrawal (D300 F2, with the order).
    check("gift_card_entries_staff", sql`(${t.kind} <> 'adjust' or ${t.accountId} is not null) and (${t.kind} <> 'void' or ${t.accountId} is not null or ${t.orderId} is not null)`),
    check("gift_card_entries_note", sql`length(${t.note}) <= 500 and (${t.kind} <> 'adjust' or length(trim(${t.note})) > 0)`),
  ],
);

/**
 * The gift cards a cart will pay with (D300 F3): found by their code at the cart or checkout (`findGiftCard()`, by hash; the code is never kept here), in the
 * order added, at most three. Nothing is held until the order is placed; what each pays is worked out again each time (`giftCardsPay()`).
 */
export const cartGiftCards = commerce.table(
  "cart_gift_cards",
  {
    storeId: storeId(),
    cartId: uuid("cart_id").notNull(),
    cardId: uuid("card_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.cartId, t.cardId] }),
    cartRef("cart_gift_cards_cart_fk", t).onDelete("cascade"),
    foreignKey({ name: "cart_gift_cards_card_fk", columns: [t.storeId, t.cardId], foreignColumns: [giftCards.storeId, giftCards.id] }),
    index("cart_gift_cards_card_idx").on(t.storeId, t.cardId),
  ],
);

/** A store's gift card rules (D300): how long a card lasts, fixed on each card when it is issued. */
export const giftCardSettings = commerce.table(
  "gift_card_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    /** Months a card lasts from its issue; null: it never expires. */
    expiryMonths: integer("expiry_months").default(36),
    updatedAt: updatedAt(),
  },
  (t) => [check("gift_card_settings_expiry", sql`${t.expiryMonths} is null or ${t.expiryMonths} between 12 and 120`)],
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
    /** A monthly net-sales target's month (the first form, D152); null for every other target. Kept in step with `starts_on` by the database. */
    month: date("month", { mode: "string" }),
    /** A monthly net-sales target's amount; null for every other target. Kept in step with `target_value`. */
    revenueTargetMinor: bigint("revenue_target_minor", { mode: "number" }),
    /** What the target counts (D348): `net_sales` and `aov` in minor units of the main currency without VAT, `orders` a count, `conversion` basis points. */
    metric: text("metric").notNull().default("net_sales"),
    period: text("period").notNull().default("month"),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    targetValue: bigint("target_value", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("analytics_targets_month_key").on(t.storeId, t.month),
    uniqueIndex("analytics_targets_period_key").on(t.storeId, t.metric, t.period, t.startsOn),
    check("analytics_targets_first_of_month", sql`${t.month} is null or ${t.month} = date_trunc('month', ${t.month}::timestamp)::date`),
    check("analytics_targets_amount", sql`${t.revenueTargetMinor} is null or ${t.revenueTargetMinor} > 0`),
    check("analytics_targets_metric", sql`${t.metric} in ('net_sales', 'orders', 'conversion', 'aov')`),
    check("analytics_targets_period", sql`${t.period} in ('week', 'month', 'quarter', 'custom')`),
    check("analytics_targets_value", sql`${t.targetValue} > 0 and (${t.metric} <> 'conversion' or ${t.targetValue} <= 10000)`),
    check(
      "analytics_targets_bounds",
      sql`${t.endsOn} >= ${t.startsOn} and ${t.endsOn} <= ${t.startsOn} + 730 and case ${t.period}
        when 'week' then extract(isodow from ${t.startsOn}) = 1 and ${t.endsOn} = ${t.startsOn} + 6
        when 'month' then ${t.startsOn} = date_trunc('month', ${t.startsOn}::timestamp)::date and ${t.endsOn} = (date_trunc('month', ${t.startsOn}::timestamp) + interval '1 month - 1 day')::date
        when 'quarter' then ${t.startsOn} = date_trunc('quarter', ${t.startsOn}::timestamp)::date and ${t.endsOn} = (date_trunc('quarter', ${t.startsOn}::timestamp) + interval '3 months - 1 day')::date
        else true end`,
    ),
    // The first form's two columns are a monthly net-sales target's, and say what the new ones say.
    check(
      "analytics_targets_first_form",
      sql`(${t.month} is null) = (${t.revenueTargetMinor} is null) and (${t.month} is null
        or (${t.metric} = 'net_sales' and ${t.period} = 'month' and ${t.month} = ${t.startsOn} and ${t.revenueTargetMinor} = ${t.targetValue}))`,
    ),
  ],
);

/**
 * A report an owner saved (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` A.3): its name and its spec (`ReportSpec`, the catalogue's keys
 * only, checked again whenever it is read), never its figures: a saved report reruns on fresh data. Written only by `src/server/saved-reports.ts`.
 */
export const savedReports = commerce.table(
  "saved_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    spec: jsonb("spec").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("saved_reports_store_idx").on(t.storeId, t.title),
    index("saved_reports_created_by_idx").on(t.createdBy),
    index("saved_reports_updated_by_idx").on(t.updatedBy),
    check("saved_reports_title", sql`length(btrim(${t.title})) between 1 and 80`),
    check("saved_reports_spec", sql`jsonb_typeof(${t.spec}) = 'object' and length(${t.spec}::text) <= 20000`),
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
    /**
     * The visitor's first visit in the last 30 days (D303 I3), only for one who allowed statistics cookies: its channel, source,
     * campaign and day, from the first-party `kaizen_touch_{store}` cookie (`recordTouch()`); null without consent.
     */
    firstChannel: text("first_channel"),
    firstSource: text("first_source"),
    firstCampaign: text("first_campaign"),
    firstDay: date("first_day", { mode: "string" }),
  },
  (t) => [
    unique("visits_day_visitor_key").on(t.storeId, t.day, t.visitor),
    index("visits_store_day_idx").on(t.storeId, t.day),
    check("visits_visitor", sql`${t.visitor} ~ '^[0-9a-f]{24}$'`),
    check("visits_device", sql`${t.device} in ('mobile', 'tablet', 'desktop')`),
    check("visits_channel", sql`${t.channel} in (${channelList})`),
    check("visits_text_lengths", sql`length(${t.source}) <= 100 and length(${t.campaign}) <= 100 and length(${t.landingPath}) <= 300`),
    check("visits_counts", sql`${t.pageViews} >= 0 and ${t.productViews} >= 0`),
    check("visits_first_channel", sql`${t.firstChannel} is null or ${t.firstChannel} in (${channelList})`),
    check("visits_first_lengths", sql`length(${t.firstSource}) <= 100 and length(${t.firstCampaign}) <= 100`),
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
 * An order bought on payment terms (wave 4 unit F, D293, `docs/wave-4-payments.md` 8): the company it was bought for, its terms and the day its money
 * is due. Written by `placeOrder()` in the order's own transaction (before the order is paid, so the bonus and referral triggers see it) and afterwards
 * only by `src/server/payment-terms.ts` (the reminder's and the overdue notice's claims, `paid_at`). The order's `balance_minor` is what is owed; it is
 * 0 once paid or cancelled. `company_id` is nulled when the company is deleted, which is refused while it owes anything.
 */
export const orderPaymentTerms = commerce.table(
  "order_payment_terms",
  {
    orderId: uuid("order_id").primaryKey(),
    storeId: storeId().references(() => stores.id),
    companyId: uuid("company_id"),
    terms: text("terms").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    overdueSentAt: timestamp("overdue_sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    orderRef("order_payment_terms_order_fk", t),
    foreignKey({
      name: "order_payment_terms_company_fk",
      columns: [t.storeId, t.companyId],
      foreignColumns: [customerCompanies.storeId, customerCompanies.id],
    }),
    index("order_payment_terms_order_idx").on(t.storeId, t.orderId),
    index("order_payment_terms_company_idx").on(t.storeId, t.companyId).where(sql`${t.paidAt} is null`),
    index("order_payment_terms_due_idx").on(t.dueOn).where(sql`${t.paidAt} is null`),
    check("order_payment_terms_terms", sql`${t.terms} in (${sqlList(PAYMENT_TERMS)})`),
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
    /** `product_import`, `product_export`, `order_export`, `customer_export`, `redirect_import`, `redirect_export` (wave 2, D168), `inventory_import`, `inventory_export` (wave 3, D172), `customer_import` (wave 10, D366). */
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
    // One customer import is open per store at a time (wave 10 unit C, D366), beside the others.
    uniqueIndex("data_jobs_one_active_customer_import_idx")
      .on(t.storeId)
      .where(sql`${t.kind} = 'customer_import' and ${t.status} in ('uploaded', 'checking', 'checked', 'queued', 'running')`),
    check(
      "data_jobs_kind",
      sql`${t.kind} in ('product_import', 'product_export', 'order_export', 'customer_export', 'redirect_import', 'redirect_export', 'inventory_import', 'inventory_export', 'customer_import')`,
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
      sql`${t.kind} in ('product_import', 'redirect_import', 'inventory_import', 'customer_import') or (${t.inputPath} is null and ${t.inputSha256} is null and ${t.format} is distinct from 'shopify')`,
    ),
    check("data_jobs_import_no_files", sql`${t.kind} not in ('product_import', 'redirect_import', 'inventory_import', 'customer_import') or ${t.files} = '[]'::jsonb`),
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
    /** `product` (one product of the file), `redirect` (one line of a redirect file, wave 2, D168), `stock` (one row of a stock file, wave 3, D172), `customer` (one row of a customer file, wave 10, D366; its `ref` is null, never the address) or `file` (a finding about the file as a whole). */
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
    check("data_job_items_kind", sql`${t.kind} in ('product', 'redirect', 'stock', 'customer', 'file')`),
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
    /** `status`, `archive`, `unarchive`, `terms_add`, `terms_remove`, `price`, `stock`, `grid`, `undo`, `sell_in` or `stop_selling_in` (D335). */
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
      sql`${t.action} in ('status', 'archive', 'unarchive', 'terms_add', 'terms_remove', 'price', 'stock', 'grid', 'undo', 'sell_in', 'stop_selling_in')`,
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
      sql`${t.field} in ('status', 'archived', 'terms', 'stock', 'cost', 'sku', 'availability') or ${t.field} ~ '^price:[A-Z]{2}$'`,
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
    /** `manual`, `product`, `category`, `tag` or `entry` (D326). */
    kind: text("kind").notNull(),
    /** The address that redirects: market-relative, lower case, a leading `/`, no trailing `/`, no query or fragment, at most 500 characters. */
    source: text("source").notNull(),
    /** Manual only: where to go, market-relative (a path with an optional `?query` and `#fragment`, at most 2,000 characters); `/` is the front page. */
    target: text("target"),
    /** Product only: the product whose handle it was. */
    productId: uuid("product_id"),
    /** Category and tag only: the term whose address it was. */
    termId: uuid("term_id").references(() => terms.id, { onDelete: "cascade" }),
    /** Entry only (D326): the content entry whose page address it was. */
    entryId: uuid("entry_id").references(() => contentEntries.id, { onDelete: "cascade" }),
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
    index("redirects_entry_idx").on(t.entryId),
    index("redirects_created_by_idx").on(t.createdBy),
    check("redirects_kind", sql`${t.kind} in ('manual', 'product', 'category', 'tag', 'entry')`),
    check("redirects_origin", sql`${t.origin} in ('editor', 'import', 'report', 'assistant', 'system')`),
    check(
      "redirects_kind_columns",
      sql`(${t.kind} = 'manual' and ${t.target} is not null and ${t.productId} is null and ${t.termId} is null and ${t.entryId} is null)
        or (${t.kind} = 'product' and ${t.target} is null and ${t.productId} is not null and ${t.termId} is null and ${t.entryId} is null)
        or (${t.kind} in ('category', 'tag') and ${t.target} is null and ${t.productId} is null and ${t.termId} is not null and ${t.entryId} is null)
        or (${t.kind} = 'entry' and ${t.target} is null and ${t.productId} is null and ${t.termId} is null and ${t.entryId} is not null)`,
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
/**
 * The codes an order used (D299 E2, `docs/wave-5-marketing.md` 7.2), one row each in the order applied, with what each took off in the order's
 * currency; written only with the order by `insertOrder()`. The code's and the generated code's ids are kept without a reference: a code can be
 * deleted after use, and the order keeps its words. Not personal.
 */
export const orderDiscountCodes = commerce.table(
  "order_discount_codes",
  {
    storeId: storeId(),
    orderId: uuid("order_id").notNull(),
    position: integer("position").notNull(),
    code: text("code").notNull(),
    discountId: uuid("discount_id"),
    itemId: uuid("item_id"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    orderRef("order_discount_codes_order_fk", t).onDelete("restrict"),
    index("order_discount_codes_discount_idx").on(t.storeId, t.discountId),
    index("order_discount_codes_item_idx").on(t.storeId, t.itemId).where(sql`${t.itemId} is not null`),
    check("order_discount_codes_position", sql`${t.position} between 1 and 5`),
    check("order_discount_codes_amount", sql`${t.amountMinor} >= 0`),
  ],
);

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
    /** When the customer's card is charged (D289): at checkout, when the order is sent, or when staff capture it. */
    capture: text("capture").notNull().default("at_checkout"),
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
    check("order_settings_capture", sql`${t.capture} in (${sqlList(CAPTURE_SETTINGS)})`),
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

// ---------------------------------------------------------------------------
// Support (D216, docs/support.md)
// ---------------------------------------------------------------------------

/**
 * A desk's support settings (D216): a store's, or Kaizen's (`store_id` null). `mode` says who answers its customers: the chat
 * agent alone (`off`), the AI first and then people (`ai_first`), or people only (`people`). Made on first use.
 */
export const supportSettings = commerce.table(
  "support_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("off"),
    emailFollowup: boolean("email_followup").notNull().default(true),
    /** `OpeningHours` (D40) in the store's time zone; null: whenever an agent is online. */
    hours: jsonb("hours"),
    endAfterMinutes: smallint("end_after_minutes").notNull().default(30),
    /** The silent partner may run on this desk (each agent also has their own switch). */
    partner: boolean("partner").notNull().default(true),
    toneOn: boolean("tone_on").notNull().default(true),
    summariesOn: boolean("summaries_on").notNull().default(true),
    toneAlert: smallint("tone_alert").default(-40),
    toneHandoff: smallint("tone_handoff").default(-60),
    notifyAfterMinutes: smallint("notify_after_minutes").notNull().default(5),
    /** The customer actions the AI may propose (`CUSTOMER_ACTION_KINDS`); null: all of them. */
    aiActions: text("ai_actions").array(),
    transcriptDays: smallint("transcript_days").notNull().default(90),
    agentNaming: text("agent_naming").notNull().default("first_name"),
    /** The desk's realtime topic (`sd:{key}`): random, handed out only after the inbox's own check. */
    channelKey: text("channel_key").notNull().default(sql`replace(gen_random_uuid()::text, '-', '')`),
    /** The desk's email address `desk-{key}@{SUPPORT_INBOUND_DOMAIN}` (D332): random, made when the settings first show it; it only routes mail. */
    emailKey: text("email_key"),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("support_settings_store_key").on(t.storeId).nullsNotDistinct(),
    unique("support_settings_email_key").on(t.emailKey),
    check("support_settings_email_key_shape", sql`${t.emailKey} is null or ${t.emailKey} ~ '^[a-z0-9]{12,32}$'`),
    index("support_settings_updated_by_idx").on(t.updatedBy),
    check("support_settings_mode", sql`${t.mode} in ('off', 'ai_first', 'people')`),
    check("support_settings_end_after", sql`${t.endAfterMinutes} between 10 and 240`),
    check("support_settings_tone_alert", sql`${t.toneAlert} is null or ${t.toneAlert} between -100 and 0`),
    check("support_settings_tone_handoff", sql`${t.toneHandoff} is null or ${t.toneHandoff} between -100 and 0`),
    check("support_settings_notify_after", sql`${t.notifyAfterMinutes} between 1 and 60`),
    check("support_settings_transcript_days", sql`${t.transcriptDays} in (30, 60, 90)`),
    check("support_settings_agent_naming", sql`${t.agentNaming} in ('first_name', 'desk')`),
  ],
);

/**
 * A support conversation (D216): between a customer of a store (or a visitor of Kaizen's site, or an account asking Kaizen from
 * the admin) and a desk. Its state (`status`, `handler`, `assignee_id`) changes only through `commerce.support_transition()`, and
 * its messages are written only by `commerce.support_add_message()`. The visitor's token is kept only as a hash.
 */
export const supportConversations = commerce.table(
  "support_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizen's desk. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** `site` (a site's chat) or `admin` (an account asking Kaizen). */
    source: text("source").notNull(),
    status: text("status").notNull().default("open"),
    handler: text("handler").notNull(),
    /** The desk's mode when the conversation started (step 14's reports), set by a trigger; null before step 14. */
    deskMode: text("desk_mode"),
    assigneeId: uuid("assignee_id").references(() => accounts.id, { onDelete: "set null" }),
    /** sha-256 hex of the visitor's tab token. */
    tokenHash: text("token_hash"),
    /** sha-256 hex of the email link's token. */
    emailTokenHash: text("email_token_hash"),
    /** The signed-in customer (store desks only). */
    customerId: uuid("customer_id"),
    /** The account asking Kaizen (source `admin`). */
    requesterId: uuid("requester_id").references(() => accounts.id, { onDelete: "set null" }),
    /** The store an owner asks Kaizen about. */
    aboutStoreId: uuid("about_store_id").references(() => stores.id, { onDelete: "set null" }),
    market: text("market"),
    locale: text("locale").notNull(),
    /** Typed by the visitor for the email follow-up: never proof of anything. */
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    pagePath: text("page_path"),
    tone: smallint("tone"),
    toneAlertAt: timestamp("tone_alert_at", { withTimezone: true }),
    handoffReason: text("handoff_reason"),
    aiReason: text("ai_reason"),
    messageSeq: integer("message_seq").notNull().default(0),
    /** The last customer message the silent partner has answered. */
    partnerSeq: integer("partner_seq").notNull().default(0),
    partnerPaused: boolean("partner_paused").notNull().default(false),
    visitorSeenAt: timestamp("visitor_seen_at", { withTimezone: true }),
    emailSentSeq: integer("email_sent_seq").notNull().default(0),
    emailCount: smallint("email_count").notNull().default(0),
    /** When the last answer email went out (at most one every `EMAIL_EVERY_MINUTES`, D216 step 5). */
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    contactChanges: smallint("contact_changes").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastCustomerAt: timestamp("last_customer_at", { withTimezone: true }),
    firstAgentAt: timestamp("first_agent_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    waitingAlertAt: timestamp("waiting_alert_at", { withTimezone: true }),
    /** `{title, text, outcome, topics, followUp, at, editedBy?, editedAt?}`, written by AI for staff. */
    summary: jsonb("summary"),
    summaryStatus: text("summary_status").notNull().default("none"),
    summaryTries: smallint("summary_tries").notNull().default(0),
    /** `{seq, text, at}`: the conversation so far, for an agent taking over. */
    brief: jsonb("brief"),
    rating: text("rating"),
    ratingComment: text("rating_comment"),
    /** The conversation's realtime topic (`sc:{key}`). */
    channelKey: text("channel_key").notNull().default(sql`replace(gen_random_uuid()::text, '-', '')`),
    /** The transcript was deleted and the personal fields cleared; only counts stay. */
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    /** The conversation's reply address `reply-{key}@{SUPPORT_INBOUND_DOMAIN}` (D332), the Reply-To of its answer emails. */
    replyKey: text("reply_key"),
    /** A conversation by email (D332): its subject, and the Message-ID of the customer's last email, for threading the answers. */
    emailSubject: text("email_subject"),
    emailMessageId: text("email_message_id"),
  },
  (t) => [
    unique("support_conversations_token_key").on(t.tokenHash),
    unique("support_conversations_reply_key").on(t.replyKey),
    check("support_conversations_reply_key_shape", sql`${t.replyKey} is null or ${t.replyKey} ~ '^[a-z0-9]{12,32}$'`),
    check("support_conversations_email_fields", sql`coalesce(length(${t.emailSubject}) <= 200, true) and coalesce(length(${t.emailMessageId}) <= 998, true)`),
    unique("support_conversations_email_token_key").on(t.emailTokenHash),
    foreignKey({ name: "support_conversations_customer_fk", columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }).onDelete("set null"),
    index("support_conversations_list_idx").on(t.storeId, t.status, t.lastMessageAt),
    index("support_conversations_open_idx")
      .on(t.storeId, t.handler)
      .where(sql`${t.status} = 'open'`),
    index("support_conversations_assignee_idx")
      .on(t.assigneeId)
      .where(sql`${t.status} = 'open'`),
    index("support_conversations_customer_idx").on(t.storeId, t.customerId),
    index("support_conversations_requester_idx").on(t.requesterId),
    index("support_conversations_about_store_idx").on(t.aboutStoreId),
    index("support_conversations_ended_idx")
      .on(t.endedAt)
      .where(sql`${t.anonymisedAt} is null`),
    check("support_conversations_source", sql`${t.source} in ('site', 'admin', 'email')`),
    check("support_conversations_status", sql`${t.status} in ('open', 'ended')`),
    check("support_conversations_desk_mode", sql`${t.deskMode} is null or ${t.deskMode} in ('off', 'ai_first', 'people')`),
    check("support_conversations_handler", sql`${t.handler} in ('ai', 'queue', 'human')`),
    check("support_conversations_assignee", sql`(${t.assigneeId} is not null) = (${t.status} = 'open' and ${t.handler} = 'human') or ${t.anonymisedAt} is not null`),
    check("support_conversations_token", sql`${t.source} <> 'site' or ${t.tokenHash} is not null or ${t.anonymisedAt} is not null`),
    check("support_conversations_requester", sql`(${t.source} = 'admin') = (${t.requesterId} is not null) or ${t.anonymisedAt} is not null`),
    check("support_conversations_kaizen_customer", sql`${t.storeId} is not null or ${t.customerId} is null`),
    check("support_conversations_handoff_reason", sql`${t.handoffReason} is null or ${t.handoffReason} in ('customer', 'ai', 'tone', 'no_ai', 'limit')`),
    check("support_conversations_ended_by", sql`${t.endedBy} is null or ${t.endedBy} in ('customer', 'agent', 'timeout', 'system')`),
    check("support_conversations_summary_status", sql`${t.summaryStatus} in ('none', 'pending', 'done', 'failed', 'skipped')`),
    check("support_conversations_rating", sql`${t.rating} is null or ${t.rating} in ('good', 'bad')`),
    check("support_conversations_tone", sql`${t.tone} is null or ${t.tone} between -100 and 100`),
    check(
      "support_conversations_lengths",
      sql`coalesce(length(${t.contactName}) <= 120, true) and coalesce(length(${t.contactEmail}) <= 254, true) and coalesce(length(${t.pagePath}) <= 300, true) and coalesce(length(${t.aiReason}) <= 200, true) and coalesce(length(${t.ratingComment}) <= 500, true) and length(${t.locale}) between 2 and 16`,
    ),
    check("support_conversations_emails", sql`${t.emailCount} between 0 and 20 and ${t.contactChanges} between 0 and 3`),
  ],
);

/** A support action (D216): something the AI proposed for the customer to confirm, or a request for a person to decide. */
export const supportActions = commerce.table(
  "support_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => supportConversations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** `customer` (self-service, on their Confirm) or `staff` (a person decides). */
    confirmer: text("confirmer").notNull(),
    args: jsonb("args").notNull(),
    /** What it does, in words made by code from the checked arguments. */
    summary: text("summary").notNull(),
    /** The AI's description of a staff request. */
    details: text("details"),
    status: text("status").notNull().default("proposed"),
    result: jsonb("result"),
    decidedBy: uuid("decided_by").references(() => accounts.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("support_actions_conversation_idx").on(t.conversationId),
    index("support_actions_open_idx")
      .on(t.storeId, t.confirmer)
      .where(sql`${t.status} = 'proposed'`),
    index("support_actions_decided_by_idx").on(t.decidedBy),
    check("support_actions_confirmer", sql`${t.confirmer} in ('customer', 'staff')`),
    check("support_actions_status", sql`${t.status} in ('proposed', 'done', 'declined', 'failed', 'expired')`),
    check("support_actions_lengths", sql`length(${t.summary}) between 1 and 500 and coalesce(length(${t.details}) <= 500, true) and length(${t.kind}) between 1 and 60`),
    check("support_actions_expiry", sql`(${t.confirmer} = 'customer') = (${t.expiresAt} is not null)`),
  ],
);

/**
 * An email that came in for a support desk (D332, `docs/support.md` step 16): kept when Resend's `email.received` event arrives (its id
 * once), then routed, fetched, checked and added to a conversation by `src/server/support-inbound.ts`, its only writer. The sender's
 * address and the subject are personal data; rows go after `INBOUND_KEEP_DAYS`.
 */
export const supportInboundEmails = commerce.table(
  "support_inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Resend's id of the received email. */
    providerId: text("provider_id").notNull(),
    /** The desk it was for, once routed (null for Kaizena Flow's own desk or before routing; `routed` says which). */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    routed: boolean("routed").notNull().default(false),
    conversationId: uuid("conversation_id").references(() => supportConversations.id, { onDelete: "set null" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject"),
    messageId: text("message_id"),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    tries: smallint("tries").notNull().default(0),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("support_inbound_emails_provider_key").on(t.providerId),
    index("support_inbound_emails_pending_idx").on(t.createdAt).where(sql`status in ('pending', 'running')`),
    index("support_inbound_emails_store_idx").on(t.storeId, t.createdAt),
    index("support_inbound_emails_conversation_idx").on(t.conversationId),
    index("support_inbound_emails_from_idx").on(t.fromAddress, t.createdAt),
    check("support_inbound_emails_status", sql`${t.status} in ('pending', 'running', 'done', 'refused', 'failed')`),
    check(
      "support_inbound_emails_lengths",
      sql`length(${t.providerId}) between 1 and 200 and length(${t.fromAddress}) <= 320 and coalesce(length(${t.subject}) <= 200, true) and coalesce(length(${t.messageId}) <= 998, true) and coalesce(length(${t.reason}) <= 200, true)`,
    ),
  ],
);

/**
 * A message of a support conversation (D216), numbered gap-free per conversation. `note` (an agent's internal note) and `partner`
 * (the silent partner's help) are staff only and never reach the customer. Written only by `commerce.support_add_message()`.
 */
export const supportMessages = commerce.table(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => supportConversations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    author: text("author").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** A system line's kind, or the partner's (`suggestion`, `answer`, `brief`). */
    kind: text("kind"),
    data: jsonb("data"),
    actionId: uuid("action_id").references(() => supportActions.id, { onDelete: "set null" }),
    tone: smallint("tone"),
    toneLabel: text("tone_label"),
    /** `[{name, ok}]`: which tools an answer used; never their arguments or results. */
    tools: jsonb("tools"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("support_messages_seq_key").on(t.conversationId, t.seq),
    index("support_messages_account_idx").on(t.accountId),
    index("support_messages_action_idx").on(t.actionId),
    index("support_messages_store_idx").on(t.storeId),
    check("support_messages_author", sql`${t.author} in ('customer', 'ai', 'agent', 'system', 'note', 'partner')`),
    check(
      "support_messages_body",
      sql`case ${t.author} when 'customer' then length(${t.body}) between 1 and 1000 when 'ai' then length(${t.body}) between 1 and 2000 when 'agent' then length(${t.body}) between 1 and 4000 when 'note' then length(${t.body}) between 1 and 2000 when 'partner' then length(${t.body}) <= 3000 else ${t.body} = '' end`,
    ),
    check("support_messages_tone", sql`${t.tone} is null or (${t.author} = 'customer' and ${t.tone} between -100 and 100)`),
    check("support_messages_tone_label", sql`${t.toneLabel} is null or ${t.toneLabel} in ('happy', 'calm', 'neutral', 'confused', 'worried', 'frustrated', 'angry')`),
  ],
);

/** Who answers on a desk (D216): online or away, how many conversations at most, their own partner switch, the name customers see. */
export const supportAgents = commerce.table(
  "support_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("away"),
    maxChats: smallint("max_chats").notNull().default(5),
    partner: boolean("partner").notNull().default(true),
    displayName: text("display_name"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("support_agents_key").on(t.storeId, t.accountId).nullsNotDistinct(),
    index("support_agents_account_idx").on(t.accountId),
    check("support_agents_status", sql`${t.status} in ('online', 'away')`),
    check("support_agents_max_chats", sql`${t.maxChats} between 1 and 20`),
    check("support_agents_display_name", sql`coalesce(length(${t.displayName}) between 1 and 40, true)`),
  ],
);

/** How far each agent has read a conversation (D216), for the unread dots. */
export const supportReads = commerce.table(
  "support_reads",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => supportConversations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    lastReadSeq: integer("last_read_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.accountId] }), index("support_reads_account_idx").on(t.accountId)],
);

/** A desk's saved replies (D216). */
export const supportReplies = commerce.table(
  "support_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    shortcut: text("shortcut"),
    /** Null: any language. */
    locale: text("locale"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("support_replies_shortcut_key").on(t.storeId, t.shortcut).nullsNotDistinct(),
    index("support_replies_created_by_idx").on(t.createdBy),
    check("support_replies_lengths", sql`length(${t.title}) between 1 and 80 and length(${t.body}) between 1 and 2000 and coalesce(length(${t.shortcut}) between 1 and 20, true)`),
  ],
);

// ---------------------------------------------------------------------------
// Customer notifications, delivery tracking and staff alerts (wave 3, D238, docs/wave-3-notifications.md 3.2)
// ---------------------------------------------------------------------------

/**
 * A store's switch for one notification (`NOTIFICATIONS`, `src/lib/notifications.ts`); no row is the notification's default. A required one cannot be
 * stored off (`notification_settings_required`). Read only by `src/server/notifications.ts`.
 */
export const notificationSettings = commerce.table(
  "notification_settings",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    notification: text("notification").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.notification] }),
    index("notification_settings_updated_by_idx").on(t.updatedBy),
    check("notification_settings_notification", sql`${t.notification} in (${sqlList(NOTIFICATION_IDS)})`),
    check("notification_settings_required", sql`${t.enabled} or ${t.notification} not in (${sqlList(REQUIRED_NOTIFICATIONS)})`),
  ],
);

/**
 * A store's own words for one notification in one language (D238 4.2): the subject, the heading and the text block, each optional (a missing slot is the
 * standard text), never an empty string, never for a locked notification. The owner's words; read only by `src/server/notifications.ts`, written only by
 * `saveTemplate()` after `templateProblems()`.
 */
export const emailTemplates = commerce.table(
  "email_templates",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    notification: text("notification").notNull(),
    locale: text("locale").notNull(),
    subject: text("subject"),
    heading: text("heading"),
    body: text("body"),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.notification, t.locale] }),
    index("email_templates_updated_by_idx").on(t.updatedBy),
    check("email_templates_notification", sql`${t.notification} in (${sqlList(EDITABLE_NOTIFICATIONS)})`),
    check("email_templates_locale", sql`${t.locale} ~ '^[a-z]{2,3}$'`),
    check(
      "email_templates_slots",
      sql`(${t.subject} is not null or ${t.heading} is not null or ${t.body} is not null)
        and (${t.subject} is null or char_length(${t.subject}) between 1 and 150)
        and (${t.heading} is null or char_length(${t.heading}) between 1 and 120)
        and (${t.body} is null or char_length(${t.body}) between 1 and 2000)`,
    ),
  ],
);

/**
 * A store's staff alert settings (D238 2.4): `configured_at` null while the defaults hold (owners get new orders, returns requested and low stock; refunds
 * overdue go to the contact address), the summary's choice and the events of the store's contact address. Read only by `src/server/staff-alerts.ts`.
 */
export const staffAlertSettings = commerce.table(
  "staff_alert_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    configuredAt: timestamp("configured_at", { withTimezone: true }),
    summary: text("summary").notNull().default("off"),
    summaryWeekday: smallint("summary_weekday").notNull().default(1),
    summaryHour: smallint("summary_hour").notNull().default(8),
    /** The last period a summary was sent for (`summaryDue()`'s key); the five-minute job's guard. */
    summaryLastPeriod: text("summary_last_period"),
    contactEvents: text("contact_events").array().notNull().default(sql`'{}'::text[]`),
    /** The least severe analytics alert emailed (D348): `urgent`, `warning` or `info`; good news is never emailed. */
    alertFloor: text("alert_floor").notNull().default("warning"),
    /** The store day the analytics alerts were last checked for their email (D348), claimed before they are worked out. */
    alertsCheckedOn: date("alerts_checked_on", { mode: "string" }),
    /** When an owner answered *Not now* to the briefing's offer on Home (D348); the offer is not shown again. */
    briefingOfferDismissedAt: timestamp("briefing_offer_dismissed_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("staff_alert_settings_updated_by_idx").on(t.updatedBy),
    check("staff_alert_settings_alert_floor", sql`${t.alertFloor} in ('urgent', 'warning', 'info')`),
    check("staff_alert_settings_summary", sql`${t.summary} in ('off', 'daily', 'weekly')`),
    check("staff_alert_settings_weekday", sql`${t.summaryWeekday} between 1 and 7`),
    check("staff_alert_settings_hour", sql`${t.summaryHour} between 0 and 23`),
    check("staff_alert_settings_contact_events", sql`${t.contactEvents} <@ array[${sqlList(STAFF_ALERT_EVENTS)}]::text[]`),
    check("staff_alert_settings_last_period", sql`${t.summaryLastPeriod} is null or char_length(${t.summaryLastPeriod}) <= 40`),
  ],
);

/** A member chosen for staff alerts and the events they get (D238 2.4); a member with none has no row. Read only by `src/server/staff-alerts.ts`. */
export const staffAlertRecipients = commerce.table(
  "staff_alert_recipients",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    events: text("events").array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.accountId] }),
    index("staff_alert_recipients_account_idx").on(t.accountId),
    check("staff_alert_recipients_events", sql`cardinality(${t.events}) > 0 and ${t.events} <@ array[${sqlList(STAFF_ALERT_EVENTS)}]::text[]`),
  ],
);

/**
 * An analytics alert emailed to a store's staff (D348): one row per store, store day and alert (`Alert.id`), claimed before the email goes, so an alert is
 * emailed once a day however often the job runs. The alert's id and severity only; its words and figures are in the email. Deleted after 90 days by the
 * retention job.
 */
export const analyticsAlertSends = commerce.table(
  "analytics_alert_sends",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    alertId: text("alert_id").notNull(),
    severity: text("severity").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.day, t.alertId] }),
    check("analytics_alert_sends_alert", sql`char_length(${t.alertId}) between 1 and 80`),
    check("analytics_alert_sends_severity", sql`${t.severity} in ('urgent', 'warning', 'info')`),
  ],
);

/**
 * Something that happened to an order or a return that staff alerts and rules react to, once (D238 3.2, 3.3): written only by the queue triggers
 * (`commerce.queue_store_event()`, in the paying or returning transaction, `on conflict do nothing`), consumed every minute by `processStoreEvents()`
 * (rules first, then alerts, each part marked done). Ids and times only; deleted by the retention job 30 days after both parts are done or it failed.
 */
export const storeEvents = commerce.table(
  "store_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    /** The order (`order.paid`) or the return (`return.requested`). */
    subjectId: uuid("subject_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    alertsDoneAt: timestamp("alerts_done_at", { withTimezone: true }),
    rulesDoneAt: timestamp("rules_done_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("store_events_once_key").on(t.storeId, t.event, t.subjectId),
    index("store_events_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`(${t.alertsDoneAt} is null or ${t.rulesDoneAt} is null) and ${t.failedAt} is null`),
    check("store_events_event", sql`${t.event} in ('order.paid', 'return.requested')`),
    check("store_events_attempts", sql`${t.attempts} between 0 and 10`),
    check("store_events_last_error", sql`${t.lastError} is null or char_length(${t.lastError}) <= 500`),
  ],
);

/**
 * A store's automation rule (D238 2.5, 4.9): *when an order is paid and {conditions} then {actions}*, a closed list (`src/lib/order-rules.ts`), at most
 * 50 a store (`order_rules_limit`). `version` rises with every save, so a run says which rule it ran. Deleted for good; its runs keep its name.
 */
export const orderRules = commerce.table(
  "order_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    event: text("event").notNull().default("order.paid"),
    match: text("match").notNull().default("all"),
    conditions: jsonb("conditions").notNull().default([]),
    actions: jsonb("actions").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("order_rules_store_id_key").on(t.storeId, t.id),
    index("order_rules_position_idx").on(t.storeId, t.position),
    index("order_rules_created_by_idx").on(t.createdBy),
    index("order_rules_updated_by_idx").on(t.updatedBy),
    check("order_rules_name", sql`char_length(${t.name}) between 1 and 80 and ${t.name} = btrim(${t.name})`),
    check("order_rules_event", sql`${t.event} = 'order.paid'`),
    check("order_rules_match", sql`${t.match} in ('all', 'any')`),
    check(
      "order_rules_lists",
      sql`jsonb_typeof(${t.conditions}) = 'array' and jsonb_array_length(${t.conditions}) between 0 and 10
        and jsonb_typeof(${t.actions}) = 'array' and jsonb_array_length(${t.actions}) between 1 and 5`,
    ),
    check("order_rules_position", sql`${t.position} >= 0`),
    check("order_rules_version", sql`${t.version} >= 1`),
  ],
);

/**
 * One rule's run for one store event (D238 4.9): inserted first (`on conflict do nothing` on `(rule_id, event_id)`, so only the transaction that inserted it
 * acts), then its outcome. No foreign key to the rule: runs outlive a deleted rule and keep its name and version. Linked to a shopper only through the
 * order, with no personal field; deleted by the retention job 12 months after it ran.
 */
export const orderRuleRuns = commerce.table(
  "order_rule_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    ruleId: uuid("rule_id").notNull(),
    ruleName: text("rule_name").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    eventId: uuid("event_id").references(() => storeEvents.id, { onDelete: "set null" }),
    orderId: uuid("order_id").notNull(),
    matched: boolean("matched").notNull(),
    /** `{ conditions: [{ kind, met, why? }], actions: [{ kind, ok, problem? }] }` (`RunOutcome`); never a person's data. */
    outcome: jsonb("outcome").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique("order_rule_runs_once_key").on(t.ruleId, t.eventId),
    orderRef("order_rule_runs_order_fk", t).onDelete("restrict"),
    index("order_rule_runs_store_idx").on(t.storeId, t.createdAt.desc()),
    index("order_rule_runs_order_idx").on(t.storeId, t.orderId),
    index("order_rule_runs_event_idx").on(t.eventId),
    check("order_rule_runs_rule_name", sql`char_length(${t.ruleName}) between 1 and 80`),
    check("order_rule_runs_outcome", sql`jsonb_typeof(${t.outcome}) = 'object' and octet_length(${t.outcome}::text) < 8192`),
  ],
);

/**
 * A tracked parcel's carrier events as polled (D238 4.5): newest first, at most 30 (`{ at, code, phase, verified, description, location }`), the phase of
 * the newest that has one, when a verified code first said out for delivery or delivered, why polling stopped, and which emails went. Made on the parcel's
 * first check by `pollTracking()`, its only writer besides `undo_shipment()` (stops it) and `anonymise_order()` (clears the events, which can name a
 * person); the events are cleared 90 days after polling stopped. Never for a copied order.
 */
export const shipmentTracking = commerce.table(
  "shipment_tracking",
  {
    storeId: storeId(),
    shipmentId: uuid("shipment_id").notNull(),
    orderId: uuid("order_id").notNull(),
    carrier: text("carrier").notNull(),
    phase: text("phase").notNull().default("unknown"),
    phaseVerified: boolean("phase_verified").notNull().default(false),
    events: jsonb("events").notNull().default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    failures: integer("failures").notNull().default(0),
    outAt: timestamp("out_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    stopped: text("stopped"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    emailedOut: boolean("emailed_out").notNull().default(false),
    emailedDelivered: boolean("emailed_delivered").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.shipmentId] }),
    foreignKey({
      name: "shipment_tracking_shipment_fk",
      columns: [t.storeId, t.shipmentId],
      foreignColumns: [shipments.storeId, shipments.id],
    }).onDelete("restrict"),
    orderRef("shipment_tracking_order_fk", t).onDelete("restrict"),
    index("shipment_tracking_order_idx").on(t.storeId, t.orderId),
    index("shipment_tracking_due_idx").on(t.nextCheckAt).where(sql`${t.stopped} is null`),
    check("shipment_tracking_phase", sql`${t.phase} in (${sqlList(TRACKING_PHASES)})`),
    check("shipment_tracking_stopped", sql`(${t.stopped} is null) = (${t.stoppedAt} is null) and (${t.stopped} is null or ${t.stopped} in (${sqlList(TRACKING_STOPS)}))`),
    check("shipment_tracking_events", sql`jsonb_typeof(${t.events}) = 'array' and jsonb_array_length(${t.events}) <= 30`),
    check("shipment_tracking_failures", sql`${t.failures} >= 0`),
    check("shipment_tracking_carrier", sql`char_length(${t.carrier}) between 1 and 40`),
  ],
);

/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3): one row per store and address that asked for the store's marketing
 * email, with what they agreed to, when and how. Only `src/server/marketing-subscribers.ts` writes it, and the database moves a status only as
 * `commerce.marketing_subscribers_rules()` allows, writing each change into `marketing_consent_events`. Never copied (people's data).
 */
export const marketingSubscribers = commerce.table(
  "marketing_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** Lower case. */
    email: text("email").notNull(),
    /** The store's customer, only when a signed-in customer with a proven email subscribed; never matched from a typed address. */
    customerId: uuid("customer_id"),
    name: text("name").notNull().default(""),
    locale: text("locale").notNull(),
    marketCode: text("market_code"),
    status: text("status").notNull(),
    source: text("source").notNull(),
    /** The form's block id, or the order's id. */
    sourceRef: text("source_ref"),
    /** The words the person agreed to, as shown. */
    consentText: text("consent_text").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    /** When they opened the confirmation link (double opt-in); null for a signed-in verified customer, or a form with confirmation off. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** sha256 of the confirmation link's token, hex; gone once used. */
    confirmHash: text("confirm_hash"),
    confirmUntil: timestamp("confirm_until", { withTimezone: true }),
    /** The address's unsubscribe token, in every marketing email; it can only unsubscribe. */
    token: text("token").notNull(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    unsubscribeSource: text("unsubscribe_source"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("marketing_subscribers_store_id_key").on(t.storeId, t.id),
    uniqueIndex("marketing_subscribers_email_idx").on(t.storeId, sql`lower(${t.email})`),
    uniqueIndex("marketing_subscribers_token_idx").on(t.token),
    uniqueIndex("marketing_subscribers_confirm_idx").on(t.confirmHash),
    index("marketing_subscribers_list_idx").on(t.storeId, t.status, t.createdAt),
    index("marketing_subscribers_customer_idx").on(t.storeId, t.customerId),
    index("marketing_subscribers_pending_idx").on(t.confirmUntil).where(sql`${t.status} = 'pending'`),
    foreignKey({
      name: "marketing_subscribers_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }),
    check("marketing_subscribers_status", sql`${t.status} in (${sqlList(SUBSCRIBER_STATUSES)})`),
    check("marketing_subscribers_source", sql`${t.source} in (${sqlList(SUBSCRIBE_SOURCES)})`),
    check(
      "marketing_subscribers_unsubscribe_source",
      sql`${t.unsubscribeSource} is null or ${t.unsubscribeSource} in (${sqlList(UNSUBSCRIBE_SOURCES)})`,
    ),
    check("marketing_subscribers_email", sql`${t.email} = lower(${t.email}) and char_length(${t.email}) between 3 and 254 and position('@' in ${t.email}) > 1`),
    check("marketing_subscribers_token", sql`${t.token} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("marketing_subscribers_confirm", sql`${t.confirmHash} is null or ${t.confirmHash} ~ '^[0-9a-f]{64}$'`),
    check("marketing_subscribers_texts", sql`char_length(${t.consentText}) between 1 and 1000 and char_length(${t.name}) <= 200 and char_length(${t.locale}) <= 20`),
  ],
);

/**
 * A subscriber's consent history (D295): every change of status with its source and the words, written only by the subscribers' trigger and
 * never changed; it goes only with its subscriber (an erasure, or a pending sign-up whose link ran out).
 */
export const marketingConsentEvents = commerce.table(
  "marketing_consent_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    storeId: storeId().references(() => stores.id),
    subscriberId: uuid("subscriber_id").notNull(),
    kind: text("kind").notNull(),
    /** A subscribe source, or an unsubscribe source. */
    source: text("source").notNull(),
    consentText: text("consent_text"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "marketing_consent_events_subscriber_fk",
      columns: [t.storeId, t.subscriberId],
      foreignColumns: [marketingSubscribers.storeId, marketingSubscribers.id],
    }).onDelete("cascade"),
    index("marketing_consent_events_subscriber_idx").on(t.storeId, t.subscriberId, t.createdAt),
    check("marketing_consent_events_kind", sql`${t.kind} in (${sqlList(CONSENT_EVENT_KINDS)})`),
  ],
);

/**
 * A saved segment (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4.2): a name and rules over the store's people (`segmentRulesSchema`), never a
 * list of people; it is counted when read. At most `SEGMENTS_MAX` a store (a trigger), names unique per store. Written only by
 * `src/server/segments.ts`. The column is `title`, not `name`, so the privacy detector does not read it as a person's name.
 */
export const segments = commerce.table(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    title: text("title").notNull(),
    rules: jsonb("rules").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("segments_store_id_key").on(t.storeId, t.id),
    uniqueIndex("segments_title_idx").on(t.storeId, sql`lower(${t.title})`),
    index("segments_created_by_idx").on(t.createdBy),
    check("segments_title", sql`char_length(${t.title}) between 1 and 80 and ${t.title} = btrim(${t.title})`),
    check("segments_rules", sql`jsonb_typeof(${t.rules}) = 'object' and jsonb_typeof(${t.rules} -> 'conditions') = 'array' and jsonb_array_length(${t.rules} -> 'conditions') <= 20`),
  ],
);

/**
 * A staff tag on a person (D296, `docs/wave-5-marketing.md` 4.3): one row per address and tag, so a guest can be tagged too. `key` is the tag
 * trimmed and case-folded, `label` its first spelling, as D173's order tags. At most 50 per person (a trigger). Written only by
 * `src/server/segments.ts`; personal data (the address), deleted on erasure, never copied.
 */
export const customerTags = commerce.table(
  "customer_tags",
  {
    storeId: storeId().references(() => stores.id),
    /** Lower case. */
    email: text("email").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.email, t.key] }),
    index("customer_tags_key_idx").on(t.storeId, t.key),
    index("customer_tags_created_by_idx").on(t.createdBy),
    check("customer_tags_email", sql`${t.email} = lower(${t.email}) and char_length(${t.email}) between 3 and 254`),
    check("customer_tags_key", sql`char_length(${t.key}) between 1 and ${lit(TAG_MAX_LENGTH)} and ${t.key} = btrim(${t.key})`),
    check("customer_tags_label", sql`char_length(${t.label}) between 1 and ${lit(TAG_MAX_LENGTH)} and ${t.label} = btrim(${t.label})`),
    check("customer_tags_label_chars", sql`${t.label} !~ '[,\\x01-\\x1f\\x7f\\u202a-\\u202e\\u2066-\\u2069]'`),
  ],
);

/**
 * A staff note on a person (wave 10 unit C, D366): free text about a customer, by their address (lower case, as tags are, so a guest can have
 * notes too), with who wrote it and when. Added and deleted by staff with `customers:write`, never edited, written only by
 * `src/server/customer-staff.ts` (a merge and an email change move them with the person). Personal data: in the export (section `notes`),
 * deleted on erasure, never copied.
 */
export const customerNotes = commerce.table(
  "customer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    /** Lower case. */
    email: text("email").notNull(),
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customer_notes_store_id_key").on(t.storeId, t.id),
    index("customer_notes_email_idx").on(t.storeId, t.email, t.createdAt),
    index("customer_notes_created_by_idx").on(t.createdBy),
    check("customer_notes_email", sql`${t.email} = lower(${t.email}) and char_length(${t.email}) between 3 and 254`),
    check("customer_notes_body", sql`char_length(${t.body}) between 1 and ${lit(CUSTOMER_NOTE_MAX)} and ${t.body} = btrim(${t.body})`),
  ],
);

/**
 * A broadcast (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5.1): an email the store writes once, per language, and sends to its subscribed
 * addresses (everyone, or a segment's). `content` is `broadcastContentSchema`; the status moves only as `commerce.broadcasts_rules()` allows, and
 * the title, audience and content are fixed once a send starts. Only a draft is deleted. Written only by `src/server/broadcasts.ts`. Not personal
 * (the store's own words); never copied.
 */
export const broadcasts = commerce.table(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    title: text("title").notNull(),
    audience: text("audience").notNull().default("everyone"),
    /** The segment for `audience = 'segment'`; null when it was deleted, and the broadcast cannot be sent until another is chosen. */
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    content: jsonb("content").notNull().default({}),
    status: text("status").notNull().default("draft"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** Why a scheduled send could not start (it went back to draft). */
    scheduleProblem: text("schedule_problem"),
    /** Who it went to, in words, as the audience was when the send started. */
    audienceWords: text("audience_words"),
    recipientCount: integer("recipient_count"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The report's figures, frozen when the recipients were pruned. */
    counts: jsonb("counts"),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("broadcasts_store_id_key").on(t.storeId, t.id),
    index("broadcasts_list_idx").on(t.storeId, t.createdAt),
    index("broadcasts_due_idx").on(t.scheduledFor).where(sql`${t.status} = 'scheduled'`),
    index("broadcasts_sending_idx").on(t.status).where(sql`${t.status} = 'sending'`),
    index("broadcasts_segment_idx").on(t.segmentId),
    index("broadcasts_created_by_idx").on(t.createdBy),
    check("broadcasts_title", sql`char_length(${t.title}) between 1 and 80 and ${t.title} = btrim(${t.title})`),
    check("broadcasts_audience", sql`${t.audience} in (${sqlList(BROADCAST_AUDIENCES)})`),
    check("broadcasts_status", sql`${t.status} in (${sqlList(BROADCAST_STATUSES)})`),
    check("broadcasts_content", sql`jsonb_typeof(${t.content}) = 'object'`),
  ],
);

/**
 * A store's own broadcast templates (wave 10 unit E, D368): a broadcast's words saved to start the next one from, written only by
 * `src/server/broadcast-templates.ts`. Content only (no audience, no schedule); a picture in it is the store's own library's, as in a broadcast.
 */
export const broadcastTemplates = commerce.table(
  "broadcast_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    title: text("title").notNull(),
    content: jsonb("content").notNull().default({}),
    createdBy: uuid("created_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("broadcast_templates_store_id_key").on(t.storeId, t.id),
    index("broadcast_templates_list_idx").on(t.storeId, t.createdAt),
    index("broadcast_templates_created_by_idx").on(t.createdBy),
    check("broadcast_templates_title", sql`length(${t.title}) between 1 and 120`),
  ],
);

/**
 * The addresses a broadcast went to (D297, 5.3), frozen when its send started: one row per address (the subscriber's own, its language and market),
 * claimed a batch at a time and sent once (`email_messages`' key `broadcast:{id}:{subscriber}`). Personal data (the address): in the export's
 * `marketing` section, deleted on erasure and 90 days after the send ended (its figures kept on the broadcast). Never copied.
 */
export const broadcastRecipients = commerce.table(
  "broadcast_recipients",
  {
    storeId: storeId().references(() => stores.id),
    broadcastId: uuid("broadcast_id").notNull(),
    subscriberId: uuid("subscriber_id").notNull(),
    /** Lower case. */
    email: text("email").notNull(),
    locale: text("locale").notNull(),
    marketCode: text("market_code"),
    status: text("status").notNull().default("queued"),
    /** Why it was skipped: the address left the list after the start, or the send was stopped. */
    skipReason: text("skip_reason"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    emailMessageId: uuid("email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.broadcastId, t.subscriberId] }),
    foreignKey({
      name: "broadcast_recipients_broadcast_fk",
      columns: [t.storeId, t.broadcastId],
      foreignColumns: [broadcasts.storeId, broadcasts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "broadcast_recipients_subscriber_fk",
      columns: [t.storeId, t.subscriberId],
      foreignColumns: [marketingSubscribers.storeId, marketingSubscribers.id],
    }).onDelete("cascade"),
    index("broadcast_recipients_queue_idx").on(t.broadcastId, t.status),
    index("broadcast_recipients_email_idx").on(t.storeId, t.email),
    index("broadcast_recipients_message_idx").on(t.emailMessageId),
    check("broadcast_recipients_status", sql`${t.status} in (${sqlList(RECIPIENT_STATUSES)})`),
    check("broadcast_recipients_skip", sql`${t.skipReason} is null or ${t.skipReason} in ('unsubscribed', 'stopped')`),
    check("broadcast_recipients_email", sql`${t.email} = lower(${t.email}) and char_length(${t.email}) between 3 and 254`),
  ],
);

/** Presses on a broadcast's links (D297, 5.5): the link's key and a count, nothing of who pressed or when. Not personal; never copied. */
export const broadcastLinkClicks = commerce.table(
  "broadcast_link_clicks",
  {
    storeId: storeId().references(() => stores.id),
    broadcastId: uuid("broadcast_id").notNull(),
    link: text("link").notNull(),
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.broadcastId, t.link] }),
    foreignKey({
      name: "broadcast_link_clicks_broadcast_fk",
      columns: [t.storeId, t.broadcastId],
      foreignColumns: [broadcasts.storeId, broadcasts.id],
    }).onDelete("cascade"),
    check("broadcast_link_clicks_link", sql`${t.link} ~ '^[a-z]{2}(-[A-Z]{2})?[.][0-9]{1,2}$'`),
  ],
);

/**
 * A store's automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.1): one row per kind, made on the first save. `enabled_at` is when it
 * was last switched on: only what happens after it starts an email. `content` is the email per language (a broadcast's shape), null exactly for
 * back in stock, whose words are Kaizena Flow's. The store's own settings and words (`NOT_PERSONAL`). Written only by `src/server/automations.ts`.
 */
export const automations = commerce.table(
  "automations",
  {
    storeId: storeId().references(() => stores.id),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    delayDays: integer("delay_days"),
    content: jsonb("content"),
    updatedBy: uuid("updated_by").references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.kind] }),
    check("automations_kind", sql`${t.kind} in (${sqlList(AUTOMATION_KINDS)})`),
    check("automations_enabled_at", sql`not ${t.enabled} or ${t.enabledAt} is not null`),
    check("automations_content", sql`(${t.kind} = 'back_in_stock') = (${t.content} is null)`),
    check(
      "automations_delay",
      sql`case ${t.kind} when 'welcome' then ${t.delayDays} between 0 and 30 when 'after_purchase' then ${t.delayDays} between 1 and 90 when 'win_back' then ${t.delayDays} between 30 and 730 else ${t.delayDays} is null end`,
    ),
  ],
);

/**
 * One automation email to one subscriber (D298, 6.2), written before the email goes, so a key (`welcome:{subscriber}`, `after_purchase:{order}`,
 * `win_back:{subscriber}:{order}`) is never sent twice. Personal data (by the subscriber): in the export's `marketing` section, deleted on erasure
 * (with the subscriber) and after 90 days. Never copied.
 */
export const automationSends = commerce.table(
  "automation_sends",
  {
    storeId: storeId().references(() => stores.id),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    subscriberId: uuid("subscriber_id").notNull(),
    orderId: uuid("order_id"),
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.key] }),
    foreignKey({
      name: "automation_sends_subscriber_fk",
      columns: [t.storeId, t.subscriberId],
      foreignColumns: [marketingSubscribers.storeId, marketingSubscribers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "automation_sends_order_fk",
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
    index("automation_sends_report_idx").on(t.storeId, t.kind, t.createdAt),
    index("automation_sends_subscriber_idx").on(t.storeId, t.subscriberId),
    index("automation_sends_order_idx").on(t.storeId, t.orderId),
    check("automation_sends_kind", sql`${t.kind} in ('welcome', 'after_purchase', 'win_back')`),
    check("automation_sends_outcome", sql`${t.outcome} is null or ${t.outcome} in (${sqlList(SEND_OUTCOMES)})`),
  ],
);

/**
 * A shopper's request to hear once when a sold-out variant is back (D298, 6.4): the address (lower case), confirmed by its owner unless a signed-in
 * customer with a verified email asked; one open request per store, variant and address. `visitor` is a key that changes every day (as forms',
 * never an IP address). Personal data: exported, erased, pruned (6.5). Never copied. Written only by `src/server/stock-requests.ts`.
 */
export const stockRequests = commerce.table(
  "stock_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    variantId: uuid("variant_id").notNull(),
    productId: uuid("product_id").notNull(),
    email: text("email").notNull(),
    customerId: uuid("customer_id"),
    locale: text("locale").notNull(),
    marketCode: text("market_code"),
    status: text("status").notNull(),
    /** sha256 of the confirmation link's token, hex; gone once used. */
    confirmHash: text("confirm_hash"),
    confirmUntil: timestamp("confirm_until", { withTimezone: true }),
    confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true }),
    visitor: text("visitor"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "stock_requests_variant_fk",
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_requests_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_requests_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    uniqueIndex("stock_requests_open_idx").on(t.storeId, t.variantId, t.email).where(sql`${t.status} in ('pending', 'waiting')`),
    uniqueIndex("stock_requests_confirm_idx").on(t.confirmHash),
    index("stock_requests_waiting_idx").on(t.storeId, t.variantId).where(sql`${t.status} = 'waiting'`),
    index("stock_requests_email_idx").on(t.storeId, t.email),
    index("stock_requests_customer_idx").on(t.storeId, t.customerId),
    index("stock_requests_product_idx").on(t.storeId, t.productId),
    check("stock_requests_status", sql`${t.status} in (${sqlList(STOCK_REQUEST_STATUSES)})`),
    check("stock_requests_email", sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * A product review (D301, `docs/wave-5-marketing.md` 9.1): a buyer's stars and words about a product they bought and received (`source = 'buyer'`, from
 * an order line, so a verified purchase), or one imported from another service (`import`, never verified). Staff publish, hide with a reason and
 * answer; the rating and words change only in the author's write (`product_reviews_rules()`, the transaction setting `kaizen.review_author`), and a
 * review is deleted only where `kaizen.review_delete` is set (the author, erasure). Written only by `src/server/reviews.ts`. Personal data; never copied.
 */
export const productReviews = commerce.table(
  "product_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    productId: uuid("product_id").notNull(),
    /** The variant bought (*Size M*); null for an import. */
    variantId: uuid("variant_id"),
    source: text("source").notNull(),
    orderId: uuid("order_id"),
    orderLineId: uuid("order_line_id"),
    /** Who wrote it, for one review per product and buyer: `c:{customer}`, or `e:{sha256 of the order's email}` for a guest (G3). */
    buyerKey: text("buyer_key"),
    customerId: uuid("customer_id"),
    /** Where an import was written (*Trustpilot*), and on which day. */
    importedFrom: text("imported_from"),
    writtenOn: date("written_on", { mode: "string" }),
    authorName: text("author_name").notNull(),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body"),
    /** The language it was written in (a market's locale). */
    locale: text("locale").notNull(),
    status: text("status").notNull().default("pending"),
    hiddenReason: text("hidden_reason"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedBy: uuid("moderated_by").references(() => accounts.id),
    /** The store's answer, shown under the review. */
    answer: text("answer"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answeredBy: uuid("answered_by").references(() => accounts.id),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    unique("product_reviews_store_id_key").on(t.storeId, t.id),
    foreignKey({ name: "product_reviews_product_fk", columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
    foreignKey({
      name: "product_reviews_variant_fk",
      columns: [t.storeId, t.variantId],
      foreignColumns: [productVariants.storeId, productVariants.id],
    }).onDelete("cascade"),
    foreignKey({ name: "product_reviews_order_fk", columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }),
    foreignKey({ name: "product_reviews_customer_fk", columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }).onDelete("cascade"),
    uniqueIndex("product_reviews_line_key").on(t.storeId, t.orderLineId).where(sql`${t.orderLineId} is not null`),
    uniqueIndex("product_reviews_buyer_key").on(t.storeId, t.productId, t.buyerKey).where(sql`${t.source} = 'buyer'`),
    index("product_reviews_shown_idx").on(t.storeId, t.productId, t.createdAt).where(sql`${t.status} = 'published'`),
    index("product_reviews_queue_idx").on(t.storeId, t.status, t.createdAt),
    index("product_reviews_order_idx").on(t.storeId, t.orderId).where(sql`${t.orderId} is not null`),
    index("product_reviews_customer_idx").on(t.storeId, t.customerId).where(sql`${t.customerId} is not null`),
    index("product_reviews_variant_idx").on(t.storeId, t.variantId).where(sql`${t.variantId} is not null`),
    index("product_reviews_moderated_by_idx").on(t.moderatedBy),
    index("product_reviews_answered_by_idx").on(t.answeredBy),
    check("product_reviews_source", sql`${t.source} in (${sqlList(REVIEW_SOURCES)})`),
    check(
      "product_reviews_origin",
      sql`(${t.source} = 'buyer' and ${t.orderId} is not null and ${t.orderLineId} is not null and ${t.variantId} is not null and ${t.buyerKey} ~ '^(c:[0-9a-f-]{36}|e:[0-9a-f]{64})$' and ${t.importedFrom} is null and ${t.writtenOn} is null)
        or (${t.source} = 'import' and ${t.orderId} is null and ${t.orderLineId} is null and ${t.buyerKey} is null and ${t.customerId} is null and length(trim(${t.importedFrom})) between 1 and 80 and ${t.writtenOn} is not null)`,
    ),
    check("product_reviews_rating", sql`${t.rating} between 1 and 5`),
    check(
      "product_reviews_words",
      sql`length(trim(${t.authorName})) between 1 and 60 and (${t.title} is null or length(trim(${t.title})) between 1 and 120) and (${t.body} is null or length(trim(${t.body})) between 1 and 5000)`,
    ),
    check("product_reviews_status", sql`${t.status} in (${sqlList(REVIEW_STATUSES)})`),
    check("product_reviews_hidden", sql`(${t.status} = 'hidden') = (${t.hiddenReason} is not null) and (${t.hiddenReason} is null or ${t.hiddenReason} in (${sqlList(HIDE_REASONS)}))`),
    check("product_reviews_answer", sql`(${t.answer} is null) = (${t.answeredAt} is null) and (${t.answer} is null or length(trim(${t.answer})) between 1 and 2000)`),
  ],
);

/**
 * A review's pictures (D301 G4, `docs/wave-5-marketing.md` 9.7): up to three, in its author's order, each a file in the private bucket
 * `review-pictures` at `{store}/{id}.{ext}` with its small copy at `{store}/{id}-480.{ext}` (the paths follow from the row, so none is kept).
 * Written only with their review by its author (`kaizen.review_writer`/`kaizen.review_author`), deleted with it; staff hide one alone.
 */
export const reviewPictures = commerce.table(
  "review_pictures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    reviewId: uuid("review_id").notNull(),
    position: smallint("position").notNull(),
    type: text("type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    thumbBytes: integer("thumb_bytes").notNull(),
    /** Staff do not show this picture (the review may still be shown). */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: uuid("hidden_by").references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("review_pictures_store_id_key").on(t.storeId, t.id),
    unique("review_pictures_position_key").on(t.storeId, t.reviewId, t.position),
    foreignKey({ name: "review_pictures_review_fk", columns: [t.storeId, t.reviewId], foreignColumns: [productReviews.storeId, productReviews.id] }).onDelete("cascade"),
    index("review_pictures_hidden_by_idx").on(t.hiddenBy),
    check("review_pictures_position", sql.raw(`position between 0 and ${REVIEW_PICTURES_MAX - 1}`)),
    check("review_pictures_type", sql`${t.type} in (${sqlList(REVIEW_PICTURE_TYPES)})`),
    check("review_pictures_size", sql.raw(`width between 1 and ${REVIEW_PICTURE_SIZE} and height between 1 and ${REVIEW_PICTURE_SIZE}`)),
    check("review_pictures_bytes", sql.raw(`bytes between 1 and ${REVIEW_PICTURE_BYTES} and thumb_bytes between 1 and ${REVIEW_THUMB_BYTES}`)),
    check("review_pictures_hidden", sql`(${t.hiddenAt} is null) = (${t.hiddenBy} is null)`),
  ],
);

/** A store's review rules (D301 9.1): whether new reviews wait for staff, and (G3) the request email after receipt. */
export const reviewSettings = commerce.table(
  "review_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    publish: text("publish").notNull().default("after_check"),
    requestsOn: boolean("requests_on").notNull().default(false),
    requestsEnabledAt: timestamp("requests_enabled_at", { withTimezone: true }),
    requestDays: integer("request_days").notNull().default(REQUEST_DAYS_DEFAULT),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("review_settings_publish", sql`${t.publish} in (${sqlList(PUBLISH_MODES)})`),
    check("review_settings_days", sql.raw(`request_days between ${REQUEST_DAYS_MIN} and ${REQUEST_DAYS_MAX}`)),
    check("review_settings_requests", sql`not ${t.requestsOn} or ${t.requestsEnabledAt} is not null`),
  ],
);

/**
 * The review request emails (D301 G3, `docs/wave-5-marketing.md` 9.6): one row per order, claimed before the email is sent so an order is asked
 * once, holding the hash of the email's token for `/account/review/{token}` (90 days) and what became of the email. Deleted on the
 * buyer's erasure and 400 days after it was made.
 */
export const reviewRequests = commerce.table(
  "review_requests",
  {
    storeId: storeId().references(() => stores.id),
    orderId: uuid("order_id").notNull(),
    /** sha256 hex of the token the email carries; the token itself is kept nowhere. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.orderId] }),
    unique("review_requests_token_key").on(t.tokenHash),
    foreignKey({ name: "review_requests_order_fk", columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }),
    index("review_requests_created_idx").on(t.storeId, t.createdAt),
    check("review_requests_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("review_requests_outcome", sql`${t.outcome} is null or ${t.outcome} in (${sqlList(SEND_OUTCOMES)})`),
  ],
);

/**
 * The AI manager's work on pages that runs after its answer (D308, `docs/ai-autopilot.md` 4.1): a page built from a brief (`build`: the
 * page studio's plan and words, `input` the brief, `page_id` once its draft is saved) and each picture of a page it built or changed
 * (`picture`: the studio's picture job as built, placed in the page's draft by the studio's own `fillPicture()`). Taken one at a time by
 * the every-minute job in the name of who asked. A store's (or Kaizena Flow's, with no store); a picture goes with its page.
 */
export const pageAiJobs = commerce.table(
  "page_ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own pages. */
    storeId: uuid("store_id").references(() => stores.id),
    kind: text("kind").notNull(),
    /** A build's page once its draft is saved; a picture's page from the start. */
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
    /** Who asked: the work is done, metered and saved in their name. */
    askedBy: uuid("asked_by")
      .notNull()
      .references(() => accounts.id),
    input: jsonb("input").notNull(),
    /** Who asked in the person's name (`currentActor()`): the job runs as them, so its audit entries and AI usage say so. */
    actedBy: text("acted_by").notNull().default("person"),
    status: text("status").notNull().default("waiting"),
    tries: integer("tries").notNull().default(0),
    problem: text("problem"),
    /** What a build came to: the notes the studio gives (sections left out, sentences with claims) and how many pictures were asked. */
    result: jsonb("result"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("page_ai_jobs_kind", sql`${t.kind} in (${sqlList(PAGE_JOB_KINDS)})`),
    check("page_ai_jobs_status", sql`${t.status} in (${sqlList(PAGE_JOB_STATUSES)})`),
    check("page_ai_jobs_tries", sql.raw(`tries between 0 and ${PAGE_JOB_TRIES}`)),
    check("page_ai_jobs_picture_page", sql`${t.kind} <> 'picture' or ${t.pageId} is not null`),
    check("page_ai_jobs_acted_by", sql`${t.actedBy} in ('person', 'ai_manager', 'autopilot')`),
    index("page_ai_jobs_waiting_idx").on(t.createdAt).where(sql`${t.status} = 'waiting'`),
    index("page_ai_jobs_page_idx").on(t.pageId),
    index("page_ai_jobs_store_idx").on(t.storeId, t.createdAt),
    index("page_ai_jobs_asked_by_idx").on(t.askedBy),
  ],
);

/**
 * A shopper's saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1): up to `ADDRESSES_MAX` per customer, one default for
 * shipping and one for billing (partial unique indexes). Written only by `src/server/customer-addresses.ts`, which keeps `customers.address`
 * equal to the default shipping address for older readers. Personal data (export section `addresses`, deleted on erasure); never copied.
 */
export const customerAddresses = commerce.table(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    customerId: uuid("customer_id").notNull(),
    /** The shopper's own word for it ("Home", "Work"), or empty. */
    label: text("label").notNull().default(""),
    /** In the shape orders keep (`name`, `line1`, `line2`, `postalCode`, `city`, `country`). */
    address: jsonb("address").notNull(),
    country: text("country").notNull(),
    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    isDefaultBilling: boolean("is_default_billing").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("customer_addresses_store_id_key").on(t.storeId, t.id),
    foreignKey({
      name: "customer_addresses_customer_fk",
      columns: [t.storeId, t.customerId],
      foreignColumns: [customers.storeId, customers.id],
    }).onDelete("cascade"),
    index("customer_addresses_customer_idx").on(t.storeId, t.customerId),
    uniqueIndex("customer_addresses_default_shipping_idx").on(t.storeId, t.customerId).where(sql`${t.isDefaultShipping}`),
    uniqueIndex("customer_addresses_default_billing_idx").on(t.storeId, t.customerId).where(sql`${t.isDefaultBilling}`),
    check("customer_addresses_label", sql`char_length(${t.label}) <= 40`),
    check("customer_addresses_country", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check("customer_addresses_shape", sql`jsonb_typeof(${t.address}) = 'object'`),
  ],
);

/**
 * A sign-up form's welcome code (wave 5 unit J3, D304, `docs/wave-5-marketing.md` 11.3): one single-use code of the form's discount, made for an
 * address once it confirmed its sign-up, once per store, discount and address. Written only by `issueSignupCode()` in `src/server/discounts.ts`.
 * Personal data (export section `marketing`, deleted on erasure).
 */
export const signupIncentives = commerce.table(
  "signup_incentives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    discountId: uuid("discount_id").notNull(),
    /** Lower case. */
    email: text("email").notNull(),
    codeItemId: uuid("code_item_id"),
    /** The form's block id. */
    formId: text("form_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("signup_incentives_once").on(t.storeId, t.discountId, t.email),
    index("signup_incentives_email_idx").on(t.storeId, t.email),
    index("signup_incentives_item_idx").on(t.storeId, t.codeItemId),
    foreignKey({
      name: "signup_incentives_discount_fk",
      columns: [t.storeId, t.discountId],
      foreignColumns: [discountCodes.storeId, discountCodes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "signup_incentives_item_fk",
      columns: [t.storeId, t.codeItemId],
      foreignColumns: [discountCodeItems.storeId, discountCodeItems.id],
    }),
    check("signup_incentives_email", sql`${t.email} = lower(${t.email}) and char_length(${t.email}) between 3 and 254`),
    check("signup_incentives_form", sql`char_length(${t.formId}) between 1 and 64`),
  ],
);

/**
 * A store's server-side connection to an ad platform (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3): the platform's own id and the
 * owner's token, encrypted (`secret-box.ts`), never sent to a page. Written only by `src/server/ad-connections.ts`. Not personal data.
 */
export const adConnections = commerce.table(
  "ad_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    platform: text("platform").notNull(),
    accountId: text("account_id").notNull(),
    token: text("token").notNull(),
    tokenHint: text("token_hint").notNull(),
    /** `standard` sends no personal data; `enhanced` adds hashed email and phone. */
    dataLevel: text("data_level").notNull().default("standard"),
    testCode: text("test_code"),
    on: boolean("on").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ad_connections_store_platform").on(t.storeId, t.platform),
    unique("ad_connections_store_id_key").on(t.storeId, t.id),
    check("ad_connections_platform", sql`${t.platform} in ('meta', 'ga4', 'tiktok', 'pinterest')`),
    check("ad_connections_level", sql`${t.dataLevel} in ('standard', 'enhanced')`),
    check("ad_connections_account", sql`char_length(${t.accountId}) between 4 and 40`),
    check("ad_connections_test_code", sql`${t.testCode} is null or char_length(${t.testCode}) between 1 and 40`),
  ],
);

/**
 * One server-side conversion event of an order for a platform (D303 I2): made only by `queueAdConversions()`, sent only by
 * `sendAdConversions()`, once per order, platform and event. No personal field: the payload is built when sent.
 */
export const adConversions = commerce.table(
  "ad_conversions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    orderId: uuid("order_id").notNull(),
    platform: text("platform").notNull(),
    event: text("event").notNull(),
    status: text("status").notNull().default("pending"),
    tries: integer("tries").notNull().default(0),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
    /** Why it was skipped, or the platform's answer code when it failed. */
    answer: text("answer"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ad_conversions_once").on(t.storeId, t.orderId, t.platform, t.event),
    index("ad_conversions_due_idx").on(t.status, t.nextAt),
    index("ad_conversions_store_idx").on(t.storeId, t.createdAt),
    foreignKey({ name: "ad_conversions_order_fk", columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete("cascade"),
    check("ad_conversions_platform", sql`${t.platform} in ('meta', 'ga4', 'tiktok', 'pinterest')`),
    check("ad_conversions_event", sql`${t.event} in ('begin_checkout', 'purchase')`),
    check("ad_conversions_status", sql`${t.status} in ('pending', 'sent', 'skipped', 'failed')`),
    check("ad_conversions_answer", sql`${t.answer} is null or char_length(${t.answer}) <= 200`),
  ],
);

/**
 * A store's product feeds (D302, `docs/wave-5-marketing.md` 13): the secret part of their address, kept as a hash to find the store by and
 * encrypted with `SETTINGS_ENCRYPTION_KEY` so the owner can see the address again. Written only by `src/server/feed-settings.ts`.
 */
export const feedSettings = commerce.table(
  "feed_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id),
    tokenHash: text("token_hash").notNull(),
    token: text("token").notNull(),
    on: boolean("on").notNull().default(true),
    /** The AI shopping channels the store serves a feed to (D353, `AGENT_FEED_CHANNELS`): each off until switched on. */
    channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("feed_settings_token_hash").on(t.tokenHash),
    check("feed_settings_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("feed_settings_channels", sql`${t.channels} <@ array['openai']::text[]`),
  ],
);

/**
 * The last run of each scheduled job (PSI 2026-10-24, REL-06): one row per cron route and per job of the five-minute dispatcher,
 * written only by `src/server/cron-runs.ts` after each run, so the platform home can say which job is late or failing
 * (`src/lib/cron-health.ts`). A row a run, kept in place: nothing grows. `last_error` is an error's message, never a person's data.
 */
export const cronJobs = commerce.table(
  "cron_jobs",
  {
    job: text("job").primaryKey(),
    everySeconds: integer("every_seconds").notNull(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastDurationMs: integer("last_duration_ms"),
    runs: integer("runs").notNull().default(0),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [
    check("cron_jobs_job", sql`${t.job} ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'`),
    check("cron_jobs_every", sql`${t.everySeconds} between 60 and 604800`),
    check("cron_jobs_error", sql`${t.lastError} is null or length(${t.lastError}) <= 1000`),
    check("cron_jobs_counts", sql`${t.runs} >= 0 and ${t.failures} >= 0`),
  ],
);

/**
 * Runs of the AI evals per model (PSI 2026-10-24, AST-09): the agents' safety eval (`src/lib/agent-eval.ts`) run from Platform → AI,
 * so a model change can be compared with the runs before it. Written only by `src/server/agent-eval.ts`. `failures` holds each failed
 * case's id, problems and the start of the model's answer to scripted cases: no person's data.
 */
export const aiEvalRuns = commerce.table(
  "ai_eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suite: text("suite").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    passed: integer("passed").notNull(),
    total: integer("total").notNull(),
    failures: jsonb("failures").notNull().default(sql`'[]'::jsonb`),
    durationMs: integer("duration_ms").notNull(),
    ranBy: uuid("ran_by").references(() => accounts.id, { onDelete: "set null" }),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_eval_runs_ran_idx").on(t.suite, t.ranAt),
    check("ai_eval_runs_suite", sql`${t.suite} in ('agents')`),
    check("ai_eval_runs_counts", sql`${t.passed} >= 0 and ${t.passed} <= ${t.total} and ${t.durationMs} >= 0`),
  ],
);

/**
 * Follow-ups the AI manager keeps for a person (PSI AGT-04, AGT-11; `src/lib/follow-ups.ts`): at `due_at` the five-minute job gives
 * `task` back to the AI manager in its conversation, in the person's name with their role's tools, and emails them. A repeating one is
 * due again at the same time of day in `time_zone`. Written only by `src/server/follow-ups.ts`. `task` is the person's own words.
 */
export const assistantFollowUps = commerce.table(
  "assistant_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the platform's AI manager. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    task: text("task").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    repeat: text("repeat").notNull().default("none"),
    timeZone: text("time_zone").notNull(),
    status: text("status").notNull().default("waiting"),
    tries: integer("tries").notNull().default(0),
    runs: integer("runs").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastProblem: text("last_problem"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    /** `person`: asked for in a conversation; `rule`: an order rule's *Ask the AI manager* (PSI AGT-04), for its order. */
    origin: text("origin").notNull().default("person"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("assistant_follow_ups_origin", sql`${t.origin} in ('person', 'rule')`),
    index("assistant_follow_ups_rule_idx").on(t.storeId, t.createdAt).where(sql`${t.origin} = 'rule'`),
    index("assistant_follow_ups_order_idx").on(t.orderId),
    foreignKey({ name: "assistant_follow_ups_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("cascade"),
    index("assistant_follow_ups_due_idx").on(t.status, t.dueAt),
    index("assistant_follow_ups_account_idx").on(t.accountId, t.storeId, t.status),
    index("assistant_follow_ups_conversation_idx").on(t.conversationId),
    index("assistant_follow_ups_store_idx").on(t.storeId),
    check("assistant_follow_ups_repeat", sql`${t.repeat} in ('none', 'daily', 'weekly')`),
    check("assistant_follow_ups_status", sql`${t.status} in ('waiting', 'done', 'cancelled', 'failed')`),
    check("assistant_follow_ups_task", sql`length(${t.task}) between 1 and 500`),
    check("assistant_follow_ups_counts", sql`${t.tries} >= 0 and ${t.runs} >= 0`),
    check("assistant_follow_ups_problem", sql`${t.lastProblem} is null or length(${t.lastProblem}) <= 500`),
  ],
);

/**
 * What the AI manager finished or waits on while the person was away (D350): a page built, a follow-up answered, an autopilot question or
 * finished plan, a change kept for their yes, a report sent. Written only by `src/server/assistant-notices.ts`, once per account, kind and
 * reference; read and marked read by the person; kept 60 days. A staff member's own work queue, never a shopper's data.
 */
export const assistantNotices = commerce.table(
  "assistant_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Null for Kaizena Flow's own AI manager. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** What it is about (a job's, follow-up's, step's, plan's, approval's or report's id), so it is written once. */
    ref: text("ref").notNull(),
    /** The facts its words are made from (a title, a summary), never a customer's details. */
    facts: jsonb("facts").notNull().default({}),
    /** Where it opens: an admin path of the person's own place. */
    href: text("href").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assistant_notices_once").on(t.accountId, t.kind, t.ref),
    index("assistant_notices_unread_idx").on(t.accountId, t.storeId, t.createdAt).where(sql`${t.readAt} is null`),
    index("assistant_notices_store_idx").on(t.storeId),
    index("assistant_notices_created_idx").on(t.createdAt),
    check(
      "assistant_notices_kind",
      sql`${t.kind} in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready')`,
    ),
    check("assistant_notices_ref", sql`length(${t.ref}) between 1 and 200`),
    check("assistant_notices_href", sql`${t.href} like '/admin/%' and length(${t.href}) <= 300`),
  ],
);

/**
 * A store drafted from one description (D351): the page builds it asked for (`page_ai_jobs`, the first the front page) and a theme added to the
 * library without going live, read on Home's *Your drafts* card and published there with one press, or discarded. Written only by
 * `src/server/store-drafts.ts`; nothing in it reaches visitors until the press.
 */
export const storeDrafts = commerce.table(
  "store_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    /** The page builds, in order: the first is the front page. */
    jobIds: uuid("job_ids").array().notNull(),
    installId: uuid("install_id").references(() => storeThemeInstalls.id, { onDelete: "set null" }),
    status: text("status").notNull().default("drafting"),
    problem: text("problem"),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("store_drafts_store_idx").on(t.storeId, t.createdAt),
    index("store_drafts_account_idx").on(t.accountId),
    index("store_drafts_install_idx").on(t.installId),
    uniqueIndex("store_drafts_one_open").on(t.storeId).where(sql`${t.status} = 'drafting'`),
    check("store_drafts_status", sql`${t.status} in ('drafting', 'published', 'discarded')`),
    check("store_drafts_description", sql`length(${t.description}) between 10 and 1500`),
    check("store_drafts_jobs", sql`cardinality(${t.jobIds}) between 1 and 4`),
    check("store_drafts_problem", sql`${t.problem} is null or length(${t.problem}) <= 1000`),
  ],
);

/**
 * Skills a person saves for the AI manager (D350), beside the built-in playbooks of `ASSISTANT_SKILLS`: a key, a title, when to use it and
 * the steps in words. A person's own in a store (or on Kaizena Flow's own site, `store_id` null); an owner may share one with the store's
 * staff (`shared`). Written only by `src/server/assistant-saved-skills.ts`, never with a customer's details or a secret.
 */
export const assistantSkills = commerce.table(
  "assistant_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    whenToUse: text("when_to_use").notNull().default(""),
    steps: text("steps").notNull(),
    shared: boolean("shared").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assistant_skills_key").on(t.accountId, t.storeId, t.key).nullsNotDistinct(),
    index("assistant_skills_store_idx").on(t.storeId, t.shared),
    check("assistant_skills_key_shape", sql`${t.key} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.key}) between 2 and 60`),
    check("assistant_skills_title", sql`length(${t.title}) between 1 and 120`),
    check("assistant_skills_when", sql`length(${t.whenToUse}) <= 300`),
    check("assistant_skills_steps", sql`length(${t.steps}) between 1 and 2000`),
    check("assistant_skills_shared", sql`not ${t.shared} or ${t.storeId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// The autopilot's goals and plans (D309, `docs/ai-autopilot.md` 7)
// ---------------------------------------------------------------------------

/** A store's (or, with no store, Kaizena Flow's) goals: the owner's vision and targets the code measures (`goalProgress()`). */
export const assistantGoals = commerce.table(
  "assistant_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own site. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    vision: text("vision").notNull().default(""),
    /** `GoalTarget[]`, read only through `goalTargetsSchema` (`src/lib/autopilot-goals.ts`). */
    targets: jsonb("targets").notNull().default([]),
    dueOn: date("due_on"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_goals_store_idx").on(t.storeId, t.status),
    index("assistant_goals_created_by_idx").on(t.createdBy),
    check("assistant_goals_status", sql`${t.status} in ('active', 'met', 'dropped')`),
    check("assistant_goals_title", sql`length(${t.title}) between 1 and 120`),
    check("assistant_goals_vision", sql`length(${t.vision}) <= 2000`),
    check("assistant_goals_targets", sql`jsonb_typeof(${t.targets}) = 'array' and jsonb_array_length(${t.targets}) <= 5`),
  ],
);

/** A plan the AI manager made: steps run by the loop in the name of the account that made it, within the owner's levels (D309). */
export const assistantPlans = commerce.table(
  "assistant_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => assistantGoals.id, { onDelete: "set null" }),
    /** Whose name its steps run in, with their role read again before every step. */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The plan's own conversation, where its task turns and its kept calls live. */
    conversationId: uuid("conversation_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    /** Raised on every change of its steps; a start is for the version the owner was shown. */
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    pauseReason: text("pause_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "assistant_plans_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("cascade"),
    index("assistant_plans_store_idx").on(t.storeId, t.status),
    index("assistant_plans_account_idx").on(t.accountId),
    index("assistant_plans_goal_idx").on(t.goalId),
    index("assistant_plans_conversation_idx").on(t.conversationId),
    check("assistant_plans_status", sql`${t.status} in ('draft', 'running', 'paused', 'done', 'stopped')`),
    check("assistant_plans_title", sql`length(${t.title}) between 1 and 120`),
    check("assistant_plans_summary", sql`length(${t.summary}) <= 2000`),
    check("assistant_plans_version", sql`${t.version} >= 1`),
    check("assistant_plans_pause_reason", sql`${t.pauseReason} is null or length(${t.pauseReason}) <= 500`),
  ],
);

/** A plan's step: a kind from `STEP_KINDS` with its spec, the keys it waits for, the check that says it worked (D309). */
export const assistantPlanSteps = commerce.table(
  "assistant_plan_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => assistantPlans.id, { onDelete: "cascade" }),
    /** The plan's store, kept on the step so the loop takes one step per store without a join. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    /** The kind's own fields, read only through `stepSchema` (`src/lib/autopilot-plans.ts`). */
    spec: jsonb("spec").notNull(),
    afterKeys: text("after_keys").array().notNull().default(sql`'{}'::text[]`),
    /** `StepCheck`, read only through `stepCheckSchema`. */
    doneCheck: jsonb("done_check").notNull().default({ kind: "none" }),
    status: text("status").notNull().default("pending"),
    tries: integer("tries").notNull().default(0),
    /** What happened, in words made by code (`{ done }` or `{ problem }`, the tools a turn used, what it was told to tell). */
    result: jsonb("result"),
    /** `{ text, options, retry? }` while it asks the owner. */
    question: jsonb("question"),
    answer: text("answer"),
    answeredBy: uuid("answered_by").references(() => accounts.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    notBefore: timestamp("not_before", { withTimezone: true }),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assistant_plan_steps_key_idx").on(t.planId, t.key),
    index("assistant_plan_steps_store_idx").on(t.storeId, t.status),
    index("assistant_plan_steps_answered_by_idx").on(t.answeredBy),
    check("assistant_plan_steps_kind", sql`${t.kind} in ('tool', 'task', 'question', 'wait')`),
    check("assistant_plan_steps_status", sql`${t.status} in ('pending', 'running', 'waiting', 'asking', 'done', 'skipped', 'cancelled')`),
    check("assistant_plan_steps_key", sql`${t.key} ~ '^[a-z0-9_]{1,20}$'`),
    check("assistant_plan_steps_title", sql`length(${t.title}) between 1 and 120`),
    check("assistant_plan_steps_tries", sql`${t.tries} >= 0`),
    check("assistant_plan_steps_position", sql`${t.position} between 0 and 29`),
    check("assistant_plan_steps_answer", sql`${t.answer} is null or length(${t.answer}) <= 500`),
  ],
);

/** The owner's autonomy levels and budgets for the autopilot (D309, `docs/ai-autopilot.md` 7.4): one row per store, one for the platform. */
export const autopilotSettings = commerce.table(
  "autopilot_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own site. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    paused: boolean("paused").notNull().default(false),
    /** `{ area: level }`, read only through `readAutonomy()` (`src/lib/autopilot-autonomy.ts`). */
    levels: jsonb("levels").notNull().default({}),
    budgets: jsonb("budgets").notNull().default({}),
    /** Whether and how the autopilot keeps working toward the goals (D328), read only through `readAutonomy()`. */
    planning: jsonb("planning").notNull().default({}),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("autopilot_settings_store_key").on(t.storeId).nullsNotDistinct(),
    index("autopilot_settings_updated_by_idx").on(t.updatedBy),
    check("autopilot_settings_levels", sql`jsonb_typeof(${t.levels}) = 'object'`),
    check("autopilot_settings_budgets", sql`jsonb_typeof(${t.budgets}) = 'object'`),
    check("autopilot_settings_planning", sql`jsonb_typeof(${t.planning}) = 'object'`),
  ],
);

/**
 * The autopilot looking at a goal again (D328, `docs/ai-autopilot.md` 12): one row per review, written only by
 * `src/server/autopilot-reviews.ts`; the plan it made, whether it started it, and what came of it in words.
 */
export const autopilotReviews = commerce.table(
  "autopilot_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => assistantGoals.id, { onDelete: "cascade" }),
    /** Whose name the review ran in: the goal's maker, read again. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** The goal's own conversation, kept from its first review on. */
    conversationId: uuid("conversation_id"),
    status: text("status").notNull().default("running"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    planId: uuid("plan_id").references(() => assistantPlans.id, { onDelete: "set null" }),
    started: boolean("started").notNull().default(false),
    outcome: text("outcome"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "autopilot_reviews_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("set null"),
    uniqueIndex("autopilot_reviews_running_idx").on(t.goalId).where(sql`status = 'running'`),
    index("autopilot_reviews_goal_idx").on(t.goalId, t.createdAt),
    index("autopilot_reviews_store_idx").on(t.storeId, t.createdAt),
    index("autopilot_reviews_account_idx").on(t.accountId),
    index("autopilot_reviews_conversation_idx").on(t.conversationId),
    index("autopilot_reviews_plan_idx").on(t.planId),
    check("autopilot_reviews_status", sql`${t.status} in ('running', 'done', 'skipped', 'failed')`),
    check("autopilot_reviews_outcome", sql`${t.outcome} is null or length(${t.outcome}) <= 500`),
  ],
);

/**
 * What the autopilot reacted to (D331, `docs/ai-autopilot.md` 15): a customer waiting for a person, an A/B test that ended by itself or an
 * urgent analytics alert, found by code and answered once by a headless turn; written only by `src/server/autopilot-events.ts`.
 */
export const autopilotEvents = commerce.table(
  "autopilot_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** `support_waiting`, `test_ended` or `alert` (`EVENT_KINDS`). */
    kind: text("kind").notNull(),
    /** What makes it once: the conversation, the test, or the alert and its ISO week. */
    ref: text("ref").notNull(),
    /** What happened, written by code (`EventFacts`). */
    facts: jsonb("facts").notNull().default({}),
    status: text("status").notNull().default("pending"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    /** Whose name the turn ran in: the one who last saved the autopilot's settings, read again. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id"),
    planId: uuid("plan_id").references(() => assistantPlans.id, { onDelete: "set null" }),
    started: boolean("started").notNull().default(false),
    outcome: text("outcome"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "autopilot_events_conversation_fk", columns: [t.conversationId], foreignColumns: [assistantConversations.id] }).onDelete("set null"),
    unique("autopilot_events_ref_key").on(t.storeId, t.kind, t.ref),
    index("autopilot_events_pending_idx").on(t.createdAt).where(sql`status = 'pending'`),
    index("autopilot_events_store_idx").on(t.storeId, t.createdAt),
    index("autopilot_events_account_idx").on(t.accountId),
    index("autopilot_events_conversation_idx").on(t.conversationId),
    index("autopilot_events_plan_idx").on(t.planId),
    check("autopilot_events_kind", sql`${t.kind} in ('support_waiting', 'test_ended', 'alert')`),
    check("autopilot_events_status", sql`${t.status} in ('pending', 'running', 'done', 'skipped', 'failed')`),
    check("autopilot_events_ref", sql`length(${t.ref}) between 1 and 200`),
    check("autopilot_events_facts", sql`jsonb_typeof(${t.facts}) = 'object'`),
    check("autopilot_events_outcome", sql`${t.outcome} is null or length(${t.outcome}) <= 500`),
  ],
);

/** When a store's analytics alerts were last looked at for events (D331), so the costly read runs once a day. */
export const autopilotEventChecks = commerce.table("autopilot_event_checks", {
  storeId: uuid("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  alertsAt: timestamp("alerts_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Web research (D329, `docs/ai-autopilot.md` 13)
// ---------------------------------------------------------------------------

/** The web search service and its key: Kaizena Flow's (`store_id` null); written only by `src/server/web-search-settings.ts`. */
export const searchSettings = commerce.table(
  "search_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** An id of `SEARCH_APIS` (`src/lib/web-search.ts`). */
    provider: text("provider").notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    apiKeyHint: text("api_key_hint").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("search_settings_store_key").on(t.storeId).nullsNotDistinct(),
    index("search_settings_updated_by_idx").on(t.updatedBy),
    check("search_settings_provider", sql`${t.provider} in ('brave')`),
  ],
);

/** What a store's AI searched for or read on the web (D329): the sources a research note may cite; kept 90 days. */
export const researchSources = commerce.table(
  "research_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    /** A page's readable text's SHA-256, to tell when it changed. */
    textHash: text("text_hash"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("research_sources_store_idx").on(t.storeId, t.createdAt),
    index("research_sources_url_idx").on(t.storeId, t.url),
    index("research_sources_account_idx").on(t.accountId),
    check("research_sources_kind", sql`${t.kind} in ('search', 'page')`),
    check("research_sources_url", sql`length(${t.url}) between 1 and 2000`),
    check("research_sources_title", sql`length(${t.title}) <= 300`),
  ],
);

/** A store's brand set down in words (D330, `docs/ai-autopilot.md` 14.1): one row per store and one for Kaizena Flow's own site; written only by `src/server/brand.ts`. */
export const brandProfiles = commerce.table(
  "brand_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Kaizena Flow's own site. */
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    tagline: text("tagline").notNull().default(""),
    voice: text("voice").notNull().default(""),
    audience: text("audience").notNull().default(""),
    values: text("values").array().notNull().default(sql`'{}'::text[]`),
    avoid: text("avoid").array().notNull().default(sql`'{}'::text[]`),
    updatedBy: uuid("updated_by").references(() => accounts.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("brand_profiles_store_key").on(t.storeId).nullsNotDistinct(),
    index("brand_profiles_updated_by_idx").on(t.updatedBy),
    check("brand_profiles_tagline", sql`length(${t.tagline}) <= 120`),
    check("brand_profiles_voice", sql`length(${t.voice}) <= 600`),
    check("brand_profiles_audience", sql`length(${t.audience}) <= 400`),
    check("brand_profiles_values", sql`cardinality(${t.values}) <= 5`),
    check("brand_profiles_avoid", sql`cardinality(${t.avoid}) <= 10`),
  ],
);

/** A store's research notes and comparisons (D329), written only by `src/server/research.ts`, each citing sources the store opened. */
export const researchNotes = commerce.table(
  "research_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("note"),
    topic: text("topic").notNull(),
    finding: text("finding").notNull(),
    /** The addresses it rests on, each searched or read by the store within 30 days when the note was kept. */
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    /** A comparison's criteria, options and totals worked out in code (`compareOptions()`). */
    data: jsonb("data"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("research_notes_store_idx").on(t.storeId, t.createdAt),
    index("research_notes_account_idx").on(t.accountId),
    check("research_notes_kind", sql`${t.kind} in ('note', 'comparison')`),
    check("research_notes_topic", sql`length(${t.topic}) between 1 and 200`),
    check("research_notes_finding", sql`length(${t.finding}) between 1 and 2000`),
    check("research_notes_sources", sql`cardinality(${t.sources}) <= 20`),
  ],
);

/** What the autopilot told a person (D309, `docs/ai-autopilot.md` 7.5): a daily digest and a weekly report, one each per period, kept for the page. */
export const autopilotReports = commerce.table(
  "autopilot_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The store's day of a digest, the Monday of a weekly report's week. */
    periodStart: date("period_start").notNull(),
    /** The figures and lists, written by code (`ReportFacts`). */
    facts: jsonb("facts").notNull(),
    /** A weekly report's few sentences by the model, kept only when they passed the checks; null otherwise. */
    note: text("note"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("autopilot_reports_period_key").on(t.storeId, t.accountId, t.kind, t.periodStart).nullsNotDistinct(),
    index("autopilot_reports_account_idx").on(t.accountId, t.createdAt),
    check("autopilot_reports_kind", sql`${t.kind} in ('daily', 'weekly')`),
    check("autopilot_reports_note", sql`${t.note} is null or length(${t.note}) <= 1500`),
  ],
);

/**
 * A look at a page's draft or at the store as shoppers see it (D310, `docs/ai-autopilot.md` 9): photographed at a phone's and a computer's
 * width and judged by the model that sees pictures. Written only by `src/server/page-looks.ts`; the photographs are never kept, only the
 * findings, for 30 days.
 */
export const pageLooks = commerce.table(
  "page_looks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** `page`: a page's draft; `store`: the home, a product page and the cart, live. */
    kind: text("kind").notNull(),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
    /** Who asked for it (`currentActor()`): the look is taken as them, so the judge's AI usage counts where it should. */
    actedBy: text("acted_by").notNull().default("person"),
    status: text("status").notNull().default("queued"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    tries: integer("tries").notNull().default(0),
    /** What was found, written by code (`LookFindings`). */
    findings: jsonb("findings"),
    problem: text("problem"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("page_looks_queue_idx").on(t.status, t.createdAt),
    index("page_looks_page_idx").on(t.pageId, t.createdAt),
    index("page_looks_store_idx").on(t.storeId, t.createdAt),
    index("page_looks_account_idx").on(t.accountId),
    check("page_looks_kind", sql`${t.kind} in ('page', 'store')`),
    check("page_looks_acted_by", sql`${t.actedBy} in ('person', 'ai_manager', 'autopilot')`),
    check("page_looks_status", sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
    check("page_looks_page", sql`(${t.kind} = 'page') = (${t.pageId} is not null)`),
    check("page_looks_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
  ],
);

/**
 * The AI writing one of a store's legal pages (D311, unit L, `docs/ai-autopilot.md` 8.3, 8.4): asked for by an owner (`asked`; L3 adds the
 * upkeep's reasons), taken by the job one language at a time (`results` holds each language's page as code made it, or why it could not),
 * then saved as a draft page. Written only by `src/server/legal-writer.ts`. One write of a kind runs at a time per store.
 */
export const legalAiWrites = commerce.table(
  "legal_ai_writes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** A kind of legal page with a starter (`STARTER_ROLES`). */
    role: text("role").notNull(),
    why: text("why").notNull().default("asked"),
    status: text("status").notNull().default("queued"),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    /** By language: the page's sections as code made them, with what was missing and cited, or the problems that stopped it. */
    results: jsonb("results").notNull().default({}),
    /** The languages the saved page holds. */
    languages: text("languages").array(),
    model: text("model"),
    /** Why the write failed, or what a language could not do (`string[]`). */
    problems: jsonb("problems"),
    /** The passages the page cites, each with the hash of its text as written from (`{ source, passage, language, hash }[]`), for the upkeep. */
    sources: jsonb("sources"),
    /** The hash of the store's facts the page was written from. */
    factsHash: text("facts_hash"),
    /** md5 of the page's draft as this write saved it: a page whose draft still has it was not changed by a person since. */
    savedHash: text("saved_hash"),
    /** The owner handed the page back: this write may write over the role's page even if a person changed it. */
    overwrite: boolean("overwrite").notNull().default(false),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("legal_ai_writes_queue_idx").on(t.status, t.createdAt),
    index("legal_ai_writes_store_idx").on(t.storeId, t.role, t.createdAt),
    index("legal_ai_writes_account_idx").on(t.accountId),
    index("legal_ai_writes_page_idx").on(t.pageId),
    uniqueIndex("legal_ai_writes_active_idx").on(t.storeId, t.role).where(sql`${t.status} in ('queued', 'running')`),
    check("legal_ai_writes_role", sql`${t.role} in ('terms', 'privacy', 'returns_policy', 'shipping_policy', 'withdrawal_info', 'imprint')`),
    check("legal_ai_writes_why", sql`${t.why} in ('asked', 'first', 'source_changed', 'facts_changed')`),
    check("legal_ai_writes_status", sql`${t.status} in ('queued', 'running', 'written', 'published', 'kept', 'failed')`),
  ],
);

/**
 * A store's choice to have the AI write and keep its legal pages (D311, unit L3, `docs/ai-autopilot.md` 8.6): on or off, whether a page that
 * passes the checks is published at once (`auto`) or left a draft (`ask`), the version of the sentence the owner agreed to, and the kinds the
 * owner stopped. Written only by `src/server/legal-writer.ts`; `never` copied (a copy agrees for itself).
 */
export const legalAiSettings = commerce.table(
  "legal_ai_settings",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    publish: text("publish").notNull().default("auto"),
    /** The version of the sentence the owner agreed to when turning it on (`LEGAL_AI_TERMS_VERSION`). */
    agreed: text("agreed"),
    turnedOnBy: uuid("turned_on_by").references(() => accounts.id, { onDelete: "set null" }),
    turnedOnAt: timestamp("turned_on_at", { withTimezone: true }),
    stoppedRoles: text("stopped_roles").array().notNull().default(sql`'{}'::text[]`),
    /** When the upkeep last compared the store's facts and sources with its pages. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("legal_ai_settings_account_idx").on(t.turnedOnBy),
    check("legal_ai_settings_publish", sql`${t.publish} in ('auto', 'ask')`),
  ],
);

/**
 * The official legal texts the AI's legal pages rest on (D311, unit L, `docs/ai-autopilot.md` 8.2), cut into passages by code
 * (`src/lib/legal-passages.ts`): one row per distinct text, by the hash of its passages, so an act read again unchanged is stored once.
 * Kaizena Flow's, no store. Written only by `src/server/legal-sources.ts`; never changed (a trigger), deleted only when no read names it.
 */
export const legalSourceTexts = commerce.table("legal_source_texts", {
  /** sha256 of the passages as stored, hex. */
  hash: text("hash").primaryKey(),
  /** `Passage[]`: key, title, text. */
  passages: jsonb("passages").notNull(),
  createdAt: createdAt(),
});

/**
 * Each read of a source in a language (D311, unit L, 8.2): when, which version, whether it worked and the text it gave. Append-only (a
 * trigger refuses changes), written only by `src/server/legal-sources.ts`; the newest `ok` read of a source and language is what pages
 * rest on, and reads are pruned after 90 days except that newest one.
 */
export const legalSourceReads = commerce.table(
  "legal_source_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A key of `LEGAL_SOURCES`. */
    sourceKey: text("source_key").notNull(),
    language: text("language").notNull(),
    /** What was read: the consolidated CELEX number, the SFS document, the ELI path, or `recorded`. */
    version: text("version"),
    status: text("status").notNull(),
    textHash: text("text_hash").references(() => legalSourceTexts.hash, { onDelete: "restrict" }),
    passageCount: integer("passage_count"),
    problem: text("problem"),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("legal_source_reads_source_idx").on(t.sourceKey, t.language, t.readAt),
    index("legal_source_reads_text_idx").on(t.textHash),
    check("legal_source_reads_status", sql`${t.status} in ('ok', 'failed')`),
    check("legal_source_reads_text", sql`(${t.status} = 'ok') = (${t.textHash} is not null)`),
    check("legal_source_reads_language", sql`${t.language} in ('nb', 'sv', 'da', 'en')`),
    check("legal_source_reads_problem", sql`${t.problem} is null or length(${t.problem}) <= 500`),
  ],
);

/**
 * A price list (wave 6 unit C, D321, `docs/wave-6-catalogue.md` C.1): fixed prices per variant and currency (`price_list_prices`) and an
 * optional percentage off the market price for the products in its scope (`price_list_products`, every product while empty), for the
 * customer groups and companies it is assigned to (`price_list_assignments`). A buyer's price is only `commerce.buyer_price()`. Written only by
 * `src/server/price-lists.ts`; catalogue in `COPY_RULES`.
 */
export const priceLists = commerce.table(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    /** Whole percent off the market price of the products in scope; null: only its fixed prices. */
    percent: integer("percent"),
    active: boolean("active").notNull().default(true),
    /**
     * Only these products for these buyers (D321 C.3): while on, the products in the list's scope are offered only to its buyers
     * (`commerce.product_exclusive()`, `commerce.buyer_sees()`); a list with no scope hides nothing.
     */
    exclusive: boolean("exclusive").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("price_lists_store_id_key").on(t.storeId, t.id),
    uniqueIndex("price_lists_name_idx").on(t.storeId, sql`lower(${t.name})`),
    check("price_lists_name", sql`char_length(${t.name}) between 1 and 80 and ${t.name} = btrim(${t.name})`),
    check("price_lists_percent", sql`${t.percent} is null or ${t.percent} between 1 and 99`),
  ],
);

/** Who a price list is for: one customer group or one company per row (D321). */
export const priceListAssignments = commerce.table(
  "price_list_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    listId: uuid("list_id").notNull(),
    tierId: uuid("tier_id"),
    companyId: uuid("company_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "price_list_assignments_list_fk", columns: [t.storeId, t.listId], foreignColumns: [priceLists.storeId, priceLists.id] }).onDelete("cascade"),
    foreignKey({ name: "price_list_assignments_tier_fk", columns: [t.storeId, t.tierId], foreignColumns: [customerTiers.storeId, customerTiers.id] }).onDelete("cascade"),
    foreignKey({ name: "price_list_assignments_company_fk", columns: [t.storeId, t.companyId], foreignColumns: [customerCompanies.storeId, customerCompanies.id] }).onDelete("cascade"),
    check("price_list_assignments_one", sql`(${t.tierId} is null) <> (${t.companyId} is null)`),
    uniqueIndex("price_list_assignments_tier_idx").on(t.listId, t.tierId).where(sql`${t.tierId} is not null`),
    uniqueIndex("price_list_assignments_company_idx").on(t.listId, t.companyId).where(sql`${t.companyId} is not null`),
    index("price_list_assignments_store_tier_idx").on(t.storeId, t.tierId),
    index("price_list_assignments_store_company_idx").on(t.storeId, t.companyId),
    index("price_list_assignments_list_fk_idx").on(t.storeId, t.listId),
  ],
);

/** A price list's fixed price for one variant in one currency (D321): VAT included, as market prices are, in minor units. */
export const priceListPrices = commerce.table(
  "price_list_prices",
  {
    storeId: storeId(),
    listId: uuid("list_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "price_list_prices_pkey", columns: [t.listId, t.variantId, t.currency] }),
    foreignKey({ name: "price_list_prices_list_fk", columns: [t.storeId, t.listId], foreignColumns: [priceLists.storeId, priceLists.id] }).onDelete("cascade"),
    foreignKey({ name: "price_list_prices_variant_fk", columns: [t.storeId, t.variantId], foreignColumns: [productVariants.storeId, productVariants.id] }).onDelete("cascade"),
    index("price_list_prices_variant_idx").on(t.storeId, t.variantId),
    index("price_list_prices_list_fk_idx").on(t.storeId, t.listId),
    check("price_list_prices_amount", sql`${t.amountMinor} >= 0`),
    check("price_list_prices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * A price list's own price breaks for a variant (wave 6 unit E3, D323, `docs/wave-6-catalogue.md` E.3): from `fromQuantity` units in one line, a
 * whole `percent` off the market price or `amounts`, a unit price per currency with VAT (as `price_list_prices`), for the list's buyers only. Read
 * only by `commerce.line_price()`; at most 10 a variant in a list.
 */
export const priceListBreaks = commerce.table(
  "price_list_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    listId: uuid("list_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    fromQuantity: integer("from_quantity").notNull(),
    percent: integer("percent"),
    amounts: jsonb("amounts").$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("price_list_breaks_step_key").on(t.listId, t.variantId, t.fromQuantity),
    foreignKey({ name: "price_list_breaks_list_fk", columns: [t.storeId, t.listId], foreignColumns: [priceLists.storeId, priceLists.id] }).onDelete("cascade"),
    foreignKey({ name: "price_list_breaks_variant_fk", columns: [t.storeId, t.variantId], foreignColumns: [productVariants.storeId, productVariants.id] }).onDelete("cascade"),
    index("price_list_breaks_variant_idx").on(t.storeId, t.variantId),
    index("price_list_breaks_list_fk_idx").on(t.storeId, t.listId),
    check("price_list_breaks_from", sql`${t.fromQuantity} between 2 and 9999`),
    check("price_list_breaks_percent", sql`${t.percent} between 1 and 99`),
    check("price_list_breaks_one", sql`(${t.percent} is null) <> (${t.amounts} is null)`),
  ],
);

/**
 * A price list's own quantity rule for a variant (D323 E3): its buyers buy it at least `minQuantity`, at most `maxQuantity` and in whole
 * `quantityStep`s, in place of the variant's own rule. Read only through `commerce.quantity_rule()`.
 */
export const priceListQuantityRules = commerce.table(
  "price_list_quantity_rules",
  {
    storeId: storeId(),
    listId: uuid("list_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    minQuantity: integer("min_quantity").notNull().default(1),
    maxQuantity: integer("max_quantity"),
    quantityStep: integer("quantity_step").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "price_list_quantity_rules_pkey", columns: [t.listId, t.variantId] }),
    foreignKey({ name: "price_list_quantity_rules_list_fk", columns: [t.storeId, t.listId], foreignColumns: [priceLists.storeId, priceLists.id] }).onDelete("cascade"),
    foreignKey({ name: "price_list_quantity_rules_variant_fk", columns: [t.storeId, t.variantId], foreignColumns: [productVariants.storeId, productVariants.id] }).onDelete("cascade"),
    index("price_list_quantity_rules_variant_idx").on(t.storeId, t.variantId),
    index("price_list_quantity_rules_list_fk_idx").on(t.storeId, t.listId),
    check("price_list_quantity_rules_rule", sql`${t.minQuantity} between 1 and 9999 and ${t.quantityStep} between 1 and 9999 and ${t.minQuantity} % ${t.quantityStep} = 0`),
    check(
      "price_list_quantity_rules_max",
      sql`${t.maxQuantity} is null or (${t.maxQuantity} between ${t.minQuantity} and 9999 and ${t.maxQuantity} % ${t.quantityStep} = 0)`,
    ),
  ],
);

/** A price list's scope (D321): a product or a product category (with its subcategories) per row; none is every product. */
export const priceListProducts = commerce.table(
  "price_list_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    listId: uuid("list_id").notNull(),
    productId: uuid("product_id"),
    termId: uuid("term_id").references(() => terms.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "price_list_products_list_fk", columns: [t.storeId, t.listId], foreignColumns: [priceLists.storeId, priceLists.id] }).onDelete("cascade"),
    productRef("price_list_products_product_fk", t),
    check("price_list_products_one", sql`(${t.productId} is null) <> (${t.termId} is null)`),
    uniqueIndex("price_list_products_product_idx").on(t.listId, t.productId).where(sql`${t.productId} is not null`),
    uniqueIndex("price_list_products_term_idx").on(t.listId, t.termId).where(sql`${t.termId} is not null`),
    index("price_list_products_store_product_idx").on(t.storeId, t.productId),
    index("price_list_products_term_fk_idx").on(t.termId),
    index("price_list_products_list_fk_idx").on(t.storeId, t.listId),
  ],
);

/** A company's location (D321 C.2): a place it buys for, with a billing and a shipping address (each the shape orders keep, or null). At most 50 a company. */
export const companyLocations = commerce.table(
  "company_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId(),
    companyId: uuid("company_id").notNull(),
    name: text("name").notNull(),
    billingAddress: jsonb("billing_address"),
    shippingAddress: jsonb("shipping_address"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("company_locations_store_id_key").on(t.storeId, t.id),
    foreignKey({ name: "company_locations_company_fk", columns: [t.storeId, t.companyId], foreignColumns: [customerCompanies.storeId, customerCompanies.id] }).onDelete("cascade"),
    check("company_locations_name", sql`char_length(${t.name}) between 1 and 80`),
    uniqueIndex("company_locations_name_idx").on(t.companyId, sql`lower(${t.name})`),
    index("company_locations_company_fk_idx").on(t.storeId, t.companyId),
  ],
);

/** Who buys at a location and in what role (D321 C.2): `orderer` (over the limit an order waits) or `approver`. Only the company's employees; the main account approves everywhere without a row. */
export const companyLocationBuyers = commerce.table(
  "company_location_buyers",
  {
    storeId: storeId(),
    locationId: uuid("location_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "company_location_buyers_pk", columns: [t.locationId, t.customerId] }),
    foreignKey({ name: "company_location_buyers_location_fk", columns: [t.storeId, t.locationId], foreignColumns: [companyLocations.storeId, companyLocations.id] }).onDelete("cascade"),
    foreignKey({ name: "company_location_buyers_customer_fk", columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }).onDelete("cascade"),
    check("company_location_buyers_role", sql`${t.role} in ('orderer', 'approver')`),
    index("company_location_buyers_customer_idx").on(t.storeId, t.customerId),
    index("company_location_buyers_location_fk_idx").on(t.storeId, t.locationId),
  ],
);

/**
 * The status page's checks (wave 9 unit G, D360, `src/server/status.ts`, the only writer): one row per component of `STATUS_COMPONENTS` and
 * check, every five minutes from the dispatcher, `ok` or not with a short reason code (never a secret or a person's data). A component not
 * measured has no row (the page says *Not measured*, never up). Kept 90 days.
 */
export const statusChecks = commerce.table(
  "status_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    component: text("component").notNull(),
    ok: boolean("ok").notNull(),
    reason: text("reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("status_checks_component", sql`${t.component} in ('website', 'sign_in', 'payments', 'email', 'jobs')`),
    check("status_checks_reason", sql`${t.reason} is null or ${t.reason} ~ '^[a-z0-9_]{1,40}$'`),
    index("status_checks_component_idx").on(t.component, t.checkedAt),
  ],
);

/**
 * Incidents on the status page (D360), posted by platform admins in their own words (English, and Norwegian where given), with the
 * components they touch; written only by `src/server/status.ts`. `resolved_at` is set by the update that resolves it.
 */
export const statusIncidents = commerce.table(
  "status_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    titleNb: text("title_nb"),
    impact: text("impact").notNull(),
    components: text("components").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("investigating"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("status_incidents_impact", sql`${t.impact} in ('minor', 'major', 'maintenance')`),
    check("status_incidents_status", sql`${t.status} in ('investigating', 'identified', 'monitoring', 'resolved')`),
    check("status_incidents_title", sql`length(btrim(${t.title})) between 1 and 120 and (${t.titleNb} is null or length(${t.titleNb}) <= 120)`),
    check("status_incidents_components", sql`${t.components} <@ array['website', 'sign_in', 'payments', 'email', 'jobs']::text[]`),
    check("status_incidents_resolved", sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null)`),
    index("status_incidents_started_idx").on(t.startedAt),
    index("status_incidents_created_by_idx").on(t.createdBy),
  ],
);

/** What a platform admin said about an incident, in order (D360): its status then and their words. Never changed. */
export const statusIncidentUpdates = commerce.table(
  "status_incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => statusIncidents.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    body: text("body").notNull(),
    bodyNb: text("body_nb"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("status_incident_updates_status", sql`${t.status} in ('investigating', 'identified', 'monitoring', 'resolved')`),
    check("status_incident_updates_body", sql`length(btrim(${t.body})) between 1 and 2000 and (${t.bodyNb} is null or length(${t.bodyNb}) <= 2000)`),
    index("status_incident_updates_incident_idx").on(t.incidentId, t.createdAt),
    index("status_incident_updates_created_by_idx").on(t.createdBy),
  ],
);

/**
 * People who asked to hear about incidents by email (D360): an address, the language, confirmed by a link first (its token kept only as a
 * hash, `confirm_hash`), and a token of its own for leaving (`unsubscribe_token`, in every email). Written only by `src/server/status.ts`;
 * leaving deletes the row, and an unconfirmed one goes after a week.
 */
export const statusSubscribers = commerce.table(
  "status_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    locale: text("locale").notNull().default("en"),
    confirmHash: text("confirm_hash"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("status_subscribers_locale", sql`${t.locale} in ('en', 'nb-NO')`),
    uniqueIndex("status_subscribers_email_idx").on(sql`lower(${t.email})`),
    uniqueIndex("status_subscribers_confirm_idx").on(t.confirmHash),
    uniqueIndex("status_subscribers_unsubscribe_idx").on(t.unsubscribeToken),
  ],
);

/**
 * A device that gets a store's push notifications for a staff member (wave 9 unit H, D361, `src/server/push.ts`, the only writer): the
 * browser's push endpoint (only a push service's own host, `isPushEndpoint()`), its keys, and a name for the person to tell devices apart.
 * Removed when the push service says the device is gone (404 or 410), when the person's membership no longer reads orders, and by the
 * person on Your account.
 */
export const pushSubscriptions = commerce.table(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    storeId: storeId().references(() => stores.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    device: text("device").notNull().default(""),
    failures: integer("failures").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("push_subscriptions_endpoint_store_key").on(t.endpoint, t.storeId),
    check("push_subscriptions_endpoint", sql`${t.endpoint} like 'https://%' and length(${t.endpoint}) <= 2000`),
    check("push_subscriptions_device", sql`length(${t.device}) <= 60`),
    index("push_subscriptions_store_idx").on(t.storeId),
    index("push_subscriptions_account_idx").on(t.accountId, t.storeId),
  ],
);

/**
 * Storefront API tokens (wave 9 unit I, D362, `src/server/storefront-api.ts`, the only writer): public by design (a site's own code holds
 * one), each for one market of the store, opening only what any visitor of that market sees. Made and revoked by owners on Apps and API.
 */
export const storefrontTokens = commerce.table(
  "storefront_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    token: text("token").notNull().unique(),
    market: text("market").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("storefront_tokens_name", sql`length(btrim(${t.name})) between 1 and 60`),
    check("storefront_tokens_token", sql`${t.token} ~ '^kfs_[A-Za-z0-9_-]{32,48}$'`),
    index("storefront_tokens_store_idx").on(t.storeId),
    index("storefront_tokens_created_by_idx").on(t.createdBy),
  ],
);

/**
 * An owner's own app whose tools the AI manager may use (wave 9 unit J, D363, `src/server/custom-apps.ts`, the only writer): its MCP
 * endpoint and bearer token, both encrypted with the settings key (`endpoint_hint`, the host, and `token_hint` shown instead), the tools
 * its `tools/list` named (`tools`), which the owner switched on and how each runs (`switched`: `read`, `public`, `send`, `spend`), and how
 * many calls it took and failed. At most five a store.
 */
export const customApps = commerce.table(
  "custom_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: storeId().references(() => stores.id),
    name: text("name").notNull(),
    key: text("key").notNull(),
    endpointEncrypted: text("endpoint_encrypted").notNull(),
    endpointHint: text("endpoint_hint").notNull(),
    tokenEncrypted: text("token_encrypted"),
    tokenHint: text("token_hint"),
    tools: jsonb("tools").notNull().default([]),
    switched: jsonb("switched").notNull().default({}),
    calls: integer("calls").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
    listedAt: timestamp("listed_at", { withTimezone: true }),
    problem: text("problem"),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("custom_apps_store_key").on(t.storeId, t.key),
    check("custom_apps_name", sql`length(btrim(${t.name})) between 1 and 60`),
    check("custom_apps_key", sql`${t.key} ~ '^[a-z0-9][a-z0-9-]{0,15}$'`),
    check("custom_apps_counts", sql`${t.calls} >= 0 and ${t.failed} >= 0`),
    index("custom_apps_created_by_idx").on(t.createdBy),
  ],
);
