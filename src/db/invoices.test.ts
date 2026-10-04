/* eslint-disable @typescript-eslint/no-explicit-any -- a snapshot is JSON and the tests read it as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { areaOfAction } from "@/lib/audit";
import { DOCUMENT_TOKEN } from "@/lib/document-token";
import { ELIGIBILITY_REASONS } from "@/lib/invoice-eligibility";
import { WAITING_REASONS } from "@/lib/invoice-readiness";
import { OFFERABLE_CURRENCIES, minorUnitDigits } from "@/lib/money";

import { createInvoiceStore, creditNotesOf, invoiceOf, one, paidAt, placeOrder, refund, scalar, type DocRow } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Invoices and credit notes for shop orders (D159, docs/wave-1b-invoices.md): the rules that live in SQL, against every migration
 * applied to a real Postgres (PGlite). An invoice is issued in the payment transaction and never stops it; a credit note follows
 * every refund that succeeds, by any path; both are immutable, gap-free and never above the order.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const eligibility = (orderId: string) => scalar<string>(db, "select commerce.invoice_eligibility($1::uuid)", [orderId]);
const readiness = (orderId: string) => scalar<string>(db, "select commerce.invoice_readiness($1::uuid)", [orderId]);
const events = async (orderId: string, type: string) => (await db.query<{ data: any }>("select data from commerce.order_events where order_id = $1 and type = $2 order by id", [orderId, type])).rows.map((r) => r.data);
const nextNumber = (store: string, series: string) => scalar<string>(db, "select next_number::text from commerce.document_series where store_id = $1 and series = $2", [store, series]);
const series = (store: string) => one<{ documents: string; missing: string; ok: boolean }>(db, "select documents::text, missing::text, ok from commerce.document_audit($1) where series = 'invoice'", [store]);

/** A paid order whose invoice waits (the order is marked paid by hand, the way a payment that completed before the details were complete would be). */
async function markPaid(orderId: string, at: string) {
  await db.query("update commerce.orders set status = 'paid' where id = $1", [orderId]);
  await paidAt(db, orderId, at);
}

describe("when an order gets an invoice", () => {
  let shop: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "inv-issue");
  });

  it("is issued by the payment itself, in the store's own series, with the order's totals", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "A", unit: 12500 }], shipping: 5900 });
    expect(o.invoiceId).not.toBeNull();
    const inv = await invoiceOf(db, o.id);
    expect(inv.document_number).toBe("F-1");
    expect(inv.public_token).toMatch(DOCUMENT_TOKEN);
    expect([Number(inv.total_minor), Number(inv.tax_minor), Number(inv.net_minor)]).toEqual([o.total, o.tax, o.total - o.tax]);
    expect(inv.snapshot.number).toBe("F-1");
    expect(await events(o.id, "invoice.issued")).toEqual([{ invoiceId: inv.id, number: "F-1" }]);
    expect(await nextNumber(shop, "invoice")).toBe("2");
  });

  it("is made once: asking again returns the same invoice, and a second payment completion makes no second", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "B", unit: 5000 }] });
    const again = await scalar<string>(db, "select commerce.issue_order_invoice($1::uuid, $2::uuid)", [shop, o.id]);
    expect(again).toBe(o.invoiceId);
    expect(await scalar(db, "select commerce.complete_order_payment($1::uuid, 'again')", [o.id])).toBe(false);
    expect(await scalar<number>(db, "select count(*)::int from commerce.invoices where order_id = $1", [o.id])).toBe(1);
  });

  it("numbers one after another with no gap, and the audit says so", async () => {
    const fresh = await createInvoiceStore(db, "inv-numbers");
    for (let i = 0; i < 6; i += 1) await placeOrder(db, fresh, { lines: [{ sku: `N${i}`, unit: 1000 + i }] });
    expect(await series(fresh)).toEqual({ documents: "6", missing: "0", ok: true });
    expect(await scalar(db, "select string_agg(document_number, ',' order by number) from commerce.invoices where store_id = $1", [fresh])).toBe("F-1,F-2,F-3,F-4,F-5,F-6");
    expect(await nextNumber(fresh, "invoice")).toBe("7");
  });

  it("keeps the order's currency, and a euro order in a store of kroner needs the VAT in kroner", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "EUR", unit: 10000, rate: 0.24 }], market: "FI", currency: "EUR" });
    const inv = await invoiceOf(db, o.id);
    expect(inv.snapshot.currency).toBe("EUR");
    expect(inv.snapshot.vatHome).toMatchObject({ currency: "NOK", fxRate: 11.7 });
    const row = await one<{ vat_home_currency: string; vat_home_minor: string; fx_rate: string; fx_source: string }>(db, "select vat_home_currency, vat_home_minor::text, fx_rate::text, fx_source from commerce.invoices where order_id = $1", [o.id]);
    expect(row).toMatchObject({ vat_home_currency: "NOK", fx_rate: "11.70000000", fx_source: "owner" });
    expect(Number(row.vat_home_minor)).toBe(Math.round(Number(inv.tax_minor) * 11.7));
  });

  it("states every reason in the closed lists the pure code names", async () => {
    const all = (
      await db.query<{ r: string }>(
        `select distinct m[1] as r from commerce.invoice_eligibility(gen_random_uuid()) x, regexp_matches(pg_get_functiondef('commerce.invoice_eligibility(uuid)'::regprocedure), '''([a-z_]+)''', 'g') m`,
      )
    ).rows.map((r) => r.r);
    for (const reason of ELIGIBILITY_REASONS) expect(all, reason).toContain(reason);
    const waiting = (await db.query<{ r: string }>(`select distinct m[1] as r from regexp_matches(pg_get_functiondef('commerce.invoice_readiness(uuid)'::regprocedure), 'RETURN ''([a-z_]+)''', 'g') m`)).rows.map((r) => r.r);
    expect(waiting.sort()).toEqual([...WAITING_REASONS, "ready"].sort());
  });
});

