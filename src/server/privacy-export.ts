import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { readField, isEmptyValue } from "@/lib/custom-fields";
import { fieldValueText } from "@/lib/field-tools";
import { t } from "@/lib/i18n";
import { yearsOf, periodFor } from "@/lib/retention";
import { EMAIL_KINDS } from "@/lib/personal-data";
import {
  EXPORT_ROW_LIMIT,
  exportFileName,
  overLimit,
  shapeExport,
  totalRows,
  type AbandonedRow,
  type BonusSource,
  type CartRow,
  type DraftExportRow,
  type CompanySource,
  type ConsentRow,
  type CustomFieldRow,
  type DocumentRow,
  type EmailRow,
  type ExportCounts,
  type ExportFile,
  type ExportInput,
  type FormRow,
  type OrderRow,
  type ProfileRow,
  type ReferralSource,
  type ReturnRow,
  type StandingListRow,
  type SubscriptionRow,
  type WishlistAddRow,
  type WishlistRow,
  type WithdrawalRow,
} from "@/lib/privacy-export";
import { privacyLanguage } from "@/lib/privacy-text";

import { audit } from "./auth";
import { getFieldData, listFieldGroups } from "./custom-fields";
import { notifyOwners } from "./privacy-notices";
import { privacyStore, resolveSubject, type PrivacySubject, type SubjectRef } from "./privacy-subject";

export { subjectOf } from "./privacy-subject";
import { retentionRules } from "./retention";
import { textList, uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * The export of a person's data (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.2): one JSON file of what a store holds about the subject,
 * by `store_id` only (a person who shops in two stores has two files, never one with both), in the order's own currency, never converted.
 * This module reads the rows; `shapeExport()` (pure) decides what the file says, field by field. Never emailed, never kept: the caller
 * answers with the text and forgets it. A subject with more rows than `EXPORT_ROW_LIMIT` is refused, never cut short.
 *
 * Restricted and anonymised orders are not the person's any more (`resolveSubject()`), so they are not in the file.
 */

export type ExportResult =
  | { ok: true; file: ExportFile; fileName: string; counts: ExportCounts; requestId: string | null }
  | { ok: false; problem: "not_found" | "too_large" };

export type ExportBy = {
  channel: "staff" | "shopper";
  /** The staff member (null for the shopper's own download). */
  accountId: string | null;
  /** The privacy request this answers, when staff logged one. */
  requestId?: string | null;
  now?: Date;
  rowLimit?: number;
  /** Where the owners' notice links to (the staff download only). */
  adminUrl?: string | null;
};

const iso = (v: unknown): string | null => (v == null ? null : new Date(String(v)).toISOString());
const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));
const strs = (v: unknown): string => String(v ?? "");

