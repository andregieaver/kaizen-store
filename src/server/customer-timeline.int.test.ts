import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { TIMELINE_SHORT } from "@/lib/customer-timeline";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { readTimeline } = await import("./customer-timeline");
const staff = await import("./customer-staff");
const { mainLocation, newStore, pay, place, setLevel } = await import("./inventory-test-support");

/**
 * A customer's timeline (D462): one person's orders, quote requests, conversations, emails, notes, returns and Work invoices as one list,
 * newest first, and a company's as its people's and its own. What is held: another store's rows never show; an order whose personal data
 * is restricted is left out with what hangs on it; a viewer sees only the kinds their role may open; one kind can be asked for; the first
 * page stops at its size and says there is more.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const mail = (name: string) => `${name}-${run}@example.com`;
/** A draft's number is `D-` and digits (`draft_orders_number`). */
const quoteNo = `D-${Date.now() % 1_000_000}`;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let adaId: string;
let firstOrder: string;
let hiddenOrder: string;

const at = (iso: string) => sql`${iso}::timestamptz`;

async function paidOrder(target: Awaited<ReturnType<typeof newStore>>, email: string, customerId: string | null, placedAt: string): Promise<string> {
  await setLevel(target.storeId, "DEMO-TOTE", await mainLocation(target.storeId), 5);
  const order = await place(target.storeId, [["DEMO-TOTE", 1]]);
  await pay(target.storeId, order, target.account);
  await db().execute(sql`update commerce.orders set email = ${email}, customer_id = ${customerId}::uuid, placed_at = ${at(placedAt)} where id = ${order.orderId}::uuid`);
  return order.orderId;
}

async function emailTo(storeId: string, to: string, subject: string, sentAt: string, status = "sent"): Promise<void> {
  await db().execute(sql`
    insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, created_at)
    values (${storeId}::uuid, 'order_confirmation', ${to}, ${subject}, '<p>x</p>', 'x', ${status}::commerce.email_status, ${at(sentAt)})
  `);
}

const reader = (role: Partial<Membership> = {}, workOn = true): Membership => ({ ...store.member, ...role, store: { ...store.member.store, workOn } });

