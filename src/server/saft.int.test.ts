import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { partyId } from "@/lib/saft";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const ledger = await import("./ledger");
const bills = await import("./supplier-invoices");
const { saftFile } = await import("./saft");
const { getStore } = await import("./stores");

import type { Membership } from "./auth";
import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * SAF-T Financial (B5 step 2, D497) against a real database: a year of a store's books as Skatteetaten's file, with each account's code
 * and balances, an invoice's and its payment's lines naming the client (and its reversal the same client), a bill's line and its supplier,
 * a purchase's VAT on its own line; the file audited; refused for a year the book does not hold and without an organisation number.
 */

const run = Date.now().toString(36);
let counter = 0;

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workStore(): Promise<{ storeId: string; actor: WorkActor & { account: { id: string } }; org: string; member: Membership }> {
  counter += 1;
  const name = `saft-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari Nordmann', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(40_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  const actor = { account: { id: String(owner.id) }, store: { id: storeId } };
  const member = {
    account: { id: String(owner.id), email: `${name}@example.com`, name: "Kari Nordmann", platformAdmin: false },
    store: (await getStore(name))!,
    role: "owner",
  } as unknown as Membership;
  return { storeId, actor, org, member };
}

const PDF = new TextEncoder().encode("%PDF-1.7\n% faktura\n%%EOF\n");
const bucket = () => {
  const files = new Map<string, Uint8Array>();
  return {
    async upload(path: string, bytes: Uint8Array) {
      files.set(path, bytes);
      return true;
    },
    async download(path: string) {
      return files.get(path) ?? null;
    },
    async remove() {
      return true;
    },
  };
};

describe("a year of the books as Skatteetaten's SAF-T file (D497)", () => {
  it("writes each account's code and balances, and names the client and supplier on their lines", async () => {
    const { storeId, actor, org, member } = await workStore();
    const [{ d: today }] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    const day = String(today);
    const year = Number(day.slice(0, 4));
    const opened = await ledger.openLedgerBook(member, `${day.slice(0, 7)}-01`);
    expect(opened.ok).toBe(true);
    const book = (await ledger.openBookOf(storeId))!;
    const due = { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn };

    // An invoice to a client, and the client's payment.
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
      values (${storeId}::uuid, 'Acme', 'Acme AS', '987654321', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@acme.example')
      returning id`);
    const clientId = String(client.id);
    const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
    ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
    const invoiceId = ok(await invoices.issueInvoice(actor, { invoiceId: draft })).invoice.invoiceId;
    await ledger.postDueDocuments(storeId, due);
    ok(await invoices.recordPayment(actor, { invoiceId, amountMinor: 1_500_000, receivedOn: day, method: "bank" }));
    await ledger.postDueDocuments(storeId, due);

    // A bill from a supplier, and a receipt posted by hand.
    const bill = await bills.addBill(
      member,
      { supplier: "Telenor Norge AS", organisationNumber: "976 967 631", number: "88123", issuedOn: day, dueOn: null, totalMinor: 125_000, kind: "phone", vatRate: 25 },
      { name: "telenor.pdf", bytes: PDF },
      { storage: bucket() },
    );
    expect(bill.ok).toBe(true);
    const hand = await ledger.postHandEntry(member, {
      series: "M",
      date: day,
      text: "Kontorrekvisita",
      rows: [
        { account: "6800", debit: "800", credit: "", vatCode: "1" },
        { account: "2710", debit: "200", credit: "", vatCode: "1" },
        { account: "1920", debit: "", credit: "1000", vatCode: "" },
      ],
    });
    expect(hand.ok).toBe(true);

    // The invoice's entry reversed: its reversal is the same client's.
    const [sale] = await db().execute<Row>(sql`select id from commerce.ledger_entries where book_id = ${book.id}::uuid and source_kind = 'work_invoice'`);
    expect((await ledger.reverseLedgerEntry(member, String(sale.id), day)).ok).toBe(true);

    const made = await saftFile(member, book, year, day);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const xml = made.xml;
    expect(made.organisationNumber).toBe(org);
    expect(xml).toContain(`<RegistrationNumber>${org}</RegistrationNumber>`);
    expect(xml).toMatch(/<FirstName>Kari<\/FirstName>\s*<LastName>Nordmann<\/LastName>\s*<\/ContactPerson>\s*<Email>post@konsulent.no<\/Email>/);
    expect(xml).toContain(`<PeriodStart>${Number(day.slice(5, 7))}</PeriodStart>`);
    expect(xml).toMatch(/<AccountID>2710<\/AccountID>\s*<AccountDescription>[^<]+<\/AccountDescription>\s*<GroupingCategory>kortsiktigGjeld<\/GroupingCategory>\s*<GroupingCode>2740<\/GroupingCode>/);
    // The client, with what it owes after the reversal: the payment, a credit.
    const acme = partyId(clientId);
    expect(xml).toMatch(new RegExp(`<Name>Acme AS</Name>[\\s\\S]*?<CustomerID>${acme}</CustomerID>\\s*<BalanceAccount>\\s*<AccountID>1500</AccountID>\\s*<OpeningDebitBalance>0.00</OpeningDebitBalance>\\s*<ClosingCreditBalance>15000.00</ClosingCreditBalance>`));
    expect(xml.match(new RegExp(`<AccountID>1500</AccountID>\\s*<CustomerID>${acme}</CustomerID>`, "g"))).toHaveLength(3);
    // The supplier, with the bill unpaid.
    expect(xml).toMatch(/<Name>Telenor Norge AS<\/Name>\s*<SupplierID>([0-9a-f]{32})<\/SupplierID>\s*<BalanceAccount>\s*<AccountID>2400<\/AccountID>\s*<OpeningDebitBalance>0.00<\/OpeningDebitBalance>\s*<ClosingCreditBalance>1250.00<\/ClosingCreditBalance>/);
    expect(xml).toMatch(/<AccountID>2400<\/AccountID>\s*<SupplierID>[0-9a-f]{32}<\/SupplierID>/);
    // The sale's VAT on its income line; the receipt's on its cost line.
    expect(xml).toMatch(/<AccountID>3000<\/AccountID>\s*<Description>[^<]+<\/Description>\s*<CreditAmount>\s*<Amount>12000.00<\/Amount>\s*<\/CreditAmount>\s*<TaxInformation>[\s\S]*?<TaxCode>3<\/TaxCode>[\s\S]*?<CreditTaxAmount>\s*<Amount>3000.00<\/Amount>/);
    expect(xml).toMatch(/<AccountID>6800<\/AccountID>\s*<Description>Kontorrekvisita<\/Description>\s*<DebitAmount>\s*<Amount>800.00<\/Amount>\s*<\/DebitAmount>\s*<TaxInformation>[\s\S]*?<TaxCode>1<\/TaxCode>[\s\S]*?<DebitTaxAmount>\s*<Amount>200.00<\/Amount>/);
    expect(xml).toContain("<VoucherType>Tilbakeføring</VoucherType>");
    expect(xml).toMatch(/<TotalDebit>([\d.]+)<\/TotalDebit>\s*<TotalCredit>\1<\/TotalCredit>/);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_saft_downloaded'`);
    expect(audited.n).toBe(1);

    // A year the book does not hold; no organisation number on the books nor the store.
    expect(await saftFile(member, book, year - 1, day)).toEqual({ ok: false, problem: "year" });
    await db().execute(sql`update commerce.stores set organisation_number = null where id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.ledger_books set organisation_number = '' where id = ${book.id}::uuid`);
    expect(await saftFile(member, (await ledger.openBookOf(storeId))!, year, day)).toEqual({ ok: false, problem: "org_number" });
  }, 60_000);
});