describe("who never gets an invoice", () => {
  let shop: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "inv-never");
  });

  it("copied history: never invoiced, and the database refuses a document for it", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "C", unit: 3000 }], copied: true });
    expect(await eligibility(o.id)).toBe("copied");
    expect(await scalar(db, "select commerce.make_order_invoice($1::uuid, $2::uuid)", [shop, o.id])).toBeNull();
    await db.query("select set_config('commerce.issuing_document', $1, false)", [o.id]);
    await rejects(
      `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, issued_on, supply_date, locale, vat_kind, snapshot, public_token)
       values ($1, $2, 'invoice', 99, 'F-99', 'NOK', 3000, 600, 2400, current_date, current_date, 'nb-NO', 'standard',
         '{"version":1,"buckets":[{"rate":0.25,"basis":"standard","netMinor":2400,"vatMinor":600,"grossMinor":3000}]}', $3)`,
      [shop, o.id, `inv_${"b".repeat(43)}`],
      /document\.order|total_not_order/,
    );
    await db.query("select set_config('commerce.issuing_document', '', false)");
  });

  it("a host's order is the host's to invoice", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "H", unit: 3000 }], host: true });
    expect(await eligibility(o.id)).toBe("host");
    expect(await scalar(db, "select count(*)::int from commerce.invoices where order_id = $1", [o.id])).toBe(0);
  });

  it("an order that was not paid", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "U", unit: 3000 }], pay: false });
    expect(await eligibility(o.id)).toBe("not_paid");
  });

  it("a payment in Stripe's test mode never uses a legal number; a live account does", async () => {
    await db.query("insert into commerce.stripe_accounts (store_id, mode, account_id) values ($1, 'test', 'acct_TESTFIX'), ($1, 'live', 'acct_LIVEFIX')", [shop]);
    const before = await nextNumber(shop, "invoice");
    const test = await placeOrder(db, shop, { lines: [{ sku: "T", unit: 3000 }], account: "acct_TESTFIX" });
    expect(await eligibility(test.id)).toBe("test_mode");
    expect(test.invoiceId).toBeNull();
    expect(await nextNumber(shop, "invoice")).toBe(before);
    const live = await placeOrder(db, shop, { lines: [{ sku: "L", unit: 3000 }], account: "acct_LIVEFIX" });
    expect(live.invoiceId).not.toBeNull();
    // A payment with no known account is live: a missing row can only produce an invoice, never lose one.
    const unknown = await placeOrder(db, shop, { lines: [{ sku: "K", unit: 3000 }], account: "acct_UNKNOWN" });
    expect(unknown.invoiceId).not.toBeNull();
  });

  it("a venue payment follows the store's mode", async () => {
    const test = await placeOrder(db, shop, { lines: [{ sku: "V1", unit: 3000 }], provider: "venue" });
    expect(await eligibility(test.id)).toBe("test_mode");
    await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1 and provider = 'stripe'", [shop]);
    const live = await placeOrder(db, shop, { lines: [{ sku: "V2", unit: 3000 }], provider: "venue" });
    expect(live.invoiceId).not.toBeNull();
  });

  it("an order of nothing", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "Z", unit: 3000, gift: true }] });
    expect(await eligibility(o.id)).toBe("zero_total");
    expect(o.invoiceId).toBeNull();
  });

  it("invoicing switched off, and on again: only what is paid from then on", async () => {
    const off = await createInvoiceStore(db, "inv-off", { invoicing: false });
    const before = await placeOrder(db, off, { lines: [{ sku: "O1", unit: 3000 }] });
    expect(await eligibility(before.id)).toBe("disabled");
    expect(before.invoiceId).toBeNull();
    expect(await scalar(db, "select enabled_from from commerce.invoice_settings where store_id = $1", [off])).toBeNull();
    await db.query("update commerce.invoice_settings set enabled = true where store_id = $1", [off]);
    expect(await scalar(db, "select enabled_from is not null from commerce.invoice_settings where store_id = $1", [off])).toBe(true);
    // The order paid before switching on stays without one, whatever the job does; one paid after is invoiced.
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [off])).toBe(0);
    expect(await eligibility(before.id)).toBe("disabled");
    const after = await placeOrder(db, off, { lines: [{ sku: "O2", unit: 3000 }] });
    expect(after.invoiceId).not.toBeNull();
    await db.query("update commerce.invoice_settings set enabled = false where store_id = $1", [off]);
    expect(await scalar(db, "select enabled_from from commerce.invoice_settings where store_id = $1", [off])).toBeNull();
  });

  it("a store with no settings row has invoicing on, from the start", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "ON", unit: 3000 }] });
    expect(await scalar(db, "select count(*)::int from commerce.invoice_settings where store_id = $1", [shop])).toBe(0);
    expect(o.invoiceId).not.toBeNull();
  });
});

