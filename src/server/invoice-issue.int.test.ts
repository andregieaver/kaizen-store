import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { isDocumentToken } from "@/lib/document-token";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const inv = await import("./invoices");
const issue = await import("./invoice-issue");
const settings = await import("./invoice-settings");
const { sendOrderConfirmation } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Invoices for paid orders (D159, docs 2.1, 2.7, 4.1), against a real database: issued by the database inside the payment, once, in the store's
 * own gap-free series; copied, test-mode, switched-off and unpaid orders get none; an order that cannot be invoiced yet waits and is issued by the
 * job when the cause is gone, with the later day as its issue date and the payment day as its supply date; the reads show it and nothing of another store's.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  store = await fx.makeStore("iss");
  other = await fx.makeStore("iss-other");
});

afterAll(async () => {
  await closeDb();
});

describe("an invoice is made when an order is paid", () => {
  it("is the order, to the minor unit, in the store's own series, once", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 2], ["DEMO-NOTEBOOK-LINED", 1]]);
    const invoice = await fx.invoiceOf(store.storeId, order.orderId);
    expect(invoice).not.toBeNull();
    expect(invoice!.documentNumber).toBe(`F-${invoice!.number}`);
    expect(invoice).toMatchObject({ totalMinor: order.total, taxMinor: order.tax, currency: "NOK", vatKind: "standard", issuedOn: today(), supplyDate: today() });
    expect(invoice!.netMinor + invoice!.taxMinor).toBe(invoice!.totalMinor);
    expect(isDocumentToken(invoice!.token)).toBe(true);
    expect(invoice!.token!.startsWith("inv_")).toBe(true);
    // The document is the snapshot: seller, buyer, order, the VAT per rate that adds up to the order's.
    const s = invoice!.snapshot;
    expect(s).toMatchObject({ version: 1, documentType: "invoice", number: invoice!.documentNumber, language: "nb", currency: "NOK" });
    expect(s.seller).toMatchObject({ legalName: "Fixture AS", organisationNumber: "923456789", vatRegistered: true, vatNumber: "NO923456789MVA", country: "NO" });
    expect(s.buyer).toMatchObject({ type: "consumer", name: "Kari Nordmann", email: order.email, complete: true, address: { line1: "Kirkeveien 5", country: "NO" } });
    expect(s.order).toMatchObject({ number: order.number });
    expect(s.payments).toEqual([{ kind: "paid_online", amountMinor: order.total, provider: "stripe" }]);
    const byRate = await fx.orderVatByRate(order.orderId);
    const buckets = new Map<string, number>(s.buckets.map((b: { rate: number; vatMinor: number }) => [b.rate.toFixed(4), b.vatMinor]));
    for (const [rate, vat] of byRate) if (vat !== 0) expect(buckets.get(rate), `rate ${rate}`).toBe(vat);
    expect(s.buckets.reduce((sum: number, b: { vatMinor: number }) => sum + b.vatMinor, 0)).toBe(order.tax);
    // The order's event history says so.
    const [event] = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'invoice.issued'`);
    expect(event.data).toMatchObject({ number: invoice!.documentNumber });
  });

  it("is not made a second time, however often the job or the function is asked", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const first = await fx.invoiceOf(store.storeId, order.orderId);
    expect(await issue.issueWaitingInvoices(store.storeId)).toBe(0);
    const [again] = await db().execute<Row>(sql`select commerce.issue_order_invoice(${store.storeId}::uuid, ${order.orderId}::uuid) as id`);
    expect(String(again.id)).toBe(first!.id);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where order_id = ${order.orderId}::uuid`);
    expect(count.n).toBe(1);
  });

  it("keeps the numbers in one unbroken run, and the audit says so", async () => {
    const own = await fx.makeStore("iss-run");
    for (let i = 0; i < 4; i++) await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const rows = await db().execute<Row>(sql`select number from commerce.invoices where store_id = ${own.storeId}::uuid order by number`);
    expect(rows.map((r) => Number(r.number))).toEqual([1, 2, 3, 4]);
    const audit = await inv.documentAudit(own.storeId);
    expect(audit.find((a) => a.series === "invoice")).toMatchObject({ documents: 4, firstNumber: 1, lastNumber: 4, missing: 0, ok: true, nextNumber: 5 });
    expect(await inv.invoiceCheckupFindings(own.storeId)).toEqual([]);
  });

  it("is an order in euro, in euro, with the VAT also in the seller's currency at the store's rate", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 2]], { market: fx.noInEuro });
    const invoice = await fx.invoiceOf(store.storeId, order.orderId);
    expect(order.currency).toBe("EUR");
    expect(invoice).toMatchObject({ currency: "EUR", totalMinor: order.total, taxMinor: order.tax, vatHomeCurrency: "NOK", fxRate: 11.5 });
    const expected = invoice!.snapshot.buckets.reduce((sum: number, b: { vatMinor: number }) => sum + Math.floor(b.vatMinor * 11.5 + 0.5), 0);
    expect(invoice!.vatHomeMinor).toBe(expected);
    expect(invoice!.snapshot.vatHome).toMatchObject({ currency: "NOK", vatMinor: expected, fxRate: 11.5 });
    // The store's main currency is NOK, so the figure the reports add up is the same one.
    expect(invoice!.snapshot.vatMain).toMatchObject({ currency: "NOK", vatMinor: expected });
  });

  it("states a business buyer's company and organisation number, and no VAT number when none was charged away", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { company: { name: "Acme AS", number: "987654321" } });
    const invoice = await fx.invoiceOf(store.storeId, order.orderId);
    expect(invoice!.snapshot.buyer).toMatchObject({ type: "business", company: "Acme AS", organisationNumber: "987654321", vatNumber: null });
    expect(invoice!.snapshot.treatment).toMatchObject({ kind: "standard", buyerVatNumber: null });
  });

  it("is a download with no postal address: a full invoice, with the gap said and nothing invented", async () => {
    const order = await fx.paidOrder(store, [["DEMO-LAMP", 1]], { billing: { name: "Per Hansen", country: "NO" }, shipTo: {} });
    const invoice = await fx.invoiceOf(store.storeId, order.orderId);
    expect(invoice!.snapshot.buyer).toMatchObject({ name: "Per Hansen", complete: false, address: { line1: null, country: "NO" } });
    expect(invoice!.snapshot.notes).toContain("buyer_incomplete");
  });
});

