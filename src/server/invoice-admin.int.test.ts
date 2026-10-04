import { sql } from "drizzle-orm";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { FormState } from "@/components/admin/action-form";

import { addMember, auditRows, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const auth = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => auth.client }));
// The renderer is Chromium: the routes are tested with what it answers.
const pdf = vi.hoisted(() => ({ outcome: null as unknown, asked: [] as string[] }));
vi.mock("@/server/invoice-pdf", () => ({
  ensureInvoicePdf: async (_store: string, id: string) => {
    pdf.asked.push(`invoice:${id}`);
    return pdf.outcome;
  },
  ensureCreditNotePdf: async (_store: string, id: string) => {
    pdf.asked.push(`credit_note:${id}`);
    return pdf.outcome;
  },
}));

const fx = await import("./invoice-test-fixture");
const roles = await import("./store-roles");
const invoicesActions = await import("../app/admin/(gated)/[store]/invoices/actions");
const settingsActions = await import("../app/admin/(gated)/[store]/settings/invoices/actions");
const exportRoute = await import("../app/admin/(gated)/[store]/invoices/export/route");
const invoicePdfRoute = await import("../app/admin/(gated)/[store]/invoices/[invoiceId]/pdf/route");
const notePdfRoute = await import("../app/admin/(gated)/[store]/invoices/credit-notes/[creditNoteId]/pdf/route");
const invoicePrint = await import("../app/admin/(gated)/(print)/[store]/invoices/[invoiceId]/print/page");
const notePrint = await import("../app/admin/(gated)/(print)/[store]/invoices/credit-notes/[creditNoteId]/print/page");
const invoices = await import("./invoices");

type Row = Record<string, unknown>;