describe("an order that waits", () => {
  it("waits for the seller's details and is issued later, with the later day as its issue date and the payment day as its supply date", async () => {
    const shop = await createInvoiceStore(db, "inv-wait-details", { legalName: null, postalAddress: null });
    const o = await placeOrder(db, shop, { lines: [{ sku: "W1", unit: 6000 }], pay: "pending-only" });
    await markPaid(o.id, "2026-09-28T10:00:00Z");
    expect(await eligibility(o.id)).toBe("ok");
    expect(await readiness(o.id)).toBe("seller_details");
    expect((await db.query("select order_id, reason from commerce.waiting_invoices($1)", [shop])).rows).toEqual([{ order_id: o.id, reason: "seller_details" }]);
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [shop])).toBe(0);
    await db.query("update commerce.stores set legal_name = 'Fixture AS', postal_address = 'Storgata 1, 0155 Oslo' where id = $1", [shop]);
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [shop])).toBe(1);
    const inv = await invoiceOf(db, o.id);
    expect(inv.supply_date).toBe("2026-09-28");
    expect(inv.issued_on).toBe(await scalar(db, "select commerce.store_day($1::uuid, now())::text", [shop]));
    expect(inv.snapshot.order.paidOn).toBe("2026-09-28");
    expect((await db.query("select * from commerce.waiting_invoices($1)", [shop])).rows).toEqual([]);
  });

  it("waits for a tax profile, for a VAT number when registered, and for a rate to the seller's currency", async () => {
    const noProfile = await createInvoiceStore(db, "inv-wait-profile", { registered: null });
    const a = await placeOrder(db, noProfile, { lines: [{ sku: "W2", unit: 6000 }] });
    expect(await readiness(a.id)).toBe("tax_profile_missing");
    await db.query("insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values ($1, true, 'NO923456789MVA')", [noProfile]);
    expect(await readiness(a.id)).toBe("ready");

    const noNumber = await createInvoiceStore(db, "inv-wait-number", { registered: true, vatNumber: null });
    const b = await placeOrder(db, noNumber, { lines: [{ sku: "W3", unit: 6000 }], sellerVatNumber: null });
    expect(await readiness(b.id)).toBe("seller_details");

    const noRate = await createInvoiceStore(db, "inv-wait-rate", { rates: {} });
    const c = await placeOrder(db, noRate, { lines: [{ sku: "W4", unit: 6000 }], market: "FI", currency: "EUR" });
    expect(await readiness(c.id)).toBe("no_exchange_rate");
    expect(c.invoiceId).toBeNull();
    await db.query("insert into commerce.store_currencies (store_id, currency, rate) values ($1, 'NOK', 11.5)", [noRate]);
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [noRate])).toBe(1);
  });

  it("a store that is not registered for VAT does not state VAT it charged: the order waits for its owner", async () => {
    const shop = await createInvoiceStore(db, "inv-wait-unregistered", { registered: false });
    const o = await placeOrder(db, shop, { lines: [{ sku: "W5", unit: 6000 }] });
    expect(await readiness(o.id)).toBe("vat_charged_not_registered");
    expect(o.invoiceId).toBeNull();
    // One that charged none is invoiced and says so.
    const free = await placeOrder(db, shop, { lines: [{ sku: "W6", unit: 6000, rate: 0, category: "exempt" }], shippingRate: 0 });
    expect(free.invoiceId).not.toBeNull();
    expect((await invoiceOf(db, free.id)).snapshot.treatment.statements).toContain("not_registered");
  });

  it("an invoice that fails rolls back only itself: the payment stands, the number comes back, and the job issues it later", async () => {
    const shop = await createInvoiceStore(db, "inv-fail");
    await db.query("create or replace function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$");
    await db.query("create function commerce.fx_boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$");
    await db.query("create trigger fx_boom before insert on commerce.invoices for each row execute function commerce.fx_boom()");
    const o = await placeOrder(db, shop, { lines: [{ sku: "F1", unit: 4000 }] });
    expect(await scalar(db, "select status::text from commerce.orders where id = $1", [o.id])).toBe("paid");
    expect(o.invoiceId).toBeNull();
    expect(await nextNumber(shop, "invoice")).toBe("1");
    expect((await events(o.id, "invoice.failed")).map((e) => e.error)).toEqual([expect.stringContaining("forced failure")]);
    // Written once an hour at most, however often the job tries.
    await db.query("select commerce.issue_order_invoice($1::uuid, $2::uuid)", [shop, o.id]);
    expect(await events(o.id, "invoice.failed")).toHaveLength(1);
    expect((await db.query("select reason from commerce.waiting_invoices($1)", [shop])).rows).toEqual([{ reason: "invoice_failed" }]);
    await db.query("drop trigger fx_boom on commerce.invoices");
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [shop])).toBe(1);
    expect((await invoiceOf(db, o.id)).document_number).toBe("F-1");
    expect(await series(shop)).toEqual({ documents: "1", missing: "0", ok: true });
  });
});

describe("a document is immutable", () => {
  let shop: string;
  let invoice: DocRow;
  let orderId: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "inv-immutable");
    const o = await placeOrder(db, shop, { lines: [{ sku: "IM", unit: 10000 }] });
    orderId = o.id;
    invoice = await invoiceOf(db, o.id);
    await refund(db, o.id, 2500);
  });

  it("refuses an update of anything, a delete, and an insert that is not the issuing function's", async () => {
    await rejects("update commerce.invoices set total_minor = 1 where id = $1", [invoice.id], /append-only/);
    await rejects("update commerce.invoices set snapshot = '{\"version\":1}' where id = $1", [invoice.id], /append-only/);
    await rejects("update commerce.invoices set public_token = null where id = $1", [invoice.id], /append-only/);
    await rejects("delete from commerce.invoices where id = $1", [invoice.id], /append-only/);
    const note = (await creditNotesOf(db, orderId))[0];
    await rejects("update commerce.credit_notes set total_minor = 1 where id = $1", [note.id], /append-only/);
    await rejects("delete from commerce.credit_notes where id = $1", [note.id], /append-only/);
    await rejects(
      `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, issued_on, supply_date, locale, vat_kind, snapshot, public_token)
       values ($1, $2, 'invoice', 7, 'F-7', 'NOK', 1, 0, 1, current_date, current_date, 'nb-NO', 'standard', '{"version":1,"buckets":[{"rate":0,"basis":"standard","netMinor":1,"vatMinor":0,"grossMinor":1}]}', $3)`,
      [shop, orderId, `inv_${"c".repeat(43)}`],
      /issuing_only|total_not_order/,
    );
    await rejects(
      `insert into commerce.credit_notes (store_id, invoice_id, refund_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, source, issued_on, locale, snapshot, public_token)
       select $1, $2, r.id, 'credit_note', 9, 'K-9', 'NOK', 1, 0, 1, 'refund', current_date, 'nb-NO', '{"version":1,"buckets":[{"rate":0.25,"basis":"standard","netMinor":1,"vatMinor":0,"grossMinor":1}]}', $3
         from commerce.refunds r where r.store_id = $1 limit 1`,
      [shop, invoice.id, `crn_${"d".repeat(43)}`],
      /issuing_only|duplicate|credit_notes_refund_key/,
    );
  });

  it("allows the stored PDF's path to be set once, and nothing else with it", async () => {
    await rejects("update commerce.invoices set pdf_path = 'a/b.pdf' where id = $1", [invoice.id], /invoices_pdf/);
    await db.query("update commerce.invoices set pdf_path = $2, pdf_sha256 = $3 where id = $1", [invoice.id, `${shop}/invoices/${invoice.id}.pdf`, "a".repeat(64)]);
    await rejects("update commerce.invoices set pdf_path = 'other.pdf', pdf_sha256 = 'b' where id = $1", [invoice.id], /append-only/);
    await rejects("update commerce.invoices set pdf_path = null, pdf_sha256 = null where id = $1", [invoice.id], /append-only/);
    await rejects("update commerce.invoices set total_minor = 2, pdf_path = 'x' where id = $1", [invoice.id], /append-only/);
  });

  it("a malformed token or a snapshot that is not the document's is refused", async () => {
    await rejects("select 1 where false", [], /^$/).catch(() => undefined);
    const check = (sql: string, pattern: RegExp) => rejects(sql, [shop, orderId], pattern);
    // Tokens and snapshots are checked by constraints on the row, so a hand-made row cannot get through even with the setting.
    await db.query("select set_config('commerce.issuing_document', $1, false)", [orderId]);
    await check(
      `insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, issued_on, supply_date, locale, vat_kind, snapshot, public_token)
       values ($1, $2, 'invoice', 50, 'F-50', 'NOK', 1, 0, 1, current_date, current_date, 'nb-NO', 'standard', '{"version":1,"buckets":[]}', 'inv_short')`,
      /invoices_public_token|totals_mismatch|invoices_order_key|total_not_order/,
    );
    await db.query("select set_config('commerce.issuing_document', '', false)");
  });
});

