import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { EXPORT_SECTIONS } from "@/lib/personal-data";
import { findExcluded, findStrings, serialiseExport, validateExport, type ExportFile } from "@/lib/privacy-export";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const fx = await import("./invoice-test-fixture");
const { buildSubject, SECRETS } = await import("./privacy-fixture");
const { exportCustomerData } = await import("./privacy-export");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * The export of a person's data (D162, G1 to G3 and G5): one file with every section, counts that round-trip, nothing the file leaves out
 * (a password hash, a client secret, a token, a cost figure, a staff member's name), nothing of another store, and a plain refusal for a
 * subject too large to give whole.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
let subject: Awaited<ReturnType<typeof buildSubject>>;
let otherSubject: Awaited<ReturnType<typeof buildSubject>>;
let file: ExportFile;

const idsOf = (list: unknown[]) => (list as { id: string }[]).map((x) => x.id).sort();
const SENTINEL_A = "ZEBRA-A-1g";
const SENTINEL_B = "OKAPI-B-1g";

beforeAll(async () => {
  store = await fx.makeStore("export");
  other = await fx.makeStore("export-b");
  subject = await buildSubject(store, "subject", { sentinel: SENTINEL_A });
  // The same email is a customer of another store with its own sentinels: two subjects, never one file.
  otherSubject = await buildSubject(other, "subject", { email: subject.email, sentinel: SENTINEL_B });
  const result = await exportCustomerData(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
  if (!result.ok) throw new Error(result.problem);
  file = result.file;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("a person with one of every kind of data (G1)", () => {
  it("gets a file whose every section is present and whose counts round-trip", () => {
    expect(Object.keys(file.sections).sort()).toEqual([...EXPORT_SECTIONS].sort());
    expect(Object.keys(file.counts).sort()).toEqual([...EXPORT_SECTIONS].sort());
    expect(file).toMatchObject({ schema: "kaizen.customer-export", version: 1, subject: { kind: "account", email: subject.email, accountId: subject.customerId } });
    // The orders are exactly the ones inserted: signed in, guest under the same email, under another email, never paid, in euro, copied, a host's, a renewal.
    const ids = subject.ids;
    expect(idsOf(file.sections.orders)).toEqual([ids.signedInOrder.orderId, ids.guestOrder.orderId, ids.otherEmailOrder.orderId, ids.unpaidOrder.orderId, ids.euroOrder.orderId, ids.copiedOrder, ids.hostOrder, ids.renewalOrder].sort());
    expect(file.counts.orders).toBe(8);
    expect(file.counts.profile).toBe(1);
    expect(file.sections.invoices.length).toBeGreaterThan(0);
    expect(idsOf(file.sections.invoices)).toContain(ids.invoice);
    expect(idsOf(file.sections.creditNotes)).toContain(ids.creditNote);
    expect(idsOf(file.sections.returns.returns)).toEqual([ids.return]);
    expect(idsOf(file.sections.returns.withdrawals)).toEqual([ids.withdrawal]);
    expect(idsOf(file.sections.subscriptions)).toEqual([ids.subscription]);
    expect(idsOf(file.sections.deliveries)).toEqual([ids.standingOrder]);
    expect(idsOf(file.sections.wishlists.lists)).toEqual([ids.wishlist]);
    expect(file.sections.wishlists.cartAdds).toHaveLength(1);
    expect((file.sections.bonus as { entries: unknown[] } | null)?.entries.length).toBeGreaterThan(0);
    const referrals = file.sections.referrals as { affiliate: unknown; rewards: { count: number } | null };
    expect(referrals.affiliate).not.toBeNull();
    expect(referrals.rewards?.count).toBe(1);
    expect(idsOf(file.sections.carts.carts)).toContain(ids.cart);
    expect(file.sections.carts.abandonedCheckouts).toHaveLength(1);
    expect(file.sections.forms).toHaveLength(1);
    expect(file.sections.company.company).toMatchObject({ name: expect.stringContaining("Fjord") });
    expect(file.sections.company.invites).toHaveLength(1);
    // The counts are what the sections hold (the validator checks every one).
    expect(validateExport(file)).toEqual([]);
  });

  it("carries the lines, payments, refunds, shipments, terms, events, a booking's time, and the order's addresses as the rows they are", () => {
    const orders = file.sections.orders as unknown as { id: string; number: string; lines: { booked: unknown }[]; payments: unknown[]; refunds: unknown[]; shipments: unknown[]; copied: boolean; host: boolean; events: { type: string }[]; billingAddress: { line1?: string } | null; email: string }[];
    const signedIn = orders.find((o) => o.id === subject.ids.signedInOrder.orderId)!;
    expect(signedIn.lines.length).toBeGreaterThan(0);
    expect(signedIn.lines.some((l) => l.booked)).toBe(true);
    expect(signedIn.payments).toHaveLength(1);
    expect(signedIn.refunds).toHaveLength(1);
    expect(signedIn.shipments).toHaveLength(1);
    expect(signedIn.events.map((e) => e.type)).toContain("order.paid");
    expect(signedIn.billingAddress?.line1).toBe("Kirkeveien 5");
    expect(orders.find((o) => o.id === subject.ids.copiedOrder)).toMatchObject({ copied: true });
    expect(orders.find((o) => o.id === subject.ids.hostOrder)).toMatchObject({ host: true });
    // An order placed signed in under another address belongs to the account; the address is in the file.
    expect(orders.find((o) => o.id === subject.ids.otherEmailOrder.orderId)).toMatchObject({ email: subject.otherEmail });
    // The addresses section lists each distinct address once, with where it came from.
    expect(file.sections.addresses.length).toBeGreaterThan(1);
  });

  it("gives the emails sent to every address of the person, without the sign-in code's body", () => {
    const emails = file.sections.emails as unknown as { kind: string; body: string | null; subject: string }[];
    expect(emails.map((e) => e.kind).sort()).toEqual(expect.arrayContaining(["order.confirmation", "account.code", "return.acknowledgement"]));
    expect(emails.find((e) => e.kind === "account.code")?.body).toBeNull();
    expect(emails.find((e) => e.kind === "order.confirmation")?.body).toContain(SENTINEL_A);
  });

  it("gives staff-entered custom fields on the customer and their orders, and the consents the store holds under the person", () => {
    const fields = file.sections.customFields as unknown as { entity: string; value: string; reference: string | null }[];
    expect(fields.find((f) => f.entity === "customer")?.value).toContain("Prefers small packages");
    expect(fields.find((f) => f.entity === "order")).toMatchObject({ value: "Gift wrap please", reference: subject.ids.signedInOrder.number });
    const kinds = (file.sections.consents as unknown as { kind: string }[]).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["email_opt_out", "newsletter_sign_up", "withdrawal_acknowledged", "standing_order_card_consent"]));
  });
});

describe("the file is valid, stable JSON in the schema, and holds none of what it leaves out (G2)", () => {
  it("never holds a password hash, a client secret, a token, a cost figure, a provider account or a staff member's name", () => {
    const needles = [...Object.values(SECRETS).map((s) => s.slice(0, 14)), "SECRET", "Secret Staff Name", "777", "scrypt$"];
    // A cost figure of 777 is a number, not a string: the deep scan looks for the strings and the keys.
    const text = serialiseExport(file);
    for (const needle of needles.filter((n) => n !== "777")) expect(text, needle).not.toContain(needle);
    expect(findStrings(file, needles.filter((n) => n !== "777"))).toEqual([]);
    expect(findExcluded(file)).toEqual([]);
    expect(text).not.toContain("unitCost");
  });

  it("is UTF-8 JSON that parses back to the same file, and the same rows give the same file", async () => {
    expect(JSON.parse(serialiseExport(file))).toEqual(file);
    const again = await exportCustomerData(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
    if (!again.ok) throw new Error(again.problem);
    expect({ ...again.file, generatedAt: "" }).toEqual({ ...file, generatedAt: "" });
    expect(again.fileName).toMatch(/^export-.*-data-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("shows the euro-view order in the currency it was charged, never converted", () => {
    const euro = (file.sections.orders as unknown as { id: string; currency: string; total: { amountMinor: number; currency: string }; subtotal: { currency: string } }[]).find((o) => o.id === subject.ids.euroOrder.orderId)!;
    expect(euro.currency).toBe(subject.ids.euroOrder.currency);
    expect(euro.total).toEqual({ amountMinor: subject.ids.euroOrder.total, currency: subject.ids.euroOrder.currency });
    expect(euro.subtotal.currency).toBe(subject.ids.euroOrder.currency);
  });

  it("gives a person the store holds nothing about a file all the same: zero counts, a guest", async () => {
    const result = await exportCustomerData(store.storeId, { email: `nobody-${fx.run}@example.com` }, { channel: "staff", accountId: store.ownerId });
    if (!result.ok) throw new Error(result.problem);
    expect(result.file.subject).toMatchObject({ kind: "guest" });
    expect(Object.values(result.file.counts).every((n) => n === 0)).toBe(true);
    expect(validateExport(result.file)).toEqual([]);
    expect(Object.keys(result.file.sections).sort()).toEqual([...EXPORT_SECTIONS].sort());
  });

  it("answers a key that is nobody's with not_found, never an empty file under someone else's name", async () => {
    expect(await exportCustomerData(store.storeId, {}, { channel: "staff", accountId: store.ownerId })).toEqual({ ok: false, problem: "not_found" });
  });
});

describe("a subject too large is refused, never cut (G3)", () => {
  it("says too_large above the row limit and writes nothing to the log", async () => {
    const before = (await auditRows(store.storeId, "customer.data_exported")).length;
    const result = await exportCustomerData(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId, rowLimit: 5 });
    expect(result).toEqual({ ok: false, problem: "too_large" });
    expect((await auditRows(store.storeId, "customer.data_exported")).length).toBe(before);
  });
});

describe("another store's data is never in a file (G5)", () => {
  it("holds only this store's data for an email that is a customer of two stores, and the reverse", async () => {
    const mine = serialiseExport(file);
    expect(mine).toContain(SENTINEL_A);
    expect(mine).not.toContain(SENTINEL_B);
    const theirs = await exportCustomerData(other.storeId, { email: subject.email }, { channel: "staff", accountId: other.ownerId });
    if (!theirs.ok) throw new Error(theirs.problem);
    const text = serialiseExport(theirs.file);
    expect(text).toContain(SENTINEL_B);
    expect(text).not.toContain(SENTINEL_A);
    expect(idsOf(theirs.file.sections.orders).some((id) => subject.ids.orders.includes(id))).toBe(false);
    // The other store's order ids are nobody's in this store.
    for (const id of otherSubject.ids.orders) expect(idsOf(file.sections.orders)).not.toContain(id);
  });

  it("does not find another store's account or order by its id", async () => {
    expect(await exportCustomerData(store.storeId, { customerId: otherSubject.customerId }, { channel: "staff", accountId: store.ownerId })).toEqual({ ok: false, problem: "not_found" });
  });
});

describe("every export is logged, and answers the request it was for (G9)", () => {
  it("writes customer.data_exported with ids and counts, never an email or a name, and tells the owners", async () => {
    const rows = await auditRows(store.storeId, "customer.data_exported");
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows.map((r) => r.details));
    expect(text).not.toContain(subject.email);
    expect(text).not.toContain("Kari");
    expect(rows[0]).toMatchObject({ area: "customers" });
    const notices = await db().execute<Row>(sql`select to_address, status, subject, text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'privacy.owners_notice'`);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((n) => String(n.to_address) === store.ownerEmail)).toBe(true);
    // The notice holds who and when, never the customer.
    expect(JSON.stringify(notices)).not.toContain(subject.email);
    expect(JSON.stringify(notices)).not.toContain("Kari Nordmann");
  });

  it("completes the open request for the person, and a shopper's own download is logged as a request already answered", async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, subject_email, subject_customer_id) values (${store.storeId}::uuid, 'export', 'staff', ${subject.email}, ${subject.customerId}::uuid) returning id`);
    const done = await exportCustomerData(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
    expect(done.ok && done.requestId).toBe(String(request.id));
    const [row] = await db().execute<Row>(sql`select status, outcome, completed_at from commerce.privacy_requests where id = ${String(request.id)}::uuid`);
    expect(row).toMatchObject({ status: "done", outcome: "exported" });
    const mine = await exportCustomerData(store.storeId, { customerId: subject.customerId }, { channel: "shopper", accountId: null });
    expect(mine.ok).toBe(true);
    const [shopper] = await db().execute<Row>(sql`select channel, status, outcome from commerce.privacy_requests where store_id = ${store.storeId}::uuid and channel = 'shopper' and kind = 'export'`);
    expect(shopper).toMatchObject({ channel: "shopper", status: "done", outcome: "exported" });
    expect(mine.ok && mine.fileName).toMatch(/-my-data-/);
    const entries = await auditRows(store.storeId, "customer.data_exported");
    expect(entries.some((r) => (r.details as { by?: string }).by === "shopper" && r.account_id === null)).toBe(true);
  });
});