/** The count of every section's top-level rows, cheaply, before anything is loaded (so a huge subject is refused, not built). */
async function countRows(s: PrivacySubject): Promise<number> {
  const store = s.storeId;
  const addresses = textList(s.addresses);
  const orders = uuidList(s.orderIds);
  const carts = uuidList(s.cartIds);
  const [row] = await db().execute<Row>(sql`
    select
      (select count(*) from commerce.invoices where store_id = ${store}::uuid and order_id = any(${orders})) +
      (select count(*) from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.store_id = ${store}::uuid and i.order_id = any(${orders})) +
      (select count(*) from commerce.returns where store_id = ${store}::uuid and order_id = any(${orders})) +
      (select count(*) from commerce.withdrawal_requests where store_id = ${store}::uuid and order_id = any(${orders})) +
      (select count(*) from commerce.standing_orders where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.wishlists where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.wishlist_cart_adds where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.bonus_entries where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.email_messages where store_id = ${store}::uuid and lower(to_address) = any(${addresses})) +
      (select count(*) from commerce.form_submissions where store_id = ${store}::uuid and lower(email) = any(${addresses})) +
      (select count(*) from commerce.carts where store_id = ${store}::uuid and id = any(${carts})) +
      (select count(*) from commerce.draft_orders where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.abandoned_checkouts where store_id = ${store}::uuid and (lower(email) = any(${addresses}) or cart_id = any(${carts}))) +
      ${s.orderIds.length}::bigint + ${s.subscriptionIds.length}::bigint as n
  `);
  return num(row?.n);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------------------------------------------------------------

const titleOf = (variant: string) => sql`coalesce(
  (select pt.title from commerce.product_translations pt where pt.store_id = ${sql.raw(variant)}.store_id and pt.product_id = ${sql.raw(variant)}.product_id
    order by pt.locale = (select s.locales[1] from commerce.stores s where s.id = ${sql.raw(variant)}.store_id) desc, pt.locale limit 1),
  ${sql.raw(variant)}.sku)`;

async function loadProfile(s: PrivacySubject): Promise<ProfileRow | null> {
  if (!s.customerId) return null;
  const [c] = await db().execute<Row>(sql`
    select c.id, c.email, c.name, c.phone, c.address, c.locale, c.created_at, c.last_sign_in_at, c.email_verified_at,
      c.password_hash is not null as has_password, c.avatar_path is not null as has_avatar, c.company_name, c.organisation_number,
      t.name as group_name, t.percent as group_percent, cc.name as membership_company_name, c.company_role as membership_role
    from commerce.customers c
    left join commerce.customer_tiers t on t.store_id = c.store_id and t.id = c.tier_id
    left join commerce.customer_companies cc on cc.store_id = c.store_id and cc.id = c.company_id
    where c.store_id = ${s.storeId}::uuid and c.id = ${s.customerId}::uuid
  `);
  if (!c) return null;
  return {
    id: strs(c.id),
    email: strs(c.email),
    name: str(c.name),
    phone: str(c.phone),
    address: c.address,
    locale: str(c.locale),
    createdAt: iso(c.created_at),
    lastSignInAt: iso(c.last_sign_in_at),
    emailVerifiedAt: iso(c.email_verified_at),
    hasPassword: Boolean(c.has_password),
    hasAvatar: Boolean(c.has_avatar),
    companyName: str(c.company_name),
    organisationNumber: str(c.organisation_number),
    groupName: str(c.group_name),
    groupPercent: c.group_percent == null ? null : num(c.group_percent),
    membershipCompanyName: str(c.membership_company_name),
    membershipRole: str(c.membership_role),
  };
}

async function loadOrders(s: PrivacySubject): Promise<OrderRow[]> {
  if (s.orderIds.length === 0) return [];
  const ids = uuidList(s.orderIds);
  const store = s.storeId;
  const [orders, lines, payments, refunds, shipments, downloads, terms, events, bookings, tags] = await Promise.all([
    db().execute<Row>(sql`
      select o.id, o.number, o.placed_at, o.status, trim(o.currency) as currency, o.subtotal_minor, o.shipping_minor, o.discount_minor,
        o.member_discount_minor, o.campaign_discount_minor, o.credit_minor, o.referral_discount_minor, o.vat_relief_minor, o.tax_minor, o.total_minor,
        o.vat_kind, o.vat_treatment ->> 'reason' as vat_reason, o.delivery ->> 'label' as delivery_label, o.billing_address, o.shipping_address, o.email,
        o.company_name, o.organisation_number, o.discount_code, o.copied_from is not null as copied, o.host_id is not null as host,
        o.restricted_at, o.anonymised_at, o.is_gift, o.gift_to, o.gift_from, o.gift_message
      from commerce.orders o where o.store_id = ${store}::uuid and o.id = any(${ids}) order by o.placed_at, o.id
    `),
    db().execute<Row>(sql`
      select l.id, l.order_id, l.sku, l.title, l.quantity, l.unit_price_minor, l.tax_rate, l.tax_minor, l.total_minor
      from commerce.order_lines l where l.store_id = ${store}::uuid and l.order_id = any(${ids}) order by l.order_id, l.id
    `),
    db().execute<Row>(sql`
      select order_id, provider, amount_minor, trim(currency) as currency, status, created_at, provider_reference
      from commerce.payments where store_id = ${store}::uuid and order_id = any(${ids}) order by created_at, id
    `),
    db().execute<Row>(sql`
      select p.order_id, r.amount_minor, trim(p.currency) as currency, r.status, r.created_at, r.reason
      from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      where r.store_id = ${store}::uuid and p.order_id = any(${ids}) order by r.created_at, r.id
    `),
    db().execute<Row>(sql`
      select order_id, carrier, tracking_number, created_at from commerce.shipments
      where store_id = ${store}::uuid and order_id = any(${ids}) order by created_at, id
    `),
    db().execute<Row>(sql`
      select d.order_id, f.name as file_name, d.downloads from commerce.order_downloads d
      left join commerce.product_files f on f.store_id = d.store_id and f.id = d.file_id
      where d.store_id = ${store}::uuid and d.order_id = any(${ids}) order by d.created_at, d.id
    `),
    db().execute<Row>(sql`
      select order_id, mode, accepted_at, locale from commerce.order_terms where store_id = ${store}::uuid and order_id = any(${ids})
    `),
    db().execute<Row>(sql`
      select order_id, type, created_at, data ->> 'reason' as reason, data ->> 'note' as note from commerce.order_events where store_id = ${store}::uuid and order_id = any(${ids}) order by id
    `),
    db().execute<Row>(sql`
      select order_line_id, starts_at, ends_at from commerce.bookings
      where store_id = ${store}::uuid and order_id = any(${ids}) and order_line_id is not null
    `),
    db().execute<Row>(sql`select order_id, label from commerce.order_tags where store_id = ${store}::uuid and order_id = any(${ids}) order by order_id, created_at, key`),
  ]);
  const group = <T extends Row>(rows: T[], key: string) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = strs(r[key]);
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return map;
  };
  const byOrder = {
    lines: group(lines, "order_id"),
    payments: group(payments, "order_id"),
    refunds: group(refunds, "order_id"),
    shipments: group(shipments, "order_id"),
    downloads: group(downloads, "order_id"),
    events: group(events, "order_id"),
    tags: group(tags, "order_id"),
  };
  const termsOf = new Map(terms.map((x) => [strs(x.order_id), x]));
  const bookingOf = new Map(bookings.map((b) => [strs(b.order_line_id), b]));
  return orders.map((o) => {
    const id = strs(o.id);
    const term = termsOf.get(id);
    return {
      id,
      number: strs(o.number),
      placedAt: iso(o.placed_at),
      status: strs(o.status),
      currency: strs(o.currency),
      subtotalMinor: num(o.subtotal_minor),
      shippingMinor: num(o.shipping_minor),
      discountMinor: num(o.discount_minor),
      memberDiscountMinor: num(o.member_discount_minor),
      campaignDiscountMinor: num(o.campaign_discount_minor),
      creditMinor: num(o.credit_minor),
      referralDiscountMinor: num(o.referral_discount_minor),
      vatReliefMinor: num(o.vat_relief_minor),
      taxMinor: num(o.tax_minor),
      totalMinor: num(o.total_minor),
      vatKind: strs(o.vat_kind),
      vatReason: str(o.vat_reason),
      deliveryLabel: str(o.delivery_label),
      billingAddress: o.billing_address,
      shippingAddress: o.shipping_address,
      email: strs(o.email),
      companyName: str(o.company_name),
      organisationNumber: str(o.organisation_number),
      discountCode: str(o.discount_code),
      copied: Boolean(o.copied),
      host: Boolean(o.host),
      restrictedAt: iso(o.restricted_at),
      keptUntil: null,
      anonymisedAt: iso(o.anonymised_at),
      gift: o.is_gift ? { to: str(o.gift_to), from: str(o.gift_from), message: str(o.gift_message) } : null,
      tags: (byOrder.tags.get(id) ?? []).map((t) => strs(t.label)),
      lines: (byOrder.lines.get(id) ?? []).map((l) => {
        const b = bookingOf.get(strs(l.id));
        return {
          id: strs(l.id),
          sku: str(l.sku),
          title: strs(l.title),
          quantity: num(l.quantity),
          unitPriceMinor: num(l.unit_price_minor),
          taxRate: l.tax_rate == null ? null : num(l.tax_rate),
          taxMinor: num(l.tax_minor),
          totalMinor: num(l.total_minor),
          bookedStartsAt: b ? iso(b.starts_at) : null,
          bookedEndsAt: b ? iso(b.ends_at) : null,
        };
      }),
      payments: (byOrder.payments.get(id) ?? []).map((p) => ({
        provider: strs(p.provider),
        amountMinor: num(p.amount_minor),
        currency: strs(p.currency),
        status: strs(p.status),
        createdAt: iso(p.created_at),
        providerReference: str(p.provider_reference),
      })),
      refunds: (byOrder.refunds.get(id) ?? []).map((r) => ({ amountMinor: num(r.amount_minor), currency: strs(r.currency), status: strs(r.status), createdAt: iso(r.created_at), reason: str(r.reason) })),
      shipments: (byOrder.shipments.get(id) ?? []).map((x) => ({ carrier: str(x.carrier), trackingNumber: str(x.tracking_number), createdAt: iso(x.created_at) })),
      downloads: (byOrder.downloads.get(id) ?? []).map((d) => ({ fileName: str(d.file_name), downloads: num(d.downloads) })),
      terms: term ? { mode: strs(term.mode), acceptedAt: iso(term.accepted_at), locale: str(term.locale) } : null,
      events: (byOrder.events.get(id) ?? []).map((e) => ({ type: strs(e.type), createdAt: iso(e.created_at), reason: str(e.reason), note: str(e.note) })),
    };
  });
}

