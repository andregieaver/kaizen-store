import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isDialect, type Cell, type DialectId } from "@/lib/csv";
import { ORDER_SELECTION_MAX } from "@/lib/data-limits";
import { mainCurrency } from "@/lib/markets";
import { ORDER_LAYOUTS, ORDER_PROFILES, orderColumns, orderRows, parseOrderNumbers, type ExportLine, type ExportOrder, type OrderLayout, type OrderProfile } from "@/lib/order-csv";

import type { ExportReader } from "./data-export-run";
import { pgTextArray, pgUuidArray } from "./pg-arrays";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The order export (D165, `docs/wave-2-data.md` 2.3, 4.2): a store's orders as plain rows for `src/lib/order-csv.ts`. Every statement carries the
 * store id. One place decides what is exported: a date range by the STORE's days (`stores.time_zone`, by the day the order was placed) or a pasted
 * list of order numbers (an explicit choice, so no other filter is applied to it); paid orders (a captured payment, a cancelled one that was paid
 * included, as analytics counts them) or every order; copied history (`copied_from`, number `C-...`) only when asked, host orders always and marked;
 * and a person's order that was erased (`restricted_at`, `anonymised_at`, D162) is exported with no personal field whatever the profile.
 *
 * The file carries NOTHING that opens something: not the order page's key (the payment's provider reference is the Checkout Session id, which is
 * that key, so `payment_reference` is filled only from a reference that is not one), no client secret, no token, no card data, no hash. The query
 * does not select those columns, so a later change to the file cannot add one by accident.
 */

export type OrderExportOptions = {
  /** A range of the store's days, both included, or a list of order numbers. */
  mode: "range" | "numbers";
  from?: string;
  to?: string;
  numbers?: string[];
  /** Paid orders (default) or every order including unpaid checkouts. Ignored for a list of numbers. */
  which: "paid" | "all";
  layout: OrderLayout;
  profile: OrderProfile;
  /** Include copied history (D129). Ignored for a list of numbers. */
  copied: boolean;
  dialect: DialectId;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string): boolean => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const schema = z.object({
  mode: z.enum(["range", "numbers"]).default("range"),
  from: z.string().optional(),
  to: z.string().optional(),
  numbers: z.union([z.string(), z.array(z.string())]).optional(),
  which: z.enum(["paid", "all"]).default("paid"),
  layout: z.enum(ORDER_LAYOUTS).default("lines"),
  profile: z.enum(ORDER_PROFILES).default("accounting"),
  copied: z.union([z.boolean(), z.enum(["true", "false", "on", "off", "1", "0"])]).default(false),
  dialect: z.string().default("excel_nordic"),
});

/** What a form or a job holds, checked: a range needs two days in order, a selection at least one number and at most `ORDER_SELECTION_MAX`. */
export function parseOrderExportOptions(raw: unknown): { ok: true; options: OrderExportOptions } | { ok: false; problem: string } {
  const parsed = schema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) return { ok: false, problem: "The choices for the export could not be read." };
  const o = parsed.data;
  if (!isDialect(o.dialect)) return { ok: false, problem: "Choose a file format." };
  const copied = o.copied === true || o.copied === "true" || o.copied === "on" || o.copied === "1";
  const base = { which: o.which, layout: o.layout, profile: o.profile, copied, dialect: o.dialect };
  if (o.mode === "numbers") {
    const pasted = Array.isArray(o.numbers) ? o.numbers.join("\n") : (o.numbers ?? "");
    const { numbers, over } = parseOrderNumbers(pasted, ORDER_SELECTION_MAX);
    if (numbers.length === 0) return { ok: false, problem: "Paste at least one order number." };
    if (over > 0) return { ok: false, problem: `A selection takes at most ${ORDER_SELECTION_MAX} order numbers; ${over} too many were pasted.` };
    return { ok: true, options: { mode: "numbers", numbers, ...base } };
  }
  if (!o.from || !o.to || !validDay(o.from) || !validDay(o.to)) return { ok: false, problem: "Choose the first and the last day." };
  if (o.from > o.to) return { ok: false, problem: "The first day is after the last day." };
  return { ok: true, options: { mode: "range", from: o.from, to: o.to, ...base } };
}