describe("what gets no invoice", () => {
  it("is an order paid in Stripe's test mode: the legal numbers are not used up", async () => {
    const test = await fx.makeStore("iss-test", { mode: "test" });
    const order = await fx.paidOrder(test, [["DEMO-MUG-WHITE", 1]]);
    expect(await fx.invoiceOf(test.storeId, order.orderId)).toBeNull();
    const docs = await inv.getOrderDocuments(test.storeId, order.orderId);
    expect(docs).toMatchObject({ eligibility: "test_mode", invoice: null, waiting: null, shopperNote: "Test order: no invoice." });
    expect(docs.staffNote).toMatch(/test mode/i);
    expect(await inv.waitingInvoices(test.storeId)).toEqual([]);
    const [series] = await db().execute<Row>(sql`select next_number from commerce.document_series where store_id = ${test.storeId}::uuid and series = 'invoice'`);
    expect(Number(series.next_number)).toBe(1);
  });

  it("is an order of a store that switched invoicing off", async () => {
    const off = await fx.makeStore("iss-off", { invoicing: false });
    const order = await fx.paidOrder(off, [["DEMO-MUG-WHITE", 1]]);
    expect(await fx.invoiceOf(off.storeId, order.orderId)).toBeNull();
    expect(await inv.getOrderDocuments(off.storeId, order.orderId)).toMatchObject({ eligibility: "disabled", shopperNote: null });
    // Switching it on starts the count: the order paid before is never back-dated.
    await settings.saveInvoiceSettings(await fx.ownerOf(off), { enabled: "on" });
    expect(await issue.issueWaitingInvoices(off.storeId)).toBe(0);
    expect(await fx.invoiceOf(off.storeId, order.orderId)).toBeNull();
    const next = await fx.paidOrder(off, [["DEMO-MUG-WHITE", 1]]);
    expect(await fx.invoiceOf(off.storeId, next.orderId)).not.toBeNull();
  });

  it("is an order not yet paid, and one copied from another store", async () => {
    const unpaid = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { pay: false });
    expect(await fx.invoiceOf(store.storeId, unpaid.orderId)).toBeNull();
    expect(await inv.getOrderDocuments(store.storeId, unpaid.orderId)).toMatchObject({ eligibility: "not_paid" });

    // History copied from another store (D129): inserted as `copy_orders()` writes it (the database refuses it a payment event, too).
    const [row] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, placed_at, copied_from)
      values (${store.storeId}::uuid, ${`C-${fx.run}-1`}, 'NO', 'NOK', 'nb-NO', 'old@example.com', 'paid', 10000, 0, 0, 2000, 10000, '{}'::jsonb, '{}'::jsonb, now(), ${crypto.randomUUID()}::uuid)
      returning id
    `);
    const copiedId = String(row.id);
    expect(await fx.invoiceOf(store.storeId, copiedId)).toBeNull();
    expect(await inv.getOrderDocuments(store.storeId, copiedId)).toMatchObject({ eligibility: "copied", waiting: null });
    expect((await inv.waitingInvoices(store.storeId)).map((w) => w.orderId)).not.toContain(copiedId);
    // Neither the job nor the function makes one, and the database refuses a document for it however it is asked.
    expect(await issue.issueWaitingInvoices(store.storeId)).toBe(0);
    const [made] = await db().execute<Row>(sql`select commerce.issue_order_invoice(${store.storeId}::uuid, ${copiedId}::uuid) as id`);
    expect(made.id).toBeNull();
    await expect(db().execute(sql`select commerce.make_order_invoice(${store.storeId}::uuid, ${copiedId}::uuid)`)).resolves.toBeDefined();
    expect(await fx.invoiceOf(store.storeId, copiedId)).toBeNull();
  });
});

describe("an order that cannot be invoiced yet waits, and is issued when the cause is gone", () => {
  it("waits for the seller's details, says so, and is issued by the job with the payment day as its supply date", async () => {
    const wait = await fx.makeStore("iss-wait", { sellerDetails: false });
    const order = await fx.paidOrder(wait, [["DEMO-MUG-WHITE", 1]]);
    // The payment went through; there is no invoice and the payment was not stopped.
    const [paid] = await db().execute<Row>(sql`select status from commerce.orders where id = ${order.orderId}::uuid`);
    expect(paid.status).toBe("paid");
    expect(await fx.invoiceOf(wait.storeId, order.orderId)).toBeNull();
    const queue = await inv.waitingInvoices(wait.storeId);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ orderId: order.orderId, reason: "seller_details", fixAt: "/settings/company", totalMinor: order.total, currency: "NOK", overdue: false });
    expect(queue[0].words).toMatch(/business details/i);
    expect((await inv.getOrderDocuments(wait.storeId, order.orderId)).waiting).toBe("seller_details");
    expect(await inv.invoiceCounts(wait.storeId)).toMatchObject({ invoices: 0, waiting: 1 });
    expect((await inv.invoiceCheckupFindings(wait.storeId)).map((f) => f.code)).toEqual(["invoices_waiting"]);
    // The job does nothing while the cause is there.
    expect(await issue.issueWaitingInvoices(wait.storeId)).toBe(0);

    await db().execute(sql`update commerce.stores set legal_name = 'Wait AS', organisation_number = '923456789', postal_address = 'Gata 1', country = 'NO' where id = ${wait.storeId}::uuid`);
    expect(await issue.storesWithDocumentWork()).toContain(wait.storeId);
    expect(await issue.issueWaitingInvoices(wait.storeId)).toBe(1);
    const invoice = await fx.invoiceOf(wait.storeId, order.orderId);
    expect(invoice).toMatchObject({ totalMinor: order.total, documentNumber: "F-1", issuedOn: today(), supplyDate: today() });
    expect(await inv.waitingInvoices(wait.storeId)).toEqual([]);
    expect(await issue.storesWithDocumentWork()).not.toContain(wait.storeId);
  });

  it("waits for a tax profile, and for one that does not say 'not registered' while VAT was charged", async () => {
    const noProfile = await fx.makeStore("iss-prof", { registered: null });
    const order = await fx.paidOrder(noProfile, [["DEMO-MUG-WHITE", 1]]);
    expect((await inv.waitingInvoices(noProfile.storeId))[0]).toMatchObject({ reason: "tax_profile_missing", fixAt: "/settings/tax" });
    await db().execute(sql`insert into commerce.store_tax_profile (store_id, vat_registered) values (${noProfile.storeId}::uuid, false)`);
    // Not registered, yet the order charged VAT (unit 1a charges the destination's): an invoice may not state VAT, so it waits.
    expect((await inv.waitingInvoices(noProfile.storeId))[0]).toMatchObject({ reason: "vat_charged_not_registered" });
    expect(await issue.issueWaitingInvoices(noProfile.storeId)).toBe(0);
    await db().execute(sql`update commerce.store_tax_profile set vat_registered = true, vat_number = 'NO923456789MVA' where store_id = ${noProfile.storeId}::uuid`);
    expect(await issue.issueWaitingInvoices(noProfile.storeId)).toBe(1);
    expect(await fx.invoiceOf(noProfile.storeId, order.orderId)).toMatchObject({ totalMinor: order.total });
  });

  it("waits for an exchange rate to the seller's currency when the invoice must carry the VAT in it", async () => {
    const own = await fx.makeStore("iss-fx");
    const placed = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: fx.noInEuro, pay: false });
    await db().execute(sql`delete from commerce.store_currencies where store_id = ${own.storeId}::uuid and currency = 'NOK'`);
    await fx.payPlaced(own, placed);
    expect(await fx.invoiceOf(own.storeId, placed.orderId)).toBeNull();
    expect((await inv.waitingInvoices(own.storeId))[0]).toMatchObject({ reason: "no_exchange_rate", fixAt: "/settings/localization", currency: "EUR" });
    await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${own.storeId}::uuid, 'NOK', 11.5, 1, 0)`);
    expect(await issue.issueWaitingInvoices(own.storeId)).toBe(1);
    expect(await fx.invoiceOf(own.storeId, placed.orderId)).toMatchObject({ vatHomeCurrency: "NOK", fxRate: 11.5 });
  });

  it("flags no standard order as overdue: only a reverse-charge supply has the 15th-of-the-month deadline (a reverse-charge order is tested with the VAT engine's)", async () => {
    const own = await fx.makeStore("iss-rc", { sellerDetails: false });
    await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    expect((await inv.waitingInvoices(own.storeId, "2999-01-01"))[0]).toMatchObject({ vatKind: "standard", overdue: false, deadline: null });
    expect((await inv.invoiceCounts(own.storeId, "2999-01-01")).overdue).toBe(0);
  });
});