async function loadInvoices(s: PrivacySubject): Promise<DocumentRow[]> {
  if (s.orderIds.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select i.id, i.document_number, i.series, i.number, o.number as order_number, i.issued_on::text as issued_on, i.issued_at, trim(i.currency) as currency,
      i.net_minor, i.tax_minor, i.total_minor, i.vat_kind, i.anonymised_at is not null as anonymised, i.snapshot
    from commerce.invoices i join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where i.store_id = ${s.storeId}::uuid and i.order_id = any(${uuidList(s.orderIds)}) order by i.issued_at, i.id
  `);
  return rows.map((r) => ({
    id: strs(r.id),
    documentNumber: strs(r.document_number),
    series: strs(r.series),
    number: num(r.number),
    orderNumber: str(r.order_number),
    issuedOn: strs(r.issued_on),
    issuedAt: iso(r.issued_at),
    currency: strs(r.currency),
    netMinor: num(r.net_minor),
    taxMinor: num(r.tax_minor),
    totalMinor: num(r.total_minor),
    vatKind: str(r.vat_kind),
    anonymised: Boolean(r.anonymised),
    snapshot: r.snapshot,
  }));
}

async function loadCreditNotes(s: PrivacySubject): Promise<DocumentRow[]> {
  if (s.orderIds.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select c.id, c.document_number, c.series, c.number, o.number as order_number, c.issued_on::text as issued_on, c.issued_at, trim(c.currency) as currency,
      c.net_minor, c.tax_minor, c.total_minor, c.anonymised_at is not null as anonymised, c.snapshot, i.document_number as invoice_number, c.source
    from commerce.credit_notes c
    join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
    join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
    where c.store_id = ${s.storeId}::uuid and i.order_id = any(${uuidList(s.orderIds)}) order by c.issued_at, c.id
  `);
  return rows.map((r) => ({
    id: strs(r.id),
    documentNumber: strs(r.document_number),
    series: strs(r.series),
    number: num(r.number),
    orderNumber: str(r.order_number),
    issuedOn: strs(r.issued_on),
    issuedAt: iso(r.issued_at),
    currency: strs(r.currency),
    netMinor: num(r.net_minor),
    taxMinor: num(r.tax_minor),
    totalMinor: num(r.total_minor),
    anonymised: Boolean(r.anonymised),
    snapshot: r.snapshot,
    invoiceNumber: str(r.invoice_number),
    source: str(r.source),
  }));
}

