/**
 * The commerce data model. Tables live in the private `commerce` schema, which
 * Supabase does not expose through its public Data API: only server code with
 * a direct database connection can reach them.
 *
 * Conventions:
 * - Money is an integer count of minor units (cents, öre) with an ISO 4217
 *   currency code alongside. Prices are VAT-inclusive (gross), per market.
 * - Records with legal weight (prices, invoices, credit notes, order events)
 *   are append-only; triggers in the functions migration enforce it.
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
} from "drizzle-orm/pg-core";

export const commerce = pgSchema("commerce");

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" }).notNull();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

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

export const cartStatus = commerce.enum("cart_status", [
  "open",
  "converted",
  "abandoned",
]);

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

export const refundStatus = commerce.enum("refund_status", [
  "pending",
  "succeeded",
  "failed",
]);

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

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/** One row per country the store can sell to. Launch countries are `active`. */
export const markets = commerce.table(
  "markets",
  {
    code: char("code", { length: 2 }).primaryKey(),
    name: text("name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    defaultLocale: text("default_locale").notNull(),
    locales: text("locales").array().notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("markets_code_currency_key").on(t.code, t.currency),
    check("markets_code_upper", sql`${t.code} = upper(${t.code})`),
    check("markets_currency_upper", sql`${t.currency} = upper(${t.currency})`),
    check(
      "markets_default_locale_listed",
      sql`${t.defaultLocale} = any(${t.locales})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * A manufacturer, importer or EU responsible person, as named on a listing
 * under the General Product Safety Regulation (EU) 2023/988, Art. 19.
 */
export const economicOperators = commerce.table("economic_operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  postalAddress: text("postal_address").notNull(),
  /** An email address or web address where the operator can be contacted. */
  electronicAddress: text("electronic_address").notNull(),
  country: char("country", { length: 2 }).notNull(),
  createdAt: createdAt(),
});

export const products = commerce.table(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull().unique(),
    status: productStatus("status").notNull().default("draft"),
    manufacturerId: uuid("manufacturer_id").references(
      () => economicOperators.id,
    ),
    /** Required when the manufacturer is established outside the EU. */
    responsiblePersonId: uuid("responsible_person_id").references(
      () => economicOperators.id,
    ),
    /** Stripe Tax product tax code, e.g. `txcd_99999999`. */
    taxCode: text("tax_code").notNull(),
    withdrawalExclusion: withdrawalExclusion("withdrawal_exclusion")
      .notNull()
      .default("none"),
    /** Category-specific attributes; the category is not fixed yet. */
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("products_manufacturer_idx").on(t.manufacturerId),
    index("products_responsible_person_idx").on(t.responsiblePersonId),
    check(
      "products_handle_format",
      sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/** Localised listing text, including GPSR safety information. */
export const productTranslations = commerce.table(
  "product_translations",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Warnings and safety information, shown on the listing itself. */
    safetyInformation: text("safety_information").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.productId, t.locale] })],
);

export const productMedia = commerce.table(
  "product_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
    /** Alt text keyed by locale. */
    alt: jsonb("alt").notNull().default({}),
  },
  (t) => [index("product_media_product_idx").on(t.productId, t.position)],
);

export const productVariants = commerce.table(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    gtin: text("gtin"),
    /**
     * Overrides the product's Stripe Tax code for this variant, for the rare
     * case where variants of one product are taxed differently.
     */
    taxCode: text("tax_code"),
    /** Option values, e.g. `{"size": "M", "colour": "blue"}`. */
    options: jsonb("options").notNull().default({}),
    weightGrams: integer("weight_grams"),
    /**
     * Customs tariff code (HS, 6 to 10 digits) and country of origin. Every
     * parcel from Norway to an EU country crosses a customs border and is
     * declared with these.
     */
    hsCode: text("hs_code"),
    originCountry: char("origin_country", { length: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    check("product_variants_gtin_digits", sql`${t.gtin} ~ '^[0-9]{8,14}$'`),
    check("product_variants_weight_positive", sql`${t.weightGrams} > 0`),
    check("product_variants_hs_code_digits", sql`${t.hsCode} ~ '^[0-9]{6,10}$'`),
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
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: money("amount_minor"),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "prices_market_currency_fk",
      columns: [t.marketCode, t.currency],
      foreignColumns: [markets.code, markets.currency],
    }),
    index("prices_market_currency_idx").on(t.marketCode, t.currency),
    uniqueIndex("prices_one_current_idx")
      .on(t.variantId, t.marketCode)
      .where(sql`${t.validTo} is null`),
    index("prices_history_idx").on(t.variantId, t.marketCode, t.validFrom),
    check("prices_amount_non_negative", sql`${t.amountMinor} >= 0`),
    check(
      "prices_valid_range",
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);

/** The producer responsibility schemes a product falls under. */
export const productSchemes = commerce.table(
  "product_schemes",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    scheme: producerScheme("scheme").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.scheme] })],
);

/**
 * The store's own registration under a producer responsibility scheme in a
 * market, e.g. a German packaging (LUCID) or electrical-equipment (WEEE)
 * number. Some markets require the number to be shown to customers.
 */
export const producerRegistrations = commerce.table(
  "producer_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketCode: char("market_code", { length: 2 })
      .notNull()
      .references(() => markets.code),
    scheme: producerScheme("scheme").notNull(),
    registrationNumber: text("registration_number").notNull(),
    authority: text("authority").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: createdAt(),
  },
  (t) => [
    index("producer_registrations_market_scheme_idx").on(
      t.marketCode,
      t.scheme,
    ),
    check(
      "producer_registrations_valid_range",
      sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const inventoryLocations = commerce.table("inventory_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const inventoryLevels = commerce.table(
  "inventory_levels",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => inventoryLocations.id),
    onHand: integer("on_hand").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    index("inventory_levels_location_idx").on(t.locationId),
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
    /** The Supabase Auth user, once the customer has an account. */
    authUserId: uuid("auth_user_id").unique(),
    email: text("email").notNull(),
    locale: text("locale"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_email_idx").on(sql`lower(${t.email})`)],
);

export const carts = commerce.table(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "carts_market_currency_fk",
      columns: [t.marketCode, t.currency],
      foreignColumns: [markets.code, markets.currency],
    }),
    index("carts_customer_idx").on(t.customerId),
    index("carts_market_currency_idx").on(t.marketCode, t.currency),
  ],
);

export const cartLines = commerce.table(
  "cart_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    unique("cart_lines_cart_variant_key").on(t.cartId, t.variantId),
    index("cart_lines_variant_idx").on(t.variantId),
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
    /** The customer-facing order number. Not an invoice number. */
    number: text("number").notNull().unique(),
    marketCode: char("market_code", { length: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    locale: text("locale").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    cartId: uuid("cart_id").references(() => carts.id),
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
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the goods reached the customer; starts the withdrawal period. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "orders_market_currency_fk",
      columns: [t.marketCode, t.currency],
      foreignColumns: [markets.code, markets.currency],
    }),
    index("orders_cart_idx").on(t.cartId),
    index("orders_market_currency_idx").on(t.marketCode, t.currency),
    index("orders_customer_idx").on(t.customerId),
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

export const orderLines = commerce.table(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor"),
    discountMinor: money("discount_minor").default(0),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 }).notNull(),
    taxCode: text("tax_code").notNull(),
    withdrawalExclusion: withdrawalExclusion("withdrawal_exclusion")
      .notNull()
      .default("none"),
  },
  (t) => [
    index("order_lines_order_idx").on(t.orderId),
    index("order_lines_variant_idx").on(t.variantId),
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
 * Stock held for a cart or an unpaid order. Available stock is on-hand minus
 * the reservations that have neither expired nor been released.
 */
export const inventoryReservations = commerce.table(
  "inventory_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => inventoryLocations.id),
    quantity: integer("quantity").notNull(),
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_reservations_active_idx")
      .on(t.variantId, t.locationId)
      .where(sql`${t.releasedAt} is null`),
    index("inventory_reservations_cart_idx").on(t.cartId),
    index("inventory_reservations_order_idx").on(t.orderId),
    index("inventory_reservations_location_idx").on(t.locationId),
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
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Payments and refunds
// ---------------------------------------------------------------------------

export const payments = commerce.table(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull(),
    /** The provider's id, e.g. a Stripe Checkout Session or PaymentIntent. */
    providerReference: text("provider_reference").notNull(),
    amountMinor: money("amount_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("payments_provider_reference_key").on(
      t.provider,
      t.providerReference,
    ),
    index("payments_order_idx").on(t.orderId),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const refunds = commerce.table(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amountMinor: money("amount_minor"),
    reason: text("reason").notNull(),
    providerReference: text("provider_reference").unique(),
    status: refundStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    index("refunds_payment_idx").on(t.paymentId),
    check("refunds_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Withdrawals and returns
// ---------------------------------------------------------------------------

/**
 * A use of the withdrawal button (Directive (EU) 2023/2673): the legal
 * notice. The physical return of goods is tracked separately in `returns`.
 */
export const withdrawalRequests = commerce.table(
  "withdrawal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    channel: text("channel").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The second, "confirm withdrawal" step. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** When the acknowledgement was sent on a durable medium. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgementReference: text("acknowledgement_reference"),
  },
  (t) => [
    index("withdrawal_requests_order_idx").on(t.orderId),
    check(
      "withdrawal_requests_ack_after_confirm",
      sql`${t.acknowledgedAt} is null or ${t.confirmedAt} is not null`,
    ),
  ],
);

export const withdrawalRequestLines = commerce.table(
  "withdrawal_request_lines",
  {
    withdrawalRequestId: uuid("withdrawal_request_id")
      .notNull()
      .references(() => withdrawalRequests.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.withdrawalRequestId, t.orderLineId] }),
    index("withdrawal_request_lines_order_line_idx").on(t.orderLineId),
    check("withdrawal_request_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const returns = commerce.table(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    withdrawalRequestId: uuid("withdrawal_request_id").references(
      () => withdrawalRequests.id,
    ),
    status: returnStatus("status").notNull().default("requested"),
    createdAt: createdAt(),
  },
  (t) => [
    index("returns_order_idx").on(t.orderId),
    index("returns_withdrawal_request_idx").on(t.withdrawalRequestId),
  ],
);

export const returnLines = commerce.table(
  "return_lines",
  {
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: integer("quantity").notNull(),
    condition: text("condition"),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.orderLineId] }),
    index("return_lines_order_line_idx").on(t.orderLineId),
    check("return_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Invoices and credit notes
// ---------------------------------------------------------------------------

/**
 * Counters for legally numbered documents. Postgres sequences can skip
 * numbers, so documents take their number from `commerce.next_document_number`,
 * which increments this row inside the issuing transaction.
 */
export const documentSeries = commerce.table(
  "document_series",
  {
    series: text("series").primaryKey(),
    prefix: text("prefix").notNull(),
    nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
  },
  (t) => [check("document_series_next_positive", sql`${t.nextNumber} > 0`)],
);

export const invoices = commerce.table(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    series: text("series")
      .notNull()
      .references(() => documentSeries.series),
    number: bigint("number", { mode: "number" }).notNull(),
    documentNumber: text("document_number").notNull().unique(),
    currency: char("currency", { length: 3 }).notNull(),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("invoices_series_number_key").on(t.series, t.number),
    index("invoices_order_idx").on(t.orderId),
  ],
);

export const creditNotes = commerce.table(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    refundId: uuid("refund_id").references(() => refunds.id),
    series: text("series")
      .notNull()
      .references(() => documentSeries.series),
    number: bigint("number", { mode: "number" }).notNull(),
    documentNumber: text("document_number").notNull().unique(),
    currency: char("currency", { length: 3 }).notNull(),
    totalMinor: money("total_minor"),
    taxMinor: money("tax_minor"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("credit_notes_series_number_key").on(t.series, t.number),
    index("credit_notes_refund_idx").on(t.refundId),
    index("credit_notes_invoice_idx").on(t.invoiceId),
  ],
);

// ---------------------------------------------------------------------------
// Integration plumbing
// ---------------------------------------------------------------------------

/** Makes retried writes (checkout, refunds) safe to repeat. */
export const idempotencyKeys = commerce.table(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("in_progress"),
    response: jsonb("response"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/** Every inbound webhook, stored before processing and deduplicated. */
export const webhookEvents = commerce.table(
  "webhook_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    unique("webhook_events_provider_event_key").on(t.provider, t.eventId),
    index("webhook_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Staff and store settings
// ---------------------------------------------------------------------------

export const staffRole = commerce.enum("staff_role", ["owner", "admin"]);

export const paymentMode = commerce.enum("payment_mode", ["test", "live"]);

/**
 * People who can sign in to the admin. Only these emails are sent a sign-in
 * link; `auth_user_id` is linked to the Supabase Auth user on first sign-in.
 * Owners manage staff and payment credentials; admins manage the rest.
 */
export const staff = commerce.table(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    authUserId: uuid("auth_user_id").unique(),
    role: staffRole("role").notNull().default("admin"),
    invitedBy: uuid("invited_by"),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("staff_email_idx").on(sql`lower(${t.email})`),
    foreignKey({
      name: "staff_invited_by_fk",
      columns: [t.invitedBy],
      foreignColumns: [t.id],
    }),
    index("staff_invited_by_idx").on(t.invitedBy),
  ],
);

/** A payment provider the store can use, and which of its modes is live. */
export const paymentProviders = commerce.table(
  "payment_providers",
  {
    provider: text("provider").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    activeMode: paymentMode("active_mode").notNull().default("test"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => staff.id),
  },
  (t) => [index("payment_providers_updated_by_idx").on(t.updatedBy)],
);

/**
 * API credentials per provider and mode. Secrets are stored encrypted with a
 * key that lives only in the server environment; `*_hint` keeps a masked
 * form such as `sk_test_…4242` for display, since secrets are never shown
 * again once saved.
 */
export const paymentCredentials = commerce.table(
  "payment_credentials",
  {
    provider: text("provider")
      .notNull()
      .references(() => paymentProviders.provider),
    mode: paymentMode("mode").notNull(),
    publishableKey: text("publishable_key"),
    secretKeyCiphertext: text("secret_key_ciphertext"),
    secretKeyHint: text("secret_key_hint"),
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),
    webhookSecretHint: text("webhook_secret_hint"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => staff.id),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.mode] }),
    index("payment_credentials_updated_by_idx").on(t.updatedBy),
  ],
);

/** Whether a payment method is offered at checkout in a market. */
export const paymentMethods = commerce.table(
  "payment_methods",
  {
    marketCode: char("market_code", { length: 2 })
      .notNull()
      .references(() => markets.code),
    method: text("method").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => staff.id),
  },
  (t) => [
    primaryKey({ columns: [t.marketCode, t.method] }),
    index("payment_methods_updated_by_idx").on(t.updatedBy),
  ],
);

/** Append-only record of every settings and staff change. Never holds secrets. */
export const settingsAuditLog = commerce.table(
  "settings_audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    staffId: uuid("staff_id").references(() => staff.id),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("settings_audit_log_created_idx").on(t.createdAt),
    index("settings_audit_log_staff_idx").on(t.staffId),
  ],
);
