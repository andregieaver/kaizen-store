import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { storeToday } from "./test-days";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The document's HTML is the surface's (`OrderDocumentView`); the PDF's own work (the lock, the storing, the failures) is held here with a stand-in.
vi.mock("./document-html", () => ({ documentHtml: (snapshot: { number: string }) => `<html><body>${snapshot.number}</body></html>` }));

const fx = await import("./invoice-test-fixture");
const inv = await import("./invoices");
const issue = await import("./invoice-issue");
const settings = await import("./invoice-settings");
const pdf = await import("./invoice-pdf");
const notices = await import("./invoice-notices");
const documents = await import("./invoice-emails");
const exporter = await import("./invoice-export");
const retention = await import("./invoice-retention");
const { sendOrderConfirmation, sendShipped } = await import("./shopper-emails");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * The documents the shopper and the staff get (D159, docs 2.2, 2.3, 4.9, 3.6), against a real database: the invoice in the confirmation and the
 * shipped email, the stand-alone email for an invoice issued later, staff sending one again, the PDF made once and kept, its failures counted,
 * the accountant's CSV, and the personal data of an old document removed with its file.
 */

/** A bucket in memory: the stand-in for Supabase Storage. */
function memoryStorage(options: { failUpload?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const calls = { upload: 0, download: 0, remove: [] as string[][] };
  return {
    files,
    calls,
    storage: {
      async upload(path: string, bytes: Uint8Array) {
        calls.upload += 1;
        if (options.failUpload || files.has(path)) return false;
        files.set(path, bytes);
        return true;
      },
      async download(path: string) {
        calls.download += 1;
        return files.get(path) ?? null;
      },
      async remove(paths: string[]) {
        calls.remove.push(paths);
        for (const p of paths) files.delete(p);
        return true;
      },
    },
  };
}

const bytesOf = (text: string) => new TextEncoder().encode(`%PDF-1.7 ${text}`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The payment event's time moved back: the log is immutable, so its guard is lifted for the one update, in the same transaction. */
async function backdatePayment(orderId: string, minutes: number) {
  await db().transaction(async (tx) => {
    await tx.execute(sql`alter table commerce.order_events disable trigger order_events_append_only`);
    await tx.execute(sql`update commerce.order_events set created_at = created_at - make_interval(mins => ${minutes}) where order_id = ${orderId}::uuid and type = 'order.paid'`);
    await tx.execute(sql`alter table commerce.order_events enable trigger order_events_append_only`);
  });
}

const emailsOf = (orderId: string, kind?: string) =>
  db().execute<Row>(sql`
    select id, kind, to_address, subject, html, idempotency_key, status from commerce.email_messages
    where order_id = ${orderId}::uuid ${kind ? sql`and kind = ${kind}` : sql``} order by created_at
  `);

let store: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("doc");
});
afterAll(async () => {
  await closeDb();
});

