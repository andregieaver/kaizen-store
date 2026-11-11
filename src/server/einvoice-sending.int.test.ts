import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Receiver } from "@/lib/peppol";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const { runEinvoiceSending, einvoiceStates } = await import("./einvoice-sending");

/**
 * Sending documents as e-invoices (B1, D463) against a real database, with the Peppol network and the access point as stand-ins: an invoice
 * to a business that receives e-invoices waits while no access point is connected, and is handed over, followed up and delivered when one
 * is; a business that does not receive them is marked so; a consumer's invoice is never looked at; a lookup that could not finish leaves the
 * document for the next run; an access point that fails is tried again later.
 */

afterAll(async () => {
  await closeDb();
});

const BUYER = "984851006";
const receives = (yes: boolean, problem: string | null = null) => async (participant: string): Promise<Receiver> => ({ participant, invoice: yes, creditNote: yes, problem });

async function storeWithBusinessInvoice(label: string) {
  const store = await fx.makeStore(label);
  // A seller with an organisation number whose check digit holds, so it is a participant (the fixture's is only a placeholder).
  await db().execute(sql`update commerce.stores set organisation_number = '923609016' where id = ${store.storeId}::uuid`);
  const business = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { company: { name: "Kunde AS", number: BUYER } });
  const consumer = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
  const invoice = (await fx.invoiceOf(store.storeId, business.orderId))!;
  const consumerInvoice = (await fx.invoiceOf(store.storeId, consumer.orderId))!;
  // Each test's documents only: the participant lookup answers for them alone, and a fresh answer is asked for.
  await db().execute(sql`delete from commerce.peppol_receivers where participant = ${`0192:${BUYER}`}`);
  return { store, invoice, consumerInvoice };
}

const stateOf = async (storeId: string, id: string) => (await einvoiceStates(storeId, [{ type: "invoice", id }])).get(`invoice:${id}`) ?? null;
const today = new Date().toISOString().slice(0, 10);

