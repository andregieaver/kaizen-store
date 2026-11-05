import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { externalVoucherNumber } from "@/lib/tripletex";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const invoices = await import("./work-invoices");
const fx = await import("./invoice-test-fixture");
const { connectTripletex, startTripletex, disconnectTripletex, getTripletexConnection } = await import("./tripletex");
const { syncDueTripletex, retryTripletex } = await import("./tripletex-sync");
const { fakeTripletex } = await import("./tripletex-test-support");

import type { InvoiceResult, WorkActor } from "./work-invoices";
import type { FakeTripletex } from "./tripletex-test-support";

type Row = Record<string, unknown>;

/**
 * Tripletex's sync (D453, `docs/tripletex.md` 3 and 8) against a real database and the Tripletex in memory: a Work invoice and its
 * credit note, a shop order's invoice, each booked once whatever happens on the way (an answer lost, runs side by side, Tripletex
 * down, a rate limit, the token deleted, a closed period), and nothing sent that should not be.
 */

const run = Date.now().toString(36);
let counter = 0;
/** Tripletex companies of this run: the database keeps earlier runs' connections, and a company belongs to one store. */
const BASE = 100_000 + Math.floor(Math.random() * 800_000) * 10;
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");

afterAll(async () => {
  await closeDb();
});

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

async function workStore(): Promise<{ storeId: string; actor: WorkActor & { account: { id: string } }; org: string }> {
  counter += 1;
  const name = `txs-${run}-${counter}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const org = `9${String(10_000_000 + counter).slice(-8)}`;
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
      contact_email = 'post@konsulent.no', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, ${`NO${org}MVA`}, 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  return { storeId, actor: { account: { id: String(owner.id) }, store: { id: storeId } }, org };
}

async function client(storeId: string, o: { name?: string; currency?: string; org?: string | null } = {}): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
    values (${storeId}::uuid, ${o.name ?? "Acme"}, ${`${o.name ?? "Acme"} AS`}, ${o.org === undefined ? "987654321" : o.org}, 'NO',
            '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, ${o.currency ?? "NOK"}, 'nb-NO', true, 'domestic', 'faktura@acme.example')
    returning id`);
  return String(row.id);
}

/** An issued Work invoice: 10 hours at 1 200.00 and 25 % VAT, 15 000.00 in all (another currency at 11.5 kroner). */
async function issued(actor: WorkActor, clientId: string, o: { fxRate?: string } = {}): Promise<{ id: string; number: string }> {
  const draft = ok(await invoices.createDraftInvoice(actor, { clientId })).invoiceId;
  ok(await invoices.saveLines(actor, draft, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 1000, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]));
  const invoice = ok(await invoices.issueInvoice(actor, { invoiceId: draft, ...(o.fxRate ? { fxRate: o.fxRate } : {}) })).invoice;
  const [row] = await db().execute<Row>(sql`select document_number from commerce.work_invoices where id = ${invoice.invoiceId}::uuid`);
  return { id: invoice.invoiceId, number: String(row.document_number) };
}

async function connected(storeId: string, accountId: string, org: string | null, companyId: number): Promise<FakeTripletex> {
  const tx = fakeTripletex({ companyId, organizationNumber: org });
  tx.apiTokens.add(token(String(companyId)));
  const result = await connectTripletex(accountId, storeId, token(String(companyId)), { fetch: tx.fetch });
  if (!result.ok) throw new Error(result.problem);
  const started = await startTripletex(accountId, storeId);
  if (!started.ok) throw new Error(started.problem);
  return tx;
}

const rowsOf = (storeId: string) =>
  db().execute<Row>(sql`select kind, local_id, state, their_id, their_ref, error_key, attempts, variance_minor from commerce.tripletex_sync where store_id = ${storeId}::uuid order by kind, local_id`);