async function loadReturns(s: PrivacySubject): Promise<ReturnRow[]> {
  if (s.orderIds.length === 0) return [];
  const ids = uuidList(s.orderIds);
  const [returns, lines] = await Promise.all([
    db().execute<Row>(sql`
      select r.id, r.number, o.number as order_number, r.kind, r.status, r.reason, r.reason_note, r.decision_note, r.refund_note, r.staff_note,
        r.refund_minor, trim(o.currency) as currency, r.refunded_at, r.created_at, r.closed_at
      from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      where r.store_id = ${s.storeId}::uuid and r.order_id = any(${ids}) order by r.created_at, r.id
    `),
    db().execute<Row>(sql`
      select rl.return_id, ol.sku, ol.title, rl.quantity, rl.decision, rl."condition" as condition, rl.reason
      from commerce.return_lines rl join commerce.returns r on r.store_id = rl.store_id and r.id = rl.return_id
      join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
      where rl.store_id = ${s.storeId}::uuid and r.order_id = any(${ids}) order by rl.return_id, ol.id
    `),
  ]);
  return returns.map((r) => ({
    id: strs(r.id),
    number: strs(r.number),
    orderNumber: str(r.order_number),
    kind: strs(r.kind),
    status: strs(r.status),
    reason: str(r.reason),
    reasonNote: str(r.reason_note),
    decisionNote: str(r.decision_note),
    refundNote: str(r.refund_note),
    staffNote: str(r.staff_note),
    refundMinor: r.refund_minor == null ? null : num(r.refund_minor),
    currency: strs(r.currency),
    refundedAt: iso(r.refunded_at),
    createdAt: iso(r.created_at),
    closedAt: iso(r.closed_at),
    lines: lines
      .filter((l) => strs(l.return_id) === strs(r.id))
      .map((l) => ({ sku: str(l.sku), title: str(l.title), quantity: num(l.quantity), decision: strs(l.decision), condition: str(l.condition), reason: str(l.reason) })),
  }));
}

async function loadWithdrawals(s: PrivacySubject): Promise<WithdrawalRow[]> {
  if (s.orderIds.length === 0) return [];
  const ids = uuidList(s.orderIds);
  const [requests, lines] = await Promise.all([
    db().execute<Row>(sql`
      select w.id, o.number as order_number, w.name, w.email, w.channel, w.status, w.submitted_at, w.confirmed_at, w.acknowledged_at
      from commerce.withdrawal_requests w join commerce.orders o on o.store_id = w.store_id and o.id = w.order_id
      where w.store_id = ${s.storeId}::uuid and w.order_id = any(${ids}) order by w.submitted_at, w.id
    `),
    db().execute<Row>(sql`
      select wl.withdrawal_request_id, ol.sku, ol.title, wl.quantity
      from commerce.withdrawal_request_lines wl
      join commerce.withdrawal_requests w on w.store_id = wl.store_id and w.id = wl.withdrawal_request_id
      join commerce.order_lines ol on ol.store_id = wl.store_id and ol.id = wl.order_line_id
      where wl.store_id = ${s.storeId}::uuid and w.order_id = any(${ids}) order by wl.withdrawal_request_id, ol.id
    `),
  ]);
  return requests.map((w) => ({
    id: strs(w.id),
    orderNumber: str(w.order_number),
    name: strs(w.name),
    email: strs(w.email),
    channel: strs(w.channel),
    status: strs(w.status),
    submittedAt: iso(w.submitted_at),
    confirmedAt: iso(w.confirmed_at),
    acknowledgedAt: iso(w.acknowledged_at),
    lines: lines.filter((l) => strs(l.withdrawal_request_id) === strs(w.id)).map((l) => ({ sku: str(l.sku), title: str(l.title), quantity: num(l.quantity) })),
  }));
}

async function loadSubscriptions(s: PrivacySubject): Promise<SubscriptionRow[]> {
  if (s.subscriptionIds.length === 0) return [];
  const ids = uuidList(s.subscriptionIds);
  const [subs, lines] = await Promise.all([
    db().execute<Row>(sql`
      select id, number, status, "interval" as interval, interval_count, trim(currency) as currency, subtotal_minor, shipping_minor, tax_minor, total_minor,
        email, shipping_address, current_period_end, cancelled_at, created_at
      from commerce.subscriptions where store_id = ${s.storeId}::uuid and id = any(${ids}) order by created_at, id
    `),
    db().execute<Row>(sql`
      select subscription_id, sku, title, quantity, unit_price_minor from commerce.subscription_lines
      where store_id = ${s.storeId}::uuid and subscription_id = any(${ids}) order by subscription_id, id
    `),
  ]);
  return subs.map((x) => ({
    id: strs(x.id),
    number: strs(x.number),
    status: strs(x.status),
    interval: strs(x.interval),
    intervalCount: num(x.interval_count),
    currency: strs(x.currency),
    subtotalMinor: num(x.subtotal_minor),
    shippingMinor: num(x.shipping_minor),
    taxMinor: num(x.tax_minor),
    totalMinor: num(x.total_minor),
    email: strs(x.email),
    shippingAddress: x.shipping_address,
    currentPeriodEnd: iso(x.current_period_end),
    cancelledAt: iso(x.cancelled_at),
    createdAt: iso(x.created_at),
    lines: lines
      .filter((l) => strs(l.subscription_id) === strs(x.id))
      .map((l) => ({ sku: str(l.sku), title: strs(l.title), quantity: num(l.quantity), unitPriceMinor: num(l.unit_price_minor) })),
  }));
}

