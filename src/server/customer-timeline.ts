import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  EMAIL_NOT_DELIVERED,
  TIMELINE_FULL,
  TIMELINE_SHORT,
  excerptOf,
  mergeTimeline,
  visibleKinds,
  type TimelineEvent,
  type TimelineGates,
  type TimelineKind,
  type TimelineRead,
} from "@/lib/customer-timeline";
import { normaliseEmail } from "@/lib/email-address";
import { featureOn } from "@/lib/store-features";
import { workBase } from "@/lib/work-paths";

import type { Membership } from "./auth";
import { bought } from "./customer-admin";
import { memberCan } from "./permissions";
import { buyerKeysOf } from "./reviews";
import { textList, uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * A customer's timeline (S1 of `docs/own-books-and-sales.md`, D462), read from what the store already keeps: orders, quote requests,
 * support conversations, emails, staff's notes, returns and withdrawals, reviews, bookings and Work invoices. One read per kind, side
 * by side, each at most one row more than the page shows; `mergeTimeline()` makes them one list. Nothing is written.
 *
 * The same rules as the pages each kind comes from: an order whose personal data is restricted or anonymised (D162) and what hangs on it
 * are left out, an anonymised conversation too, a draft quote and a Work draft are not events, and a kind is read only for a viewer who
 * may see it (`visibleKinds()`).
 */

/** Whose timeline: one person (by address and account), or a company's people and the company itself. */
export type TimelineSubject =
  | { kind: "person"; email: string; customerId: string | null }
  | { kind: "company"; companyId: string; people: readonly { id: string; email: string }[] };

/** What the viewer holds and the store has on (`TimelineGates`). */
export function timelineGates(member: Membership): TimelineGates {
  const { store } = member;
  return {
    orders: memberCan(member, "orders:read"),
    support: memberCan(member, "support:read"),
    products: memberCan(member, "products:read"),
    reviewsOn: featureOn(store, "reviews"),
    bookings: memberCan(member, "bookings:read"),
    bookingsOn: featureOn(store, "appointments") || featureOn(store, "bookings"),
    settings: memberCan(member, "settings:read"),
    workOn: store.workOn,
  };
}

type Who = { storeId: string; base: string; workBase: string; emails: string[]; ids: string[]; companyId: string | null; orders: boolean; n: number };

/** A person's or a company's timeline as this viewer may see it: newest first, `full` for up to `TIMELINE_FULL`, `show` for one kind. */
export async function readTimeline(
  member: Membership,
  subject: TimelineSubject,
  { show = null, full = false }: { show?: TimelineKind | null; full?: boolean } = {},
): Promise<TimelineRead> {
  const visible = memberCan(member, "customers:read") ? visibleKinds(timelineGates(member)) : [];
  const shown = show && visible.includes(show) ? show : null;
  const kinds = shown ? [shown] : visible;
  const limit = full ? TIMELINE_FULL : TIMELINE_SHORT;
  const people = subject.kind === "person" ? [{ id: subject.customerId, email: subject.email }] : subject.people;
  const who: Who = {
    storeId: member.store.id,
    base: `/admin/${member.store.slug}`,
    workBase: workBase(member.store.slug),
    emails: [...new Set(people.map((p) => normaliseEmail(p.email)).filter((address) => address !== ""))],
    ids: [...new Set(people.map((p) => p.id).filter((id): id is string => typeof id === "string"))],
    companyId: subject.kind === "company" ? subject.companyId : null,
    orders: memberCan(member, "orders:read"),
    n: limit + 1,
  };
  if (kinds.length === 0 || (who.emails.length === 0 && who.ids.length === 0 && !who.companyId)) {
    return { events: [], more: false, visible, shown };
  }
  const sources = await Promise.all(kinds.map((kind) => READERS[kind](who)));
  const { events, more } = mergeTimeline(sources, { kinds, limit });
  return { events, more, visible, shown };
}

/** The person a row belongs to: by the order's or row's own address, or by its account. */
const theirs = (emailColumn: SQL, customerColumn: SQL, who: Who): SQL =>
  sql`(lower(${emailColumn}) = any(${textList(who.emails)}) or ${customerColumn} = any(${uuidList(who.ids)}))`;

/** An order whose personal data may still be shown (D162); the order's alias is `o`. */
const SHOWN_ORDER = sql`o.restricted_at is null and o.anonymised_at is null`;

/** A product's title in the store's first language, else its handle (as the reviews page names it). */
const productTitle = (store: SQL, product: SQL) => sql`coalesce(
  (select t.title from commerce.product_translations t join commerce.stores st on st.id = ${store}
   where t.store_id = ${store} and t.product_id = ${product} order by t.locale = st.locales[1] desc, t.locale limit 1),
  (select p.handle from commerce.products p where p.store_id = ${store} and p.id = ${product}))`;

const orderRow = z.object({ id: col.uuid, number: col.text, status: col.text, at: col.timestamp, total: col.minor, currency: col.currency, email: col.textOrNull });

async function orders(who: Who): Promise<TimelineEvent[]> {
  const rows = await typedRows(orderRow, sql`
    select o.id, o.number, o.status, coalesce(o.placed_at, o.created_at) as at, o.total_minor as total, o.currency,
      lower(coalesce(c.email, nullif(o.email, ''))) as email
    from commerce.orders o
    left join commerce.customers c on c.id = o.customer_id
    where o.store_id = ${who.storeId}::uuid and ${theirs(sql`o.email`, sql`o.customer_id`, who)}
      and (${bought} or o.copied_from is not null) and ${SHOWN_ORDER}
    order by coalesce(o.placed_at, o.created_at) desc, o.id
    limit ${who.n}
  `);
  return rows.map((r) => ({
    key: `order:${r.id}`,
    what: "order_placed",
    at: r.at,
    email: r.email,
    label: r.number,
    status: r.status,
    amount: { minor: r.total, currency: r.currency },
    href: `${who.base}/orders/${r.id}`,
  }));
}

const quoteRow = z.object({
  id: col.uuid,
  number: col.textOrNull,
  created: col.timestamp,
  sent: col.timestampOrNull,
  declined: col.timestampOrNull,
  note: col.textOrNull,
  email: col.textOrNull,
});

async function quotes(who: Who): Promise<TimelineEvent[]> {
  const rows = await typedRows(quoteRow, sql`
    select d.id, d.number, d.created_at as created, d.sent_at as sent, d.quote_declined_at as declined, d.request_note as note,
      lower(coalesce(c.email, nullif(d.email, ''))) as email
    from commerce.draft_orders d
    left join commerce.customers c on c.id = d.customer_id
    where d.store_id = ${who.storeId}::uuid and d.source = 'quote' and ${theirs(sql`d.email`, sql`d.customer_id`, who)}
    order by d.created_at desc, d.id
    limit ${who.n}
  `);
  return rows.flatMap((r) => {
    const base = { email: r.email, label: r.number ?? "", href: `${who.base}/orders/drafts/${r.id}` };
    const events: TimelineEvent[] = [{ ...base, key: `quote:${r.id}:requested`, what: "quote_requested", at: r.created, excerpt: excerptOf(r.note) }];
    if (r.sent) events.push({ ...base, key: `quote:${r.id}:sent`, what: "quote_sent", at: r.sent });
    if (r.declined) events.push({ ...base, key: `quote:${r.id}:declined`, what: "quote_declined", at: r.declined });
    return events;
  });
}

const conversationRow = z.object({ id: col.uuid, source: col.text, status: col.text, at: col.timestamp, subject: col.textOrNull, email: col.textOrNull });

async function conversations(who: Who): Promise<TimelineEvent[]> {
  const rows = await typedRows(conversationRow, sql`
    select v.id, v.source, v.status, v.created_at as at, v.email_subject as subject,
      lower(coalesce(c.email, nullif(v.contact_email, ''))) as email
    from commerce.support_conversations v
    left join commerce.customers c on c.id = v.customer_id
    where v.store_id = ${who.storeId}::uuid and ${theirs(sql`v.contact_email`, sql`v.customer_id`, who)} and v.anonymised_at is null
    order by v.created_at desc, v.id
    limit ${who.n}
  `);
  return rows.map((r) => ({
    key: `conversation:${r.id}`,
    what: "conversation_started",
    at: r.at,
    email: r.email,
    label: r.subject ?? "",
    status: r.source,
    href: `${who.base}/support/c/${r.id}`,
  }));
}

const emailRow = z.object({ id: col.uuid, subject: col.text, status: col.text, at: col.timestamp, email: col.text });

async function emails(who: Who): Promise<TimelineEvent[]> {
  if (who.emails.length === 0) return [];
  const rows = await typedRows(emailRow, sql`
    select e.id, e.subject, e.status::text as status, e.created_at as at, lower(e.to_address) as email
    from commerce.email_messages e
    where e.store_id = ${who.storeId}::uuid and lower(e.to_address) = any(${textList(who.emails)})
    order by e.created_at desc, e.id
    limit ${who.n}
  `);
  return rows.map((r) => ({
    key: `email:${r.id}`,
    what: EMAIL_NOT_DELIVERED.includes(r.status) ? "email_failed" : "email_sent",
    at: r.at,
    email: r.email,
    label: r.subject,
    status: r.status,
    // The email's own page is the orders area's (`/emails/{id}`), as the customer page's list links it.
    href: who.orders ? `${who.base}/emails/${r.id}` : null,
  }));
}

const noteRow = z.object({ id: col.uuid, body: col.text, at: col.timestamp, email: col.text, author: col.textOrNull });

async function notes(who: Who): Promise<TimelineEvent[]> {
  if (who.emails.length === 0) return [];
  const rows = await typedRows(noteRow, sql`
    select n.id, n.body, n.created_at as at, n.email, coalesce(nullif(a.name, ''), a.email) as author
    from commerce.customer_notes n
    left join commerce.accounts a on a.id = n.created_by
    where n.store_id = ${who.storeId}::uuid and n.email = any(${textList(who.emails)})
    order by n.created_at desc, n.id
    limit ${who.n}
  `);
  return rows.map((r) => ({ key: `note:${r.id}`, what: "note_added", at: r.at, email: r.email, label: "", excerpt: excerptOf(r.body), author: r.author, href: null }));
}

const returnRow = z.object({ id: col.uuid, number: col.textOrNull, status: col.text, at: col.timestamp, order: col.text, email: col.textOrNull });
const withdrawalRow = z.object({ id: col.uuid, orderId: col.uuid, order: col.text, status: col.text, at: col.timestamp, email: col.textOrNull });

async function returns(who: Who): Promise<TimelineEvent[]> {
  const [opened, withdrawals] = await Promise.all([
    typedRows(returnRow, sql`
      select r.id, r.number, r.status::text as status, r.created_at as at, o.number as "order",
        lower(coalesce(c.email, nullif(o.email, ''))) as email
      from commerce.returns r
      join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      left join commerce.customers c on c.id = o.customer_id
      where r.store_id = ${who.storeId}::uuid and ${theirs(sql`o.email`, sql`o.customer_id`, who)} and ${SHOWN_ORDER}
      order by r.created_at desc, r.id
      limit ${who.n}
    `),
    typedRows(withdrawalRow, sql`
      select w.id, o.id as "orderId", o.number as "order", w.status, w.submitted_at as at,
        lower(coalesce(c.email, nullif(w.email, ''), nullif(o.email, ''))) as email
      from commerce.withdrawal_requests w
      join commerce.orders o on o.store_id = w.store_id and o.id = w.order_id
      left join commerce.customers c on c.id = o.customer_id
      where w.store_id = ${who.storeId}::uuid
        and (lower(w.email) = any(${textList(who.emails)}) or ${theirs(sql`o.email`, sql`o.customer_id`, who)}) and ${SHOWN_ORDER}
      order by w.submitted_at desc, w.id
      limit ${who.n}
    `),
  ]);
  return [
    ...opened.map((r): TimelineEvent => ({
      key: `return:${r.id}`,
      what: "return_opened",
      at: r.at,
      email: r.email,
      label: r.number ?? r.order,
      status: r.status,
      href: `${who.base}/returns/${r.id}`,
    })),
    ...withdrawals.map((r): TimelineEvent => ({
      key: `withdrawal:${r.id}`,
      what: "withdrawal_requested",
      at: r.at,
      email: r.email,
      label: r.order,
      status: r.status,
      href: `${who.base}/orders/${r.orderId}`,
    })),
  ];
}

const reviewRow = z.object({ id: col.uuid, rating: col.int, status: col.text, at: col.timestamp, product: col.textOrNull, email: col.textOrNull });

async function reviews(who: Who): Promise<TimelineEvent[]> {
  // A buyer's review is theirs by account or by their address's key (D301): both are what erasure finds them by.
  const keys = [...who.ids.map((id) => buyerKeysOf(id, [])).flat(), ...buyerKeysOf(null, who.emails)];
  const rows = await typedRows(reviewRow, sql`
    select r.id, r.rating::int as rating, r.status, r.created_at as at, ${productTitle(sql`r.store_id`, sql`r.product_id`)} as product,
      lower(coalesce(c.email, nullif(o.email, ''))) as email
    from commerce.product_reviews r
    left join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    left join commerce.customers c on c.id = coalesce(r.customer_id, o.customer_id)
    where r.store_id = ${who.storeId}::uuid and r.source = 'buyer'
      and (r.customer_id = any(${uuidList(who.ids)}) or r.buyer_key = any(${textList(keys)}))
      and (o.id is null or (${SHOWN_ORDER}))
    order by r.created_at desc, r.id
    limit ${who.n}
  `);
  return rows.map((r) => ({
    key: `review:${r.id}`,
    what: "review_written",
    at: r.at,
    email: r.email,
    label: r.product ?? "",
    rating: r.rating,
    status: r.status,
    href: `${who.base}/reviews?state=all${r.product ? `&q=${encodeURIComponent(r.product.slice(0, 100))}` : ""}`,
  }));
}

const bookingRow = z.object({ id: col.uuid, orderId: col.uuid, status: col.text, at: col.timestamp, startsAt: col.timestamp, product: col.textOrNull, email: col.textOrNull });

async function bookings(who: Who): Promise<TimelineEvent[]> {
  const rows = await typedRows(bookingRow, sql`
    select b.id, b.order_id as "orderId", b.status, b.created_at as at, b.starts_at as "startsAt",
      ${productTitle(sql`b.store_id`, sql`b.product_id`)} as product,
      lower(coalesce(c.email, nullif(o.email, ''))) as email
    from commerce.bookings b
    join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    left join commerce.customers c on c.id = o.customer_id
    -- A held booking is a basket on its way to checkout, not something they booked yet.
    where b.store_id = ${who.storeId}::uuid and b.status <> 'held' and ${theirs(sql`o.email`, sql`o.customer_id`, who)} and ${SHOWN_ORDER}
    order by b.created_at desc, b.id
    limit ${who.n}
  `);
  return rows.map((r) => ({
    key: `booking:${r.id}`,
    what: "booking_made",
    at: r.at,
    email: r.email,
    label: r.product ?? "",
    status: r.status,
    startsAt: r.startsAt,
    href: `${who.base}/orders/${r.orderId}`,
  }));
}

const workRow = z.object({
  id: col.uuid,
  number: col.textOrNull,
  status: col.text,
  issued: col.timestamp,
  paid: col.timestampOrNull,
  total: col.minor,
  currency: col.currency,
  email: col.textOrNull,
});

async function workInvoices(who: Who): Promise<TimelineEvent[]> {
  // A Work client is a store customer or company by its own link (`work_clients.customer_id`, `customer_company_id`, docs/work.md 6.1).
  const rows = await typedRows(workRow, sql`
    select i.id, i.document_number as number, i.status, coalesce(i.sent_at, i.issued_on::timestamptz, i.created_at) as issued,
      i.paid_at as paid, i.total_minor as total, i.currency,
      case when k.customer_id is not null then lower(cu.email) end as email
    from commerce.work_invoices i
    join commerce.work_clients k on k.store_id = i.store_id and k.id = i.client_id
    left join commerce.customers cu on cu.id = k.customer_id
    where i.store_id = ${who.storeId}::uuid and i.status <> 'draft'
      and (k.customer_id = any(${uuidList(who.ids)}) ${who.companyId ? sql`or k.customer_company_id = ${who.companyId}::uuid` : sql``})
    order by coalesce(i.sent_at, i.issued_on::timestamptz, i.created_at) desc, i.id
    limit ${who.n}
  `);
  return rows.flatMap((r) => {
    const base = { email: r.email, label: r.number ?? "", amount: { minor: r.total, currency: r.currency }, status: r.status, href: `${who.workBase}/invoices/${r.id}` };
    const events: TimelineEvent[] = [{ ...base, key: `work_invoice:${r.id}:issued`, what: "work_invoice_issued", at: r.issued }];
    if (r.paid) events.push({ ...base, key: `work_invoice:${r.id}:paid`, what: "work_invoice_paid", at: r.paid });
    return events;
  });
}

const READERS: Record<TimelineKind, (who: Who) => Promise<TimelineEvent[]>> = {
  order: orders,
  quote: quotes,
  conversation: conversations,
  email: emails,
  note: notes,
  return: returns,
  review: reviews,
  booking: bookings,
  work_invoice: workInvoices,
};