/** Which of some pasted order numbers are the store's, and which are not (listed back to the member). Matched as typed. */
export async function resolveOrderNumbers(storeId: string, numbers: readonly string[]): Promise<{ found: string[]; unknown: string[] }> {
  if (numbers.length === 0) return { found: [], unknown: [] };
  const rows = await db().execute<Row>(sql`select number from commerce.orders where store_id = ${storeId}::uuid and number = any(${pgTextArray(numbers)}::text[])`);
  const have = new Set(rows.map((r) => String(r.number)));
  return { found: numbers.filter((n) => have.has(n)), unknown: numbers.filter((n) => !have.has(n)) };
}

/** The orders an export names, in SQL (alias `o`). The store id first. */
function filterOf(store: Store, o: OrderExportOptions): SQL {
  const own = sql`o.store_id = ${store.id}::uuid`;
  if (o.mode === "numbers") return sql`${own} and o.number = any(${pgTextArray(o.numbers ?? [])}::text[])`;
  // The store's days: from the first day's local midnight up to the local midnight AFTER the last day. The next day is added to the DATE, then made a
  // moment in the store's zone: adding an interval to a timestamptz adds a flat 24 hours in the session's zone, which is wrong on the two days a year
  // the clock changes (a 23 or 25 hour day).
  const start = (day: string) => sql`((${day}::date)::timestamp at time zone ${store.timeZone})`;
  const after = (day: string) => sql`(((${day}::date + 1))::timestamp at time zone ${store.timeZone})`;
  const range = sql`o.placed_at >= ${start(o.from as string)} and o.placed_at < ${after(o.to as string)}`;
  // Paid: a captured payment (a cancelled order that was paid still counts), or a copied order that was paid in the store it came from.
  const paid = o.which === "paid"
    ? sql`and (exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured') or (o.copied_from is not null and o.status in ('paid', 'fulfilled', 'closed')))`
    : sql``;
  const copied = o.copied ? sql`` : sql`and o.copied_from is null`;
  return sql`${own} and ${range} ${paid} ${copied}`;
}