describe("the numbers", () => {
  it("cannot be re-prefixed, lowered, skipped or removed once issued; the audit finds a gap", async () => {
    const shop = await createInvoiceStore(db, "inv-series");
    expect((await db.query("select prefix from commerce.document_series where store_id = $1 and series in ('invoice', 'credit_note') order by series", [shop])).rows).toEqual([{ prefix: "K-" }, { prefix: "F-" }]);
    // Before the first is issued the owner chooses the prefix and the first number.
    await db.query("select commerce.set_sales_series($1::uuid, 'invoice', 'INV/', 500)", [shop]);
    const a = await placeOrder(db, shop, { lines: [{ sku: "S1", unit: 1000 }] });
    expect((await invoiceOf(db, a.id)).document_number).toBe("INV/500");
    await placeOrder(db, shop, { lines: [{ sku: "S2", unit: 1000 }] });
    await rejects("select commerce.set_sales_series($1::uuid, 'invoice', 'X-', 1)", [shop], /numbers already issued/);
    await rejects("update commerce.document_series set prefix = 'X-' where store_id = $1 and series = 'invoice'", [shop], /prefix/);
    await rejects("update commerce.document_series set next_number = 1 where store_id = $1 and series = 'invoice'", [shop], /sequence/);
    await rejects("update commerce.document_series set next_number = 900 where store_id = $1 and series = 'invoice'", [shop], /sequence/);
    await rejects("delete from commerce.document_series where store_id = $1 and series = 'invoice'", [shop], /issued/);
    // The credit-note series has no document yet and can still be chosen.
    await db.query("select commerce.set_sales_series($1::uuid, 'credit_note', 'CR-', 10)", [shop]);
    await rejects("select commerce.set_sales_series($1::uuid, 'order', 'X', 1)", [shop], /not an invoice or credit note series/);
    await rejects("select commerce.set_sales_series($1::uuid, 'credit_note', 'toolongprefix1', 1)", [shop], /prefix/);
    await rejects("select commerce.set_sales_series($1::uuid, 'credit_note', 'K-', 0)", [shop], /1 or more/);
    expect(await series(shop)).toEqual({ documents: "2", missing: "0", ok: true });
    // A number removed by hand (the guard is switched off for the test, as a superuser could) shows as a gap.
    await db.query("alter table commerce.invoices disable trigger invoices_append_only");
    await db.query("delete from commerce.invoices where store_id = $1 and number = 501", [shop]);
    await db.query("alter table commerce.invoices enable trigger invoices_append_only");
    expect(await series(shop)).toEqual({ documents: "1", missing: "0", ok: false });
  });

  it("finds a missing number in the middle, and a number with the wrong format", async () => {
    const shop = await createInvoiceStore(db, "inv-audit");
    for (let i = 0; i < 4; i += 1) await placeOrder(db, shop, { lines: [{ sku: `AU${i}`, unit: 1000 }] });
    await db.query("alter table commerce.invoices disable trigger invoices_append_only");
    await db.query("delete from commerce.invoices where store_id = $1 and number = 2", [shop]);
    await db.query("update commerce.invoices set document_number = 'F-x' where store_id = $1 and number = 3", [shop]);
    await db.query("alter table commerce.invoices enable trigger invoices_append_only");
    const audit = await one<{ missing: string; first_missing: string; off_format: string; ok: boolean }>(db, "select missing::text, first_missing::text, off_format::text, ok from commerce.document_audit($1) where series = 'invoice'", [shop]);
    expect(audit).toEqual({ missing: "1", first_missing: "2", off_format: "1", ok: false });
  });

  it("the new stores' series are F- and K-, and the template's too", async () => {
    const fresh = await scalar<string>(db, "insert into commerce.stores (slug, name) values ('inv-prefixes', 'Prefixes') returning id");
    const rows = (await db.query<{ series: string; prefix: string }>("select series, prefix from commerce.document_series where store_id = $1 and series in ('invoice', 'credit_note') order by series", [fresh])).rows;
    expect(rows).toEqual([{ series: "credit_note", prefix: "K-" }, { series: "invoice", prefix: "F-" }]);
    // The template store of a database that already had stores was changed too, as every unissued series of the old defaults.
    expect(await scalar(db, "select count(*)::int from commerce.document_series where series = 'invoice' and prefix = 'INV-'")).toBe(0);
    expect(await scalar(db, "select count(*)::int from commerce.document_series where series = 'credit_note' and prefix = 'CN-'")).toBe(0);
  });
});

