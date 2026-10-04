/* eslint-disable @typescript-eslint/no-explicit-any -- a snapshot is JSON and the tests read it as such */
/**
 * Rows for the tests of invoices and credit notes (D159): a store with the seller's details, orders placed as `placeOrder()` writes
 * them (VAT per line, shipping, discounts, reverse charge), paid through `commerce.complete_order_payment()` like every real path,
 * and refunds. Shared by `invoices.test.ts` and `invoice-parity.test.ts`; nothing here is used by the application.
 */
import type { PGlite } from "@electric-sql/pglite";

import { vatIncludedExact } from "@/lib/invoice-snapshot";

export type Db = Pick<PGlite, "query">;

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

export async function scalar<T = unknown>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = await one<Record<string, T>>(db, sql, params);
  return Object.values(row ?? {})[0] as T;
}

export type StoreOptions = {
  country?: string;
  legalName?: string | null;
  organisationNumber?: string | null;
  postalAddress?: string | null;
  contactEmail?: string | null;
  timeZone?: string;
  /** null: no tax profile row. */
  registered?: boolean | null;
  vatNumber?: string | null;
  markets?: string[];
  /** Units of each currency per 1 EUR; the store's `store_currencies`. */
  rates?: Record<string, number>;
  ratesAuto?: boolean;
  ratesUpdatedAt?: string | null;
  footerNote?: string | null;
  /** Rows of `invoice_settings`: null for none (invoicing on). */
  invoicing?: boolean | null;
};

let counter = 0;
const next = () => (counter += 1);