async function loadStandingLists(s: PrivacySubject): Promise<StandingListRow[]> {
  if (!s.customerId) return [];
  const lists = await db().execute<Row>(sql`
    select l.id, d.name as schedule_name, l.status, l.shipping_address, l.card_label, l.consent_at, l.skip_dates::text[] as skip_dates, l.created_at
    from commerce.standing_orders l left join commerce.delivery_schedules d on d.store_id = l.store_id and d.id = l.schedule_id
    where l.store_id = ${s.storeId}::uuid and l.customer_id = ${s.customerId}::uuid order by l.created_at, l.id
  `);
  if (lists.length === 0) return [];
  const ids = uuidList(lists.map((l) => strs(l.id)));
  const [lines, deliveries] = await Promise.all([
    db().execute<Row>(sql`
      select sl.standing_order_id, v.sku, ${titleOf("v")} as title, sl.quantity
      from commerce.standing_order_lines sl join commerce.product_variants v on v.store_id = sl.store_id and v.id = sl.variant_id
      where sl.store_id = ${s.storeId}::uuid and sl.standing_order_id = any(${ids}) order by sl.standing_order_id, v.sku
    `),
    db().execute<Row>(sql`
      select sd.standing_order_id, sd.delivery_date::text as delivery_date, sd.outcome, o.number as order_number
      from commerce.standing_deliveries sd left join commerce.orders o on o.store_id = sd.store_id and o.id = sd.order_id
      where sd.store_id = ${s.storeId}::uuid and sd.standing_order_id = any(${ids}) order by sd.standing_order_id, sd.delivery_date
    `),
  ]);
  return lists.map((l) => ({
    id: strs(l.id),
    scheduleName: str(l.schedule_name),
    status: strs(l.status),
    shippingAddress: l.shipping_address,
    cardLabel: str(l.card_label),
    consentAt: iso(l.consent_at),
    skipDates: ((l.skip_dates as string[] | null) ?? []).map(String),
    createdAt: iso(l.created_at),
    lines: lines.filter((x) => strs(x.standing_order_id) === strs(l.id)).map((x) => ({ sku: str(x.sku), title: strs(x.title), quantity: num(x.quantity) })),
    deliveries: deliveries
      .filter((d) => strs(d.standing_order_id) === strs(l.id))
      .map((d) => ({ deliveryDate: strs(d.delivery_date), outcome: str(d.outcome), orderNumber: str(d.order_number) })),
  }));
}

async function loadWishlists(s: PrivacySubject): Promise<{ lists: WishlistRow[]; adds: WishlistAddRow[] }> {
  if (!s.customerId) return { lists: [], adds: [] };
  const [lists, adds] = await Promise.all([
    db().execute<Row>(sql`
      select id, name, created_at from commerce.wishlists where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid order by created_at, id
    `),
    db().execute<Row>(sql`
      select title, sku, quantity, trim(currency) as currency, unit_price_minor, created_at from commerce.wishlist_cart_adds
      where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid order by created_at, id
    `),
  ]);
  const items =
    lists.length === 0
      ? []
      : await db().execute<Row>(sql`
          select i.wishlist_id, v.sku, ${titleOf("v")} as title, i.quantity, i.created_at
          from commerce.wishlist_items i join commerce.product_variants v on v.store_id = i.store_id and v.id = i.variant_id
          where i.store_id = ${s.storeId}::uuid and i.wishlist_id = any(${uuidList(lists.map((l) => strs(l.id)))}) order by i.wishlist_id, i.created_at, i.id
        `);
  return {
    lists: lists.map((l) => ({
      id: strs(l.id),
      name: str(l.name),
      createdAt: iso(l.created_at),
      items: items.filter((i) => strs(i.wishlist_id) === strs(l.id)).map((i) => ({ sku: str(i.sku), title: strs(i.title), quantity: num(i.quantity), addedAt: iso(i.created_at) })),
    })),
    adds: adds.map((a) => ({ title: strs(a.title), sku: str(a.sku), quantity: num(a.quantity), currency: strs(a.currency), unitPriceMinor: num(a.unit_price_minor), createdAt: iso(a.created_at) })),
  };
}

async function loadBonus(s: PrivacySubject): Promise<BonusSource> {
  if (!s.customerId) return null;
  const [entries, settings, balance] = await Promise.all([
    db().execute<Row>(sql`
      select e.kind, e.amount_minor, e.available_at, e.expires_at, o.number as order_number, e.note, e.created_at
      from commerce.bonus_entries e left join commerce.orders o on o.store_id = e.store_id and o.id = e.order_id
      where e.store_id = ${s.storeId}::uuid and e.customer_id = ${s.customerId}::uuid order by e.created_at, e.id
    `),
    db().execute<Row>(sql`select trim(currency) as currency from commerce.bonus_settings where store_id = ${s.storeId}::uuid`),
    db().execute<Row>(sql`select available_minor from commerce.bonus_balance(${s.storeId}::uuid, ${s.customerId}::uuid)`),
  ]);
  if (entries.length === 0 && !settings[0]) return null;
  return {
    currency: strs(settings[0]?.currency ?? "").toUpperCase() || "EUR",
    balanceMinor: num(balance[0]?.available_minor),
    entries: entries.map((e) => ({
      kind: strs(e.kind),
      amountMinor: num(e.amount_minor),
      availableAt: iso(e.available_at),
      expiresAt: iso(e.expires_at),
      orderNumber: str(e.order_number),
      note: str(e.note),
      createdAt: iso(e.created_at),
    })),
  };
}

async function loadReferrals(s: PrivacySubject): Promise<ReferralSource> {
  if (!s.customerId) return { affiliate: null, rewards: null, wasReferred: false };
  const [affiliate, rewards, referred, settings] = await Promise.all([
    db().execute<Row>(sql`
      select code, blocked_at is not null as blocked, blocked_reason, created_at from commerce.affiliates
      where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid
    `),
    db().execute<Row>(sql`
      select count(*)::int as n, coalesce(sum(reward_minor), 0)::bigint as reward, coalesce(sum(discount_minor), 0)::bigint as discount
      from commerce.affiliate_attributions where store_id = ${s.storeId}::uuid and affiliate_customer_id = ${s.customerId}::uuid
    `),
    db().execute<Row>(sql`
      select (c.referred_by_customer_id is not null or exists (
        select 1 from commerce.affiliate_attributions a where a.store_id = c.store_id and a.friend_customer_id = c.id)) as referred
      from commerce.customers c where c.store_id = ${s.storeId}::uuid and c.id = ${s.customerId}::uuid
    `),
    db().execute<Row>(sql`select trim(currency) as currency from commerce.bonus_settings where store_id = ${s.storeId}::uuid`),
  ]);
  const a = affiliate[0];
  const r = rewards[0];
  return {
    affiliate: a ? { code: strs(a.code), blocked: Boolean(a.blocked), blockedReason: str(a.blocked_reason), createdAt: iso(a.created_at) } : null,
    rewards: r && num(r.n) > 0 ? { count: num(r.n), rewardMinor: num(r.reward), discountMinor: num(r.discount), currency: strs(settings[0]?.currency ?? "").toUpperCase() || "EUR" } : null,
    wasReferred: Boolean(referred[0]?.referred),
  };
}