const sync = (tx: FakeTripletex, storeId: string, now?: Date) => syncDueTripletex({ deps: { fetch: tx.fetch }, storeIds: [storeId], ...(now ? { now: () => now } : {}) });

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("sending Work's invoices to Tripletex (D453)", () => {
  it("books an issued invoice once: the client's customer card, then one voucher with Kaizena Flow's number", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 1);
    const clientId = await client(storeId);
    const invoice = await issued(actor, clientId);

    expect(await sync(tx, storeId)).toMatchObject({ stores: 1, sent: 1, failed: 0, blocked: 0 });
    const vouchers = [...tx.vouchers.values()];
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ externalVoucherNumber: externalVoucherNumber(storeId, invoice.number), description: `Faktura ${invoice.number} · Acme AS` });
    expect(vouchers[0].postings.map((p) => [p.amountGross, p.invoiceNumber ?? null])).toEqual([
      [15000, invoice.number],
      [-15000, null],
    ]);
    // Tripletex worked out the same VAT as the invoice: no difference recorded.
    expect(tx.vatOf(vouchers[0])).toBe(300_000);
    const customers = [...tx.customers.values()];
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ name: "Acme AS", organizationNumber: "987654321", invoiceSendMethod: "MANUAL", isPrivateIndividual: false });
    expect(customers[0].email).toBeUndefined();

    const rows = await rowsOf(storeId);
    expect(rows.map((r) => [r.kind, r.state])).toEqual([
      ["customer", "synced"],
      ["work_invoice", "synced"],
    ]);
    expect(rows[1]).toMatchObject({ their_ref: `${vouchers[0].year}/${vouchers[0].number}`, variance_minor: null });
    const [event] = await db().execute<Row>(sql`select type, data from commerce.work_events where store_id = ${storeId}::uuid and type = 'tripletex.synced'`);
    expect(event.data).toMatchObject({ document: invoice.number, adopted: false });

    // A second run sends nothing.
    const posts = tx.calls.filter((c) => c.method === "POST").length;
    expect(await sync(tx, storeId)).toMatchObject({ sent: 0 });
    expect(tx.calls.filter((c) => c.method === "POST").length).toBe(posts);
  });

  it("adopts a voucher whose answer was lost, and never books it twice", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 2);
    await issued(actor, await client(storeId));
    tx.loseAnswer("POST", /^\/ledger\/voucher$/);
    expect(await sync(tx, storeId)).toMatchObject({ sent: 0, failed: 1 });
    expect(tx.vouchers.size).toBe(1);
    expect((await rowsOf(storeId)).find((r) => r.kind === "work_invoice")).toMatchObject({ state: "failed", error_key: "network" });

    // Not due yet: nothing happens. Past the first rung of the ladder: looked up, found, adopted.
    expect(await sync(tx, storeId)).toMatchObject({ stores: 0 });
    expect(await sync(tx, storeId, later(2))).toMatchObject({ adopted: 1, sent: 0 });
    expect(tx.vouchers.size).toBe(1);
    expect((await rowsOf(storeId)).find((r) => r.kind === "work_invoice")).toMatchObject({ state: "synced" });
  });

  it("books once when runs overlap", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 3);
    const clientId = await client(storeId);
    await issued(actor, clientId);
    await issued(actor, clientId);
    const results = await Promise.all([sync(tx, storeId), sync(tx, storeId), sync(tx, storeId)]);
    expect(results.reduce((s, r) => s + r.sent + r.adopted, 0)).toBe(2);
    expect(tx.vouchers.size).toBe(2);
    expect(tx.customers.size).toBe(1);
  });

  it("tries again on Tripletex's own problems, waits out a rate limit, and stops for the whole store when the token is deleted", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 4);
    const clientId = await client(storeId);
    await issued(actor, clientId);

    tx.failNext("POST", /^\/ledger\/voucher$/, 503);
    expect(await sync(tx, storeId)).toMatchObject({ failed: 1 });
    tx.failNext("GET", /^\/ledger\/voucher\/>externalVoucherNumber$/, 429, {}, { "x-rate-limit-reset": "120" });
    expect(await sync(tx, storeId, later(2))).toMatchObject({ sent: 0, failed: 0 });
    const waiting = (await rowsOf(storeId)).find((r) => r.kind === "work_invoice");
    expect(waiting).toMatchObject({ state: "failed", attempts: 1 });

    tx.revokeAll();
    expect(await sync(tx, storeId, later(10))).toMatchObject({ sent: 0 });
    expect((await getTripletexConnection(storeId))?.state).toBe("auth_failed");
    // Nothing runs while the token is refused; a new token for the same company goes on where it stopped.
    expect(await sync(tx, storeId, later(20))).toMatchObject({ stores: 0 });
    tx.apiTokens.add(token("renewed"));
    expect(await connectTripletex(actor.account.id, storeId, token("renewed"), { fetch: tx.fetch })).toMatchObject({ ok: true });
    expect((await getTripletexConnection(storeId))?.state).toBe("on");
    expect(await sync(tx, storeId, later(30))).toMatchObject({ sent: 1 });
    expect(tx.vouchers.size).toBe(1);
  });

  it("waits for a person on a closed period, never redating the voucher, and books it after Try again", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 5);
    await issued(actor, await client(storeId));
    tx.closedBefore = "2999-01-01";
    expect(await sync(tx, storeId)).toMatchObject({ blocked: 1 });
    expect((await rowsOf(storeId)).find((r) => r.kind === "work_invoice")).toMatchObject({ state: "blocked", error_key: "closed_period" });
    expect(await sync(tx, storeId, later(60 * 24 * 3))).toMatchObject({ stores: 0 });
    tx.closedBefore = null;
    expect(await retryTripletex(storeId)).toBe(1);
    expect(await sync(tx, storeId)).toMatchObject({ sent: 1 });
    expect([...tx.vouchers.values()][0].date).toBe([...tx.vouchers.values()][0].postings[0].date);
  });

  it("books a credit note after its invoice, with the signs turned and the invoice's number", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 6);
    const invoice = await issued(actor, await client(storeId));
    const line = (await invoices.getWorkInvoiceDetail(storeId, invoice.id))!.lines[0];
    const credit = ok(await invoices.creditInvoice(actor, { invoiceId: invoice.id, kind: "partial", reason: "En time for mye", lines: [{ lineId: line.id, quantityHundredths: 100 }] })).creditNote;

    expect(await sync(tx, storeId)).toMatchObject({ sent: 2 });
    const vouchers = [...tx.vouchers.values()].sort((a, b) => a.id - b.id);
    expect(vouchers[0].description).toMatch(/^Faktura /);
    expect(vouchers[1].description).toMatch(/^Kreditnota .* for /);
    expect(vouchers[1].postings.map((p) => [p.amountGross, p.invoiceNumber ?? null])).toEqual([
      [-1500, invoice.number],
      [1500, null],
    ]);
    expect((await rowsOf(storeId)).map((r) => r.state)).toEqual(["synced", "synced", "synced"]);
    expect(credit.creditNoteId).toBeTruthy();
  });

  it("sends nothing issued before the start day, waits visibly on another currency, and keeps going with the rest", async () => {
    const { storeId, actor, org } = await workStore();
    const before = await issued(actor, await client(storeId));
    const tx = await connected(storeId, actor.account.id, org, BASE + 7);
    // The invoice's own day (the store's time zone), not the database's: the start day is the day after it.
    await db().execute(sql`update commerce.tripletex_connections set sync_from = (select issued_on + 1 from commerce.work_invoices where id = ${before.id}::uuid) where store_id = ${storeId}::uuid`);
    expect(await sync(tx, storeId)).toMatchObject({ stores: 0 });
    await db().execute(sql`update commerce.tripletex_connections set sync_from = (select issued_on from commerce.work_invoices where id = ${before.id}::uuid) where store_id = ${storeId}::uuid`);

    const euro = await issued(actor, await client(storeId, { name: "Euro GmbH", currency: "EUR", org: null }), { fxRate: "11.5" });
    const kroner = await issued(actor, await client(storeId, { name: "Nord", org: "912000111" }));
    const result = await sync(tx, storeId);
    expect(result).toMatchObject({ sent: 2, blocked: 1 });
    const rows = await rowsOf(storeId);
    expect(rows.find((r) => r.local_id === euro.id)).toMatchObject({ state: "blocked", error_key: "currency_unsupported" });
    expect(rows.find((r) => r.local_id === kroner.id)).toMatchObject({ state: "synced" });
    expect(rows.find((r) => r.local_id === before.id)).toMatchObject({ state: "synced" });
    // The euro client never got a customer card: nothing is made for a document that waits.
    expect([...tx.customers.values()].map((c) => c.name).sort()).toEqual(["Acme AS", "Nord AS"]);
  });

  it("sends the customer card again only when something on it changed, with Tripletex's version", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 8);
    const clientId = await client(storeId);
    await issued(actor, clientId);
    await sync(tx, storeId);
    await db().execute(sql`update commerce.work_clients set notes = 'Hyggelig kunde', updated_at = now() where id = ${clientId}::uuid`);
    await issued(actor, clientId);
    await sync(tx, storeId);
    expect(tx.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    await db().execute(sql`update commerce.work_clients set legal_name = 'Acme Holding AS' where id = ${clientId}::uuid`);
    await issued(actor, clientId);
    await sync(tx, storeId);
    expect(tx.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect([...tx.customers.values()][0]).toMatchObject({ name: "Acme Holding AS", version: 1 });
    expect(tx.customers.size).toBe(1);
  });

  it("never books twice after a disconnect and a connect of the same company", async () => {
    const { storeId, actor, org } = await workStore();
    const tx = await connected(storeId, actor.account.id, org, BASE + 9);
    await issued(actor, await client(storeId));
    await sync(tx, storeId);
    await disconnectTripletex(actor.account.id, storeId);
    await connectTripletex(actor.account.id, storeId, token(String(BASE + 9)), { fetch: tx.fetch });
    await startTripletex(actor.account.id, storeId);
    expect(await sync(tx, storeId)).toMatchObject({ sent: 0 });
    expect(tx.vouchers.size).toBe(1);
  });
});

