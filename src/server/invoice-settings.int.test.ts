import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const settings = await import("./invoice-settings");
const fx = await import("./invoice-test-fixture");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * The invoicing settings (D159), against a real database: the switch (on unless a row says off, and the database sets the day it was
 * switched on), the note and the email option, the two series' prefix and first number until the first document is issued, the readiness
 * list, owners only, and a store never sees or changes another's.
 */

let a: Awaited<ReturnType<typeof fx.makeStore>>;
let b: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  a = await fx.makeStore("set-a");
  b = await fx.makeStore("set-b");
});

afterAll(async () => {
  await closeDb();
});

describe("the switch, the note and the email option", () => {
  it("is on with no note when nothing was saved, and says nothing was", async () => {
    expect(await settings.getInvoiceSettings(a.storeId)).toEqual({ enabled: true, enabledFrom: null, footerNote: null, emailWithConfirmation: true, saved: false });
    expect(await settings.kaizenInvoicingOn(a.storeId)).toBe(true);
  });

  it("is saved by an owner, with the activity log naming what changed and never the note", async () => {
    const owner = await fx.ownerOf(a);
    const saved = await settings.saveInvoiceSettings(owner, { enabled: "on", footerNote: "Bank: 1234.56.78901\nIBAN NO00", emailWithConfirmation: "false" });
    expect(saved).toMatchObject({ ok: true, settings: { enabled: true, footerNote: "Bank: 1234.56.78901\nIBAN NO00", emailWithConfirmation: false, saved: true } });
    const rows = await auditRows(a.storeId, "invoice.settings_updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ area: "settings", account_id: a.ownerId });
    expect(JSON.stringify(rows[0].details)).not.toContain("IBAN");
    expect(rows[0].details).toMatchObject({ fields: expect.arrayContaining(["footerNote", "emailWithConfirmation"]) });
    // The same values again change nothing and write no second entry.
    await settings.saveInvoiceSettings(owner, { enabled: "on", footerNote: "Bank: 1234.56.78901\nIBAN NO00", emailWithConfirmation: "false" });
    expect(await auditRows(a.storeId, "invoice.settings_updated")).toHaveLength(1);
  });

  it("is not another store's", async () => {
    expect(await settings.getInvoiceSettings(b.storeId)).toMatchObject({ footerNote: null, emailWithConfirmation: true, saved: false });
  });

  it("is for owners alone: an admin is told so and nothing changes", async () => {
    const admin = await fx.ownerOf(b, "admin");
    const refused = await settings.saveInvoiceSettings(admin, { enabled: "false", footerNote: "x" });
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringMatching(/owner/i)] });
    expect(await settings.getInvoiceSettings(b.storeId)).toMatchObject({ saved: false });
    expect((await settings.setSeries(admin, { series: "invoice", prefix: "X-", nextNumber: 5 })).ok).toBe(false);
    expect((await settings.seriesStates(b.storeId))[0]).toMatchObject({ prefix: "F-", nextNumber: 1 });
  });

  it("refuses a note over 1,000 characters, with the field named", async () => {
    const owner = await fx.ownerOf(b);
    expect(await settings.saveInvoiceSettings(owner, { footerNote: "x".repeat(1001) })).toMatchObject({ ok: false, errors: { footerNote: expect.any(String) } });
    expect(await settings.getInvoiceSettings(b.storeId)).toMatchObject({ saved: false });
  });

  it("starts the count when it is switched on again: the database sets the day, and off clears it", async () => {
    const owner = await fx.ownerOf(b);
    await settings.saveInvoiceSettings(owner, { enabled: "false", footerNote: "" });
    expect(await settings.getInvoiceSettings(b.storeId)).toMatchObject({ enabled: false, enabledFrom: null });
    expect(await settings.kaizenInvoicingOn(b.storeId)).toBe(false);
    await settings.saveInvoiceSettings(owner, { enabled: "on", footerNote: "" });
    const on = await settings.getInvoiceSettings(b.storeId);
    expect(on.enabled).toBe(true);
    expect(on.enabledFrom).not.toBeNull();
    expect(Date.now() - new Date(on.enabledFrom!).getTime()).toBeLessThan(60_000);
    expect((await auditRows(b.storeId, "invoice.settings_updated")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the two series", () => {
  it("start with the prefixes F- and K- at number 1, for a new store", async () => {
    const c = await fx.makeStore("set-c");
    expect(await settings.seriesStates(c.storeId)).toEqual([
      { series: "invoice", prefix: "F-", nextNumber: 1, issued: 0, locked: false, nextDocumentNumber: "F-1" },
      { series: "credit_note", prefix: "K-", nextNumber: 1, issued: 0, locked: false, nextDocumentNumber: "K-1" },
    ]);
  });

  it("take another prefix and first number until a document is issued, then are locked", async () => {
    const c = await fx.makeStore("set-d");
    const owner = await fx.ownerOf(c);
    const set = await settings.setSeries(owner, { series: "invoice", prefix: "FA-", nextNumber: "1001" });
    expect(set).toMatchObject({ ok: true, series: [{ series: "invoice", prefix: "FA-", nextNumber: 1001, nextDocumentNumber: "FA-1001" }, { series: "credit_note", prefix: "K-" }] });
    expect(await auditRows(c.storeId, "invoice.series_set")).toHaveLength(1);

    const order = await fx.paidOrder(c, [["DEMO-MUG-WHITE", 1]]);
    const invoice = await fx.invoiceOf(c.storeId, order.orderId);
    expect(invoice?.documentNumber).toBe("FA-1001");
    const locked = (await settings.seriesStates(c.storeId))[0];
    expect(locked).toMatchObject({ issued: 1, locked: true, nextNumber: 1002 });
    expect(await settings.setSeries(owner, { series: "invoice", prefix: "ZZ-", nextNumber: 5 })).toMatchObject({ ok: false, problems: ["Numbers already issued cannot be changed."] });
    // The credit note series has no document yet and can still be set.
    expect(await settings.setSeries(owner, { series: "credit_note", prefix: "KR-", nextNumber: 7 })).toMatchObject({ ok: true });
  });

  it("refuse what the form refuses, before the database is asked", async () => {
    const owner = await fx.ownerOf(a);
    expect(await settings.setSeries(owner, { series: "invoice", prefix: "bad prefix!", nextNumber: 1 })).toMatchObject({ ok: false, errors: { prefix: expect.any(String) } });
    expect(await settings.setSeries(owner, { series: "order", prefix: "F-", nextNumber: 1 })).toMatchObject({ ok: false, errors: { series: expect.any(String) } });
    expect(await settings.setSeries(owner, { series: "invoice", prefix: "F-", nextNumber: 0 })).toMatchObject({ ok: false, errors: { nextNumber: expect.any(String) } });
  });

  it("belong to one store: changing one's does not change another's", async () => {
    expect((await settings.seriesStates(a.storeId))[0]).toMatchObject({ prefix: "F-", nextNumber: 1 });
  });
});

describe("what is missing before invoices can be issued", () => {
  it("lists the seller's missing details and the page that fixes each, and is ready when they are given", async () => {
    const c = await fx.makeStore("set-e", { sellerDetails: false, registered: null });
    const before = await settings.invoiceReadiness(c.storeId);
    expect(before).toMatchObject({ ready: false, taxProfileSaved: false });
    expect(before.missing).toEqual(expect.arrayContaining(["legal_name", "postal_address", "organisation_number"]));
    expect(before.fixAt.legal_name).toBe("/settings/company");

    await db().execute(sql`update commerce.stores set legal_name = 'X AS', postal_address = 'Gata 1', organisation_number = '923456789', country = 'NO' where id = ${c.storeId}::uuid`);
    await db().execute(sql`insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${c.storeId}::uuid, true, 'NO923456789MVA')`);
    expect(await settings.invoiceReadiness(c.storeId)).toMatchObject({ ready: true, missing: [], taxProfileSaved: true, vatRegistered: true });
  });

  it("asks for a VAT number when the store says it is registered", async () => {
    const c = await fx.makeStore("set-f", { registered: null });
    await db().execute(sql`insert into commerce.store_tax_profile (store_id, vat_registered) values (${c.storeId}::uuid, true)`);
    const readiness = await settings.invoiceReadiness(c.storeId);
    expect(readiness.missing).toContain("vat_number");
    expect(readiness.fixAt.vat_number).toBe("/settings/tax");
    expect(readiness.ready).toBe(false);
  });

  it("says Stripe's own invoice option is ignored while Kaizen invoicing is on", async () => {
    const c = await fx.makeStore("set-g");
    expect((await settings.invoiceReadiness(c.storeId)).stripeInvoicesIgnored).toBe(false);
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${c.storeId}::uuid and provider = 'stripe'`);
    expect((await settings.invoiceReadiness(c.storeId)).stripeInvoicesIgnored).toBe(true);
    await settings.saveInvoiceSettings(await fx.ownerOf(c), { enabled: "false" });
    expect((await settings.invoiceReadiness(c.storeId)).stripeInvoicesIgnored).toBe(false);
  });

  it("flags rates kept by hand for the accountant", async () => {
    const [row] = await db().execute<Row>(sql`select rates_auto from commerce.stores where id = ${a.storeId}::uuid`);
    expect((await settings.invoiceReadiness(a.storeId)).ratesByHand).toBe(row.rates_auto !== true);
  });
});