/** The rows the file will have (a row per line, or per order), and the orders, for the choice of a download or a job and for the limit. */
export async function countOrderExportRows(store: Store, o: OrderExportOptions): Promise<{ orders: number; rows: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as orders,
      coalesce(sum(greatest(1, (select count(*) from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id))), 0)::bigint as lines
    from commerce.orders o where ${filterOf(store, o)}
  `);
  const orders = Number(row?.orders ?? 0);
  return { orders, rows: o.layout === "orders" ? orders : Number(row?.lines ?? 0) };
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string | null => (v === null || v === undefined || String(v) === "" ? null : String(v));

type Address = ExportOrder["billing"];
const addressOf = (v: unknown): Address => {
  const a = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return { name: str(a.name), line1: str(a.line1), line2: str(a.line2), postalCode: str(a.postalCode), city: str(a.city), country: str(a.country), phone: str(a.phone) };
};

/** A reference that is not the order page's key: a payment intent or a charge. A Checkout Session id (`cs_...`) or a venue payment's is the key and is never written. */
export const exportablePaymentReference = (reference: string | null): string | null => (reference !== null && /^(pi|ch)_[A-Za-z0-9]+$/.test(reference) ? reference : null);

/** The orders after a position, as the file's input shape. */
async function readOrders(store: Store, o: OrderExportOptions, position: unknown, limit: number): Promise<{ orders: ExportOrder[]; position: unknown; more: boolean }> {
  const pos = typeof position === "object" && position !== null ? (position as { at: string; id: string }) : null;
  const rows = await db().execute<Row>(sql`
    select o.id, o.number, o.placed_at::text as placed_at_text, o.placed_at,
      to_char((o.placed_at at time zone ${store.timeZone})::date, 'YYYY-MM-DD') as placed_on,
      o.status::text as status, o.market_code, o.currency, o.locale, o.email, o.billing_address, o.shipping_address, o.discount_code,
      o.company_name, o.subtotal_minor, o.shipping_minor, o.discount_minor, o.member_discount_minor, o.campaign_discount_minor, o.credit_minor,
      o.referral_discount_minor, o.vat_relief_minor, o.vat_kind, o.tax_minor, o.total_minor, o.balance_minor, o.commission_minor,
      o.delivery ->> 'label' as delivery_label, o.vat_treatment ->> 'buyerVatNumber' as buyer_vat_number,
      o.copied_from is not null as copied, o.host_id is not null as host_order,
      -- Paid in Stripe's test mode: the same test as commerce.invoice_eligibility() ('test_mode'), so the file agrees with the invoices and the VAT reports.
      exists (
        select 1 from commerce.payments tp
        where tp.store_id = o.store_id and tp.order_id = o.id and tp.status not in ('failed', 'cancelled')
          and ((tp.provider <> 'venue' and tp.provider_account is not null and exists (
                  select 1 from commerce.connected_accounts a where a.store_id = o.store_id and a.account_id = tp.provider_account and a.mode = 'test'))
            or (tp.provider = 'venue' and tp.test_mode))
      ) as test_payment,
      (o.restricted_at is not null or o.anonymised_at is not null) as erased,
      o.archived_at is not null as archived, o.source as order_source, o.is_gift, o.gift_to, o.gift_from, o.gift_message,
      coalesce((select array_agg(t.label order by t.key) from commerce.order_tags t where t.store_id = o.store_id and t.order_id = o.id), '{}'::text[]) as tag_labels,
      pay.status as payment_status, pay.provider_reference as payment_reference,
      coalesce(
        (select min(e.created_at) from commerce.order_events e where e.store_id = o.store_id and e.order_id = o.id and e.type = 'order.paid'),
        (select min(p.updated_at) from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
      ) as paid_at,
      (select i.document_number from commerce.invoices i where i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order' order by i.number limit 1) as invoice_number,
      -- Wave 3 run 3 (D174): where the sending stands (the order page's own state) and whether staff changed the order after purchase.
      commerce.order_fulfilment(o.id) as fulfilment, o.edited_at is not null as edited,
      ref.amount as refunded, ref.n as refund_count, ref.last_at as last_refund_at
    from commerce.orders o
    left join lateral (
      select p.status::text as status, p.provider_reference from commerce.payments p
      where p.store_id = o.store_id and p.order_id = o.id order by (p.status = 'captured') desc, p.created_at limit 1
    ) pay on true
    left join lateral (
      select coalesce(sum(r.amount_minor), 0) as amount, count(*) as n, max(r.created_at) as last_at
      from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      -- The refund of an order change's lower total is not a refund here (D174, docs/analytics.md): the order's total is already the changed one.
      where r.store_id = o.store_id and p.order_id = o.id and r.status = 'succeeded' and r.order_edit_id is null
    ) ref on true
    where ${filterOf(store, o)} ${pos ? sql`and (o.placed_at, o.id) > (${pos.at}::timestamptz, ${pos.id}::uuid)` : sql``}
    order by o.placed_at, o.id limit ${limit + 1}
  `);
  const page = rows.slice(0, limit);
  const ids = page.map((r) => String(r.id));
  const lineRows = ids.length === 0 ? [] : await db().execute<Row>(sql`
    select ol.order_id, ol.sku, ol.title, ol.quantity, ol.unit_price_minor, ol.discount_minor, ol.total_minor, ol.tax_minor, ol.tax_rate,
      ol.unit_cost_minor, ol.gift, ol.delivery::text as delivery
    from commerce.order_lines ol
    where ol.store_id = ${store.id}::uuid and ol.order_id = any(${pgUuidArray(ids)}::uuid[])
    order by ol.order_id, ol.sku, ol.id
  `);
  const byOrder = new Map<string, ExportLine[]>();
  for (const l of lineRows) {
    const list = byOrder.get(String(l.order_id)) ?? [];
    list.push({
      lineNumber: list.length + 1,
      sku: String(l.sku ?? ""),
      title: String(l.title ?? ""),
      quantity: num(l.quantity),
      unitPriceMinor: num(l.unit_price_minor),
      discountMinor: num(l.discount_minor),
      totalMinor: num(l.total_minor),
      taxMinor: num(l.tax_minor),
      taxRate: Number(l.tax_rate ?? 0),
      unitCostMinor: l.unit_cost_minor === null || l.unit_cost_minor === undefined ? null : num(l.unit_cost_minor),
      gift: l.gift === true,
      delivery: (["physical", "digital", "service"].includes(String(l.delivery)) ? String(l.delivery) : "physical") as ExportLine["delivery"],
    });
    byOrder.set(String(l.order_id), list);
  }
  const orders: ExportOrder[] = page.map((r) => {
    const business = Boolean(r.company_name);
    return {
      number: String(r.number),
      placedAt: new Date(String(r.placed_at)).toISOString(),
      placedOn: String(r.placed_on),
      status: String(r.status),
      paymentStatus: str(r.payment_status),
      paidAt: r.paid_at ? new Date(String(r.paid_at)).toISOString() : null,
      market: String(r.market_code).trim(),
      currency: String(r.currency).trim(),
      locale: String(r.locale ?? ""),
      copied: r.copied === true,
      hostOrder: r.host_order === true,
      testPayment: r.test_payment === true,
      invoiceNumber: str(r.invoice_number),
      customerType: business ? "business" : "private",
      companyName: str(r.company_name),
      buyerVatNumber: business ? str(r.buyer_vat_number) : null,
      erased: r.erased === true,
      email: str(r.email),
      billing: addressOf(r.billing_address),
      shipping: addressOf(r.shipping_address),
      discountCode: str(r.discount_code),
      subtotalMinor: num(r.subtotal_minor),
      shippingMinor: num(r.shipping_minor),
      discountMinor: num(r.discount_minor),
      memberDiscountMinor: num(r.member_discount_minor),
      campaignDiscountMinor: num(r.campaign_discount_minor),
      creditMinor: num(r.credit_minor),
      referralDiscountMinor: num(r.referral_discount_minor),
      vatReliefMinor: num(r.vat_relief_minor),
      vatKind: String(r.vat_kind ?? "standard"),
      taxMinor: num(r.tax_minor),
      totalMinor: num(r.total_minor),
      refundedMinor: num(r.refunded),
      refundCount: num(r.refund_count),
      lastRefundAt: r.last_refund_at ? new Date(String(r.last_refund_at)).toISOString() : null,
      balanceMinor: num(r.balance_minor),
      commissionMinor: num(r.commission_minor),
      deliveryService: str(r.delivery_label),
      tags: Array.isArray(r.tag_labels) ? (r.tag_labels as unknown[]).map(String) : [],
      archived: r.archived === true,
      fulfilment: r.fulfilment === null || r.fulfilment === undefined ? null : String(r.fulfilment),
      edited: r.edited === true,
      source: r.order_source === "draft" ? "draft" : "checkout",
      isGift: r.is_gift === true,
      giftTo: str(r.gift_to),
      giftFrom: str(r.gift_from),
      giftMessage: str(r.gift_message),
      paymentReference: exportablePaymentReference(str(r.payment_reference)),
      lines: byOrder.get(String(r.id)) ?? [],
    };
  });
  const last = page.at(-1);
  return { orders, position: last ? { at: String(last.placed_at_text), id: String(last.id) } : position, more: rows.length > limit };
}

/** The reader of an order export: the store's rates are those of the moment the job runs, held for the whole job. */
export async function orderExportReader(store: Store, o: OrderExportOptions): Promise<ExportReader> {
  const main = { currency: mainCurrency(store), rates: store.localization.rates };
  return {
    header: orderColumns(o.layout, o.profile),
    dialect: o.dialect,
    fileBase: "orders",
    total: async () => (await countOrderExportRows(store, o)).orders,
    async read(position, limit) {
      const read = await readOrders(store, o, position, Math.max(1, limit));
      const rows: Cell[][] = orderRows(read.orders, { layout: o.layout, profile: o.profile, main });
      return { rows, position: read.position, more: read.more, units: read.orders.length };
    },
  };
}