describe("sending the shop's invoices", () => {
  it("books a paid order's invoice on the shop's own customer card, never a shopper's name", async () => {
    const shop = await fx.makeStore("txshop");
    const order = await fx.paidOrder(shop, [["DEMO-MUG-WHITE", 2]], { email: "kari.nordmann@example.com" });
    const invoice = (await fx.invoiceOf(shop.storeId, order.orderId))!;
    const tx = fakeTripletex({ companyId: BASE + 101 });
    tx.apiTokens.add(token("shop"));
    expect(await connectTripletex(shop.ownerId, shop.storeId, token("shop"), { fetch: tx.fetch })).toMatchObject({ ok: true });
    expect(await startTripletex(shop.ownerId, shop.storeId)).toMatchObject({ ok: true });

    expect(await sync(tx, shop.storeId)).toMatchObject({ sent: 1, blocked: 0 });
    const [voucher] = [...tx.vouchers.values()];
    expect(voucher.description).toBe(`Faktura ${invoice.documentNumber} · Nettbutikk`);
    expect([...tx.customers.values()].map((c) => c.name)).toEqual(["Nettbutikkunder (Kaizena Flow)"]);
    expect(JSON.stringify([...tx.customers.values(), voucher])).not.toMatch(/kari|nordmann/i);
    expect(voucher.postings.reduce((s, p) => s + Math.round(p.amountGross * 100), 0)).toBe(0);
    expect(Math.round(voucher.postings[0].amountGross * 100)).toBe(invoice.totalMinor);

    // A refund's credit note follows, on the same customer.
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
      select p.store_id, p.id, 1000, 'Skadet', ${`re_tx_${order.orderId.slice(0, 8)}`}, 'succeeded' from commerce.payments p
       where p.store_id = ${shop.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
    `);
    expect(await sync(tx, shop.storeId)).toMatchObject({ sent: 1 });
    expect(tx.vouchers.size).toBe(2);
    expect(tx.customers.size).toBe(1);
  });
});