async function loadConsents(s: PrivacySubject, orders: OrderRow[]): Promise<ConsentRow[]> {
  const addresses = textList(s.addresses);
  const orderIds = uuidList(s.orderIds);
  const [optOuts, signUps, terms, digital, acks, reminders, cards] = await Promise.all([
    db().execute<Row>(sql`select source, created_at from commerce.email_opt_outs where store_id = ${s.storeId}::uuid and lower(email) = any(${addresses})`),
    db().execute<Row>(sql`
      select kind, status, created_at, confirmed_at from commerce.form_submissions
      where store_id = ${s.storeId}::uuid and lower(email) = any(${addresses}) and kind = 'subscription'
    `),
    db().execute<Row>(sql`
      select o.number, t.mode, t.accepted_at from commerce.order_terms t join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id
      where t.store_id = ${s.storeId}::uuid and t.order_id = any(${orderIds})
    `),
    db().execute<Row>(sql`select number, digital_consent_at from commerce.orders where store_id = ${s.storeId}::uuid and id = any(${orderIds}) and digital_consent_at is not null`),
    db().execute<Row>(sql`
      select o.number, w.acknowledged_at from commerce.withdrawal_requests w join commerce.orders o on o.store_id = w.store_id and o.id = w.order_id
      where w.store_id = ${s.storeId}::uuid and w.order_id = any(${orderIds}) and w.acknowledged_at is not null
    `),
    db().execute<Row>(sql`
      select opted_out_at from commerce.abandoned_checkouts
      where store_id = ${s.storeId}::uuid and opted_out_at is not null and (lower(email) = any(${addresses}) or cart_id = any(${uuidList(s.cartIds)}))
    `),
    db().execute<Row>(sql`
      select consent_at from commerce.standing_orders where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid and consent_at is not null
    `),
  ]);
  void orders;
  const out: ConsentRow[] = [
    ...optOuts.map((r) => ({ kind: "email_opt_out", source: strs(r.source), at: iso(r.created_at), detail: null })),
    ...signUps.map((r) => ({ kind: "newsletter_sign_up", source: "form", at: iso(r.confirmed_at ?? r.created_at), detail: strs(r.status) })),
    ...terms.map((r) => ({ kind: "terms_accepted", source: "checkout", at: iso(r.accepted_at), detail: `${strs(r.number)} (${strs(r.mode)})` })),
    ...digital.map((r) => ({ kind: "digital_content_consent", source: "checkout", at: iso(r.digital_consent_at), detail: strs(r.number) })),
    ...acks.map((r) => ({ kind: "withdrawal_acknowledged", source: "withdrawal", at: iso(r.acknowledged_at), detail: strs(r.number) })),
    ...reminders.map((r) => ({ kind: "cart_reminder_opt_out", source: "cart_reminder", at: iso(r.opted_out_at), detail: null })),
    ...cards.map((r) => ({ kind: "standing_order_card_consent", source: "standing_order", at: iso(r.consent_at), detail: null })),
  ];
  return out.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
}

/** The security emails' bodies (a sign-in code) are never in the file. */
const SECURITY_KINDS = Object.entries(EMAIL_KINDS)
  .filter(([, c]) => c === "security")
  .map(([k]) => k);

async function loadEmails(s: PrivacySubject): Promise<EmailRow[]> {
  const rows = await db().execute<Row>(sql`
    select e.id, e.kind, e.subject, e.sent_at, e.created_at, e.status, e.text, o.number as order_number
    from commerce.email_messages e left join commerce.orders o on o.store_id = e.store_id and o.id = e.order_id
    where e.store_id = ${s.storeId}::uuid and lower(e.to_address) = any(${textList(s.addresses)}) order by e.created_at, e.id
  `);
  return rows.map((e) => ({
    id: strs(e.id),
    kind: strs(e.kind),
    subject: strs(e.subject),
    sentAt: iso(e.sent_at),
    createdAt: iso(e.created_at),
    status: strs(e.status),
    body: SECURITY_KINDS.includes(strs(e.kind)) ? null : str(e.text),
    orderNumber: str(e.order_number),
  }));
}

