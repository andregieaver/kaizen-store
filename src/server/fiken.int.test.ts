import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { sealFikenState } from "@/lib/fiken";
import { parseKey } from "@/lib/secret-box";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const fx = await import("./invoice-test-fixture");
const { chooseFikenCompany, disconnectFiken, finishFikenConnect, getFikenConnection, startFiken, fikenAttention } = await import("./fiken");
const { syncDueFiken, retryFiken, checkFikenDocument, postFikenAgain } = await import("./fiken-sync");
const { accountingAttention } = await import("./accounting");
const { fakeFiken } = await import("./fiken-test-support");

import type { Membership } from "./auth";
import type { FakeFiken } from "./fiken-test-support";
import type { InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * Fiken (D460, `docs/fiken.md`) against a real database and the Fiken in memory: connecting through Fiken's consent page and back (one
 * company chosen at once, several offered, a company another store has, Tripletex first), a Work invoice and its credit note and a shop
 * order's invoice each booked once as a sale whatever happens on the way (an answer lost, a sale already there, Fiken down, the access
 * token over, the grant taken back, a locked period), and nothing sent that should not be.
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

async function workStore(): Promise<{ storeId: string; slug: string; actor: WorkActor & { account: { id: string } }; org: string }> {
  counter += 1;
  const name = `fik-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(20_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  return { storeId, slug: name, actor: { account: { id: String(owner.id) }, store: { id: storeId } }, org };
}

async function client(storeId: string, o: { name?: string; org?: string | null } = {}): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, ${o.name ?? "Acme"}, ${`${o.name ?? "Acme"} AS`}, ${o.org === undefined ? "987654321" : o.org}, 'NO',
            '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@acme.example')
    returning id`);
  return String(row.id);
}

/** An issued Work invoice: 10 hours at 1 200.00 and 25 % VAT, 15 000.00 in all. */
async function issued(actor: WorkActor, clientId: string): Promise<{ id: string; number: string; dueOn: string }> {
  const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
  ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
  const invoice = ok(await invoices.issueInvoice(actor, { invoiceId: draft })).invoice;
  const [row] = await db().execute<Row>(sql`select document_number, due_on::text as due_on from commerce.work_invoices where id = ${invoice.invoiceId}::uuid`);
  return { id: invoice.invoiceId, number: String(row.document_number), dueOn: String(row.due_on) };
}

/** The deps every call takes: the fake's network and app, and no pause between calls. */
const depsOf = (fk: FakeFiken) => ({ fetch: fk.fetch, app: () => ({ clientId: fk.clientId, clientSecret: fk.clientSecret }), sleep: async () => {} });

const owner = (storeId: string, slug: string, accountId: string) => async () => ({ account: { id: accountId }, store: { id: storeId, slug } }) as unknown as Membership;

/** Fiken's return to the callback, as a browser that pressed Connect brings it: the state cookie and Fiken's code. */
async function comeBack(fk: FakeFiken, storeId: string, slug: string, accountId: string, companies?: string[]): Promise<string> {
  const { code, verifier } = fk.issueCode(companies);
  const state = randomBytes(36).toString("base64url");
  const cookie = sealFikenState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state, store: slug, account: accountId, verifier });
  return finishFikenConnect(new URLSearchParams({ code, state }), cookie, { ...depsOf(fk), owner: owner(storeId, slug, accountId) });
}

async function connected(store: { storeId: string; slug: string; actor: { account: { id: string } } }, companySlug: string): Promise<FakeFiken> {
  const fk = fakeFiken({ companies: [{ slug: companySlug, name: "Human Web AS", organizationNumber: "912345678", hasApiAccess: true, testCompany: false }] });
  const back = await comeBack(fk, store.storeId, store.slug, store.actor.account.id);
  expect(back).toBe(`/admin/${store.slug}/integrations/fiken?fiken=connected`);
  const started = await startFiken(store.actor.account.id, store.storeId);
  if (!started.ok) throw new Error(started.problem);
  return fk;
}