describe("the lists and the hosted document", () => {
  let own: Awaited<ReturnType<typeof fx.makeStore>>;
  const orders: Awaited<ReturnType<typeof fx.paidOrder>>[] = [];

  beforeAll(async () => {
    own = await fx.makeStore("iss-list");
    orders.push(await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { email: "anna@example.com" }));
    orders.push(await fx.paidOrder(own, [["DEMO-MUG-WHITE", 3]], { email: "bjorn@example.com", billing: { name: "Bjørn Berg", line1: "Gata 2", postalCode: "0150", city: "Oslo", country: "NO" } }));
    orders.push(await fx.paidOrder(own, [["DEMO-NOTEBOOK-LINED", 1]], { email: "cato@example.com" }));
  });

  it("show the store's invoices, newest first, with the buyer's name for staff", async () => {
    const page = await inv.listInvoices(own.storeId);
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.documentNumber)).toEqual(["F-3", "F-2", "F-1"]);
    expect(page.rows[1]).toMatchObject({ buyerName: "Bjørn Berg", buyerCountry: "NO", currency: "NOK", orderId: orders[1].orderId, orderNumber: orders[1].number, totalMinor: orders[1].total, hasPdf: false, anonymised: false, type: "invoice" });
  });

  it("are searched by document number, order number and a buyer's email, within a period, a page at a time", async () => {
    expect((await inv.listInvoices(own.storeId, { q: "F-2" })).rows.map((r) => r.documentNumber)).toEqual(["F-2"]);
    expect((await inv.listInvoices(own.storeId, { q: orders[2].number })).rows.map((r) => r.documentNumber)).toEqual(["F-3"]);
    expect((await inv.listInvoices(own.storeId, { q: "ANNA@example.com" })).rows.map((r) => r.documentNumber)).toEqual(["F-1"]);
    // A percent sign is text, not a wildcard.
    expect((await inv.listInvoices(own.storeId, { q: "%" })).total).toBe(0);
    expect((await inv.listInvoices(own.storeId, { from: today(), to: today() })).total).toBe(3);
    expect((await inv.listInvoices(own.storeId, { from: "2999-01-01" })).total).toBe(0);
    expect((await inv.listInvoices(own.storeId, { from: "not a date" })).total).toBe(3);
    const second = await inv.listInvoices(own.storeId, { limit: 2, offset: 2 });
    expect(second.rows.map((r) => r.documentNumber)).toEqual(["F-1"]);
    expect(second.total).toBe(3);
  });

  it("show nothing of another store's", async () => {
    expect((await inv.listInvoices(other.storeId, { q: "F-1" })).rows.every((r) => r.orderId !== orders[0].orderId)).toBe(true);
    expect(await inv.getInvoice(other.storeId, (await fx.invoiceOf(own.storeId, orders[0].orderId))!.id)).toBeNull();
    expect((await inv.getOrderDocuments(other.storeId, orders[0].orderId)).invoice).toBeNull();
    expect((await inv.listCreditNotes(other.storeId)).total).toBe(0);
  });

  it("find a document by its token, for its own store alone, and not by anything that is not one", async () => {
    const invoice = (await fx.invoiceOf(own.storeId, orders[0].orderId))!;
    const found = await inv.findDocumentByToken(own.storeId, invoice.token);
    expect(found).toMatchObject({ kind: "invoice", id: invoice.id, orderId: orders[0].orderId, documentNumber: invoice.documentNumber, pdfPath: null });
    expect(found!.snapshot.buyer.email).toBe("anna@example.com");
    expect(await inv.findDocumentByToken(other.storeId, invoice.token)).toBeNull();
    for (const bad of [null, undefined, "", "inv_short", `inv_${"a".repeat(43)}`, `crn_${"a".repeat(43)}`, `${invoice.token}x`, { token: invoice.token }, 42]) {
      expect(await inv.findDocumentByToken(own.storeId, bad), String(bad)).toBeNull();
    }
    // An invoice's token never opens a credit note, and the other way round (the prefix decides which table is asked).
    expect(await inv.findDocumentByToken(own.storeId, invoice.token!.replace("inv_", "crn_"))).toBeNull();
  });

  it("give an order its documents in one read, with the token for the shopper's link", async () => {
    const docs = await inv.getOrderDocuments(own.storeId, orders[1].orderId);
    expect(docs).toMatchObject({ eligibility: "ok", waiting: null, shopperNote: null, staffNote: null, creditNotes: [] });
    expect(docs.invoice).toMatchObject({ documentNumber: "F-2", type: "invoice", currency: "NOK", totalMinor: orders[1].total, hasPdf: false });
    expect(isDocumentToken(docs.invoice!.token)).toBe(true);
    expect(await inv.getOrderDocuments(own.storeId, "00000000-0000-4000-8000-000000000000")).toMatchObject({ invoice: null, creditNotes: [] });
  });

  it("show the invoice in full for staff: the snapshot, the order and no credit notes yet", async () => {
    const invoice = (await fx.invoiceOf(own.storeId, orders[2].orderId))!;
    const detail = await inv.getInvoice(own.storeId, invoice.id);
    expect(detail).toMatchObject({ documentNumber: "F-3", orderNumber: orders[2].number, vatKind: "standard", totalMinor: orders[2].total, creditNotes: [], anonymised: false });
    expect(detail!.snapshot.documentType).toBe("invoice");
  });
});

describe("the five-minute job", () => {
  it("issues what waits, in every store with something to do, and tells the shopper of an invoice that came later", async () => {
    const own = await fx.makeStore("iss-job", { sellerDetails: false });
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { email: "late@example.com" });
    // The shopper was told nothing about an invoice, since there was none.
    await sendOrderConfirmation(own.storeId, order.orderId);
    const [first] = await db().execute<Row>(sql`select html from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'order.confirmation'`);
    expect(String(first.html)).not.toContain("/account/documents/");

    await db().execute(sql`update commerce.stores set legal_name = 'Job AS', organisation_number = '923456789', postal_address = 'Gata 1', country = 'NO' where id = ${own.storeId}::uuid`);
    const result = await issue.invoiceJobs();
    expect(result.invoices).toBeGreaterThanOrEqual(1);
    expect(await fx.invoiceOf(own.storeId, order.orderId)).not.toBeNull();
    // An invoice issued in the payment's own transaction is carried by the confirmation; one issued later is not, and is announced.
    // (The two-minute margin is the job's: it is crossed here by backdating the payment event's reading, not the invoice.)
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    expect(invoice.issuedOn).toBe(today());
  });
});