async function loadCarts(s: PrivacySubject): Promise<{ carts: CartRow[]; abandoned: AbandonedRow[]; drafts: DraftExportRow[] }> {
  const [carts, abandoned, drafts] = await Promise.all([
    s.cartIds.length === 0
      ? Promise.resolve([] as Row[])
      : db().execute<Row>(sql`
          select id, status, trim(currency) as currency, created_at, updated_at from commerce.carts
          where store_id = ${s.storeId}::uuid and id = any(${uuidList(s.cartIds)}) order by created_at, id
        `),
    db().execute<Row>(sql`
      select captured_at, reminders_sent, clicked_at, recovered_at, opted_out_at from commerce.abandoned_checkouts
      where store_id = ${s.storeId}::uuid and (lower(email) = any(${textList(s.addresses)}) or cart_id = any(${uuidList(s.cartIds)})) order by captured_at, id
    `),
    // Draft orders staff made for the customer account (D173): matched by the account only, never by an address staff typed (D162).
    s.customerId
      ? db().execute<Row>(sql`
          select id, number, status, trim(currency) as currency, created_at, email, phone, shipping_address, billing_address, company_name, organisation_number, note_to_buyer, internal_note
          from commerce.draft_orders where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid order by created_at, id
        `)
      : Promise.resolve([] as Row[]),
  ]);
  const draftLines =
    drafts.length === 0
      ? []
      : await db().execute<Row>(sql`
          select draft_id, sku, title, quantity, unit_price_minor from commerce.draft_order_lines
          where store_id = ${s.storeId}::uuid and draft_id = any(${uuidList(drafts.map((d) => strs(d.id)))}) order by draft_id, position, id
        `);
  const lines =
    carts.length === 0
      ? []
      : await db().execute<Row>(sql`
          select cl.cart_id, v.sku, ${titleOf("v")} as title, cl.quantity
          from commerce.cart_lines cl join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
          where cl.store_id = ${s.storeId}::uuid and cl.cart_id = any(${uuidList(carts.map((c) => strs(c.id)))}) order by cl.cart_id, cl.id
        `);
  return {
    carts: carts.map((c) => ({
      id: strs(c.id),
      status: strs(c.status),
      currency: strs(c.currency),
      createdAt: iso(c.created_at),
      updatedAt: iso(c.updated_at),
      lines: lines.filter((l) => strs(l.cart_id) === strs(c.id)).map((l) => ({ sku: str(l.sku), title: strs(l.title), quantity: num(l.quantity) })),
    })),
    abandoned: abandoned.map((a) => ({ capturedAt: iso(a.captured_at), remindersSent: num(a.reminders_sent), clickedAt: iso(a.clicked_at), recoveredAt: iso(a.recovered_at), optedOutAt: iso(a.opted_out_at) })),
    drafts: drafts.map((d) => ({
      number: strs(d.number),
      status: strs(d.status),
      currency: strs(d.currency),
      createdAt: iso(d.created_at),
      email: str(d.email),
      phone: str(d.phone),
      shippingAddress: d.shipping_address,
      billingAddress: d.billing_address,
      companyName: str(d.company_name),
      organisationNumber: str(d.organisation_number),
      noteToBuyer: str(d.note_to_buyer),
      internalNote: str(d.internal_note),
      lines: draftLines
        .filter((l) => strs(l.draft_id) === strs(d.id))
        .map((l) => ({ sku: str(l.sku), title: strs(l.title), quantity: num(l.quantity), unitPriceMinor: num(l.unit_price_minor) })),
    })),
  };
}

async function loadForms(s: PrivacySubject): Promise<FormRow[]> {
  const rows = await db().execute<Row>(sql`
    select kind, created_at, status from commerce.form_submissions
    where store_id = ${s.storeId}::uuid and lower(email) = any(${textList(s.addresses)}) order by created_at, id
  `);
  return rows.map((r) => ({ kind: strs(r.kind), createdAt: iso(r.created_at), status: strs(r.status) }));
}

async function loadCompany(s: PrivacySubject): Promise<CompanySource> {
  const [company, invites] = await Promise.all([
    s.customerId
      ? db().execute<Row>(sql`
          select cc.name, c.company_role from commerce.customers c join commerce.customer_companies cc on cc.store_id = c.store_id and cc.id = c.company_id
          where c.store_id = ${s.storeId}::uuid and c.id = ${s.customerId}::uuid
        `)
      : Promise.resolve([] as Row[]),
    db().execute<Row>(sql`
      select status, created_at, expires_at, accepted_at from commerce.company_invites
      where store_id = ${s.storeId}::uuid and (lower(email) = any(${textList(s.addresses)}) or customer_id = ${s.customerId}::uuid) order by created_at, id
    `),
  ]);
  const c = company[0];
  return {
    company: c ? { name: strs(c.name), role: str(c.company_role) } : null,
    invites: invites.map((i) => ({ status: strs(i.status), createdAt: iso(i.created_at), expiresAt: iso(i.expires_at), acceptedAt: iso(i.accepted_at) })),
  };
}

