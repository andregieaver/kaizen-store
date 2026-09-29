import { sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { CreditNoteDocumentView, InvoiceDocumentView } from "@/components/work/invoice-document";
import { formatMoney } from "@/lib/money";
import { printableState } from "@/lib/work-invoice-print";

import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const invoices = await import("./work-invoices");

/**
 * The printed documents (docs/work.md 7.2 WP7a) from real data: an invoice issued in a store that is
 * registered for VAT is drawn from its frozen snapshot, so changing the store's or the client's details
 * afterwards changes nothing in it; a draft does not print; a credit note is drawn from what it froze.
 */

const run = Date.now().toString(36);
const IBAN = "NO9386011117947";

afterAll(async () => {
  await closeDb();
});

async function makeStore(tag: string): Promise<{ storeId: string; actor: WorkActor }> {
  const name = `wd-${tag}-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic, payment_note, invoice_footer)
    values (${storeId}::uuid, true, 'NO923456789MVA', 14, ${IBAN}, 'DNBANOKKXXX', 'Pay by bank transfer.', 'Konsulent AS <b>footer</b>')`);
  return { storeId, actor: { account: { id: String(owner.id) }, store: { id: storeId } } };
}

async function makeClient(storeId: string, locale: string, name: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, country, billing_address, currency, default_hourly_rate_minor,
                                       locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, ${name}, 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 150000,
            ${locale}, true, 'domestic', 'faktura@kunde.no')
    returning id`);
  return String(row.id);
}

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

describe("Work documents from real data", () => {
  it("draws an issued invoice from its snapshot, and a credit note from what it froze", async () => {
    const { storeId, actor } = await makeStore("main");
    const client = await makeClient(storeId, "sv-SE", "Kund <i>AB</i>");
    const draft = ok(await invoices.createDraftInvoice(actor, { clientId: client })).invoiceId;

    // A draft is a preview at best: it never prints.
    const preview = (await invoices.invoiceDocumentData(storeId, draft))!;
    expect(preview.draft).toBe(true);
    expect(printableState(preview)).toEqual({ printable: false, reason: "draft" });

    ok(
      await invoices.saveLines(actor, draft, [
        {
          description: "Workshop <script>alert(1)</script>",
          unit: "hour",
          quantityHundredths: 400,
          unitPriceMinor: 100_000,
          discountBp: 0,
          vatCategory: "standard",
        },
        {
          description: "Materials",
          unit: "unit",
          quantityHundredths: 200,
          unitPriceMinor: 5_000,
          discountBp: 1000,
          vatCategory: "standard",
        },
      ]),
    );
    const issued = ok(await invoices.issueInvoice(actor, { invoiceId: draft })).invoice;
    const doc = (await invoices.invoiceDocumentData(storeId, issued.invoiceId))!;
    expect(printableState(doc)).toEqual({ printable: true });
    expect(doc.documentNumber).toMatch(/^W-/);

    // The store changes its details afterwards; the issued document does not.
    await db().execute(sql`update commerce.stores set legal_name = 'Nytt Navn AS' where id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.work_clients set name = 'Byttet' where id = ${client}::uuid`);
    const again = (await invoices.invoiceDocumentData(storeId, issued.invoiceId))!;

    const html = renderToStaticMarkup(createElement(InvoiceDocumentView, { doc: again }));
    expect(html).toContain('lang="sv"');
    expect(html).toContain(`Faktura</h1>`);
    expect(html).toContain(doc.documentNumber!);
    expect(html).toContain("Konsulent AS");
    expect(html).not.toContain("Nytt Navn");
    expect(html).toContain("NO923456789MVA");
    expect(html).toContain(IBAN);
    expect(html).toContain("Kund &lt;i&gt;AB&lt;/i&gt;");
    expect(html).toContain("Workshop &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>footer</b>");
    expect(html).toContain("Betalningsvillkor: 14 dagar netto");
    // 4.00 h at 1 000.00 + 2 x 50.00 less 10 % = 4 090.00 + 25 % VAT.
    expect(again.totals.subtotalMinor).toBe(409_000);
    expect(html).toContain(formatMoney(409_000, "NOK", "sv-SE"));
    expect(html).toContain(formatMoney(511_250, "NOK", "sv-SE"));
    expect(html).toContain("4,00 tim");

    // A partial credit note: one hour of the workshop.
    const line = (await invoices.getWorkInvoiceDetail(storeId, issued.invoiceId))!.lines[0];
    const credit = ok(
      await invoices.creditInvoice(actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "One hour too many",
        lines: [{ lineId: line.id, quantityHundredths: 100 }],
      }),
    ).creditNote;
    const note = (await invoices.creditNoteDocumentData(storeId, credit.creditNoteId))!;
    const noteHtml = renderToStaticMarkup(createElement(CreditNoteDocumentView, { doc: note }));
    expect(noteHtml).toContain("Kreditfaktura</h1>");
    expect(noteHtml).toContain(note.documentNumber);
    expect(noteHtml).toContain(`Denna kreditfaktura krediterar en del av faktura ${doc.documentNumber}.`);
    expect(noteHtml).toContain("One hour too many");
    expect(noteHtml).toContain(formatMoney(-100_000, "NOK", "sv-SE"));
    expect(noteHtml).toContain(formatMoney(-125_000, "NOK", "sv-SE"));
    expect(noteHtml).not.toContain("Nytt Navn");

    // The invoice now names its credit note and what is still due.
    const credited = (await invoices.invoiceDocumentData(storeId, issued.invoiceId))!;
    const creditedHtml = renderToStaticMarkup(createElement(InvoiceDocumentView, { doc: credited }));
    expect(creditedHtml).toContain(note.documentNumber);
    expect(creditedHtml).toContain(formatMoney(511_250 - 125_000, "NOK", "sv-SE"));

    // Documents are the store's own: another store sees nothing.
    const other = await makeStore("other");
    expect(await invoices.invoiceDocumentData(other.storeId, issued.invoiceId)).toBeNull();
    expect(await invoices.creditNoteDocumentData(other.storeId, credit.creditNoteId)).toBeNull();
  });
});