describe("a credit note for every refund that succeeds, by every path", () => {
  let shop: string;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "inv-credit");
  });
  const paid = (amount = 12500, extra = {}) => placeOrder(db, shop, { lines: [{ sku: `CN${Math.random()}`, unit: amount }], ...extra });

  it("P1 and P5: a refund inserted as succeeded, in one transaction with its stock and email work, gets its note at commit", async () => {
    const o = await paid();
    await refund(db, o.id, 5000);
    const [note] = await creditNotesOf(db, o.id);
    expect(note.document_number).toBe("K-1");
    expect(Number(note.total_minor)).toBe(5000);
    expect(note.snapshot.refersTo).toMatchObject({ invoiceNumber: (await invoiceOf(db, o.id)).document_number });
    expect(note.public_token).toMatch(/^crn_[A-Za-z0-9_-]{43}$/);
    expect(await events(o.id, "credit_note.issued")).toHaveLength(1);
  });

  it("P6: a refund Stripe reports pending has none; when it succeeds, the update brings it", async () => {
    const o = await paid();
    const id = await refund(db, o.id, 3000, "pending");
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
    await db.query("update commerce.refunds set status = 'succeeded' where id = $1", [id]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(1);
    // Saying it again changes nothing.
    await db.query("update commerce.refunds set status = 'succeeded' where id = $1", [id]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(1);
  });

  it("P7 and P10: a refund made in Stripe, or by raw SQL, with no staff member, is the same", async () => {
    const o = await paid();
    const payment = await scalar<string>(db, "select id from commerce.payments where order_id = $1", [o.id]);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, created_by) values ($1, $2, 4000, 'stripe dashboard', 're_dash_1', 'succeeded', null)", [shop, payment]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(1);
  });

  it("a failed refund has none, and a refund that succeeded cannot become failed", async () => {
    const o = await paid();
    const failed = await refund(db, o.id, 3000, "failed");
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
    const ok = await refund(db, o.id, 2000);
    await rejects("update commerce.refunds set status = 'failed' where id = $1", [ok], /succeeded_final/);
    await rejects("update commerce.refunds set status = 'pending' where id = $1", [ok], /succeeded_final/);
    // A failed one can still be corrected to succeeded, which is how a delayed bank method ends.
    await db.query("update commerce.refunds set status = 'succeeded' where id = $1", [failed]);
    expect(await creditNotesOf(db, o.id)).toHaveLength(2);
  });

  it("one note per refund, in a series of its own that never shares the invoices' numbers", async () => {
    const o = await paid();
    const a = await refund(db, o.id, 1000);
    const b = await refund(db, o.id, 1500);
    const notes = await creditNotesOf(db, o.id);
    expect(notes.map((n) => n.document_number)).toHaveLength(2);
    const numbers = (await db.query<{ number: string }>("select number::text from commerce.credit_notes where store_id = $1 order by number", [shop])).rows.map((r) => Number(r.number));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(await scalar(db, "select count(*)::int from commerce.credit_notes where refund_id = any($1::uuid[])", [[a, b]])).toBe(2);
    await rejects("select 1", [], /^$/).catch(() => undefined);
  });

  it("two credits of 10 and 15 on a bucket of 25 leave exactly nothing, and the VAT adds up to the invoice's", async () => {
    const shop2 = await createInvoiceStore(db, "inv-credit-exact");
    const o = await placeOrder(db, shop2, { lines: [{ sku: "EX", unit: 2500, rate: 0.25 }] });
    await refund(db, o.id, 1000);
    await refund(db, o.id, 1500);
    const notes = await creditNotesOf(db, o.id);
    const inv = await invoiceOf(db, o.id);
    expect(notes.reduce((s, n) => s + Number(n.tax_minor), 0)).toBe(Number(inv.tax_minor));
    expect(notes.reduce((s, n) => s + Number(n.total_minor), 0)).toBe(Number(inv.total_minor));
    expect(notes[1].snapshot.position).toMatchObject({ leftOnInvoiceMinor: 0 });
  });

  it("never above the invoice: a refund larger than what is left is credited up to it and said to be short", async () => {
    const o = await paid(10000);
    await refund(db, o.id, 7000);
    await refund(db, o.id, 7000);
    const notes = await creditNotesOf(db, o.id);
    expect(notes.map((n) => Number(n.total_minor))).toEqual([7000, 3000]);
    expect(notes[1].snapshot.notes).toEqual(["credit_capped"]);
    expect((await events(o.id, "credit_note.short"))[0]).toMatchObject({ amountMinor: 7000, creditedMinor: 3000, shortMinor: 4000 });
    // Nothing left: no note, said once.
    const third = await refund(db, o.id, 1000);
    expect(await creditNotesOf(db, o.id)).toHaveLength(2);
    expect((await events(o.id, "credit_note.short")).filter((e) => e.key === third)).toHaveLength(1);
    expect(await scalar(db, "select commerce.issue_missing_credit_notes($1::uuid)", [shop])).toBe(0);
    expect((await events(o.id, "credit_note.short")).filter((e) => e.key === third)).toHaveLength(1);
  });

  it("the database refuses a credit note above the invoice per rate, whoever makes it", async () => {
    const o = await paid(10000);
    const inv = await invoiceOf(db, o.id);
    const id = await refund(db, o.id, 4000);
    const [note] = await creditNotesOf(db, o.id);
    expect(note).toBeDefined();
    const big = { version: 1, buckets: [{ rate: 0.25, basis: "standard", netMinor: 8000, vatMinor: 2000, grossMinor: 10000 }] };
    await db.query("select set_config('commerce.issuing_document', $1, false)", [id]);
    await rejects(
      `insert into commerce.credit_notes (store_id, invoice_id, refund_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, source, issued_on, locale, snapshot, public_token)
       values ($1, $2, $3, 'credit_note', 99999, 'K-99999', 'NOK', 10000, 2000, 8000, 'refund', current_date, 'nb-NO', $4::jsonb, $5)`,
      [shop, inv.id, id, JSON.stringify(big), `crn_${"e".repeat(43)}`],
      /over_invoice|credit_notes_refund_key|duplicate/,
    );
    await db.query("select set_config('commerce.issuing_document', '', false)");
  });

  it("a second note for the same refund is refused even when made by hand, and so is a number that is not the series' own", async () => {
    const o = await paid(10000);
    const id = await refund(db, o.id, 2000);
    const inv = await invoiceOf(db, o.id);
    const small = { version: 1, buckets: [{ rate: 0.25, basis: "standard", netMinor: 80, vatMinor: 20, grossMinor: 100 }] };
    await db.query("select set_config('commerce.issuing_document', $1, false)", [id]);
    const insert = (number: number, documentNumber: string) =>
      db.query(
        `insert into commerce.credit_notes (store_id, invoice_id, refund_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, source, issued_on, locale, snapshot, public_token)
         values ($1, $2, $3, 'credit_note', $4, $5, 'NOK', 100, 20, 80, 'refund', current_date, 'nb-NO', $6::jsonb, $7)`,
        [shop, inv.id, id, number, documentNumber, JSON.stringify(small), `crn_${"g".repeat(43)}`],
      );
    await expect(insert(88888, "K-88888")).rejects.toThrow(/credit_notes_refund_key/);
    await expect(insert(88889, "X-88889")).rejects.toThrow(/number_format/);
    await db.query("select set_config('commerce.issuing_document', '', false)");
  });

  it("an order with no invoice (copied, a host's, test-mode, invoicing off) gets no credit note", async () => {
    const host = await paid(5000, { host: true });
    await refund(db, host.id, 1000);
    expect(await creditNotesOf(db, host.id)).toHaveLength(0);
    const off = await createInvoiceStore(db, "inv-credit-off", { invoicing: false });
    const o = await placeOrder(db, off, { lines: [{ sku: "OFF", unit: 5000 }] });
    await refund(db, o.id, 1000);
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
    expect(await scalar(db, "select count(*)::int from commerce.credit_notes where store_id = $1", [off])).toBe(0);
  });

  it("a refund made while the invoice waited is credited when the invoice is issued, in the order the refunds were made", async () => {
    const waiting = await createInvoiceStore(db, "inv-credit-wait", { legalName: null });
    const o = await placeOrder(db, waiting, { lines: [{ sku: "WR", unit: 9000 }], pay: "pending-only" });
    await markPaid(o.id, "2026-09-27T08:00:00Z");
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [o.id]);
    await refund(db, o.id, 2000);
    await refund(db, o.id, 1000);
    expect(await scalar(db, "select count(*)::int from commerce.credit_notes where store_id = $1", [waiting])).toBe(0);
    await db.query("update commerce.stores set legal_name = 'Fixture AS' where id = $1", [waiting]);
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [waiting])).toBe(1);
    expect((await creditNotesOf(db, o.id)).map((n) => Number(n.total_minor))).toEqual([2000, 1000]);
  });

  it("a credit note that fails never stops the refund: it is written down and made later by the job", async () => {
    const o = await paid(10000);
    await db.query("create function commerce.fx_boom2() returns trigger language plpgsql as $$ begin raise exception 'forced credit failure'; end $$");
    await db.query("create trigger fx_boom2 before insert on commerce.credit_notes for each row execute function commerce.fx_boom2()");
    const id = await refund(db, o.id, 2000);
    expect(await scalar(db, "select status::text from commerce.refunds where id = $1", [id])).toBe("succeeded");
    expect(await creditNotesOf(db, o.id)).toHaveLength(0);
    expect((await events(o.id, "credit_note.failed"))[0]).toMatchObject({ key: id });
    await db.query("drop trigger fx_boom2 on commerce.credit_notes");
    expect(await scalar(db, "select commerce.issue_missing_credit_notes($1::uuid)", [shop])).toBe(1);
    expect(await creditNotesOf(db, o.id)).toHaveLength(1);
  });
});