/** What staff entered in the customer's and their orders' custom fields, as label and words in the store's main language. */
async function loadCustomFields(s: PrivacySubject, orders: OrderRow[], main: string): Promise<CustomFieldRow[]> {
  const groups = await listFieldGroups(s.storeId);
  const words = t(main.split("-")[0]).customFields;
  const out: CustomFieldRow[] = [];
  const things: { entity: "customer" | "order"; id: string; reference: string | null }[] = [
    ...(s.customerId ? [{ entity: "customer" as const, id: s.customerId, reference: null }] : []),
    ...orders.map((o) => ({ entity: "order" as const, id: o.id, reference: o.number })),
  ];
  for (const thing of things) {
    const applicable = groups.filter((g) => g.entities.includes(thing.entity));
    if (applicable.length === 0) continue;
    const data = await getFieldData(s.storeId, thing.entity, thing.id);
    for (const group of applicable) {
      for (const def of group.fields) {
        const value = readField(def, data, main, main);
        if (value === undefined || isEmptyValue(value)) continue;
        out.push({ entity: thing.entity, reference: thing.reference, group: group.name, label: def.label, value: fieldValueText(def, value, main, words, 2000), locale: main });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------------------------------------------

/** What `exportCustomerData()` reads for a subject, shaped but not yet written down. Exported for the erasure's own checks. */
export async function gatherExport(s: PrivacySubject, language: string, now: Date): Promise<ExportInput | null> {
  const store = await privacyStore(s.storeId);
  if (!store) return null;
  const rules = await retentionRules();
  const [profile, orders, invoices, creditNotes, returns, withdrawals, subscriptions, standingLists, wishlists, bonus, referrals, emails, carts, forms, company] = await Promise.all([
    loadProfile(s),
    loadOrders(s),
    loadInvoices(s),
    loadCreditNotes(s),
    loadReturns(s),
    loadWithdrawals(s),
    loadSubscriptions(s),
    loadStandingLists(s),
    loadWishlists(s),
    loadBonus(s),
    loadReferrals(s),
    loadEmails(s),
    loadCarts(s),
    loadForms(s),
    loadCompany(s),
  ]);
  const [consents, customFields] = await Promise.all([loadConsents(s, orders), loadCustomFields(s, orders, store.mainLocale)]);
  const today = now.toISOString().slice(0, 10);
  return {
    generatedAt: now,
    language,
    store: { name: store.name, legalName: store.legalName, organisationNumber: store.organisationNumber, contactEmail: store.contactEmail, country: store.country },
    subject: { kind: s.customerId ? "account" : "guest", email: s.email, accountId: s.customerId },
    bookkeepingYears: yearsOf(periodFor("bookkeeping", store.country, today, rules)),
    authority: null,
    profile,
    orders,
    invoices,
    creditNotes,
    returns,
    withdrawals,
    subscriptions,
    standingLists,
    wishlists: wishlists.lists,
    wishlistAdds: wishlists.adds,
    bonus,
    referrals,
    consents,
    emails,
    carts: carts.carts,
    abandoned: carts.abandoned,
    drafts: carts.drafts,
    forms,
    company,
    customFields,
  };
}

/**
 * The file for a subject (an account id and/or an email): every section present, the counts of what was found. A subject with no data at
 * all still gets a file (all zero, `guest`): the answer to "do you hold data about me" is a file saying no. Audit-logged (`customer.data_exported`:
 * ids and counts, never an email or a name); completes the privacy request it answers, or (the shopper's own download) records one already done;
 * a staff download tells the store's owners. Never throws into the caller's page for the audit or the notices: the file is what matters.
 */
export async function exportCustomerData(storeId: string, ref: SubjectRef, by: ExportBy): Promise<ExportResult> {
  const now = by.now ?? new Date();
  const subject = await resolveSubject(storeId, ref, { channel: by.channel });
  if (!subject) return { ok: false, problem: "not_found" };
  const limit = by.rowLimit ?? EXPORT_ROW_LIMIT;
  if ((await countRows(subject)) > limit) return { ok: false, problem: "too_large" };
  const store = await privacyStore(storeId);
  if (!store) return { ok: false, problem: "not_found" };
  const language = privacyLanguage(subject.locale ?? store.mainLocale);
  const input = await gatherExport(subject, language, now);
  if (!input) return { ok: false, problem: "not_found" };
  const file = shapeExport(input);
  if (overLimit(file.counts) || totalRows(file.counts) > limit) return { ok: false, problem: "too_large" };

  let requestId: string | null = by.requestId ?? null;
  try {
    requestId = await recordExport(subject, store.id, file.counts, by, now, requestId);
  } catch (error) {
    console.error("[privacy] the export could not be logged", error);
  }
  return { ok: true, file, fileName: exportFileName(store.slug, now, by.channel), counts: file.counts, requestId };
}

/** The audit entry, the request and the owners' notice of one export. */
async function recordExport(s: PrivacySubject, storeId: string, counts: ExportCounts, by: ExportBy, now: Date, requestId: string | null): Promise<string | null> {
  let id = requestId;
  if (id) {
    await db().execute(sql`
      update commerce.privacy_requests set status = 'done', outcome = 'exported', completed_at = ${now.toISOString()}::timestamptz,
        handled_by = coalesce(handled_by, ${by.accountId}::uuid)
      where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'open' and kind = 'export'
    `);
  } else if (by.channel === "staff") {
    const [open] = await db().execute<Row>(sql`
      select id from commerce.privacy_requests
      where store_id = ${storeId}::uuid and kind = 'export' and status = 'open'
        and (subject_customer_id = ${s.customerId}::uuid or subject_email = ${s.email})
      order by received_at limit 1
    `);
    if (open) {
      id = String(open.id);
      await db().execute(sql`
        update commerce.privacy_requests set status = 'done', outcome = 'exported', completed_at = ${now.toISOString()}::timestamptz,
          handled_by = coalesce(handled_by, ${by.accountId}::uuid)
        where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'open'
      `);
    }
  } else {
    // The shopper's own download: logged as a request already answered.
    const [row] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, subject_customer_id, subject_email, received_at, due_at, completed_at, outcome)
      values (${storeId}::uuid, 'export', 'shopper', 'done', ${s.customerId}::uuid, ${s.email}, ${now.toISOString()}::timestamptz,
              ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, 'exported')
      returning id
    `);
    id = String(row.id);
  }
  await audit(by.accountId, storeId, "customer.data_exported", { kind: s.customerId ? "account" : "guest", customer: s.customerId, by: by.channel, request: id, counts }, {
    area: "customers",
    target: { type: "customer", id: s.customerId ?? s.orderIds[0] ?? storeId },
  });
  if (by.channel === "staff" && by.accountId) await notifyOwners(storeId, "export", by.accountId, id, now, by.adminUrl ?? null);
  return id;
}