/** A store with complete seller details, a tax profile, markets and rates, ready to invoice. */
export async function createInvoiceStore(db: Db, slug: string, o: StoreOptions = {}): Promise<string> {
  const country = o.country ?? "NO";
  const id = (
    await one<{ id: string }>(
      db,
      `insert into commerce.stores (slug, name, country, legal_name, organisation_number, postal_address, contact_email, time_zone, rates_auto, rates_updated_at)
       values ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        slug,
        country,
        o.legalName === undefined ? "Fixture AS" : o.legalName,
        o.organisationNumber === undefined ? "923456789" : o.organisationNumber,
        o.postalAddress === undefined ? "Storgata 1, 0155 Oslo" : o.postalAddress,
        o.contactEmail === undefined ? "post@fixture.example" : o.contactEmail,
        o.timeZone ?? "Europe/Oslo",
        o.ratesAuto ?? false,
        o.ratesUpdatedAt === undefined ? "2026-10-01T08:00:00Z" : o.ratesUpdatedAt,
      ],
    )
  ).id;
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [id, o.markets ?? ["NO", "SE", "DK", "DE", "FI"]],
  );
  for (const [currency, rate] of Object.entries(o.rates ?? { NOK: 11.7, SEK: 11.2, DKK: 7.46 })) {
    await db.query("insert into commerce.store_currencies (store_id, currency, rate) values ($1, $2, $3)", [id, currency, rate]);
  }
  if (o.registered !== null) {
    const registered = o.registered ?? true;
    await db.query("insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values ($1, $2, $3)", [
      id,
      registered,
      registered ? (o.vatNumber === undefined ? `${country}923456789MVA`.slice(0, 14) : o.vatNumber) : null,
    ]);
  }
  if (o.footerNote !== undefined || (o.invoicing !== undefined && o.invoicing !== null)) {
    await db.query("insert into commerce.invoice_settings (store_id, enabled, footer_note) values ($1, $2, $3)", [id, o.invoicing ?? true, o.footerNote ?? null]);
  }
  return id;
}

export type LineSpec = {
  sku: string;
  title?: string;
  quantity?: number;
  /** The price of one unit, VAT included, in the order's currency. */
  unit: number;
  rate?: number;
  /** A code's discount on the line, VAT included. */
  discount?: number;
  member?: number;
  campaign?: number;
  bonus?: number;
  referral?: number;
  delivery?: "physical" | "digital" | "service";
  gift?: boolean;
  /** The product's VAT category (`exempt` makes its own bucket). */
  category?: string;
  /** A line of a selling plan: `trial` is a free-trial line (nothing to pay now), `fee` a sign-up fee, `renewing` a priced one. */
  plan?: "trial" | "fee" | "renewing";
  /** A booked time or stay: local times in the store's zone (`2026-10-12T10:00`) and its nights, days or hours. */
  booking?: { startsAt: string; endsAt: string; count?: number };
};

export type OrderSpec = {
  market?: string;
  currency?: string;
  locale?: string;
  email?: string;
  lines: LineSpec[];
  /** Delivery, VAT included, before any shipping discount. */
  shipping?: number;
  /** null: the order keeps no shipping rate (an order from before D157). */
  shippingRate?: number | null;
  shippingDiscount?: number;
  vatKind?: "standard" | "reverse_charge" | "ioss";
  company?: { name: string; number?: string; vatNumber?: string };
  iossNumber?: string;
  /** What the order's frozen treatment says of the seller's number (undefined: the store's; null: none; a renewal has no treatment at all, `noTreatment`). */
  sellerVatNumber?: string | null;
  noTreatment?: boolean;
  billing?: Record<string, string | null>;
  shipTo?: Record<string, string | null>;
  balance?: number;
  deliveryLabel?: string;
  memberLabel?: string;
  campaignLabel?: string;
  discountCode?: string;
  host?: boolean;
  copied?: boolean;
  pay?: boolean | "pending-only";
  provider?: "stripe" | "venue";
  /** The Stripe account the payment is on (`acct_…`); a row in `stripe_accounts` makes its mode known. */
  account?: string | null;
  /** When the payment happened (the `order.paid` event); default now. */
  paidAt?: string;
};

export type PlacedOrder = {
  id: string;
  number: string;
  total: number;
  tax: number;
  lineIds: string[];
  invoiceId: string | null;
};

const products = new Map<string, { variantId: string; productId: string; planId?: string }>();

async function variantFor(db: Db, store: string, category: string, plan: boolean): Promise<{ variantId: string; planId: string | null }> {
  const key = `${store}|${category}`;
  let found = products.get(key);
  if (!found) {
    const n = next();
    const productId = (
      await one<{ id: string }>(db, "insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, $2, 'txcd_99999999', $3) returning id", [store, `fx-${category}-${n}`, category])
    ).id;
    const variantId = (await one<{ id: string }>(db, "insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, $3) returning id", [store, productId, `FX-${category}-${n}`])).id;
    found = { variantId, productId };
    products.set(key, found);
  }
  if (plan && !found.planId) {
    found.planId = (
      await one<{ id: string }>(db, "insert into commerce.selling_plans (store_id, product_id, interval, trial_days) values ($1, $2, 'month', 14) returning id", [store, found.productId])
    ).id;
  }
  return { variantId: found.variantId, planId: found.planId ?? null };
}

/** An order as `placeOrder()` writes it: VAT per line from the amount paid for it, shipping apart, discounts inside the lines. */
export async function placeOrder(db: Db, store: string, spec: OrderSpec): Promise<PlacedOrder> {
  const market = spec.market ?? "NO";
  const currency = spec.currency ?? (await scalar<string>(db, "select currency::text from commerce.countries where code = $1", [market]));
  const rc = spec.vatKind === "reverse_charge";
  const shippingRate = spec.shippingRate === undefined ? 0.25 : spec.shippingRate;
  const rateForShipping = shippingRate ?? 0.25;

  type Row = { spec: LineSpec; quantity: number; rate: number; discount: number; relief: number; total: number; tax: number; unit: number };
  const rows: Row[] = spec.lines.map((l) => {
    const quantity = l.quantity ?? 1;
    const rate = l.rate ?? 0.25;
    const unit = l.plan === "trial" ? 0 : l.unit;
    const gross = unit * quantity;
    const given = l.gift ? gross : Math.min((l.discount ?? 0) + (l.member ?? 0) + (l.campaign ?? 0) + (l.bonus ?? 0) + (l.referral ?? 0), gross);
    const relief = rc && !l.gift ? vatIncludedExact(gross - given, rate) : 0;
    const total = gross - given - relief;
    return { spec: l, quantity, rate, discount: given + relief, relief, total, tax: rc ? 0 : vatIncludedExact(total, rate), unit };
  });
  const shipping = spec.shipping ?? 0;
  const shippingDiscount = Math.min(spec.shippingDiscount ?? 0, shipping);
  const shippingRelief = rc ? vatIncludedExact(shipping - shippingDiscount, rateForShipping) : 0;
  const shippingTax = rc ? 0 : vatIncludedExact(shipping - shippingDiscount, rateForShipping);
  const subtotal = rows.reduce((s, r) => s + r.unit * r.quantity, 0);
  const discount = rows.reduce((s, r) => s + r.discount, 0) + shippingDiscount + shippingRelief;
  const total = subtotal + shipping - discount;
  const tax = rows.reduce((s, r) => s + r.tax, 0) + shippingTax;
  const sum = (key: "member" | "campaign" | "bonus" | "referral") => spec.lines.reduce((s, l) => s + (l[key] ?? 0), 0);
  const relief = rows.reduce((s, r) => s + r.relief, 0) + shippingRelief;

  const n = next();
  const number = spec.copied ? `C-${9000 + n}` : `FX-${1000 + n}`;
  const profileNumber = await scalar<string | null>(db, "select vat_number from commerce.store_tax_profile where store_id = $1", [store]);
  const treatment = spec.noTreatment
    ? null
    : {
        kind: spec.vatKind ?? "standard",
        reason: rc ? "reverse_charge" : spec.vatKind === "ioss" ? "ioss" : "consumer",
        sellerVatNumber: spec.sellerVatNumber === undefined ? profileNumber : spec.sellerVatNumber,
        sellerCountry: "NO",
        buyerVatNumber: spec.company?.vatNumber ?? null,
        buyerCountry: spec.company?.vatNumber ? spec.company.vatNumber.slice(0, 2) : null,
        vies: { status: "valid", checkedAt: null, requestIdentifier: null, registeredName: "VIES NAME", registeredAddress: "VIES ADDRESS" },
        iossNumber: spec.vatKind === "ioss" ? (spec.iossNumber ?? "IM5780000001") : null,
        consignmentEurMinor: null,
        shippingRule: "standard",
        shippingRate: shippingRate,
      };
  let hostId: string | null = null;
  if (spec.host) {
    const account = await one<{ id: string }>(db, "insert into commerce.accounts (email) values ($1) returning id", [`host${n}@example.com`]);
    hostId = (
      await one<{ id: string }>(db, "insert into commerce.hosts (store_id, account_id, name, commission_bps) values ($1, $2, 'Fixture host', 1000) returning id", [store, account.id])
    ).id;
  }
  if (spec.copied) await db.query("select set_config('commerce.copying', 'on', false)");
  const copiedFrom = spec.copied ? (await one<{ id: string }>(db, "select gen_random_uuid() as id")).id : null;

  const order = await one<{ id: string }>(
    db,
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
       billing_address, shipping_address, company_name, organisation_number, balance_minor, member_discount_minor, member_label, campaign_discount_minor, campaign_label,
       credit_minor, referral_discount_minor, discount_code, vat_kind, vat_relief_minor, shipping_tax_rate, vat_treatment, delivery, host_id, copied_from)
     values ($1, $2, $3, $4, $5, $6, $31::commerce.order_status, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28::jsonb, $29, $30)
     returning id`,
    [
      store, number, market, currency, spec.locale ?? (market === "NO" ? "nb-NO" : market === "SE" ? "sv-SE" : market === "DK" ? "da-DK" : market === "DE" ? "de-DE" : "en-IE"),
      spec.email ?? "shopper@example.com", subtotal, shipping, discount, tax, total,
      JSON.stringify(spec.billing ?? { name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: market }),
      JSON.stringify(spec.shipTo ?? { name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: market }),
      spec.company?.name ?? null, spec.company?.number ?? null, spec.balance ?? 0,
      sum("member"), sum("member") > 0 ? (spec.memberLabel ?? "Gold") : null, sum("campaign"), sum("campaign") > 0 ? (spec.campaignLabel ?? "Autumn sale") : null,
      sum("bonus"), sum("referral"), spec.discountCode ?? null, spec.vatKind ?? "standard", relief, shippingRate, treatment ? JSON.stringify(treatment) : null,
      spec.deliveryLabel ? JSON.stringify({ label: spec.deliveryLabel }) : null, hostId, copiedFrom, spec.copied ? "paid" : "pending_payment",
    ],
  );
  const lineIds: string[] = [];
  for (const r of rows) {
    const category = r.spec.category ?? "standard";
    const v = r.spec.sku === "SIGNUP-FEE" ? { variantId: null, planId: null } : await variantFor(db, store, category, Boolean(r.spec.plan));
    const line = await one<{ id: string }>(
      db,
      `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, member_discount_minor, total_minor, tax_minor, tax_rate,
         tax_code, delivery, selling_plan_id, campaign_discount_minor, gift, bonus_discount_minor, referral_discount_minor, vat_relief_minor, booked_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'txcd_99999999', $13, $14, $15, $16, $17, $18, $19, $20) returning id`,
      [
        store, order.id, v.variantId, r.spec.sku, r.spec.title ?? `Item ${r.spec.sku}`, r.quantity, r.unit, r.discount, r.spec.member ?? 0, r.total, r.tax, r.rate,
        r.spec.delivery ?? "physical", r.spec.plan ? v.planId ?? (await variantFor(db, store, category, true)).planId : null, r.spec.campaign ?? 0, Boolean(r.spec.gift), r.spec.bonus ?? 0,
        r.spec.referral ?? 0, r.relief, r.spec.booking ? (r.spec.booking.count ?? 1) : null,
      ],
    );
    lineIds.push(line.id);
    if (r.spec.booking) {
      const resource = (
        await one<{ id: string }>(db, "insert into commerce.booking_resources (store_id, name, hours) values ($1, 'Room', '{}'::jsonb) returning id", [store])
      ).id;
      const tz = await scalar<string>(db, "select time_zone from commerce.stores where id = $1", [store]);
      await db.query(
        `insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status, order_id, order_line_id)
         select $1, v.product_id, v.id, $2, ($4::timestamp at time zone $3), ($5::timestamp at time zone $3), ($4::timestamp at time zone $3), ($5::timestamp at time zone $3), 'confirmed', $6, $7
           from commerce.product_variants v where v.id = $8`,
        [store, resource, tz, r.spec.booking.startsAt, r.spec.booking.endsAt, order.id, line.id, v.variantId],
      );
    }
  }

  let invoiceId: string | null = null;
  if (spec.copied) await db.query("select set_config('commerce.copying', '', false)");
  if (spec.pay !== false && !spec.copied) {
    const account = spec.account === undefined ? null : spec.account;
    await db.query(
      `insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [store, order.id, spec.provider ?? "stripe", `pi_fx_${n}`, account, Math.max(1, total - (spec.balance ?? 0)), currency],
    );
    if (spec.pay !== "pending-only") {
      await db.query("select commerce.complete_order_payment($1::uuid, $2)", [order.id, `cs_fx_${n}`]);
      if (spec.paidAt) await db.query("update commerce.order_events set created_at = $2 where order_id = $1 and type = 'order.paid'", [order.id, spec.paidAt]).catch(() => undefined);
      await db.query("update commerce.payments set status = 'captured' where order_id = $1", [order.id]);
      invoiceId = (await one<{ id: string }>(db, "select id from commerce.invoices where order_id = $1", [order.id]))?.id ?? null;
    }
  }
  return { id: order.id, number, total, tax, lineIds, invoiceId };
}

/** A paid order's `order.paid` event, written at a given moment (for orders that waited). */
export async function paidAt(db: Db, orderId: string, at: string): Promise<void> {
  await db.query("insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) select store_id, id, 'order.paid', '{}'::jsonb, 'test', $2 from commerce.orders where id = $1", [orderId, at]);
}

/** A refund of an order's payment, in the given status (the credit note follows at commit when it succeeded). */
export async function refund(db: Db, orderId: string, amount: number, status: "pending" | "succeeded" | "failed" = "succeeded"): Promise<string> {
  const payment = await one<{ id: string; store_id: string }>(db, "select id, store_id from commerce.payments where order_id = $1 order by created_at limit 1", [orderId]);
  const n = next();
  return (
    await one<{ id: string }>(
      db,
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'test', $4, $5) returning id",
      [payment.store_id, payment.id, amount, `re_fx_${n}`, status],
    )
  ).id;
}

export type DocRow = {
  id: string;
  document_number: string;
  total_minor: string;
  tax_minor: string;
  net_minor: string;
  snapshot: any;
  public_token: string | null;
  issued_on: string;
  supply_date?: string;
};

export const invoiceOf = (db: Db, orderId: string) =>
  one<DocRow>(db, "select id, document_number, total_minor::text, tax_minor::text, net_minor::text, snapshot, public_token, issued_on::text, supply_date::text from commerce.invoices where order_id = $1", [orderId]);

export const creditNotesOf = async (db: Db, orderId: string): Promise<DocRow[]> =>
  (
    await db.query<DocRow>(
      `select c.id, c.document_number, c.total_minor::text, c.tax_minor::text, c.net_minor::text, c.snapshot, c.public_token, c.issued_on::text
         from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
        where i.order_id = $1 order by c.number`,
      [orderId],
    )
  ).rows;

export type WorkingJson = {
  lines: { lineId: string; quantity: number; valueMinor: number; deductionMinor: number }[];
  deliveryMinor: number;
  returnShippingMinor: number;
  adjustmentMinor: number;
  amountMinor: number;
  outside: boolean;
};

/** A working as `refundReturn()` keeps it: the adjustment is what the amount is beyond the rest. */
export function workingOf(over: Omit<WorkingJson, "adjustmentMinor" | "outside"> & { outside?: boolean }): WorkingJson {
  const base = over.lines.reduce((s, l) => s + l.valueMinor - l.deductionMinor, 0) + over.deliveryMinor - over.returnShippingMinor;
  return { ...over, outside: over.outside ?? false, adjustmentMinor: over.amountMinor - base };
}

/** An approved voluntary return of an order. */
export async function startReturn(db: Db, store: string, orderId: string): Promise<{ id: string; number: string }> {
  return one<{ id: string; number: string }>(db, "insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', 'approved') returning id, number", [store, orderId]);
}

/** A return's refund through Stripe: the refund row and the return's record of it, in one transaction (the credit note follows at commit). */
export async function refundReturn(db: PGlite, store: string, orderId: string, returnId: string, working: WorkingJson | null, amount = working?.amountMinor ?? 0, status: "succeeded" | "pending" = "succeeded"): Promise<string> {
  let refundId = "";
  await db.transaction(async (tx) => {
    const payment = (await tx.query<{ id: string }>("select id from commerce.payments where order_id = $1 order by created_at limit 1", [orderId])).rows[0].id;
    const n = next();
    refundId = (
      await tx.query<{ id: string }>(
        "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'return', $4, $5) returning id",
        [store, payment, amount, `re_ret_${n}`, status],
      )
    ).rows[0].id;
    await tx.query("update commerce.returns set refund_id = $2, refund_minor = $3, refund_computed_minor = $3, refunded_at = now(), refund_working = $4::jsonb where id = $1", [
      returnId, refundId, amount, working ? JSON.stringify(working) : null,
    ]);
  });
  return refundId;
}

/** A return refunded outside Kaizen's Stripe: no refund row, the credit note comes from the return. */
export async function refundReturnOutside(db: Db, returnId: string, working: WorkingJson | null, amount = working?.amountMinor ?? 0): Promise<void> {
  await db.query("update commerce.returns set refund_minor = $2, refund_computed_minor = $2, refund_outside = true, refunded_at = now(), refund_working = $3::jsonb where id = $1", [
    returnId, amount, working ? JSON.stringify(working) : null,
  ]);
}