const rowsOf = (storeId: string) =>
  db().execute<Row>(sql`select kind, local_id, external_key, state, their_id, their_ref, error_key, attempts, variance_minor from commerce.fiken_sync where store_id = ${storeId}::uuid order by kind, local_id`);

const sync = (fk: FakeFiken, storeId: string, now?: Date) => syncDueFiken({ deps: depsOf(fk), storeIds: [storeId], ...(now ? { now: () => now } : {}) });

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("connecting Fiken (D460)", () => {
  it("keeps the grant encrypted, chooses the one company it opens and plans where things are booked", async () => {
    const store = await workStore();
    const fk = fakeFiken({ companies: [{ slug: `hw-${run}-a`, name: "Human Web AS", organizationNumber: "912345678", hasApiAccess: true, testCompany: true }] });
    expect(await comeBack(fk, store.storeId, store.slug, store.actor.account.id)).toBe(`/admin/${store.slug}/integrations/fiken?fiken=connected`);
    const connection = await getFikenConnection(store.storeId);
    expect(connection).toMatchObject({ state: "setup", testCompany: true, company: { slug: `hw-${run}-a`, name: "Human Web AS", organizationNumber: "912345678" } });
    expect(connection?.settings?.bookings.standard_25).toEqual({ account: "3000", vatType: "HIGH" });
    expect(connection?.settings?.bookings.gift_card).toEqual({ account: "2900", vatType: "NONE" });
    const [row] = await db().execute<Row>(sql`select access_token_encrypted, refresh_token_encrypted from commerce.fiken_connections where store_id = ${store.storeId}::uuid`);
    expect(String(row.access_token_encrypted)).not.toMatch(/access-/);
    expect(String(row.refresh_token_encrypted)).not.toMatch(/refresh-/);
  });

  it("refuses a state that is not this browser's, and says when the owner declined", async () => {
    const store = await workStore();
    const fk = fakeFiken();
    const { code, verifier } = fk.issueCode();
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    const cookie = sealFikenState(key, { state: "s".repeat(40), store: store.slug, account: store.actor.account.id, verifier });
    const deps = { ...depsOf(fk), owner: owner(store.storeId, store.slug, store.actor.account.id) };
    expect(await finishFikenConnect(new URLSearchParams({ code, state: "x".repeat(40) }), cookie, deps)).toBe(`/admin/${store.slug}/integrations/fiken?fiken=failed`);
    expect(await finishFikenConnect(new URLSearchParams({ error: "access_denied", state: "s".repeat(40) }), cookie, deps)).toBe(`/admin/${store.slug}/integrations/fiken?fiken=declined`);
    expect(await finishFikenConnect(new URLSearchParams({ code, state: "s".repeat(40) }), "forged.cookie", deps)).toBe("/admin");
    // A wrong PKCE verifier is refused by Fiken: nothing kept.
    const wrong = sealFikenState(key, { state: "t".repeat(40), store: store.slug, account: store.actor.account.id, verifier: "v".repeat(64) });
    expect(await finishFikenConnect(new URLSearchParams({ code, state: "t".repeat(40) }), wrong, deps)).toBe(`/admin/${store.slug}/integrations/fiken?fiken=failed`);
    expect(await getFikenConnection(store.storeId)).toBeNull();
  });

  it("offers several companies, refuses one another store has, and is refused while Tripletex keeps the books", async () => {
    const first = await workStore();
    const second = await workStore();
    const companies = [
      { slug: `hw-${run}-b`, name: "Human Web AS", organizationNumber: "912345678", hasApiAccess: true, testCompany: false },
      { slug: `hw-${run}-c`, name: "Holding AS", organizationNumber: null, hasApiAccess: false, testCompany: false },
    ];
    const fk = fakeFiken({ companies });
    expect(await comeBack(fk, first.storeId, first.slug, first.actor.account.id)).toBe(`/admin/${first.slug}/integrations/fiken?fiken=choose`);
    expect(await getFikenConnection(first.storeId)).toMatchObject({ state: "choose", company: null });
    expect(await chooseFikenCompany(first.actor.account.id, first.storeId, `hw-${run}-c`, depsOf(fk))).toMatchObject({ ok: false, problem: "no_api_access" });
    expect(await chooseFikenCompany(first.actor.account.id, first.storeId, `hw-${run}-b`, depsOf(fk))).toMatchObject({ ok: true, company: { slug: `hw-${run}-b` } });

    expect(await comeBack(fk, second.storeId, second.slug, second.actor.account.id, [`hw-${run}-b`])).toBe(`/admin/${second.slug}/integrations/fiken?fiken=taken`);

    const third = await workStore();
    await db().execute(sql`
      insert into commerce.tripletex_connections (store_id, mode, token_kind, token_encrypted, token_hint, company_id, company_name)
      values (${third.storeId}::uuid, 'test', 'api_token', 'v2.x', 'tlxr_…abcd', ${800_000_000 + Math.floor(Math.random() * 100_000_000)}, 'Annet AS')`);
    expect(await comeBack(fk, third.storeId, third.slug, third.actor.account.id)).toBe(`/admin/${third.slug}/integrations/fiken?fiken=other_system`);
  });
});