/**
 * The admin side of invoices (D159), against a real database and the real permission guards (a stand-in for the sign-in only): *Check again*,
 * *Try again* and *Send again* need the right to change orders; the CSV is a POST from the admin itself; the PDF and print routes need to read
 * orders; the settings are the owner's; and nothing of another store's is reachable by an id from the address.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
let ownerSub: string;
let readerSub: string;
let clerkSub: string;
let strangerSub: string;

const signInAs = (sub: string | null) => {
  auth.client = fakeSupabase(fakeAuthState({ sub }));
};

const formOf = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
};
const idle: FormState = { status: "idle", messages: [] };

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

const postExport = (slug: string, values: Record<string, string>, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) =>
  exportRoute.POST(new Request(`http://localhost/admin/${slug}/invoices/export`, { method: "POST", body: formOf(values), headers }) as never, ctx({ store: slug }));

const countOf = async (storeId: string, table: "invoices" | "credit_notes") => {
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from ${sql.raw(`commerce.${table}`)} where store_id = ${storeId}::uuid`);
  return Number(row.n);
};

beforeAll(async () => {
  store = await fx.makeStore("adm");
  other = await fx.makeStore("adm-other");
  ownerSub = await linkAuthUser(store.ownerId);
  await roles.ensureStoreRoles(store.storeId);
  const [readOnly] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.storeId}::uuid and template = 'read_only'`);
  const [orders] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.storeId}::uuid and template = 'orders'`);
  const reader = await makeAccount("reader");
  readerSub = await linkAuthUser(reader.id);
  await addMember(store.storeId, reader.id, "admin", { roleId: String(readOnly.id) });
  const clerk = await makeAccount("clerk");
  clerkSub = await linkAuthUser(clerk.id);
  await addMember(store.storeId, clerk.id, "admin", { roleId: String(orders.id) });
  const stranger = await makeAccount("stranger");
  strangerSub = await linkAuthUser(stranger.id);
  await addMember(other.storeId, stranger.id, "owner");
});

beforeEach(() => {
  signInAs(ownerSub);
  pdf.asked = [];
  pdf.outcome = null;
});

afterAll(async () => {
  await closeDb();
});

describe("Check again", () => {
  it("issues the invoice of an order that waited for the seller's details, once they are given, and says so", async () => {
    const waitingStore = await fx.makeStore("adm-wait", { sellerDetails: false });
    const sub = await linkAuthUser(waitingStore.ownerId);
    signInAs(sub);
    const order = await fx.paidOrder(waitingStore, [["DEMO-MUG-WHITE", 1]]);
    expect(await fx.invoiceOf(waitingStore.storeId, order.orderId)).toBeNull();
    expect((await invoices.waitingInvoices(waitingStore.storeId)).map((w) => w.reason)).toEqual(["seller_details"]);
    // Nothing is made while the cause stays.
    expect(await invoicesActions.checkAgainAction(waitingStore.slug)).toEqual({ status: "ok", messages: ["Nothing new could be issued. What still waits is listed here with the reason."] });
    await db().execute(sql`update commerce.stores set legal_name = 'Fixture AS', organisation_number = '923456789', postal_address = 'Storgata 1\n0155 Oslo', country = 'NO' where id = ${waitingStore.storeId}::uuid`);
    const result = await invoicesActions.checkAgainAction(waitingStore.slug);
    expect(result).toEqual({ status: "ok", messages: ["1 invoice issued."] });
    const invoice = await fx.invoiceOf(waitingStore.storeId, order.orderId);
    expect(invoice).not.toBeNull();
    // The payment day is the day of supply; the invoice is dated the day it was issued.
    expect(invoice!.supplyDate).toBeTruthy();
    expect(await invoices.waitingInvoices(waitingStore.storeId)).toEqual([]);
  });

  it("is for members who may change orders: a read-only member and a stranger are refused, and nothing is issued", async () => {
    const waitingStore = await fx.makeStore("adm-refuse", { sellerDetails: false });
    const reader = await makeAccount("reader2");
    const sub = await linkAuthUser(reader.id);
    const [readOnly] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.storeId}::uuid and template = 'read_only'`);
    await roles.ensureStoreRoles(waitingStore.storeId);
    const [own] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${waitingStore.storeId}::uuid and template = 'read_only'`);
    expect(readOnly.id).not.toBe(own.id);
    await addMember(waitingStore.storeId, reader.id, "admin", { roleId: String(own.id) });
    await fx.paidOrder(waitingStore, [["DEMO-MUG-WHITE", 1]]);
    await db().execute(sql`update commerce.stores set legal_name = 'Fixture AS', organisation_number = '923456789', postal_address = 'Storgata 1\n0155 Oslo', country = 'NO' where id = ${waitingStore.storeId}::uuid`);
    signInAs(sub);
    expect(await invoicesActions.checkAgainAction(waitingStore.slug)).toEqual({ status: "error", messages: ["You do not have access to this."] });
    signInAs(strangerSub);
    expect(await invoicesActions.checkAgainAction(waitingStore.slug)).toEqual({ status: "error", messages: ["You do not have access to this."] });
    signInAs(null);
    expect(await invoicesActions.checkAgainAction(waitingStore.slug)).toEqual({ status: "error", messages: ["You do not have access to this."] });
    expect(await countOf(waitingStore.storeId, "invoices")).toBe(0);
  });

  it("lets a member with the Orders role press it", async () => {
    signInAs(clerkSub);
    expect((await invoicesActions.checkAgainAction(store.slug)).status).toBe("ok");
  });
});

describe("Try again for a PDF that could not be made", () => {
  let invoiceId: string;

  beforeAll(async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    invoiceId = (await fx.invoiceOf(store.storeId, order.orderId))!.id;
    await db().execute(sql`
      insert into commerce.document_pdf_state (store_id, document_type, document_id, attempts, last_attempt_at, last_error)
      values (${store.storeId}::uuid, 'invoice', ${invoiceId}::uuid, ${invoices.PDF_ATTEMPTS}, now(), 'Chromium could not start')
    `);
  });

  it("lists the document on the Waiting tab's read and counts it", async () => {
    const failing = await invoices.failingPdfs(store.storeId);
    expect(failing).toEqual([expect.objectContaining({ type: "invoice", id: invoiceId, attempts: invoices.PDF_ATTEMPTS, lastError: "Chromium could not start" })]);
    expect((await invoices.invoiceCounts(store.storeId)).pdfFailing).toBe(1);
    expect(await invoices.failingPdfs(other.storeId)).toEqual([]);
  });

  it("is refused to a read-only member and to another store's owner, and forgets the failures for an owner", async () => {
    signInAs(readerSub);
    expect(await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "invoice", id: invoiceId }))).toMatchObject({ status: "error", messages: ["You do not have access to this."] });
    signInAs(strangerSub);
    expect(await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "invoice", id: invoiceId }))).toMatchObject({ status: "error" });
    // Another store's owner cannot reset it through their own store either: the document is looked up by that store's id.
    expect(await invoicesActions.retryPdfAction(other.slug, idle, formOf({ type: "invoice", id: invoiceId }))).toMatchObject({ status: "error", messages: ["This document has no failed tries to forget."] });
    expect((await invoices.failingPdfs(store.storeId)).length).toBe(1);
    signInAs(ownerSub);
    expect((await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "invoice", id: invoiceId }))).status).toBe("ok");
    expect(await invoices.failingPdfs(store.storeId)).toEqual([]);
    // Nothing left to forget the second time.
    expect((await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "invoice", id: invoiceId }))).status).toBe("error");
  });

  it("refuses an id or a kind it cannot read", async () => {
    expect(await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "invoice", id: "not-an-id" }))).toMatchObject({ status: "error", messages: ["This document no longer exists."] });
    expect(await invoicesActions.retryPdfAction(store.slug, idle, formOf({ type: "order", id: invoiceId }))).toMatchObject({ status: "error", messages: ["This document no longer exists."] });
  });
});

describe("Send again", () => {
  it("sends the invoice, and then a credit note, to the order's own address, and writes each to the order's history", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 2]], { email: "again@example.com" });
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    const sent = await invoicesActions.sendDocumentAgainAction(store.slug, "invoice", invoice.id);
    expect(sent.status).toBe("ok");
    expect(sent.messages[0]).toBe("The invoice was sent to the order's email address.");
    const events = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'invoice.emailed'`);
    expect(events).toHaveLength(1);
    const mails = await db().execute<Row>(sql`select to_address from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${order.orderId}::uuid and kind = 'invoice.issued'`);
    expect(mails.map((m) => m.to_address)).toEqual(["again@example.com"]);
    // A credit note, from a refund that succeeded (the database issues it when the refund is recorded).
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${order.orderId}::uuid`);
    await db().execute(sql`insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values (${store.storeId}::uuid, ${String(payment.id)}::uuid, 1000, 'x', ${`re_adm_${order.orderId}`}, 'succeeded')`);
    const [creditNote] = await fx.notesOf(store.storeId, order.orderId);
    const again = await invoicesActions.sendDocumentAgainAction(store.slug, "credit_note", creditNote.id);
    expect(again).toEqual({ status: "ok", messages: ["The credit note was sent to the order's email address."] });
    const noteEvents = await db().execute<Row>(sql`select 1 from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'credit_note.emailed'`);
    expect(noteEvents).toHaveLength(1);
  });

  it("is refused to a member who may only read, and for a document that is not the store's or not a document", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    signInAs(readerSub);
    expect(await invoicesActions.sendDocumentAgainAction(store.slug, "invoice", invoice.id)).toEqual({ status: "error", messages: ["You do not have access to this."] });
    signInAs(strangerSub);
    // The stranger owns another store: the document is not found there.
    expect((await invoicesActions.sendDocumentAgainAction(other.slug, "invoice", invoice.id)).status).toBe("error");
    expect(await invoicesActions.sendDocumentAgainAction(store.slug, "invoice", invoice.id)).toMatchObject({ status: "error" });
    signInAs(ownerSub);
    expect(await invoicesActions.sendDocumentAgainAction(store.slug, "invoice", "nope")).toEqual({ status: "error", messages: ["This document no longer exists."] });
    expect(await invoicesActions.sendDocumentAgainAction(store.slug, "receipt", invoice.id)).toEqual({ status: "error", messages: ["This document no longer exists."] });
    expect(await invoicesActions.sendDocumentAgainAction(store.slug, "invoice", crypto.randomUUID())).toMatchObject({ status: "error" });
    const events = await db().execute<Row>(sql`select 1 from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'invoice.emailed'`);
    expect(events).toHaveLength(0);
  });
});

describe("the CSV for the accountant", () => {
  let invoiceNumber: string;

  beforeAll(async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { billing: { name: "=1+1 Kari", line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" } });
    invoiceNumber = (await fx.invoiceOf(store.storeId, order.orderId))!.documentNumber;
  });

  const day = new Date().toISOString().slice(0, 10);

  it("is a download of the period's invoices from the admin itself, for members who may change orders, and is written to the log", async () => {
    const response = await postExport(store.slug, { type: "invoices", from: `${day.slice(0, 7)}-01`, to: "2099-12-31" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="invoices-\d{4}-\d{2}-\d{2}-2099-12-31\.csv"$/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A byte order mark first, so a spreadsheet reads the file as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    expect(body).toContain(invoiceNumber);
    // A name that would be a formula in a spreadsheet is made safe.
    expect(body).not.toMatch(/(^|,)=1\+1 Kari/m);
    expect(body).toContain("'=1+1 Kari");
    const rows = await auditRows(store.storeId, "invoice.exported");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ area: "orders" });
    expect(JSON.stringify(rows[0].details)).not.toContain("Kari");
  });

  it("gives the credit notes of a period as their own file", async () => {
    const response = await postExport(store.slug, { type: "credit_notes", from: "2020-01-01", to: "2099-12-31" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("credit-notes-2020-01-01-2099-12-31.csv");
  });

  it("is a 404 for a read-only member, a stranger and nobody signed in, and a 403 from another site", async () => {
    for (const sub of [readerSub, strangerSub, null]) {
      signInAs(sub);
      expect((await postExport(store.slug, { type: "invoices", from: "2020-01-01", to: "2099-12-31" })).status).toBe(404);
    }
    signInAs(ownerSub);
    expect((await postExport(store.slug, { type: "invoices", from: "2020-01-01", to: "2099-12-31" }, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
  });

  it("sends the person back with a code, not a file, for a period it cannot read", async () => {
    const response = await postExport(store.slug, { type: "invoices", from: "2026-10-10", to: "2026-10-01" });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(`/admin/${store.slug}/invoices`);
    expect(location.searchParams.get("export")).toBe("period");
    const notes = await postExport(store.slug, { type: "credit_notes", from: "nope", to: "2026-10-01" });
    expect(new URL(notes.headers.get("location")!).searchParams.get("tab")).toBe("credit-notes");
  });

  it("never reaches another store's documents: the file holds only this store's invoices", async () => {
    const foreign = await fx.paidOrder(other, [["DEMO-MUG-WHITE", 1]], { billing: { name: "Foreign Buyer", line1: "Elsewhere 1", postalCode: "0001", city: "Oslo", country: "NO" } });
    expect((await fx.invoiceOf(other.storeId, foreign.orderId))!.documentNumber).toMatch(/^F-/);
    const body = await (await postExport(store.slug, { type: "invoices", from: "2020-01-01", to: "2099-12-31" })).text();
    // The two stores' series both start at F-1 and their order numbers at 1001: the buyer's name is the tell.
    expect(body).not.toContain("Foreign Buyer");
    expect(body).toContain("Kari Nordmann");
  });
});

describe("the PDF routes", () => {
  let invoiceId: string;
  let creditNoteId: string | null = null;

  beforeAll(async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    invoiceId = (await fx.invoiceOf(store.storeId, order.orderId))!.id;
    creditNoteId = null;
  });

  const get = (route: (request: Request, context: never) => Promise<Response>, slug: string, params: Record<string, string>) =>
    route(new Request(`http://localhost/admin/${slug}/invoices/x/pdf`), ctx({ store: slug, ...params }));

  it("serves the file as a download that is never cached, to a member who may read orders", async () => {
    pdf.outcome = { ok: true, bytes: new TextEncoder().encode("%PDF-1.7 fake"), stored: true, fileName: "F-1" };
    signInAs(readerSub);
    const response = await get(invoicePdfRoute.GET, store.slug, { invoiceId });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="F-1.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("%PDF-1.7 fake");
    expect(pdf.asked).toEqual([`invoice:${invoiceId}`]);
  });

  it("sends staff to the printable view when the renderer is busy or fails, and nothing else is lost", async () => {
    for (const reason of ["busy", "render_failed"]) {
      pdf.outcome = { ok: false, reason };
      const response = await get(invoicePdfRoute.GET, store.slug, { invoiceId });
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search).toBe(`/admin/${store.slug}/invoices/${invoiceId}/print?auto=1`);
    }
  });

  it("is a 404 for a document that does not exist or is anonymised, and for an id that is not one", async () => {
    pdf.outcome = { ok: false, reason: "not_found" };
    expect((await get(invoicePdfRoute.GET, store.slug, { invoiceId: crypto.randomUUID() })).status).toBe(404);
    pdf.outcome = { ok: false, reason: "anonymised" };
    expect((await get(invoicePdfRoute.GET, store.slug, { invoiceId })).status).toBe(404);
    pdf.asked = [];
    expect((await get(invoicePdfRoute.GET, store.slug, { invoiceId: "nope" })).status).toBe(404);
    expect(pdf.asked).toEqual([]);
  });

  it("is not reachable by a stranger or without signing in: the guard comes before the renderer", async () => {
    pdf.outcome = { ok: true, bytes: new Uint8Array([1]), stored: true, fileName: "F-1" };
    for (const sub of [strangerSub, null]) {
      signInAs(sub);
      await expect(get(invoicePdfRoute.GET, store.slug, { invoiceId })).rejects.toThrow(/NEXT_NOT_FOUND|REDIRECT/);
    }
    expect(pdf.asked).toEqual([]);
  });

  it("serves a credit note's file the same way, from the same routes' sibling", async () => {
    pdf.outcome = { ok: true, bytes: new TextEncoder().encode("%PDF note"), stored: false, fileName: "K-1" };
    creditNoteId = crypto.randomUUID();
    const response = await get(notePdfRoute.GET, store.slug, { creditNoteId });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="K-1.pdf"');
    expect(pdf.asked).toEqual([`credit_note:${creditNoteId}`]);
    pdf.outcome = { ok: false, reason: "busy" };
    const busy = await get(notePdfRoute.GET, store.slug, { creditNoteId });
    expect(new URL(busy.headers.get("location")!).pathname).toBe(`/admin/${store.slug}/invoices/credit-notes/${creditNoteId}/print`);
  });
});

describe("the printable views", () => {
  const props = (slug: string, key: string, id: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ store: slug, [key]: id }), searchParams: Promise.resolve(search) }) as never;

  it("draws an invoice from its snapshot with the document's number, in the order's language, and nothing of another store's", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { billing: { name: "Kari Nordmann", line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" } });
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    const html = renderToString(await invoicePrint.default(props(store.slug, "invoiceId", invoice.id)));
    expect(html).toContain(invoice.documentNumber);
    expect(html).toContain("Fixture AS");
    expect(html).toContain("Kari Nordmann");
    expect(html).toContain("Back to the invoices");
    // Another store's owner cannot open it through their own store, and a made-up id is a 404.
    signInAs(strangerSub);
    await expect(invoicePrint.default(props(other.slug, "invoiceId", invoice.id))).rejects.toThrow("NEXT_NOT_FOUND");
    signInAs(ownerSub);
    await expect(invoicePrint.default(props(store.slug, "invoiceId", crypto.randomUUID()))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(invoicePrint.default(props(store.slug, "invoiceId", "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("needs the right to read orders", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    signInAs(readerSub);
    expect(renderToString(await invoicePrint.default(props(store.slug, "invoiceId", invoice.id)))).toContain(invoice.documentNumber);
    signInAs(null);
    await expect(invoicePrint.default(props(store.slug, "invoiceId", invoice.id))).rejects.toThrow(/REDIRECT|NEXT_NOT_FOUND/);
  });

  it("says an anonymised invoice has no buyer left, instead of drawing it", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(store.storeId, order.orderId))!;
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.invoices disable trigger user`);
      await tx.execute(sql`update commerce.invoices set anonymised_at = now(), public_token = null where id = ${invoice.id}::uuid`);
      await tx.execute(sql`alter table commerce.invoices enable trigger user`);
    });
    const html = renderToString(await invoicePrint.default(props(store.slug, "invoiceId", invoice.id)));
    expect(html).toContain("This invoice has been anonymised");
    expect(html).not.toContain("Kari Nordmann");
  });

  it("has a credit note's view that refuses what is not the store's", async () => {
    await expect(notePrint.default(props(store.slug, "creditNoteId", crypto.randomUUID()))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(notePrint.default(props(store.slug, "creditNoteId", "nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the invoicing settings", () => {
  it("are saved by an owner, the activity log names what changed and never the note, and the switch's day is the database's", async () => {
    const owner = await fx.makeStore("adm-set");
    signInAs(await linkAuthUser(owner.ownerId));
    const saved = await settingsActions.saveInvoiceSettingsAction(owner.slug, idle, formOf({ footerNote: "Bank: 1234.56.78901", enabled: "on" }));
    expect(saved).toEqual({ status: "ok", messages: ["Saved. Invoices are made for orders paid from now on."] });
    // A ticked box is on and an absent one is off: the email option was not ticked.
    const { getInvoiceSettings } = await import("./invoice-settings");
    expect(await getInvoiceSettings(owner.storeId)).toMatchObject({ enabled: true, footerNote: "Bank: 1234.56.78901", emailWithConfirmation: false, saved: true });
    const rows = await auditRows(owner.storeId, "invoice.settings_updated");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].details)).not.toContain("1234");
    // Switched off: no new orders are invoiced, and the page says so.
    const off = await settingsActions.saveInvoiceSettingsAction(owner.slug, idle, formOf({ footerNote: "" }));
    expect(off).toEqual({ status: "ok", messages: ["Saved. New orders get no invoice."] });
    expect((await getInvoiceSettings(owner.storeId)).enabled).toBe(false);
    const order = await fx.paidOrder(owner, [["DEMO-MUG-WHITE", 1]]);
    expect(await fx.invoiceOf(owner.storeId, order.orderId)).toBeNull();
    expect((await invoices.getOrderDocuments(owner.storeId, order.orderId)).eligibility).toBe("disabled");
  });

  it("refuse a note that is too long, with the problem said", async () => {
    const result = await settingsActions.saveInvoiceSettingsAction(store.slug, idle, formOf({ footerNote: "x".repeat(1001), enabled: "on" }));
    expect(result).toMatchObject({ status: "error", messages: [expect.stringContaining("1000")] });
  });

  it("are the owner's alone: a member with a role, a read-only member and a stranger are refused, and nothing changes", async () => {
    for (const sub of [clerkSub, readerSub, strangerSub, null]) {
      signInAs(sub);
      expect(await settingsActions.saveInvoiceSettingsAction(store.slug, idle, formOf({ footerNote: "Hacked", enabled: "on" }))).toEqual({ status: "error", messages: ["You do not have access to this."] });
      expect(await settingsActions.setSeriesAction(store.slug, idle, formOf({ series: "invoice", prefix: "X-", nextNumber: "500" }))).toEqual({ status: "error", messages: ["You do not have access to this."] });
    }
    const { getInvoiceSettings, seriesStates } = await import("./invoice-settings");
    expect((await getInvoiceSettings(store.storeId)).footerNote).not.toBe("Hacked");
    expect((await seriesStates(store.storeId))[0].prefix).not.toBe("X-");
  });

  it("set a series' prefix and first number before its first document, and refuse after", async () => {
    const fresh = await fx.makeStore("adm-series");
    signInAs(await linkAuthUser(fresh.ownerId));
    const ok = await settingsActions.setSeriesAction(fresh.slug, idle, formOf({ series: "invoice", prefix: "INV/", nextNumber: "250" }));
    expect(ok).toEqual({ status: "ok", messages: ["Saved."] });
    const { seriesStates } = await import("./invoice-settings");
    expect((await seriesStates(fresh.storeId))[0]).toMatchObject({ prefix: "INV/", nextNumber: 250, nextDocumentNumber: "INV/250", locked: false });
    expect((await auditRows(fresh.storeId, "invoice.series_set"))).toHaveLength(1);
    expect(await settingsActions.setSeriesAction(fresh.slug, idle, formOf({ series: "invoice", prefix: "bad prefix!", nextNumber: "1" }))).toMatchObject({ status: "error" });
    expect(await settingsActions.setSeriesAction(fresh.slug, idle, formOf({ series: "invoice", prefix: "F-", nextNumber: "0" }))).toMatchObject({ status: "error" });
    expect(await settingsActions.setSeriesAction(fresh.slug, idle, formOf({ series: "order", prefix: "F-", nextNumber: "1" }))).toMatchObject({ status: "error" });
    const order = await fx.paidOrder(fresh, [["DEMO-MUG-WHITE", 1]]);
    expect((await fx.invoiceOf(fresh.storeId, order.orderId))!.documentNumber).toBe("INV/250");
    // Once the first document is issued the numbers are locked.
    const locked = await settingsActions.setSeriesAction(fresh.slug, idle, formOf({ series: "invoice", prefix: "F-", nextNumber: "1" }));
    expect(locked).toEqual({ status: "error", messages: ["Numbers already issued cannot be changed."] });
    expect((await seriesStates(fresh.storeId))[0]).toMatchObject({ prefix: "INV/", nextNumber: 251, locked: true, issued: 1 });
  });
});