beforeAll(async () => {
  store = await newStore("timeline");
  other = await newStore("timeline-other");
  const made = await staff.createCustomer(store.member, { email: mail("ada"), name: "Ada Lovelace" });
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  adaId = made.id;

  firstOrder = await paidOrder(store, mail("ada"), adaId, "2026-10-01T09:00:00Z");
  hiddenOrder = await paidOrder(store, mail("ada"), adaId, "2026-10-05T09:00:00Z");
  await db().execute(sql`update commerce.orders set restricted_at = now() where id = ${hiddenOrder}::uuid`);
  await paidOrder(other, mail("ada"), null, "2026-10-06T09:00:00Z");

  await emailTo(store.storeId, mail("ada").toUpperCase(), "Your order", "2026-10-01T09:05:00Z");
  await emailTo(store.storeId, mail("ada"), "Your receipt", "2026-10-02T09:05:00Z", "bounced");
  await emailTo(other.storeId, mail("ada"), "Another store's email", "2026-10-03T09:05:00Z");

  // A note is never edited (`customer_notes_rules()`), so it is written with its time.
  await db().execute(sql`
    insert into commerce.customer_notes (store_id, email, body, created_by, created_at)
    values (${store.storeId}::uuid, ${mail("ada")}, ${"Call back\nabout the invoice"}, ${store.accountId}::uuid, ${at("2026-10-04T12:00:00Z")})
  `);

  await db().execute(sql`
    insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, email, source, request_note, created_at, quote_declined_at)
    values (${store.storeId}::uuid, ${quoteNo}, 'NO', 'no', 'NOK', 'nb-NO', ${mail("ada")}, 'quote', 'Price for 40 totes?', ${at("2026-10-07T08:00:00Z")}, ${at("2026-10-08T08:00:00Z")})
  `);
  await db().execute(sql`
    insert into commerce.support_conversations (store_id, source, handler, locale, contact_email, email_subject, created_at)
    values (${store.storeId}::uuid, 'email', case when commerce.support_mode(${store.storeId}::uuid) = 'people' then 'queue' else 'ai' end,
            'nb-NO', ${mail("ada")}, 'Where is my parcel?', ${at("2026-10-09T08:00:00Z")})
  `);
  await db().execute(sql`
    insert into commerce.returns (store_id, order_id, number, created_at) values (${store.storeId}::uuid, ${firstOrder}::uuid, ${`R-${run}`}, ${at("2026-10-10T08:00:00Z")})
  `);
  await db().execute(sql`
    insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, submitted_at, expires_at)
    values (${store.storeId}::uuid, ${firstOrder}::uuid, 'Ada Lovelace', ${mail("ada")}, 'form', ${at("2026-10-09T20:00:00Z")}, ${at("2026-10-10T20:00:00Z")})
  `);
  // A return on the restricted order is left out with it.
  await db().execute(sql`
    insert into commerce.returns (store_id, order_id, number, created_at) values (${store.storeId}::uuid, ${hiddenOrder}::uuid, ${`R2-${run}`}, ${at("2026-10-11T08:00:00Z")})
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("a person's timeline", () => {
  it("lists what happened with them in this store, newest first, and nothing of another store's or a restricted order's", async () => {
    const read = await readTimeline(reader(), { kind: "person", email: mail("ada"), customerId: adaId });
    expect(read.events.map((e) => [e.what, e.label])).toEqual([
      // The database numbers a return after its order (`1001-R1`).
      ["return_opened", expect.stringMatching(/-R1$/)],
      ["withdrawal_requested", expect.any(String)],
      ["conversation_started", "Where is my parcel?"],
      ["quote_declined", quoteNo],
      ["quote_requested", quoteNo],
      ["note_added", ""],
      ["email_failed", "Your receipt"],
      ["email_sent", "Your order"],
      ["order_placed", expect.any(String)],
    ]);
    expect(read.more).toBe(false);
    expect(read.shown).toBeNull();
  });

  it("carries what the page shows: the order's amount and status, the note's words on one line and its author, a link to each page", async () => {
    const { events } = await readTimeline(reader(), { kind: "person", email: mail("ada"), customerId: adaId });
    const order = events.find((e) => e.what === "order_placed");
    expect(order).toMatchObject({ key: `order:${firstOrder}`, status: "paid", href: `/admin/${store.slug}/orders/${firstOrder}`, email: mail("ada") });
    expect(order?.amount?.currency).toBe("NOK");
    expect(order?.amount?.minor).toBeGreaterThan(0);
    const note = events.find((e) => e.what === "note_added");
    expect(note).toMatchObject({ excerpt: "Call back about the invoice", href: null });
    expect(note?.author).toBeTruthy();
    expect(events.find((e) => e.what === "quote_requested")).toMatchObject({ excerpt: "Price for 40 totes?" });
    expect(events.find((e) => e.what === "conversation_started")?.href).toMatch(new RegExp(`^/admin/${store.slug}/support/c/`));
  });

  it("links a withdrawal to its order", async () => {
    const { events } = await readTimeline(reader(), { kind: "person", email: mail("ada"), customerId: adaId }, { show: "return" });
    expect(events.find((e) => e.what === "withdrawal_requested")).toMatchObject({ href: `/admin/${store.slug}/orders/${firstOrder}`, status: "pending" });
  });

  it("reads reviews and bookings, where their features are on, without a row of another store's", async () => {
    const withFeatures: Membership = { ...store.member, store: { ...store.member.store, features: [...store.member.store.features, "reviews", "appointments"] } };
    for (const show of ["review", "booking"] as const) {
      const read = await readTimeline(withFeatures, { kind: "person", email: mail("ada"), customerId: adaId }, { show });
      expect(read.visible).toContain(show);
      expect(read).toMatchObject({ shown: show, events: [], more: false });
    }
  });

  it("finds a guest by their address alone", async () => {
    const { events } = await readTimeline(reader(), { kind: "person", email: mail("ada"), customerId: null });
    expect(events.map((e) => e.what)).toContain("order_placed");
    expect(events.map((e) => e.what)).toContain("note_added");
  });

  it("shows one kind when asked", async () => {
    const read = await readTimeline(reader(), { kind: "person", email: mail("ada"), customerId: adaId }, { show: "email" });
    expect(read.shown).toBe("email");
    expect(read.events.map((e) => e.label)).toEqual(["Your receipt", "Your order"]);
  });

  it("shows a role that only reads customers what the customer page already shows, and no link to an email it cannot open", async () => {
    const readOnly = reader({ role: "admin", permissions: ["customers:read"] });
    const read = await readTimeline(readOnly, { kind: "person", email: mail("ada"), customerId: adaId });
    expect(read.visible).toEqual(["order", "email", "note"]);
    expect(new Set(read.events.map((e) => e.what))).toEqual(new Set(["note_added", "email_failed", "email_sent", "order_placed"]));
    expect(read.events.filter((e) => e.what.startsWith("email")).every((e) => e.href === null)).toBe(true);
    // Asking for a kind the role may not see shows what it may.
    expect((await readTimeline(readOnly, { kind: "person", email: mail("ada"), customerId: adaId }, { show: "conversation" })).shown).toBeNull();
  });

  it("shows nothing to a role that cannot read customers", async () => {
    const read = await readTimeline(reader({ role: "admin", permissions: ["orders:read"] }), { kind: "person", email: mail("ada"), customerId: adaId });
    expect(read).toEqual({ events: [], more: false, visible: [], shown: null });
  });

  it("stops the first page at its size and says there is more; everything shows the rest", async () => {
    const ben = mail("ben");
    for (let i = 0; i < TIMELINE_SHORT + 2; i++) await emailTo(store.storeId, ben, `Letter ${i}`, new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString());
    const first = await readTimeline(reader(), { kind: "person", email: ben, customerId: null });
    expect(first.events).toHaveLength(TIMELINE_SHORT);
    expect(first.events[0].label).toBe(`Letter ${TIMELINE_SHORT + 1}`);
    expect(first.more).toBe(true);
    const all = await readTimeline(reader(), { kind: "person", email: ben, customerId: null }, { full: true });
    expect(all.events).toHaveLength(TIMELINE_SHORT + 2);
    expect(all.more).toBe(false);
  });
});

describe("a company's timeline", () => {
  let companyId: string;

  beforeAll(async () => {
    const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name) values (${store.storeId}::uuid, 'Lovelace AS') returning id`);
    companyId = String(company.id);
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, currency, customer_company_id) values (${store.storeId}::uuid, 'Lovelace AS', 'NOK', ${companyId}::uuid) returning id
    `);
    // An issued invoice is made by issuing a draft or by the Kaizen Life import; the import's way puts one here as it stands.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.work_importing', 'on', true)`);
      await tx.execute(sql`
        insert into commerce.work_invoices (store_id, client_id, status, series, imported, document_number, issued_on, due_on, sent_at, seller, buyer,
                                            locale, payment_days, currency, subtotal_minor, vat_minor, total_minor)
        values (${store.storeId}::uuid, ${String(client.id)}::uuid, 'sent', 'work_invoice', true, ${`W-${run}`}, '2026-10-12', '2026-10-26',
                ${at("2026-10-12T10:00:00Z")}, '{}'::jsonb, '{}'::jsonb, 'nb-NO', 14, 'NOK', 100000, 25000, 125000)
      `);
    });
  });

  it("brings its people's events, each naming the person, and the company's own Work invoices", async () => {
    const read = await readTimeline(reader(), { kind: "company", companyId, people: [{ id: adaId, email: mail("ada") }] });
    const work = read.events[0];
    expect(work).toMatchObject({ what: "work_invoice_issued", label: `W-${run}`, email: null, amount: { minor: 125000, currency: "NOK" } });
    expect(work.href).toMatch(/^\/admin\/account\/work\/s\//);
    expect(read.events.find((e) => e.what === "order_placed")?.email).toBe(mail("ada"));
  });

  it("leaves Work out where Work is off", async () => {
    const read = await readTimeline(reader({}, false), { kind: "company", companyId, people: [{ id: adaId, email: mail("ada") }] });
    expect(read.visible).not.toContain("work_invoice");
    expect(read.events.map((e) => e.what)).not.toContain("work_invoice_issued");
  });

  it("shows a company with no people its own invoices only", async () => {
    const read = await readTimeline(reader(), { kind: "company", companyId, people: [] });
    expect(read.events.map((e) => e.what)).toEqual(["work_invoice_issued"]);
  });
});