describe("sending to Fiken (D460)", () => {
  it("books an issued Work invoice once, as a sale under its own number on the client's contact", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-d`);
    const invoice = await issued(store.actor, await client(store.storeId));

    expect(await sync(fk, store.storeId)).toMatchObject({ stores: 1, sent: 1, failed: 0, blocked: 0 });
    const sales = [...fk.sales.values()];
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ saleNumber: invoice.number, kind: "external_invoice", currency: "NOK", dueDate: invoice.dueOn });
    expect(sales[0].lines).toEqual([{ description: "Rådgivning", netPrice: 1_200_000, vat: 300_000, account: "3000", vatType: "HIGH" }]);
    const contacts = [...fk.contacts.values()];
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Acme AS", organizationNumber: "987654321", customer: true, language: "NORWEGIAN" });
    expect(contacts[0].email).toBeUndefined();
    expect(sales[0].customerId).toBe(contacts[0].contactId);
    const rows = await rowsOf(store.storeId);
    expect(rows.map((r) => [r.kind, r.state, r.their_ref ?? null])).toEqual([
      ["customer", "synced", null],
      ["work_invoice", "synced", "1"],
    ]);
    expect(rows[1].variance_minor).toBeNull();

    // A second run sends nothing again.
    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 0, adopted: 0 });
    expect(fk.sales.size).toBe(1);
  });

  it("books a credit note after its invoice, as a sale with the lines turned", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-e`);
    const invoice = await issued(store.actor, await client(store.storeId));
    const line = (await invoices.getWorkInvoiceDetail(store.storeId, invoice.id))!.lines[0];
    ok(await invoices.creditInvoice(store.actor, { invoiceId: invoice.id, kind: "partial", reason: "En time for mye", lines: [{ lineId: line.id, quantityHundredths: 100 }] }));

    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 2 });
    const [sale, credit] = [...fk.sales.values()].sort((a, b) => a.saleId - b.saleId);
    expect(sale.saleNumber).toBe(invoice.number);
    expect(credit.lines).toEqual([{ description: `Kreditnota ${credit.saleNumber} for faktura ${invoice.number}: Rådgivning`, netPrice: -120_000, vat: -30_000, account: "3000", vatType: "HIGH" }]);
    expect(credit.customerId).toBe(sale.customerId);
    expect(fk.contacts.size).toBe(1);
  });

  it("adopts the sale when its answer was lost, and never books it twice", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-f`);
    await issued(store.actor, await client(store.storeId));
    fk.loseAnswer("POST", /\/sales$/);
    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 0, failed: 1 });
    expect(fk.sales.size).toBe(1);
    expect(await sync(fk, store.storeId, later(2))).toMatchObject({ adopted: 1, sent: 0 });
    expect(fk.sales.size).toBe(1);
    expect((await rowsOf(store.storeId)).find((r) => r.kind === "work_invoice")).toMatchObject({ state: "synced", their_ref: "1" });
  });

  it("adopts the owner's own booking of the same sale, and leaves another sale with the number for a person", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-g`);
    const company = `hw-${run}-g`;
    const first = await issued(store.actor, await client(store.storeId));
    const second = await issued(store.actor, await client(store.storeId, { name: "Beta", org: "912000222" }));
    const today = String((await db().execute<Row>(sql`select issued_on::text as d from commerce.work_invoices where id = ${first.id}::uuid`))[0].d);
    const by = (number: string, net: number, vat: number) =>
      fk.sales.set(90_000 + fk.sales.size, {
        saleId: 90_000 + fk.sales.size,
        company,
        saleNumber: number,
        date: today,
        kind: "external_invoice",
        currency: "NOK",
        customerId: 1,
        dueDate: null,
        lines: [{ description: "For hånd", netPrice: net, vat, account: "3000", vatType: "HIGH" }],
        deleted: false,
        transactionId: 0,
        journalEntryNumber: 0,
        files: [],
      });
    by(first.number, 1_200_000, 300_000);
    by(second.number, 999, 0);

    expect(await sync(fk, store.storeId)).toMatchObject({ adopted: 1, blocked: 1, sent: 0 });
    const rows = await rowsOf(store.storeId);
    expect(rows.find((r) => r.local_id === first.id)).toMatchObject({ state: "synced" });
    expect(rows.find((r) => r.local_id === second.id)).toMatchObject({ state: "blocked", error_key: "number_taken" });
    expect(fk.sales.size).toBe(2);
  });

  it("refreshes an access token that is over, and stops when Fiken takes the grant back, until connected again", async () => {
    const store = await workStore();
    const company = `hw-${run}-h`;
    const fk = await connected(store, company);
    await issued(store.actor, await client(store.storeId));
    await db().execute(sql`update commerce.fiken_connections set access_expires_at = now() - interval '1 hour' where store_id = ${store.storeId}::uuid`);
    fk.expireAccess();
    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 1 });
    expect(fk.refreshes).toBe(1);

    await issued(store.actor, await client(store.storeId));
    fk.revokeGrants();
    await db().execute(sql`update commerce.fiken_connections set access_expires_at = now() - interval '1 hour' where store_id = ${store.storeId}::uuid`);
    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 0 });
    expect(await getFikenConnection(store.storeId)).toMatchObject({ state: "auth_failed" });
    expect(await fikenAttention(store.storeId)).toMatchObject({ tokenRefused: true });
    expect(await accountingAttention(store.storeId)).toMatchObject({ system: "fiken", name: "Fiken", tokenRefused: true });

    // Connected again to the same company: it goes on where it stopped.
    expect(await comeBack(fk, store.storeId, store.slug, store.actor.account.id)).toBe(`/admin/${store.slug}/integrations/fiken?fiken=connected`);
    expect(await getFikenConnection(store.storeId)).toMatchObject({ state: "on" });
    expect(await sync(fk, store.storeId, later(2))).toMatchObject({ sent: 1 });
    expect(fk.sales.size).toBe(2);
  });

  it("waits visibly on a locked period and on Fiken being down, then goes when told", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-i`);
    const invoice = await issued(store.actor, await client(store.storeId));
    fk.lockedBefore = "2999-01-01";
    expect(await sync(fk, store.storeId)).toMatchObject({ blocked: 1 });
    expect((await rowsOf(store.storeId)).find((r) => r.local_id === invoice.id)).toMatchObject({ state: "blocked", error_key: "closed_period" });
    fk.lockedBefore = null;
    fk.failNext("POST", /\/sales$/, 503);
    expect(await retryFiken(store.storeId)).toBe(1);
    expect(await sync(fk, store.storeId)).toMatchObject({ failed: 1 });
    // Its second try: the ladder's second rung, five minutes on.
    expect(await sync(fk, store.storeId, later(2))).toMatchObject({ stores: 0 });
    expect(await sync(fk, store.storeId, later(6))).toMatchObject({ sent: 1 });
  });

  it("books a shop order's invoice on the shop's own contact, never a shopper's name, with its PDF once made", async () => {
    const shop = await fx.makeStore("fikshop");
    const order = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]], { email: "kari.nordmann@example.com" });
    const invoice = (await fx.invoiceOf(shop.storeId, order.orderId))!;
    const [slugRow] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${shop.storeId}::uuid`);
    const fk = await connected({ storeId: shop.storeId, slug: String(slugRow.slug), actor: { account: { id: shop.ownerId } } }, `hw-${run}-j`);
    const files = new Map<string, Uint8Array>();
    const storage = { upload: async (path: string, bytes: Uint8Array) => (files.set(path, bytes), true), download: async (path: string) => files.get(path) ?? null, remove: async () => true };
    const runOnce = () => syncDueFiken({ deps: depsOf(fk), storeIds: [shop.storeId], storage });

    expect(await runOnce()).toMatchObject({ sent: 1, attached: 0 });
    const [sale] = [...fk.sales.values()];
    expect(sale.saleNumber).toBe(invoice.documentNumber);
    expect(sale.lines.reduce((t, l) => t + l.netPrice + l.vat, 0)).toBe(invoice.totalMinor);
    expect([...fk.contacts.values()].map((c) => c.name)).toEqual(["Nettbutikkunder (Kaizena Flow)"]);
    expect(JSON.stringify([...fk.contacts.values(), sale])).not.toMatch(/kari|nordmann/i);

    const path = `${shop.storeId}/invoices/${invoice.id}.pdf`;
    files.set(path, new TextEncoder().encode(`%PDF-1.7 ${invoice.documentNumber}`));
    await db().execute(sql`update commerce.invoices set pdf_path = ${path}, pdf_sha256 = ${"0".repeat(64)} where id = ${invoice.id}::uuid`);
    expect(await runOnce()).toMatchObject({ sent: 0, attached: 1 });
    expect(sale.files).toEqual([{ name: `${invoice.documentNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`, type: "application/pdf", size: files.get(path)!.length, head: "%PDF-", attachToSale: true }]);
    expect(await runOnce()).toMatchObject({ attached: 0 });
  });

  it("finds a sale deleted in Fiken, posts it again on the owner's press, and forgets the grant on Disconnect", async () => {
    const store = await workStore();
    const fk = await connected(store, `hw-${run}-k`);
    const invoice = await issued(store.actor, await client(store.storeId));
    expect(await sync(fk, store.storeId)).toMatchObject({ sent: 1 });
    expect(await checkFikenDocument(store.storeId, "work_invoice", invoice.id, depsOf(fk))).toBe("booked");
    [...fk.sales.values()][0].deleted = true;
    expect(await checkFikenDocument(store.storeId, "work_invoice", invoice.id, depsOf(fk))).toBe("gone");
    expect(await sync(fk, store.storeId, later(1))).toMatchObject({ sent: 0 });
    expect(await postFikenAgain(store.storeId, "work_invoice", invoice.id, store.actor.account.id)).toBe(true);
    expect(await sync(fk, store.storeId, later(2))).toMatchObject({ sent: 1 });
    expect([...fk.sales.values()].filter((s) => !s.deleted)).toHaveLength(1);

    await issued(store.actor, await client(store.storeId));
    expect(await disconnectFiken(store.actor.account.id, store.storeId, depsOf(fk))).toBe(true);
    expect(fk.revoked).toBe(1);
    expect(await getFikenConnection(store.storeId)).toBeNull();
    // What was sent stays recorded; nothing more goes.
    expect((await rowsOf(store.storeId)).filter((r) => r.kind === "work_invoice").map((r) => r.state)).toEqual(["synced"]);
  });
});
