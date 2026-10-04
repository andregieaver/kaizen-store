import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor } from "@/lib/control-center";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const inv = await import("./invoices");
const issue = await import("./invoice-issue");
const ownerTools = await import("./owner-tools");
const center = await import("./control-center");

type Row = Record<string, unknown>;

/**
 * The AI manager's invoice tools (D159, docs 5.5) and the control center's invoice item, against a real database: answers come from the store's
 * own documents, amounts are written by `formatMoney` and added in code per currency, no buyer's name, address or email is ever in an answer,
 * another store's documents are never seen, a store with nothing says what is missing and never zero as if it knew, and what waits is the owner's.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
let bare: Awaited<ReturnType<typeof fx.makeStore>>;
let waitingStore: Awaited<ReturnType<typeof fx.makeStore>>;
let orders: Awaited<ReturnType<typeof fx.paidOrder>>[] = [];

const ctxOf = async (f: typeof store) => {
  const m = await fx.ownerOf(f);
  return { account: m.account, store: m.store, invalidate: () => {} };
};
const run = async (f: typeof store, name: string, input: unknown = {}) => (await ownerTools.runOwnerTool(await ctxOf(f), name, input)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  store = await fx.makeStore("tool");
  other = await fx.makeStore("tool-other");
  bare = await fx.makeStore("tool-bare");
  waitingStore = await fx.makeStore("tool-wait", { sellerDetails: false });
  orders = [
    await fx.paidOrder(store, [["DEMO-MUG-WHITE", 2]]),
    await fx.paidOrder(store, [["DEMO-NOTEBOOK-LINED", 1]], { market: fx.noInEuro }),
  ];
  await fx.paidOrder(other, [["DEMO-MUG-WHITE", 5]]);
  // A refund of the first order that succeeded: a credit note follows.
  const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${orders[0].orderId}::uuid`);
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
    values (${store.storeId}::uuid, ${String(payment.id)}::uuid, 1000, 'Kunden ombestemte seg', 're_tool1', 'succeeded')
  `);
  // Two orders that cannot be invoiced yet: the seller's details are missing.
  await fx.paidOrder(waitingStore, [["DEMO-MUG-WHITE", 1]]);
  await fx.paidOrder(waitingStore, [["DEMO-MUG-WHITE", 2]]);
});

afterAll(async () => {
  await closeDb();
});

describe("list_invoices", () => {
  it("lists the store's invoices with amounts in each order's currency and totals added in code per currency", async () => {
    const result = await run(store, "list_invoices");
    expect(result.count).toBe(2);
    expect(result.documents).toHaveLength(2);
    const currencies = new Set(result.documents.map((d: { total: string }) => d.total.replace(/[\d\s., ]/g, "")));
    expect(currencies.size).toBeGreaterThan(0);
    const first = await fx.invoiceOf(store.storeId, orders[0].orderId);
    const row = result.documents.find((d: { number: string }) => d.number === first!.documentNumber);
    expect(row).toMatchObject({ type: "invoice", order: orders[0].number, treatment: "VAT charged", buyer_country: "NO", pdf_stored: false });
    // One total per currency (the second order was bought in euro: its invoice is in the order's own currency).
    expect(result.totals_of_those_shown.length).toBe(new Set([orders[0].currency, orders[1].currency]).size);
    expect(result.page).toBe(`/admin/${store.slug}/invoices`);
  });

  it("never gives a buyer's name, address or email, and never another store's documents", async () => {
    const text = JSON.stringify(await run(store, "list_invoices", { limit: 50 })) + JSON.stringify(await run(store, "list_invoices", { which: "credit_notes" })) + JSON.stringify(await run(store, "list_invoices", { which: "waiting" }));
    expect(text).not.toMatch(/Kari|Nordmann|Kirkeveien|@example\.com|0368/);
    // The other store has one invoice of its own (five mugs); this store's list holds exactly its two.
    const [theirs] = await db().execute<Row>(sql`select total_minor from commerce.invoices where store_id = ${other.storeId}::uuid`);
    expect(Number(theirs.total_minor)).toBeGreaterThan(0);
    expect((await run(store, "list_invoices", { limit: 50 })).count).toBe(2);
    expect((await run(other, "list_invoices", { limit: 50 })).count).toBe(1);
  });

  it("finds one by its number or order number, by period, and refuses an email address", async () => {
    const first = await fx.invoiceOf(store.storeId, orders[0].orderId);
    const byOrder = await run(store, "list_invoices", { search: orders[0].number });
    expect(byOrder.documents.map((d: { number: string }) => d.number)).toEqual([first!.documentNumber]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await run(store, "list_invoices", { from: today, to: today })).count).toBe(2);
    expect((await run(store, "list_invoices", { from: "2020-01-01", to: "2020-12-31" })).count).toBe(0);
    await expect(run(store, "list_invoices", { search: orders[0].email })).rejects.toThrow(/email address/);
    await expect(run(store, "list_invoices", { from: "2026-10-31", to: "2026-10-01" })).rejects.toThrow(/after/);
  });

  it("lists credit notes with the invoice they credit", async () => {
    const result = await run(store, "list_invoices", { which: "credit_notes" });
    const first = await fx.invoiceOf(store.storeId, orders[0].orderId);
    expect(result.count).toBe(1);
    expect(result.documents[0]).toMatchObject({ type: "credit_note", order: orders[0].number, credits_invoice: first!.documentNumber });
    expect(result.documents[0].number).toMatch(/^K-/);
  });

  it("says what waits and why, with the page that fixes it, and the sum added in code", async () => {
    const result = await run(waitingStore, "list_invoices", { which: "waiting" });
    expect(result.invoices_waiting).toBe(2);
    expect(result.overdue).toBe(0);
    expect(result.waiting_total).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ treatment: "VAT charged", fix_at: `/admin/${waitingStore.slug}/settings/company` });
    expect(result.orders[0].why_it_waits).toMatch(/business details/);
    expect((await run(store, "list_invoices", { which: "waiting" })).invoices_waiting).toBe(0);
  });

  it("says plainly that a store with nothing has nothing, not an invented figure", async () => {
    const result = await run(bare, "list_invoices");
    expect(result).toMatchObject({ count: 0, shown: 0, documents: [], totals_of_those_shown: [] });
    expect((await run(bare, "list_invoices", { which: "credit_notes" })).count).toBe(0);
    expect(await run(bare, "list_invoices", { which: "waiting" })).toMatchObject({ invoices_waiting: 0, orders: [], credit_notes_to_check: [] });
  });
});

describe("invoice_readiness", () => {
  it("says a ready store is ready, with its series and counts", async () => {
    const result = await run(store, "invoice_readiness");
    expect(result).toMatchObject({ invoicing_on: true, ready_to_issue: true, missing: [], tax_profile_saved: true, registered_for_vat: true, invoices_issued: 2, credit_notes_issued: 1, invoices_waiting: 0 });
    expect(result.series).toEqual([
      expect.objectContaining({ series: "invoices", issued: 2, locked: true, next_number: "F-3" }),
      expect.objectContaining({ series: "credit notes", issued: 1, locked: true, next_number: "K-2" }),
    ]);
    expect(result.settings_page).toBe(`/admin/${store.slug}/settings/invoices`);
    expect(result.note).toMatch(/not tax or accounting advice/);
  });

  it("names each missing detail with its page, and the waiting count", async () => {
    const result = await run(waitingStore, "invoice_readiness");
    expect(result.ready_to_issue).toBe(false);
    expect(result.missing.map((m: { what: string }) => m.what)).toEqual(expect.arrayContaining(["the legal name", "the postal address", "the organisation number", "the country"]));
    for (const m of result.missing) expect(m.fix_at).toBe(`/admin/${waitingStore.slug}/settings/company`);
    expect(result.invoices_waiting).toBe(2);
  });

  it("says when invoicing is off, and when the tax profile is not saved", async () => {
    const off = await fx.makeStore("tool-off", { invoicing: false, registered: null });
    const result = await run(off, "invoice_readiness");
    expect(result).toMatchObject({ invoicing_on: false, tax_profile_saved: false, tax_profile_page: `/admin/${off.slug}/settings/tax`, ready_to_issue: false });
  });
});

describe("the store checkup and the control center", () => {
  it("lists what waits in the store checkup, with the Invoices page", async () => {
    const checkup = await run(waitingStore, "store_checkup");
    expect(checkup.findings.some((f: { what: string; page: string }) => /waiting for an invoice/.test(f.what) && f.page === `/admin/${waitingStore.slug}/invoices`)).toBe(true);
    expect(checkup.findings.some((f: { what: string }) => /invoice/i.test(f.what))).toBe(true);
  });

  it("counts what waits for stores in one call, leaves out a store with nothing waiting, and costs nothing for none", async () => {
    const found = await inv.invoiceAttention([store.storeId, other.storeId, bare.storeId, waitingStore.storeId]);
    expect([...found.keys()]).toEqual([waitingStore.storeId]);
    expect(found.get(waitingStore.storeId)).toEqual({ waiting: 2, overdue: 0 });
    expect((await inv.invoiceAttention([])).size).toBe(0);
  });

  it("is in the owner's control center, and goes once the job has issued the invoices", async () => {
    const member = await fx.ownerOf(waitingStore);
    const before = await center.controlCenter(member.account);
    const figures = before.stores.find((s) => s.slug === waitingStore.slug)!;
    expect(figures.invoices).toEqual({ waiting: 2, overdue: 0 });
    expect(attentionFor([figures]).map((i) => i.text)).toContain(`${figures.name}: 2 paid orders are waiting for an invoice.`);
    // The owner fills in the details; the job issues what waited, and the item is gone.
    await db().execute(sql`
      update commerce.stores set legal_name = 'Fixture AS', organisation_number = '923456789', postal_address = 'Storgata 1\n0155 Oslo', country = 'NO' where id = ${waitingStore.storeId}::uuid
    `);
    expect(await issue.issueWaitingInvoices(waitingStore.storeId)).toBe(2);
    const after = await center.controlCenter(member.account);
    expect(after.stores.find((s) => s.slug === waitingStore.slug)!.invoices).toBeUndefined();
  });

  it("shows a member who is not an owner nothing of it", async () => {
    const staff = await fx.makeStore("tool-staff", { sellerDetails: false });
    await fx.paidOrder(staff, [["DEMO-MUG-WHITE", 1]]);
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`staff-${staff.slug}@example.com`}, 'Staff') returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${staff.storeId}::uuid, ${String(account.id)}::uuid, 'admin')`);
    const member = { ...(await fx.ownerOf(staff, "admin")), account: { id: String(account.id), email: `staff-${staff.slug}@example.com`, name: "Staff", platformAdmin: false } };
    const result = await center.controlCenter(member.account);
    expect(result.stores.find((s) => s.slug === staff.slug)!.invoices).toBeUndefined();
  });
});
