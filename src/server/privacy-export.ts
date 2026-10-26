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
  type MarketingRow,
  type SupportRow,
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
  type ReviewExportRow,
  type StandingListRow,
  type SubscriptionRow,
  type WishlistAddRow,
  type WishlistRow,
  type WithdrawalRow,
} from "@/lib/privacy-export";
import { privacyLanguage } from "@/lib/privacy-text";

import { audit } from "./auth";
import { getFieldData, listFieldGroups } from "./custom-fields";
import { buyerKeysOf } from "./reviews";
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
      (select count(*) from commerce.customer_addresses where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.wishlist_cart_adds where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.bonus_entries where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.email_messages where store_id = ${store}::uuid and lower(to_address) = any(${addresses})) +
      (select count(*) from commerce.form_submissions where store_id = ${store}::uuid and lower(email) = any(${addresses})) +
      (select count(*) from commerce.carts where store_id = ${store}::uuid and id = any(${carts})) +
      (select count(*) from commerce.draft_orders where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid) +
      (select count(*) from commerce.support_conversations where store_id = ${store}::uuid and customer_id = ${s.customerId}::uuid and anonymised_at is null) +
      (select count(*) from commerce.product_reviews where store_id = ${store}::uuid and source = 'buyer' and buyer_key = any(${textList(buyerKeysOf(s.customerId, s.addresses))})) +
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
  const [orders, lines, payments, refunds, shipments, downloads, terms, events, bookings, tags, parcelLines, changes, tracking, onTerms] = await Promise.all([
    db().execute<Row>(sql`
      select o.id, o.number, o.placed_at, o.status, trim(o.currency) as currency, o.subtotal_minor, o.shipping_minor, o.discount_minor,
        o.member_discount_minor, o.campaign_discount_minor, o.credit_minor, o.referral_discount_minor, o.vat_relief_minor, o.tax_minor, o.total_minor,
        o.vat_kind, o.vat_treatment ->> 'reason' as vat_reason, o.delivery ->> 'label' as delivery_label, o.delivery_method, o.delivery ->> 'name' as pickup_place, o.delivery_note, o.billing_address, o.shipping_address, o.email,
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
      select id, order_id, carrier, tracking_number, created_at, legacy, undone_at, undo_reason from commerce.shipments
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
    // D174: what each parcel held (a legacy parcel's back-filled lines are left out: the customer was never told them), and the order's changes.
    db().execute<Row>(sql`
      select sl.shipment_id, l.sku, l.title, sl.quantity from commerce.shipment_lines sl
      join commerce.shipments sh on sh.store_id = sl.store_id and sh.id = sl.shipment_id and not sh.legacy
      join commerce.order_lines l on l.store_id = sl.store_id and l.id = sl.order_line_id
      where sl.store_id = ${store}::uuid and sh.order_id = any(${ids}) order by sl.shipment_id, l.title, l.id
    `),
    db().execute<Row>(sql`
      select order_id, seq, status, created_at, applied_at, difference_minor, trim(currency) as currency from commerce.order_edits
      where store_id = ${store}::uuid and order_id = any(${ids}) order by order_id, seq
    `),
    // D238: the carrier events kept for each parcel (cleared when the order is anonymised, and 90 days after following stopped).
    db().execute<Row>(sql`
      select shipment_id, phase, events from commerce.shipment_tracking where store_id = ${store}::uuid and order_id = any(${ids})
    `),
    // D293: an order bought on payment terms, when it was due and paid.
    db().execute<Row>(sql`
      select order_id, terms, due_on::text as due_on, reminder_sent_at, overdue_sent_at, paid_at from commerce.order_payment_terms
      where store_id = ${store}::uuid and order_id = any(${ids})
    `),
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
    parcelLines: group(parcelLines, "shipment_id"),
    changes: group(changes, "order_id"),
  };
  const termsOf = new Map(terms.map((x) => [strs(x.order_id), x]));
  const paymentTermsOf = new Map(onTerms.map((x) => [strs(x.order_id), x]));
  const trackingOf = new Map(tracking.map((t) => [strs(t.shipment_id), t]));
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
      // D237: how it reached them, the pickup place's name and their own note for the driver.
      deliveryMethod: str(o.delivery_method),
      pickupPlace: o.delivery_method === "pickup" ? str(o.pickup_place) : null,
      deliveryNote: str(o.delivery_note),
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
      shipments: (byOrder.shipments.get(id) ?? []).map((x) => ({
        carrier: str(x.carrier),
        trackingNumber: str(x.tracking_number),
        createdAt: iso(x.created_at),
        lines: (byOrder.parcelLines.get(strs(x.id)) ?? []).map((l) => ({ sku: str(l.sku), title: strs(l.title), quantity: num(l.quantity) })),
        // Undone (D174 follow-up): kept in the record, marked, with staff's reason (it is about this order).
        ...(x.undone_at ? { undoneAt: iso(x.undone_at), undoReason: str(x.undo_reason) } : {}),
        ...(trackingOf.has(strs(x.id)) ? { tracking: trackingOfShipment(trackingOf.get(strs(x.id))!) } : {}),
      })),
      changes: (byOrder.changes.get(id) ?? []).map((c) => ({ label: `E${num(c.seq)}`, status: strs(c.status), createdAt: iso(c.created_at), appliedAt: iso(c.applied_at), differenceMinor: num(c.difference_minor), currency: strs(c.currency) })),
      downloads: (byOrder.downloads.get(id) ?? []).map((d) => ({ fileName: str(d.file_name), downloads: num(d.downloads) })),
      terms: term ? { mode: strs(term.mode), acceptedAt: iso(term.accepted_at), locale: str(term.locale) } : null,
      ...(paymentTermsOf.has(id) ? { paymentTerms: paymentTermsOfRow(paymentTermsOf.get(id)!) } : {}),
      events: (byOrder.events.get(id) ?? []).map((e) => ({ type: strs(e.type), createdAt: iso(e.created_at), reason: str(e.reason), note: str(e.note) })),
    };
  });
}

/** An order's payment terms (D293) as the export carries them. */
function paymentTermsOfRow(row: Row): NonNullable<OrderRow["paymentTerms"]> {
  return { terms: strs(row.terms), dueOn: strs(row.due_on), reminderSentAt: iso(row.reminder_sent_at), overdueSentAt: iso(row.overdue_sent_at), paidAt: iso(row.paid_at) };
}

/** A parcel's kept carrier events as the export carries them: when, the carrier's words and the place. */
function trackingOfShipment(row: Row): { phase: string; events: { at: string; description: string; location: string | null }[] } {
  const events = Array.isArray(row.events) ? (row.events as Record<string, unknown>[]) : [];
  return {
    phase: strs(row.phase),
    events: events.map((e) => ({ at: strs(e.at), description: strs(e.description), location: e.location ? strs(e.location) : null })),
  };
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
  const [returns, lines, exchanges] = await Promise.all([
    db().execute<Row>(sql`
      select r.id, r.number, o.number as order_number, r.kind, r.status, r.reason, r.reason_note, r.decision_note, r.refund_note, r.staff_note,
        r.refund_minor, trim(o.currency) as currency, r.refunded_at, r.created_at, r.closed_at, r.exchange_wish_at, r.exchange_wish_note
      from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      where r.store_id = ${s.storeId}::uuid and r.order_id = any(${ids}) order by r.created_at, r.id
    `),
    db().execute<Row>(sql`
      select rl.return_id, ol.sku, ol.title, rl.quantity, rl.decision, rl."condition" as condition, rl.reason
      from commerce.return_lines rl join commerce.returns r on r.store_id = rl.store_id and r.id = rl.return_id
      join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
      where rl.store_id = ${s.storeId}::uuid and r.order_id = any(${ids}) order by rl.return_id, ol.id
    `),
    // The returns' exchanges (D239): state, dates, amounts, the delivery address staff proposed (held on the exchange even when no order was made: a proposal
    // declined or expired) and the replacements' titles and quantities (review finding: GDPR Art. 15 carries every PERSONAL_DATA field).
    db().execute<Row>(sql`
      select x.return_id, x.status, x.created_at, x.confirmed_at, x.settled_at, coalesce(x.credit_at_processing, x.credit_minor) as credit, x.total_minor,
        coalesce(x.difference_at_processing, x.difference_minor) as difference, xo.number as order_number, x.delivery_address,
        coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'title', l.title, 'quantity', l.quantity) order by l.n)
                  from commerce.return_exchange_lines l where l.store_id = x.store_id and l.exchange_id = x.id), '[]'::jsonb) as replacement_lines
      from commerce.return_exchanges x left join commerce.orders xo on xo.store_id = x.store_id and xo.id = x.exchange_order_id
      where x.store_id = ${s.storeId}::uuid and x.order_id = any(${ids}) and x.status <> 'draft' order by x.return_id, x.seq
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
    exchangeWish: r.exchange_wish_at ? { at: iso(r.exchange_wish_at), note: str(r.exchange_wish_note) } : null,
    exchanges: exchanges
      .filter((x) => strs(x.return_id) === strs(r.id))
      .map((x) => ({
        status: strs(x.status),
        createdAt: iso(x.created_at),
        confirmedAt: iso(x.confirmed_at),
        settledAt: iso(x.settled_at),
        creditMinor: num(x.credit),
        totalMinor: num(x.total_minor),
        differenceMinor: num(x.difference),
        orderNumber: str(x.order_number),
        deliveryAddress: x.delivery_address ?? null,
        replacementLines: ((x.replacement_lines ?? []) as Row[]).map((l) => ({ sku: str(l.sku), title: str(l.title), quantity: num(l.quantity) })),
      })),
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
  const locations = c && s.customerId
    ? await db().execute<Row>(sql`
        select l.name, b.role from commerce.company_location_buyers b
        join commerce.company_locations l on l.store_id = b.store_id and l.id = b.location_id
        where b.store_id = ${s.storeId}::uuid and b.customer_id = ${s.customerId}::uuid order by lower(l.name)
      `)
    : [];
  return {
    company: c ? { name: strs(c.name), role: str(c.company_role), locations: locations.map((l) => ({ name: strs(l.name), role: strs(l.role) })) } : null,
    invites: invites.map((i) => ({ status: strs(i.status), createdAt: iso(i.created_at), expiresAt: iso(i.expires_at), acceptedAt: iso(i.accepted_at) })),
  };
}