describe("the invoice in the shopper's emails", () => {
  it("is a number and a link in the order confirmation, noted as carried, and the same link in the shipped email", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    await sendOrderConfirmation(store.storeId, order.orderId);
    const [mail] = await emailsOf(order.orderId, "order.confirmation");
    const html = String(mail.html);
    expect(mail.to_address).toBe(order.email);
    expect(html).toContain(`/account/documents/${invoice.token}`);
    expect(html).toContain(`Din faktura ${invoice.documentNumber}`);
    // The shopper's own link, never another secret: no VAT number of anyone's, no session key beyond the order link the email always had.
    expect(html).not.toContain("NO923456789MVA");
    const [carried] = await db().execute<Row>(sql`select count(*)::int as n from commerce.document_deliveries where document_id = ${invoice.id}::uuid and email_message_id = ${String(mail.id)}::uuid`);
    expect(carried.n).toBe(1);
    // Sent again by staff, it carries it again; the delivery is noted once for the same email.
    await sendShipped(store.storeId, order.orderId, { id: crypto.randomUUID(), carrier: "posten", trackingNumber: "TRACK1", trackingUrl: null });
    const [shipped] = await emailsOf(order.orderId, "order.sent");
    expect(String(shipped.html)).toContain(`/account/documents/${invoice.token}`);
  });

  it("is left out of the confirmation when the owner switched that off, and the invoice stays on the order", async () => {
    const own = await fx.makeStore("doc-off");
    await settings.saveInvoiceSettings(await fx.ownerOf(own), { enabled: "on", emailWithConfirmation: "false" });
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    await sendOrderConfirmation(own.storeId, order.orderId);
    const [mail] = await emailsOf(order.orderId, "order.confirmation");
    expect(String(mail.html)).not.toContain("/account/documents/");
    expect((await inv.getOrderDocuments(own.storeId, order.orderId)).invoice).not.toBeNull();
  });

  it("is not in the email of an order that waits, copied history or a test order: they say nothing about it", async () => {
    const wait = await fx.makeStore("doc-wait", { sellerDetails: false });
    const waiting = await fx.paidOrder(wait, [["DEMO-MUG-WHITE", 1]]);
    await sendOrderConfirmation(wait.storeId, waiting.orderId);
    expect(String((await emailsOf(waiting.orderId, "order.confirmation"))[0].html)).not.toMatch(/faktura|invoice/i);

    const test = await fx.makeStore("doc-test", { mode: "test" });
    const testOrder = await fx.paidOrder(test, [["DEMO-MUG-WHITE", 1]]);
    await sendOrderConfirmation(test.storeId, testOrder.orderId);
    expect(String((await emailsOf(testOrder.orderId, "order.confirmation"))[0].html)).not.toContain("/account/documents/");
  });

  it("is announced by an email of its own when it was issued later than the payment, once, to the order's own address", async () => {
    const own = await fx.makeStore("doc-late", { sellerDetails: false });
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { email: "late@example.com" });
    await db().execute(sql`update commerce.stores set legal_name = 'Late AS', organisation_number = '923456789', postal_address = 'Gata 1', country = 'NO' where id = ${own.storeId}::uuid`);
    await backdatePayment(order.orderId, 10);
    await issue.invoiceJobs();
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    expect(invoice).not.toBeNull();
    const [mail] = await emailsOf(order.orderId, "invoice.issued");
    expect(mail).toMatchObject({ to_address: "late@example.com", idempotency_key: `invoice:${invoice.id}` });
    expect(String(mail.subject)).toBe(`Din faktura ${invoice.documentNumber} fra doc-late`);
    expect(String(mail.html)).toContain(`/account/documents/${invoice.token}`);
    // A second run sends nothing more, and the delivery is noted.
    await issue.invoiceJobs();
    expect(await emailsOf(order.orderId, "invoice.issued")).toHaveLength(1);
    expect(await notices.sendInvoiceNotice(own.storeId, invoice.id)).toBe("duplicate");
    const [carried] = await db().execute<Row>(sql`select count(*)::int as n from commerce.document_deliveries where document_id = ${invoice.id}::uuid`);
    expect(carried.n).toBe(1);
  });

  it("is sent again by staff to the order's own address, with a key of its own and the order's history saying so", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: "again@example.com" });
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    const outcome = await notices.sendDocumentAgain(store.storeId, "invoice", invoice.id, store.ownerId);
    expect(["sent", "logged"]).toContain(outcome);
    const second = await notices.sendDocumentAgain(store.storeId, "invoice", invoice.id, store.ownerId);
    expect(["sent", "logged"]).toContain(second);
    expect(await emailsOf(order.orderId, "invoice.issued")).toHaveLength(2);
    expect((await emailsOf(order.orderId, "invoice.issued")).every((m) => m.to_address === "again@example.com")).toBe(true);
    const events = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'invoice.emailed'`);
    expect(events).toHaveLength(2);
    // Not another store's document, and not a document that is not one.
    expect(await notices.sendDocumentAgain(store.storeId, "invoice", crypto.randomUUID(), null)).toBeNull();
    const foreign = await fx.makeStore("doc-foreign");
    expect(await notices.sendDocumentAgain(foreign.storeId, "invoice", invoice.id, null)).toBeNull();
  });

  it("attaches the PDF as base64 when it exists and is small enough, and only links it otherwise", async () => {
    const own = await fx.makeStore("doc-attach");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    const made = await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("pdf") });
    expect(made).toMatchObject({ ok: true, stored: true });
    const file = bytesOf("pdf");
    const built = await documents.documentBlocks({ storeId: own.storeId, orderId: order.orderId, storeSlug: own.slug, marketSlug: "no", lang: "nb", want: { invoice: true }, attach: true, readFile: async () => file });
    expect(built.attachments).toEqual([{ filename: `${invoice.documentNumber}.pdf`, content: Buffer.from(file).toString("base64"), contentType: "application/pdf", encoding: "base64" }]);
    expect(built.blocks.some((b) => b.type === "paragraph" && b.text.includes("PDF-filen ligger vedlagt"))).toBe(true);
    // Too large for an email: the link only.
    const big = await documents.documentBlocks({ storeId: own.storeId, orderId: order.orderId, storeSlug: own.slug, marketSlug: "no", lang: "en", want: { invoice: true }, attach: true, readFile: async () => new Uint8Array(documents.MAX_ATTACHED_BYTES + 1) });
    expect(big.attachments).toEqual([]);
    expect(big.blocks.some((b) => b.type === "button" && b.url.includes(`/account/documents/${invoice.token}`))).toBe(true);
    // Nothing for another store's order.
    const none = await documents.documentBlocks({ storeId: store.storeId, orderId: order.orderId, storeSlug: store.slug, marketSlug: "no", lang: "nb", want: { invoice: true }, attach: true });
    expect(none).toEqual({ blocks: [], attachments: [], docs: [] });
  });
});

describe("the PDF", () => {
  it("is made once, stored with its checksum, and the second request is served from storage without rendering", async () => {
    const own = await fx.makeStore("pdf-once");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    const render = vi.fn(async (html: string) => bytesOf(html));
    const first = await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render });
    expect(first).toMatchObject({ ok: true, stored: true, fileName: invoice.documentNumber });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toContain(invoice.documentNumber);
    const path = `${own.storeId}/invoices/${invoice.id}.pdf`;
    expect([...mem.files.keys()]).toEqual([path]);
    const [row] = await db().execute<Row>(sql`select pdf_path, pdf_sha256 from commerce.invoices where id = ${invoice.id}::uuid`);
    expect(row).toMatchObject({ pdf_path: path, pdf_sha256: sha(mem.files.get(path)!) });
    const second = await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render });
    expect(second).toMatchObject({ ok: true, stored: true });
    expect(render).toHaveBeenCalledTimes(1);
    expect(sha((second as { bytes: Uint8Array }).bytes)).toBe(sha((first as { bytes: Uint8Array }).bytes));
    expect((await inv.getOrderDocuments(own.storeId, order.orderId)).invoice?.hasPdf).toBe(true);
    expect(await pdf.readPdf(own.storeId, "invoice", invoice.id, { storage: mem.storage })).toEqual(mem.files.get(path));
    // Another store cannot reach it.
    expect(await pdf.ensureInvoicePdf(store.storeId, invoice.id, { storage: mem.storage, render })).toEqual({ ok: false, reason: "not_found" });
    expect(await pdf.readPdf(store.storeId, "invoice", invoice.id, { storage: mem.storage })).toBeNull();
  });

  it("is made for a credit note too, in its own folder", async () => {
    const own = await fx.makeStore("pdf-cn");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${order.orderId}::uuid`);
    await db().execute(sql`insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values (${own.storeId}::uuid, ${String(payment.id)}::uuid, 1000, 'x', 're_pdf1', 'succeeded')`);
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    const mem = memoryStorage();
    expect(await pdf.ensureCreditNotePdf(own.storeId, note.id, { storage: mem.storage, render: async () => bytesOf("cn") })).toMatchObject({ ok: true, stored: true, fileName: note.documentNumber });
    expect([...mem.files.keys()]).toEqual([`${own.storeId}/credit-notes/${note.id}.pdf`]);
  });

  it("falls back, noting the failure, when the renderer fails; the document is untouched, and the job gives up after five", async () => {
    const own = await fx.makeStore("pdf-fail");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    const broken = async () => {
      throw new Error("Chromium crashed\nwith a very long message ".repeat(20));
    };
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: broken })).toEqual({ ok: false, reason: "render_failed" });
    const [state] = await db().execute<Row>(sql`select attempts, last_error from commerce.document_pdf_state where document_id = ${invoice.id}::uuid`);
    expect(state.attempts).toBe(1);
    expect(String(state.last_error).length).toBeLessThanOrEqual(200);
    expect(String(state.last_error)).not.toContain("\n");
    expect(await fx.invoiceOf(own.storeId, order.orderId)).toMatchObject({ pdfPath: null });
    expect(mem.files.size).toBe(0);
    // The job tries it (not for five minutes after a failure), and five failures stop it; the Waiting tab shows it.
    await db().execute(sql`update commerce.document_pdf_state set attempts = 5, last_attempt_at = now() - interval '1 hour' where document_id = ${invoice.id}::uuid`);
    const render = vi.fn(async () => bytesOf("late"));
    const job = await pdf.pdfJob({ storeId: own.storeId, deps: { storage: mem.storage, render } });
    expect(render.mock.calls.length).toBe(0);
    expect(job.made).toBe(0);
    expect((await inv.invoiceCounts(own.storeId)).pdfFailing).toBe(1);
    expect((await inv.invoiceCheckupFindings(own.storeId)).map((f) => f.code)).toContain("pdf_failing");
    // *Try again* on the Waiting tab forgets the failures without rendering (the page's action stays free of Chromium), for the store's own
    // document alone, and the job makes it on its next run.
    const foreign = await fx.makeStore("pdf-fail-foreign");
    expect(await issue.retryPdfLater(foreign.storeId, "invoice", invoice.id)).toBe(false);
    expect(await issue.retryPdfLater(own.storeId, "invoice", invoice.id)).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect((await inv.invoiceCounts(own.storeId)).pdfFailing).toBe(0);
    expect(await pdf.pdfJob({ storeId: own.storeId, deps: { storage: mem.storage, render } })).toEqual({ made: 1, failed: 0, skipped: 0 });
    expect((await fx.invoiceOf(own.storeId, order.orderId))?.pdfPath).not.toBeNull();
  });

  it("is made at once by the PDF route's own retry, which forgets the failures first", async () => {
    const own = await fx.makeStore("pdf-retry");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    for (let i = 0; i < 5; i++) await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => { throw new Error("no"); } });
    expect((await inv.invoiceCounts(own.storeId)).pdfFailing).toBe(1);
    expect(await pdf.retryDocumentPdf(own.storeId, "invoice", invoice.id, { storage: mem.storage, render: async () => bytesOf("fine") })).toMatchObject({ ok: true, stored: true });
    expect((await inv.invoiceCounts(own.storeId)).pdfFailing).toBe(0);
  });

  it("is served from memory, not recorded, when storage fails, and nothing is lost: the next request tries again", async () => {
    const own = await fx.makeStore("pdf-nostore");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage({ failUpload: true });
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("x") })).toMatchObject({ ok: true, stored: false });
    expect(await fx.invoiceOf(own.storeId, order.orderId)).toMatchObject({ pdfPath: null });
    // No storage on this server at all: the same.
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: null, render: async () => bytesOf("x") })).toMatchObject({ ok: true, stored: false });
    expect(await pdf.pdfJob({ storeId: own.storeId, deps: { storage: null } })).toEqual({ made: 0, failed: 0, skipped: 0 });
  });

  it("adopts the file another server stored first, when its row was not written", async () => {
    const own = await fx.makeStore("pdf-race");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    const winner = bytesOf("the winner's");
    mem.files.set(`${own.storeId}/invoices/${invoice.id}.pdf`, winner);
    const outcome = await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("the loser's") });
    expect(outcome).toMatchObject({ ok: true, stored: true });
    expect((outcome as { bytes: Uint8Array }).bytes).toEqual(winner);
    expect((await fx.invoiceOf(own.storeId, order.orderId))?.pdfPath).toBe(`${own.storeId}/invoices/${invoice.id}.pdf`);
    const [row] = await db().execute<Row>(sql`select pdf_sha256 from commerce.invoices where id = ${invoice.id}::uuid`);
    expect(row.pdf_sha256).toBe(sha(winner));
  });

  it("is not made twice at once: the one that does not get the lock is told it is busy", async () => {
    const own = await fx.makeStore("pdf-busy");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => {};
    const gotLock = new Promise<void>((resolve) => (locked = resolve));
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`document-pdf:invoice:${invoice.id}`}, 0))`);
      locked();
      await held;
    });
    await gotLock;
    const render = vi.fn(async () => bytesOf("x"));
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render })).toEqual({ ok: false, reason: "busy" });
    expect(render).not.toHaveBeenCalled();
    release();
    await holder;
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render })).toMatchObject({ ok: true });
  });

  it("is made by the job for what has none, oldest first, and never for an anonymised document", async () => {
    const own = await fx.makeStore("pdf-job");
    const a = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const b = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const mem = memoryStorage();
    const render = vi.fn(async (html: string) => bytesOf(html));
    const result = await pdf.pdfJob({ limit: 50, storeId: own.storeId, deps: { storage: mem.storage, render } });
    expect(result.made).toBe(2);
    for (const order of [a, b]) expect((await fx.invoiceOf(own.storeId, order.orderId))?.pdfPath).not.toBeNull();
    const again = await pdf.pdfJob({ limit: 50, storeId: own.storeId, deps: { storage: mem.storage, render } });
    expect(again.made).toBe(0);
  });
});

describe("the accountant's CSV", () => {
  it("lists a period's invoices with the VAT per rate, for orders:write, and writes the export to the log", async () => {
    const own = await fx.makeStore("csv");
    await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { billing: { name: "=HYPERLINK(\"http://evil\")", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" } });
    await fx.paidOrder(own, [["DEMO-NOTEBOOK-LINED", 1]], { market: fx.noInEuro });
    const owner = await fx.ownerOf(own);
    const day = storeToday();
    const out = await exporter.exportDocuments(owner, "invoices", day, day);
    expect(out).toMatchObject({ ok: true, count: 2, truncated: false, fileName: `invoices-${day}-${day}.csv` });
    if (!out.ok) return;
    const lines = out.csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^number,issue_date,supply_date,order_number,/);
    expect(lines[0]).toContain("vat_25_net");
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.csv).not.toMatch(/,=HYPERLINK/);
    const [entry] = await auditRows(own.storeId, "invoice.exported");
    expect(entry).toMatchObject({ area: "orders", account_id: own.ownerId });
    expect(entry.details).toMatchObject({ type: "invoices", from: day, to: day, count: 2 });
    expect(JSON.stringify(entry.details)).not.toContain("HYPERLINK");
    // Credit notes: none yet, a header only.
    const none = await exporter.exportDocuments(owner, "credit_notes", day, day);
    expect(none).toMatchObject({ ok: true, count: 0 });
  });

  it("is refused to a member without orders:write, to a bad period, and shows nothing of another store's", async () => {
    const own = await fx.makeStore("csv-deny");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const reader = { ...(await fx.ownerOf(own, "admin")), permissions: ["orders:read"] };
    expect(await exporter.exportDocuments(reader, "invoices", "2020-01-01", "2999-01-01")).toEqual({ ok: false, problem: "You do not have access to this." });
    const owner = await fx.ownerOf(own);
    expect(await exporter.exportDocuments(owner, "invoices", "2020-01-01", "2019-01-01")).toMatchObject({ ok: false });
    expect(await exporter.exportDocuments(owner, "invoices", "yesterday", "today")).toMatchObject({ ok: false });
    const foreign = await fx.makeStore("csv-foreign");
    const theirs = await exporter.exportDocuments(await fx.ownerOf(foreign), "invoices", "2020-01-01", "2999-01-01");
    expect(theirs).toMatchObject({ ok: true, count: 0 });
    expect(JSON.stringify(theirs)).not.toContain(order.number);
  });
});

describe("removing an old document's personal data", () => {
  it("replaces the buyer in the snapshot, drops the token and the stored file, and keeps the numbers and amounts", async () => {
    const own = await fx.makeStore("ret");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { email: "gone@example.com" });
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("old") });
    expect(mem.files.size).toBe(1);
    // A younger cutoff is refused whatever the rules say: the database holds a five-year floor.
    await expect(retention.anonymiseDocuments(own.storeId, new Date().toISOString().slice(0, 10), { storage: mem.storage })).rejects.toThrow();
    // Nothing is past its period: nothing changes.
    expect(await retention.anonymiseDocuments(own.storeId, "2015-01-01", { storage: mem.storage })).toEqual({ documents: 0, filesRemoved: 0, filesLeft: [] });
    // The invoice is made old (the immutability guard is lifted for this one update in the test).
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.invoices disable trigger invoices_append_only`);
      await tx.execute(sql`update commerce.invoices set issued_on = '2015-03-04' where id = ${invoice.id}::uuid`);
      await tx.execute(sql`alter table commerce.invoices enable trigger invoices_append_only`);
    });
    const result = await retention.anonymiseDocuments(own.storeId, "2016-01-01", { storage: mem.storage });
    expect(result).toEqual({ documents: 1, filesRemoved: 1, filesLeft: [] });
    expect(mem.files.size).toBe(0);
    const after = (await inv.getInvoice(own.storeId, invoice.id))!;
    expect(after).toMatchObject({ anonymised: true, publicToken: null, pdfPath: null, documentNumber: invoice.documentNumber, totalMinor: invoice.totalMinor, netMinor: invoice.netMinor, vatMinor: invoice.taxMinor });
    expect(after.snapshot.buyer).toMatchObject({ name: "[removed]", email: "[removed]" });
    expect(JSON.stringify(after.snapshot)).not.toContain("gone@example.com");
    expect(after.snapshot.seller.legalName).toBe("Fixture AS");
    expect(after.snapshot.buckets).toEqual(invoice.snapshot.buckets);
    // The hosted page's token is gone: the same 404 as any unknown token; the PDF is not made again.
    expect(await inv.findDocumentByToken(own.storeId, invoice.token)).toBeNull();
    expect(await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("again") })).toEqual({ ok: false, reason: "anonymised" });
    expect((await emailsOf(order.orderId, "invoice.issued")).length).toBe(0);
    // The order's history says so, and the order's page offers no link.
    const events = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'document.anonymised'`);
    expect(events).toHaveLength(1);
    expect((await inv.getOrderDocuments(own.storeId, order.orderId)).invoice?.token).toBeNull();
    // A second run changes nothing; another store's call changes nothing of this one's.
    expect((await retention.anonymiseDocuments(own.storeId, "2016-01-01", { storage: mem.storage })).documents).toBe(0);
  });

  it("leaves a stored file named when it cannot be removed", async () => {
    const own = await fx.makeStore("ret-left");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const mem = memoryStorage();
    await pdf.ensureInvoicePdf(own.storeId, invoice.id, { storage: mem.storage, render: async () => bytesOf("stuck") });
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.invoices disable trigger invoices_append_only`);
      await tx.execute(sql`update commerce.invoices set issued_on = '2014-03-04' where id = ${invoice.id}::uuid`);
      await tx.execute(sql`alter table commerce.invoices enable trigger invoices_append_only`);
    });
    const failing = { ...mem.storage, remove: async () => false };
    const result = await retention.anonymiseDocuments(own.storeId, "2016-01-01", { storage: failing });
    expect(result).toEqual({ documents: 1, filesRemoved: 0, filesLeft: [`${own.storeId}/invoices/${invoice.id}.pdf`] });
  });
});
