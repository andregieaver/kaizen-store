import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { vatTermOfDay } from "@/lib/vat-return";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const ledger = await import("./ledger");
const { connectTripletex, startTripletex } = await import("./tripletex");
const { syncDueTripletex } = await import("./tripletex-sync");
const { ourVatReturn, theirVatReturn, setVatTermSize, vatReturnOrgNumber, vatReturnXml } = await import("./vat-return");
const { fakeTripletex } = await import("./tripletex-test-support");
const { getStore } = await import("./stores");

import type { Membership } from "./auth";
import type { InvoiceResult, WorkActor } from "./work-invoices";
import type { FakeTripletex } from "./tripletex-test-support";

type Row = Record<string, unknown>;

/**
 * The VAT return (B5, D496) against a real database and the Tripletex in memory: a term's return from the store's own books, the same
 * days in Tripletex worked out from its postings, the two agreeing for an invoice booked in both and differing by a purchase posted only
 * here; Tripletex's status of the term; the XML; and the owner's term length.
 */

const run = Date.now().toString(36);
let counter = 0;
const BASE = 500_000 + Math.floor(Math.random() * 400_000) * 10;
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workStore(): Promise<{ storeId: string; actor: WorkActor & { account: { id: string } }; org: string; member: Membership }> {
  counter += 1;
  const name = `vat-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(30_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  const actor = { account: { id: String(owner.id) }, store: { id: storeId } };
  const member = { account: { id: String(owner.id), email: `${name}@example.com`, name: "W", platformAdmin: false }, store: (await getStore(name))!, role: "owner" } as unknown as Membership;
  return { storeId, actor, org, member };
}

async function issued(actor: WorkActor, storeId: string): Promise<string> {
  const [client] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, 'Acme', 'Acme AS', '987654321', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@acme.example')
    returning id`);
  const draft = ok(await invoices.createDraftInvoice(actor, { clientId: String(client.id) })).invoiceId;
  ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
  return ok(await invoices.issueInvoice(actor, { invoiceId: draft })).invoice.invoiceId;
}

async function connected(storeId: string, accountId: string, org: string, companyId: number): Promise<FakeTripletex> {
  const tx = fakeTripletex({ companyId, organizationNumber: org });
  tx.apiTokens.add(token(String(companyId)));
  const result = await connectTripletex(accountId, storeId, token(String(companyId)), { fetch: tx.fetch });
  if (!result.ok) throw new Error(result.problem);
  const started = await startTripletex(accountId, storeId);
  if (!started.ok) throw new Error(started.problem);
  return tx;
}

describe("the VAT return, from the books and compared with Tripletex (D496)", () => {
  it("gives a term's lines and what to pay, agrees with Tripletex for an invoice booked in both, and shows a purchase posted only here", async () => {
    const { storeId, actor, org, member } = await workStore();
    const [{ d: today }] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    const term = vatTermOfDay("two_months", String(today));
    const tx = await connected(storeId, actor.account.id, org, BASE + 1);
    // The books open on the term's first day, so the term is whole.
    const opened = await ledger.openLedgerBook(member, term.from);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await issued(actor, storeId);
    const book = (await ledger.openBookOf(storeId))!;
    await ledger.postDueDocuments(storeId, { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn });
    expect(await syncDueTripletex({ deps: { fetch: tx.fetch }, storeIds: [storeId] })).toMatchObject({ sent: 1 });

    const ours = await ourVatReturn(book, term);
    expect(ours.partial).toBe(false);
    expect(ours.ret.lines).toEqual([{ code: "3", side: "due", base: 1_200_000, rate: 25, vat: 300_000 }]);
    expect(ours.ret.total).toBe(300_000);

    // Tripletex has it too: the same return, worked out from its postings (its own VAT postings not counted twice).
    tx.vatStatus.set(`${term.year}-${term.term}`, { voucherNumber: 0, totalAmountVatBasis: 12000, altinnPaymentAmount: 3000, deliveryStatus: { status: "NOT_SENT" }, paymentStatus: { status: "NOT_PAID" } });
    const same = await theirVatReturn(storeId, ours, { fetch: tx.fetch });
    expect(same).toMatchObject({ ok: true, comparison: { differences: [], totalDifference: 0 }, status: { delivery: "NOT_SENT", owedMinor: 300_000, basisMinor: 1_200_000 } });

    // A purchase posted here only (a receipt for 1 000.00 with 25 % VAT): the return deducts it, and the comparison says so.
    const posted = await ledger.postHandEntry(
      member,
      {
        series: "M",
        date: String(today),
        text: "Kontorrekvisita",
        rows: [
          { account: "6800", debit: "800", credit: "", vatCode: "1" },
          { account: "2710", debit: "200", credit: "", vatCode: "1" },
          { account: "1920", debit: "", credit: "1000", vatCode: "" },
        ],
      },
    );
    expect(posted.ok).toBe(true);
    const after = await ourVatReturn(book, term);
    expect(after.ret.lines).toEqual([
      { code: "1", side: "deducted", base: null, rate: null, vat: -20_000 },
      { code: "3", side: "due", base: 1_200_000, rate: 25, vat: 300_000 },
    ]);
    expect(after.ret.total).toBe(280_000);
    const differ = await theirVatReturn(storeId, after, { fetch: tx.fetch });
    expect(differ).toMatchObject({ ok: true, comparison: { differences: [{ code: "1", oursVat: -20_000, theirsVat: 0 }], totalDifference: -20_000 } });

    // The XML says the same.
    const org9 = await vatReturnOrgNumber(book, storeId);
    expect(org9).toBe(org);
    const xml = vatReturnXml(org9!, after, storeId);
    expect(xml).toContain("<fastsattMerverdiavgift>2800</fastsattMerverdiavgift>");
    expect(xml).toContain(`<organisasjonsnummer>${org}</organisasjonsnummer>`);
  }, 60_000);

  it("keeps the owner's term length, audited, and refuses anything else", async () => {
    const { storeId, member } = await workStore();
    const opened = await ledger.openLedgerBook(member, "2026-01-01");
    expect(opened.ok).toBe(true);
    const book = (await ledger.openBookOf(storeId))!;
    expect(book.vatTerm).toBe("two_months");
    expect(await setVatTermSize(member, book.id, "monthly")).toEqual({ ok: false });
    expect(await setVatTermSize(member, book.id, "year")).toEqual({ ok: true });
    expect((await ledger.openBookOf(storeId))!.vatTerm).toBe("year");
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'work.ledger_vat_term_set'`);
    expect(audited.n).toBe(1);
    expect(await theirVatReturn(storeId, await ourVatReturn((await ledger.openBookOf(storeId))!, vatTermOfDay("year", "2026-06-01")))).toEqual({ ok: false, problem: "connection" });
    // No organisation number on the books nor the store: no return is offered.
    await db().execute(sql`update commerce.stores set organisation_number = null where id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.ledger_books set organisation_number = '' where id = ${book.id}::uuid`);
    expect(await vatReturnOrgNumber((await ledger.openBookOf(storeId))!, storeId)).toBeNull();
  });
});