/**
 * The customer's support conversations (D216, docs/support.md 3.5): by the account only (a conversation is never matched by an address
 * someone typed), with what the customer, the AI and the store's people wrote. Staff's notes and the partner's help stay out.
 */
async function loadSupport(s: PrivacySubject): Promise<SupportRow[]> {
  if (!s.customerId) return [];
  const conversations = await db().execute<Row>(sql`
    select id, created_at, ended_at, summary, rating, rating_comment from commerce.support_conversations
    where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid and anonymised_at is null order by created_at, id
  `);
  if (conversations.length === 0) return [];
  const messages = await db().execute<Row>(sql`
    select conversation_id, created_at, author, body from commerce.support_messages
    where store_id = ${s.storeId}::uuid and conversation_id = any(${uuidList(conversations.map((c) => String(c.id)))})
      and author in ('customer', 'ai', 'agent')
    order by conversation_id, seq
  `);
  return conversations.map((c) => {
    const summary = c.summary as { title?: unknown; outcome?: unknown } | null;
    return {
      startedAt: iso(c.created_at),
      endedAt: iso(c.ended_at),
      messages: messages
        .filter((m) => String(m.conversation_id) === String(c.id))
        .map((m) => ({ at: iso(m.created_at), from: String(m.author) as "customer" | "ai" | "agent", text: strs(m.body) })),
      summary: summary && typeof summary.title === "string" ? { title: summary.title, outcome: String(summary.outcome ?? "") } : null,
      rating: str(c.rating),
      ratingComment: str(c.rating_comment),
    };
  });
}

