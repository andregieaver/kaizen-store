import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const { connectTripletex, startTripletex } = await import("./tripletex");
const { syncDueTripletex } = await import("./tripletex-sync");
const { fakeTripletex } = await import("./tripletex-test-support");
const ledger = await import("./ledger");
const { compareWithTripletex, ledgerComparisonSummary } = await import("./ledger-compare");

import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * Our own ledger's step 4 (D478) against a real database and Tripletex in memory: a store's Work invoices are booked in Tripletex by its
 * sync and posted to its books here; each is compared with its voucher there, account by account and in VAT. One agrees; one whose voucher
 * was changed in Tripletex differs, by the øre and the account; one whose voucher was deleted there is missing.
 */

const run = Date.now().toString(36);
const BASE = 300_000 + Math.floor(Math.random() * 600_000) * 10;
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workStore(): Promise<{ storeId: string; actor: WorkActor & { account: { id: string } }; org: string }> {
  const name = `lcmp-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(30_000_000 + (BASE % 1000)).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  return { storeId, actor: { account: { id: String(owner.id) }, store: { id: storeId } }, org };
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

describe("a store's books compared with Tripletex", () => {
  it("finds a document that agrees, one whose voucher was changed there, and one whose voucher was deleted", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = fakeTripletex({ companyId: BASE + 1, organizationNumber: org });
    tx.apiTokens.add(token(String(BASE + 1)));
    const connected = await connectTripletex(actor.account.id, storeId, token(String(BASE + 1)), { fetch: tx.fetch });
    if (!connected.ok) throw new Error(connected.problem);
    const started = await startTripletex(actor.account.id, storeId);
    if (!started.ok) throw new Error(started.problem);

    const same = await issued(actor, storeId);
    const changed = await issued(actor, storeId);
    const deleted = await issued(actor, storeId);
    await syncDueTripletex({ deps: { fetch: tx.fetch }, storeIds: [storeId] });
    expect(tx.vouchers.size).toBe(3);

    const [book] = await db().execute<Row>(sql`
      insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on) values (${storeId}::uuid, 'Konsulent AS', 'NO', 'NOK', current_date - 1)
      returning id, opened_on::text`);
    const b = { id: String(book.id), currency: "NOK", opened_on: String(book.opened_on), closed_on: null };
    expect(await ledger.postDueDocuments(storeId, b)).toEqual({ posted: 3, waiting: 0 });

    // In Tripletex, someone moves an øre on the second voucher's income and receivable, and deletes the third.
    const syncRow = async (localId: string) =>
      Number((await db().execute<Row>(sql`select their_id from commerce.tripletex_sync where store_id = ${storeId}::uuid and local_id = ${localId}`))[0].their_id);
    const v = tx.vouchers.get(await syncRow(changed))!;
    for (const p of v.postings) {
      if (p.amountGross < 0) {
        p.amountGross = Math.round((p.amountGross - 0.01) * 100) / 100;
        p.amount = Math.round((p.amount - 0.01) * 100) / 100;
      } else {
        p.amountGross = Math.round((p.amountGross + 0.01) * 100) / 100;
        p.amount = Math.round((p.amount + 0.01) * 100) / 100;
      }
    }
    tx.vouchers.delete(await syncRow(deleted));

    expect(await compareWithTripletex(storeId, { id: b.id }, { deps: { fetch: tx.fetch } })).toEqual({ compared: 3, agree: 1, differ: 1, missing: 1 });
    // Compared again the same day: nothing more to compare.
    expect(await compareWithTripletex(storeId, { id: b.id }, { deps: { fetch: tx.fetch } })).toEqual({ compared: 0, agree: 0, differ: 0, missing: 0 });

    const summary = await ledgerComparisonSummary(b.id);
    expect(summary).toMatchObject({ agree: 1, differ: 1, missing: 1 });
    const differs = summary.items.find((i) => i.state === "differs")!;
    expect(differs.id).toBe(changed);
    expect(differs.differences).toEqual([
      { account: 1500, ours: 1_500_000, theirs: 1_500_001 },
      { account: 3000, ours: -1_200_000, theirs: -1_200_001 },
    ]);
    expect(summary.items.find((i) => i.state === "missing")?.id).toBe(deleted);
    expect(summary.items.some((i) => i.id === same)).toBe(false);
  });
});