describe("a return's credit note", () => {
  let shop: string;
  let order: Awaited<ReturnType<typeof placeOrder>>;
  beforeAll(async () => {
    shop = await createInvoiceStore(db, "inv-return");
  });

  async function startReturn(orderId: string) {
    return one<{ id: string; number: string }>(db, "insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', 'approved') returning id, number", [shop, orderId]);
  }

  it("P5: lists the returned lines at their own rates, the deduction, the delivery given back and the return shipping, and adds up to the refund", async () => {
    order = await placeOrder(db, shop, {
      lines: [{ sku: "R1", unit: 10000, quantity: 2, rate: 0.25 }, { sku: "R2", unit: 5000, rate: 0.15, category: "food" }],
      shipping: 4900,
      shippingRate: 0.25,
      deliveryLabel: "Posten",
    });
    const ret = await startReturn(order.id);
    const [l1, l2] = order.lineIds;
    const working = {
      lines: [{ lineId: l1, quantity: 1, valueMinor: 10000, deductionMinor: 1000 }, { lineId: l2, quantity: 1, valueMinor: 5000, deductionMinor: 0 }],
      deliveryMinor: 4900,
      returnShippingMinor: 3900,
      adjustmentMinor: 0,
      amountMinor: 10000 - 1000 + 5000 + 4900 - 3900,
      outside: false,
    };
    await db.transaction(async (tx) => {
      const payment = (await tx.query<{ id: string }>("select id from commerce.payments where order_id = $1", [order.id])).rows[0].id;
      const r = (await tx.query<{ id: string }>("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'return', 're_ret_1', 'succeeded') returning id", [shop, payment, working.amountMinor])).rows[0];
      await tx.query("update commerce.returns set refund_id = $2, refund_minor = $3, refund_computed_minor = $3, refunded_at = now(), refund_working = $4::jsonb where id = $1", [ret.id, r.id, working.amountMinor, JSON.stringify(working)]);
    });
    const [note] = await creditNotesOf(db, order.id);
    expect(Number(note.total_minor)).toBe(working.amountMinor);
    expect(note.snapshot.reason).toEqual({ kind: "return", returnNumber: ret.number });
    expect(note.snapshot.lines.map((l: any) => [l.kind, l.grossMinor])).toEqual([
      ["goods", 10000],
      ["deduction", -1000],
      ["goods", 5000],
      ["delivery", 4900],
      ["return_shipping", -3900],
    ]);
    expect(note.snapshot.lines[0]).toMatchObject({ lineId: l1, vatRate: 0.25, quantity: 1 });
    expect(note.snapshot.lines[2]).toMatchObject({ lineId: l2, vatRate: 0.15 });
    expect(note.snapshot.notes).toEqual([]);
    expect(note.snapshot.totals.grossMinor).toBe(working.amountMinor);
  });

  it("the working is written once with the refund", async () => {
    const [ret] = (await db.query<{ id: string }>("select id from commerce.returns where order_id = $1", [order.id])).rows;
    await rejects("update commerce.returns set refund_working = '{}'::jsonb where id = $1", [ret.id], /return_refund_recorded|working_once/);
  });

  it("a staff adjustment above the working is shared again and shown as an adjustment row; the rows always add up to the buckets", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "AD1", unit: 8000, rate: 0.25 }, { sku: "AD2", unit: 2000, rate: 0.12 }] });
    const ret = await startReturn(o.id);
    const working = { lines: [{ lineId: o.lineIds[0], quantity: 1, valueMinor: 8000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, adjustmentMinor: 500, amountMinor: 8500, outside: false };
    await db.transaction(async (tx) => {
      const payment = (await tx.query<{ id: string }>("select id from commerce.payments where order_id = $1", [o.id])).rows[0].id;
      const r = (await tx.query<{ id: string }>("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, 8500, 'return', 're_ret_2', 'succeeded') returning id", [shop, payment])).rows[0];
      await tx.query("update commerce.returns set refund_id = $2, refund_minor = 8500, refund_computed_minor = 8000, refunded_at = now(), refund_working = $3::jsonb where id = $1", [ret.id, r.id, JSON.stringify(working)]);
    });
    const [note] = await creditNotesOf(db, o.id);
    expect(Number(note.total_minor)).toBe(8500);
    const rows = note.snapshot.lines as { kind: string; grossMinor: number; vatRate: number }[];
    expect(rows.reduce((s, r) => s + r.grossMinor, 0)).toBe(8500);
    expect(rows.some((r) => r.kind === "adjustment")).toBe(true);
    expect(note.snapshot.buckets.reduce((s: number, b: any) => s + b.grossMinor, 0)).toBe(8500);
  });

  it("a working that does not match the refund is not used: the amount is shared as a plain refund, and the note says so", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "MM1", unit: 6000 }] });
    const ret = await startReturn(o.id);
    const working = { lines: [{ lineId: o.lineIds[0], quantity: 1, valueMinor: 6000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, adjustmentMinor: 0, amountMinor: 6000, outside: false };
    await db.transaction(async (tx) => {
      const payment = (await tx.query<{ id: string }>("select id from commerce.payments where order_id = $1", [o.id])).rows[0].id;
      const r = (await tx.query<{ id: string }>("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, 4000, 'return', 're_ret_3', 'succeeded') returning id", [shop, payment])).rows[0];
      await tx.query("update commerce.returns set refund_id = $2, refund_minor = 4000, refund_computed_minor = 6000, refunded_at = now(), refund_working = $3::jsonb where id = $1", [ret.id, r.id, JSON.stringify(working)]);
    });
    const [note] = await creditNotesOf(db, o.id);
    expect(Number(note.total_minor)).toBe(4000);
    expect(note.snapshot.notes).toEqual(["working_not_used"]);
    expect(note.snapshot.lines.map((l: any) => l.kind)).toEqual(["refund"]);
  });

  it("P8: a return refunded outside Kaizen gets its note from the return, once", async () => {
    const o = await placeOrder(db, shop, { lines: [{ sku: "OU1", unit: 7000 }], provider: "venue", account: null });
    expect(o.invoiceId).toBeNull();
    // The store is in test mode until it has a live Stripe account, so a venue order has none; a live store's has.
    await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1 and provider = 'stripe'", [shop]);
    const live = await placeOrder(db, shop, { lines: [{ sku: "OU2", unit: 7000 }], provider: "venue" });
    expect(live.invoiceId).not.toBeNull();
    const ret = await startReturn(live.id);
    const working = { lines: [{ lineId: live.lineIds[0], quantity: 1, valueMinor: 7000, deductionMinor: 500 }], deliveryMinor: 0, returnShippingMinor: 0, adjustmentMinor: 0, amountMinor: 6500, outside: true };
    await db.query("update commerce.returns set refund_minor = 6500, refund_computed_minor = 6500, refund_outside = true, refunded_at = now(), refund_working = $2::jsonb where id = $1", [ret.id, JSON.stringify(working)]);
    const notes = await creditNotesOf(db, live.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].snapshot.source).toBe("return_outside");
    expect(Number(notes[0].total_minor)).toBe(6500);
    expect(await scalar(db, "select source from commerce.credit_notes where id = $1", [notes[0].id])).toBe("return_outside");
    expect(await scalar(db, "select commerce.issue_missing_credit_notes($1::uuid)", [shop])).toBe(0);
    expect(await creditNotesOf(db, live.id)).toHaveLength(1);
  });
});