/** The person's place on the subscriber list (D295), by the account or the subject's addresses, with its consent history. */
async function loadMarketing(s: PrivacySubject): Promise<MarketingRow[]> {
  const rows = await db().execute<Row>(sql`
    select m.email, m.status, m.source, m.consent_text, m.consented_at, m.confirmed_at, m.unsubscribed_at, m.unsubscribe_source,
      (select coalesce(json_agg(json_build_object('kind', e.kind, 'source', e.source, 'consentText', e.consent_text, 'at', e.created_at) order by e.id), '[]')
         from commerce.marketing_consent_events e where e.store_id = m.store_id and e.subscriber_id = m.id) as history
    from commerce.marketing_subscribers m
    where m.store_id = ${s.storeId}::uuid and (m.customer_id = ${s.customerId}::uuid or lower(m.email) = any(${textList(s.addresses)}))
    order by m.created_at, m.id
  `);
  return rows.map((r) => ({
    email: strs(r.email),
    status: strs(r.status),
    source: strs(r.source),
    consentText: strs(r.consent_text),
    consentedAt: iso(r.consented_at) ?? "",
    confirmedAt: iso(r.confirmed_at),
    unsubscribedAt: iso(r.unsubscribed_at),
    unsubscribeSource: str(r.unsubscribe_source),
    history: ((r.history ?? []) as { kind: string; source: string; consentText: string | null; at: string }[]).map((h) => ({ ...h, at: iso(h.at) ?? "" })),
  }));
}

