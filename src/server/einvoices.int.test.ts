import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const { documentUbl } = await import("./einvoices");

/**
 * Invoices and credit notes as EN 16931 UBL (D403) against a real database: an invoice issued when an order was paid, and the credit note a refund
 * issued, each put in the format from its frozen snapshot with the snapshot's totals; another store's document is not found.
 */

afterAll(async () => {
  await closeDb();
});

const value = (xml: string, tag: string) => Number(new RegExp(`<cbc:${tag} currencyID="NOK">([0-9.]+)</cbc:${tag}>`).exec(xml)?.[1]);

describe("e-invoices (D403)", () => {
  it("makes an issued invoice and a refund's credit note, with the documents' own totals", async () => {
    const own = await fx.makeStore("einv");
    const other = await fx.makeStore("einv-other");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 3]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const out = await documentUbl(own.storeId, "invoice", invoice.id);
    if (!out?.ok) throw new Error(JSON.stringify(out));
    expect(out.xml).toContain(`<cbc:ID>${invoice.documentNumber}</cbc:ID>`);
    expect(value(out.xml, "TaxInclusiveAmount")).toBe(invoice.totalMinor / 100);
    expect(value(out.xml, "TaxExclusiveAmount")).toBe(invoice.netMinor / 100);
    expect(await documentUbl(other.storeId, "invoice", invoice.id)).toBeNull();

    // A refund made outside Kaizena Flow's own path (in Stripe, by hand) gets its credit note at commit all the same (D159).
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
      select p.store_id, p.id, 5000, 'Skadet', ${`re_${order.orderId.slice(0, 8)}`}, 'succeeded' from commerce.payments p
      where p.store_id = ${own.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
    `);
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    const credit = await documentUbl(own.storeId, "credit_note", note.id);
    if (!credit?.ok) throw new Error(JSON.stringify(credit));
    expect(credit.xml).toContain(`<cbc:ID>${invoice.documentNumber}</cbc:ID>`);
    expect(value(credit.xml, "TaxInclusiveAmount")).toBe(note.totalMinor / 100);
  });
});