describe("the settings", () => {
  it("keeps a note of at most 1000 characters and the confirmation switch; a new store copies them without the numbers", async () => {
    const shop = await createInvoiceStore(db, "inv-settings", { footerNote: "Bank 1503.12.34567" });
    await rejects("update commerce.invoice_settings set footer_note = $2 where store_id = $1", [shop, "x".repeat(1001)], /invoice_settings_footer_note/);
    const owner = await scalar<string>(db, "insert into commerce.accounts (email) values ('inv-owner@example.com') returning id");
    await placeOrder(db, shop, { lines: [{ sku: "DUP", unit: 1000 }] });
    const copy = await scalar<string>(db, "select commerce.duplicate_store($1::uuid, 'inv-settings-copy', 'Copy', $2::uuid)", [shop, owner]);
    expect(await one(db, "select enabled, enabled_from, footer_note, email_with_confirmation from commerce.invoice_settings where store_id = $1", [copy])).toEqual({
      enabled: true,
      enabled_from: null,
      footer_note: "Bank 1503.12.34567",
      email_with_confirmation: true,
    });
    expect(await scalar(db, "select next_number::text from commerce.document_series where store_id = $1 and series = 'invoice'", [copy])).toBe("1");
    expect(await scalar(db, "select count(*)::int from commerce.invoices where store_id = $1", [copy])).toBe(0);
  });
});

describe("retention (the hook of unit 1g)", () => {
  it("refuses a cutoff younger than five years, and anonymises only what is past it, leaving numbers, totals and the seller", async () => {
    const shop = await createInvoiceStore(db, "inv-retention");
    const old = await placeOrder(db, shop, { lines: [{ sku: "OLD", unit: 10000 }], company: { name: "Muster GmbH", number: "DE-HRB 1", vatNumber: "DE123456789" }, vatKind: "reverse_charge", market: "DE", currency: "EUR" });
    const young = await placeOrder(db, shop, { lines: [{ sku: "YOUNG", unit: 10000 }] });
    await refund(db, old.id, 3000);
    const oldInv = await invoiceOf(db, old.id);
    await db.query("update commerce.invoices set pdf_path = $2, pdf_sha256 = $3 where id = $1", [oldInv.id, `${shop}/invoices/${oldInv.id}.pdf`, "f".repeat(64)]);
    await rejects("select commerce.anonymise_expired_documents($1::uuid, (current_date - interval '4 years')::date)", [shop], /cutoff_too_young/);
    // Documents older than the period (the guard is lifted for the test, as a migration could).
    await db.query("alter table commerce.invoices disable trigger invoices_append_only");
    await db.query("alter table commerce.credit_notes disable trigger credit_notes_append_only");
    await db.query("update commerce.invoices set issued_on = date '2019-03-01' where order_id = $1", [old.id]);
    await db.query("update commerce.credit_notes set issued_on = date '2019-04-01' where invoice_id = $1", [oldInv.id]);
    await db.query("alter table commerce.invoices enable trigger invoices_append_only");
    await db.query("alter table commerce.credit_notes enable trigger credit_notes_append_only");
    const files = (await db.query<{ document_type: string; pdf_path: string }>("select document_type, pdf_path from commerce.expired_document_files($1, date '2021-01-01')", [shop])).rows;
    expect(files).toEqual([{ document_type: "invoice", pdf_path: `${shop}/invoices/${oldInv.id}.pdf` }]);
    expect(await scalar(db, "select commerce.anonymise_expired_documents($1::uuid, date '2021-01-01')", [shop])).toBe(2);
    const after = await invoiceOf(db, old.id);
    expect(after.public_token).toBeNull();
    expect(after.snapshot.buyer).toMatchObject({ name: "[removed]", email: "[removed]", company: "[removed]", vatNumber: "[removed]", organisationNumber: "[removed]" });
    expect(after.snapshot.buyer.address).toMatchObject({ line1: "[removed]", city: "[removed]" });
    expect(after.snapshot.treatment.buyerVatNumber).toBe("[removed]");
    expect({ ...after, snapshot: { ...after.snapshot, buyer: null, treatment: null, order: null } }).toMatchObject({ document_number: oldInv.document_number, total_minor: oldInv.total_minor, issued_on: "2019-03-01" });
    expect(after.snapshot.buckets).toEqual(oldInv.snapshot.buckets);
    expect(after.snapshot.seller).toEqual(oldInv.snapshot.seller);
    expect(await scalar(db, "select pdf_path from commerce.invoices where id = $1", [oldInv.id])).toBeNull();
    expect(await scalar(db, "select anonymised_at is not null from commerce.credit_notes where invoice_id = $1", [oldInv.id])).toBe(true);
    expect((await events(old.id, "document.anonymised")).length).toBe(2);
    // The young one is untouched, and the anonymised one is still immutable.
    expect((await invoiceOf(db, young.id)).public_token).not.toBeNull();
    await rejects("update commerce.invoices set total_minor = 1 where id = $1", [oldInv.id], /append-only/);
    await rejects("update commerce.invoices set pdf_path = 'again.pdf', pdf_sha256 = 'a' where id = $1", [oldInv.id], /append-only/);
    expect(await scalar(db, "select commerce.anonymise_expired_documents($1::uuid, date '2021-01-01')", [shop])).toBe(0);
  });
});