/** The broadcasts sent to the person's addresses (D297): the name staff gave each and when it went. */
async function loadBroadcasts(s: PrivacySubject): Promise<{ broadcast: string; sentAt: string | null }[]> {
  const rows = await db().execute<Row>(sql`
    select b.title, r.sent_at from commerce.broadcast_recipients r join commerce.broadcasts b on b.store_id = r.store_id and b.id = r.broadcast_id
    where r.store_id = ${s.storeId}::uuid and r.status = 'sent' and r.email = any(${textList(s.addresses)}) order by r.sent_at
  `);
  return rows.map((r) => ({ broadcast: strs(r.title), sentAt: r.sent_at ? new Date(String(r.sent_at)).toISOString() : null }));
}

/** The automation emails sent to the person (D298): which kind and when, by the subject's subscriber rows. */
async function loadAutomations(s: PrivacySubject): Promise<{ automation: string; sentAt: string | null }[]> {
  const rows = await db().execute<Row>(sql`
    select x.kind, x.created_at from commerce.automation_sends x
    join commerce.marketing_subscribers m on m.store_id = x.store_id and m.id = x.subscriber_id
    where x.store_id = ${s.storeId}::uuid and (lower(m.email) = any(${textList(s.addresses)}) or m.customer_id = ${s.customerId}::uuid)
    order by x.created_at
  `);
  return rows.map((r) => ({ automation: strs(r.kind), sentAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null }));
}

/** The person's back-in-stock requests (D298): the product's name, the status and when. */
async function loadStockRequests(s: PrivacySubject): Promise<{ product: string; status: string; askedAt: string | null; notifiedAt: string | null }[]> {
  const rows = await db().execute<Row>(sql`
    select r.status, r.created_at, r.notified_at,
      coalesce((select t.title from commerce.product_translations t where t.store_id = r.store_id and t.product_id = r.product_id order by t.locale = r.locale desc, t.locale limit 1), '') as title
    from commerce.stock_requests r
    where r.store_id = ${s.storeId}::uuid and (r.email = any(${textList(s.addresses)}) or r.customer_id = ${s.customerId}::uuid)
    order by r.created_at
  `);
  const at = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return rows.map((r) => ({ product: strs(r.title), status: strs(r.status), askedAt: at(r.created_at), notifiedAt: at(r.notified_at) }));
}