describe("e-invoices through Peppol (D463)", () => {
  it("marks an invoice to a business that receives e-invoices as waiting while no access point is connected, and never looks at a consumer's", async () => {
    const { store, invoice, consumerInvoice } = await storeWithBusinessInvoice("einv-wait");
    await runEinvoiceSending({ from: today, lookup: receives(true), accessPoint: null });
    expect(await stateOf(store.storeId, invoice.id)).toEqual({ state: "waiting", problem: null });
    expect(await stateOf(store.storeId, consumerInvoice.id)).toBeNull();
  });

  it("still reaches an invoice after more than a batch of invoices to businesses that are not on Peppol, which are never recorded", async () => {
    const store = await fx.makeStore("einv-many");
    await db().execute(sql`update commerce.stores set organisation_number = '923609016' where id = ${store.storeId}::uuid`);
    // 55 invoices to a business whose number is not one (its check digit fails): each is looked at and left, as it went by email.
    for (let i = 0; i < 55; i++) await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { company: { name: `Ikke AS ${i}`, number: "123456789" } });
    const business = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { company: { name: "Kunde AS", number: BUYER } });
    const invoice = (await fx.invoiceOf(store.storeId, business.orderId))!;
    await db().execute(sql`delete from commerce.peppol_receivers where participant = ${`0192:${BUYER}`}`);
    await runEinvoiceSending({ from: today, lookup: receives(true), accessPoint: null });
    expect(await stateOf(store.storeId, invoice.id)).toEqual({ state: "waiting", problem: null });
  }, 120_000);

  it("looks at a Work invoice to a business too, by the organisation numbers its parties were issued with", async () => {
    const store = await fx.makeStore("einv-work");
    await db().execute(sql`update commerce.stores set organisation_number = '923609016', modules = array['work'] where id = ${store.storeId}::uuid`);
    await db().execute(sql`
      insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
      values (${store.storeId}::uuid, true, 'NO923609016MVA', 14, 'NO9386011117947', 'DNBANOKKXXX')
      on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923609016MVA', bank_account = 'NO9386011117947', bic = 'DNBANOKKXXX'`);
    const [client] = await db().execute<{ id: string }>(sql`
      insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
      values (${store.storeId}::uuid, 'Kunde', 'Kunde AS', ${BUYER}, 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@kunde.example')
      returning id`);
    const invoices = await import("./work-invoices");
    const actor = { account: { id: store.ownerId }, store: { id: store.storeId } };
    const draft = await invoices.createDraftInvoice(actor, { clientId: client.id });
    if (!draft.ok) throw new Error(draft.problems.join());
    const lines = await invoices.saveLines(actor, draft.invoiceId, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 100, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]);
    if (!lines.ok) throw new Error(lines.problems.join());
    const issued = await invoices.issueInvoice(actor, { invoiceId: draft.invoiceId });
    if (!issued.ok) throw new Error(issued.problems.join());
    await db().execute(sql`delete from commerce.peppol_receivers where participant = ${`0192:${BUYER}`}`);
    await runEinvoiceSending({ from: today, lookup: receives(true), accessPoint: null });
    const states = await einvoiceStates(store.storeId, [{ type: "work_invoice", id: issued.invoice.invoiceId }]);
    expect(states.get(`work_invoice:${issued.invoice.invoiceId}`)).toEqual({ state: "waiting", problem: null });
  });

  it("marks a business that does not receive them, and leaves a document for later when the network could not tell", async () => {
    const { store, invoice } = await storeWithBusinessInvoice("einv-not");
    await runEinvoiceSending({ from: today, lookup: receives(false, "dns_eservfail"), accessPoint: null });
    expect(await stateOf(store.storeId, invoice.id)).toBeNull();
    await runEinvoiceSending({ from: today, lookup: receives(false), accessPoint: null });
    expect(await stateOf(store.storeId, invoice.id)).toEqual({ state: "not_receiver", problem: null });
  });

  it("hands an invoice to the access point, tries again after a failure, and follows it up to delivered", async () => {
    const { store, invoice } = await storeWithBusinessInvoice("einv-send");
    const sent: { sender: string; receiver: string; xml: string }[] = [];
    let fail = true;
    const accessPoint = {
      name: "stand-in",
      send: async (doc: { sender: string; receiver: string; xml: string; reference: string }) => {
        if (fail) return { ok: false as const, problem: "http_503", retry: true };
        sent.push(doc);
        return { ok: true as const, messageId: `msg-${doc.reference}` };
      },
      status: async () => ({ state: "delivered" as const }),
    };
    const now = new Date();
    await runEinvoiceSending({ now, from: today, lookup: receives(true), accessPoint });
    expect(await stateOf(store.storeId, invoice.id)).toEqual({ state: "failed", problem: "http_503" });

    fail = false;
    await runEinvoiceSending({ now: new Date(now.getTime() + 3 * 60_000), from: today, lookup: receives(true), accessPoint });
    const mine = sent.find((d) => d.xml.includes(`<cbc:ID>${invoice.documentNumber}</cbc:ID>`));
    expect(mine).toMatchObject({ sender: "0192:923609016", receiver: `0192:${BUYER}` });
    expect(mine!.xml).toContain(`<cbc:EndpointID schemeID="0192">${BUYER}</cbc:EndpointID>`);
    // Handed over in that run and followed up in the same one: the stand-in reports it delivered.
    expect(await stateOf(store.storeId, invoice.id)).toEqual({ state: "delivered", problem: null });
    const [row] = await db().execute<{ attempts: number; access_point: string; message_id: string }>(sql`
      select attempts, access_point, message_id from commerce.einvoice_sends where document_id = ${invoice.id}::uuid
    `);
    expect(row).toMatchObject({ attempts: 2, access_point: "stand-in" });
    expect(row.message_id).toMatch(/^msg-/);
  });
});