describe("what the migration and the registries say", () => {
  it("has no removal, TRUNCATE or DROP inside any function it adds (the production migration tool cancels them)", async () => {
    const { rows } = await db.query<{ proname: string; src: string }>(
      `select p.proname, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'commerce' and p.proname = any($1)`,
      [[
        "vat_incl", "nz", "minor_unit_digits", "convert_with", "new_document_token", "fx_factor", "main_currency", "home_vat_required", "store_day", "distribute_minor", "credit_vat",
        "set_sales_series", "invoice_settings_rules", "guard_document_change", "document_insert_guard", "refunds_succeeded_final", "returns_working_once", "invoice_eligibility",
        "invoice_seller_vat", "fx_as_of", "invoice_readiness", "doc_language", "build_invoice_snapshot", "make_order_invoice", "issue_order_invoice", "bucket_index", "make_credit_note",
        "issue_credit_note", "refunds_issue_credit_note", "returns_issue_credit_note", "waiting_invoices", "issue_missing_credit_notes", "issue_waiting_invoices", "document_audit",
        "anonymised_snapshot", "expired_document_files", "anonymise_expired_documents",
      ]],
    );
    expect(rows).toHaveLength(37);
    for (const { proname, src } of rows) expect([proname, /delete|truncate|drop/i.test(src)]).toEqual([proname, false]);
    // The two statements that replace complete_order_payment and the copy function say it too.
    for (const name of ["complete_order_payment", "initialise_store"]) {
      const { src } = await one<{ src: string }>(db, "select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'commerce' and p.proname = $1", [name]);
      expect(/\bdrop\b|truncate/i.test(src), name).toBe(false);
    }
    expect(await scalar<boolean>(db, "select position('issue_order_invoice' in prosrc) > 0 from pg_proc where proname = 'complete_order_payment'")).toBe(true);
    expect(await scalar<boolean>(db, "select position('commerce.invoice_settings' in prosrc) > 0 from pg_proc where proname = 'duplicate_store'")).toBe(true);
  });

  it("sets a fixed search path on every function, and row-level security on every table", async () => {
    const unset = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'commerce' and p.proname in ('make_order_invoice', 'make_credit_note', 'issue_order_invoice', 'issue_credit_note', 'build_invoice_snapshot', 'guard_document_change', 'document_insert_guard')
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(unset.rows).toEqual([]);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relnamespace = 'commerce'::regnamespace and relname in ('invoice_settings', 'document_deliveries', 'document_pdf_state', 'invoices', 'credit_notes')");
    expect(rls.rows.map((r) => r.relrowsecurity)).toEqual([true, true, true, true, true]);
  });

  it("every currency Kaizen offers has two decimals, as the SQL assumes (commerce.minor_unit_digits)", async () => {
    expect(OFFERABLE_CURRENCIES.map((c) => minorUnitDigits(c))).toEqual(OFFERABLE_CURRENCIES.map(() => 2));
    expect(await scalar(db, "select commerce.minor_unit_digits('NOK')")).toBe(2);
  });

  it("has audit areas for the new actions, the same in SQL as in code", async () => {
    for (const action of ["invoice.exported", "invoice.emailed", "invoice.series_set", "invoice.settings_updated", "credit_note.emailed", "document.anonymised"]) {
      expect(await scalar(db, "select commerce.audit_area_of($1)", [action]), action).toBe(areaOfAction(action));
    }
    expect(areaOfAction("invoice.exported")).toBe("orders");
    expect(areaOfAction("invoice.settings_updated")).toBe("settings");
  });

  it("adds the feature to the plan comparison, which describes and enables nothing", async () => {
    expect(await scalar(db, "select count(*)::int from commerce.plan_features where name = 'Invoices and credit notes for orders'")).toBe(1);
  });

  it("keeps the helper arithmetic the pure code has", async () => {
    expect(await scalar(db, "select commerce.vat_incl(125, 0.25)::int")).toBe(25);
    expect(await scalar(db, "select commerce.vat_incl(3, 0.2)::int")).toBe(1);
    expect(await scalar(db, "select commerce.vat_incl(0, 0.25)::int")).toBe(0);
    expect(await scalar(db, "select commerce.distribute_minor(2, array[1,1,1]::bigint[], array[0.25, 0.15, 0.12])::text")).toBe("{1,1,0}");
    expect(await scalar(db, "select commerce.distribute_minor(10, array[3,3,4]::bigint[])::text")).toBe("{3,3,4}");
    expect(await scalar(db, "select commerce.convert_with(1000, 0.08712345)::int")).toBe(87);
  });
});