/** The person's product reviews (D301): by their account or their addresses' buyer keys, with the product's name. */
async function loadReviews(s: PrivacySubject): Promise<ReviewExportRow[]> {
  const rows = await db().execute<Row>(sql`
    select r.rating, r.title, r.body, r.author_name, r.status, r.created_at, r.edited_at, r.answer,
      coalesce((select t.title from commerce.product_translations t where t.store_id = r.store_id and t.product_id = r.product_id order by t.locale = r.locale desc, t.locale limit 1), '') as product
    from commerce.product_reviews r
    where r.store_id = ${s.storeId}::uuid and r.source = 'buyer' and r.buyer_key = any(${textList(buyerKeysOf(s.customerId, s.addresses))})
    order by r.created_at
  `);
  return rows.map((r) => ({
    product: strs(r.product),
    rating: Number(r.rating),
    title: (r.title as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    name: strs(r.author_name),
    status: strs(r.status),
    writtenAt: r.created_at as string,
    editedAt: (r.edited_at as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
  }));
}

/** Welcome codes sign-up forms gave the person (D304 J3): the discount's own code and when; never the code given. */
async function loadSignupCodes(s: PrivacySubject): Promise<{ discount: string; givenAt: string }[]> {
  const rows = await db().execute<Row>(sql`
    select d.code, x.created_at from commerce.signup_incentives x join commerce.discount_codes d on d.store_id = x.store_id and d.id = x.discount_id
    where x.store_id = ${s.storeId}::uuid and x.email = any(${textList(s.addresses)}) order by x.created_at
  `);
  return rows.map((r) => ({ discount: strs(r.code), givenAt: new Date(String(r.created_at)).toISOString() }));
}

/** Staff's tags on the person (D296), by the subject's addresses. */
async function loadCustomerTags(s: PrivacySubject): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select label from commerce.customer_tags where store_id = ${s.storeId}::uuid and email = any(${textList(s.addresses)}) order by created_at, key
  `);
  return rows.map((r) => strs(r.label));
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

/** The account's saved addresses (D304), oldest first, with the shopper's own labels. */
async function loadSavedAddresses(s: PrivacySubject): Promise<{ address: unknown; label: string }[]> {
  if (!s.customerId) return [];
  const rows = await db().execute<Row>(sql`
    select address, label from commerce.customer_addresses where store_id = ${s.storeId}::uuid and customer_id = ${s.customerId}::uuid order by created_at, id
  `);
  return rows.map((r) => ({ address: r.address, label: String(r.label ?? "") }));
}

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
  const [consents, customFields, support, marketing, customerTags, broadcasts, automations, stockRequests, reviews, savedAddresses, signupCodes] = await Promise.all([
    loadConsents(s, orders),
    loadCustomFields(s, orders, store.mainLocale),
    loadSupport(s),
    loadMarketing(s),
    loadCustomerTags(s),
    loadBroadcasts(s),
    loadAutomations(s),
    loadStockRequests(s),
    loadReviews(s),
    loadSavedAddresses(s),
    loadSignupCodes(s),
  ]);
  const today = now.toISOString().slice(0, 10);
  return {
    generatedAt: now,
    language,
    store: { name: store.name, legalName: store.legalName, organisationNumber: store.organisationNumber, contactEmail: store.contactEmail, country: store.country },
    subject: { kind: s.customerId ? "account" : "guest", email: s.email, accountId: s.customerId },
    bookkeepingYears: yearsOf(periodFor("bookkeeping", store.country, today, rules)),
    authority: null,
    profile,
    savedAddresses,
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
    support,
    marketing,
    customerTags,
    signupCodes,
    broadcasts,
    automations,
    stockRequests,
    reviews,
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
