import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const fx = await import("./invoice-test-fixture");
const bc = await import("./business-change");
const invoices = await import("./work-invoices");

type Row = Record<string, unknown>;

/**
 * Changing the business behind a store (B8, D473) through the server and the real issuers, against a real database: planned by the owner
 * for a day after today; on its day the first document issued is the new business's, with its own prefix and the numbers going on; an
 * order placed before the change and paid after states the new business's VAT number; Work's invoices follow too; the dispatcher's job
 * applies a change nothing issued and draws the store again.
 */

afterAll(async () => {
  await closeDb();
});

const run = Date.now().toString(36);
const due = (storeId: string, prefixes: Record<string, string>) =>
  db().execute(sql`
    insert into commerce.store_business_changes (store_id, starts_on, legal_name, business_form, organisation_number, vat_registered, vat_number, prefixes)
    values (${storeId}::uuid, commerce.store_day(${storeId}::uuid, now()), 'Human Web AS', 'as', '923609016', true, 'NO923609016MVA', ${JSON.stringify(prefixes)}::jsonb)`);

describe("a change of the business behind a store", () => {
  it("is planned by the owner alone, for a day after today, and called off", async () => {
    const store = await fx.makeStore(`bc-plan-${run}`);
    const owner = await fx.ownerOf(store);
    const admin = await fx.ownerOf(store, "admin");
    const raw = { legalName: "Human Web AS", businessForm: "as", startsOn: "2099-01-01", vatRegistered: true };
    expect(await bc.planBusinessChange(admin, raw)).toEqual({ ok: false, problems: ["forbidden"] });
    expect(await bc.planBusinessChange(owner, raw)).toEqual({ ok: false, problems: ["starts_on"] });
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    const made = await bc.planBusinessChange(owner, { ...raw, startsOn: nextYear });
    expect(made.ok).toBe(true);
    // Planned again: the same change, now with the number the new business was given.
    const again = await bc.planBusinessChange(owner, { ...raw, startsOn: nextYear, organisationNumber: "923609016", prefixes: { invoice: "AS-F-" } });
    expect(again).toEqual(made);
    expect(await bc.businessChangesOf(store.storeId)).toMatchObject([
      { status: "planned", startsOn: nextYear, organisationNumber: "923609016", vatNumber: "NO923609016MVA", prefixes: { invoice: "AS-F-" } },
    ]);
    expect(await bc.cancelBusinessChange(owner)).toMatchObject({ ok: true });
    expect(await bc.businessChangesOf(store.storeId)).toEqual([]);
    expect(await bc.cancelBusinessChange(owner)).toEqual({ ok: false, problems: ["not_found"] });
  });

  it("draws its checklist from the store, and keeps what the owner ticked off", async () => {
    const store = await fx.makeStore(`bc-list-${run}`);
    const owner = await fx.ownerOf(store);
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    expect((await bc.planBusinessChange(owner, { legalName: "Human Web AS", businessForm: "as", startsOn: nextYear, vatRegistered: true })).ok).toBe(true);
    // A legal page that names the business as it is.
    const terms = JSON.stringify({ blocks: [{ type: "text", text: "Fixture AS sells mugs." }] });
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.storeId}::uuid, ${`terms-${run}`}, ${terms}::jsonb, ${terms}::jsonb, now()) returning id`);
    await db().execute(sql`insert into commerce.page_roles (store_id, role, page_id) values (${store.storeId}::uuid, 'terms', ${String(page.id)}::uuid)`);
    const { getStore } = await import("./stores");
    const live = (await getStore(store.slug))!;
    let [change] = await bc.businessChangesOf(store.storeId);
    const facts = await bc.businessChecklistFacts(live, change);
    expect(facts).toMatchObject({ legalPagesNamingOld: 1, paysPlan: true, checked: [] });
    expect(await bc.tickBusinessStep(owner, "plan", true)).toMatchObject({ ok: true });
    expect(await bc.tickBusinessStep(owner, "plan", true)).toMatchObject({ ok: true });
    expect(await bc.tickBusinessStep(owner, "numbers", true)).toEqual({ ok: false, problems: ["not_found"] });
    [change] = await bc.businessChangesOf(store.storeId);
    expect(change.checked).toEqual(["plan"]);
    expect(await bc.tickBusinessStep(owner, "plan", false)).toMatchObject({ ok: true });
    [change] = await bc.businessChangesOf(store.storeId);
    expect(change.checked).toEqual([]);
    expect(await bc.businessSeriesNow(store.storeId)).toMatchObject({ invoice: { prefix: "F-", next: 1 } });
  });

  it("makes the first invoice of its day the new business's, with its own prefix, the numbers going on", async () => {
    const store = await fx.makeStore(`bc-shop-${run}`);
    const first = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const old = (await fx.invoiceOf(store.storeId, first.orderId))!;
    expect(old.snapshot.seller).toMatchObject({ legalName: "Fixture AS", organisationNumber: "923456789", vatNumber: "NO923456789MVA" });

    await due(store.storeId, { invoice: "AS-F-" });
    const second = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const now = (await fx.invoiceOf(store.storeId, second.orderId))!;
    expect(now.documentNumber).toBe(`AS-F-${old.number + 1}`);
    expect(now.snapshot.seller).toMatchObject({ legalName: "Human Web AS", organisationNumber: "923609016", vatNumber: "NO923609016MVA" });
    // The order placed before the change, were it invoiced now, states the business that issues it.
    const [vat] = await db().execute<Row>(sql`select commerce.invoice_seller_vat(${first.orderId}::uuid) as vat`);
    expect(vat.vat).toBe("NO923609016MVA");

    const [change] = await bc.businessChangesOf(store.storeId);
    expect(change).toMatchObject({ status: "applied", before: { legalName: "Fixture AS", organisationNumber: "923456789", vatNumber: "NO923456789MVA" } });
    expect(change.seriesStart?.invoice).toBe(`AS-F-${old.number + 1}`);
    // The store is drawn again once, whoever applied the change.
    expect((await bc.runBusinessChanges()).refreshed).toBeGreaterThanOrEqual(1);
    const [refreshed] = await db().execute<Row>(sql`select refreshed_at is not null as done from commerce.store_business_changes where id = ${change.id}::uuid`);
    expect(refreshed.done).toBe(true);
  });

  it("is applied by the dispatcher's job when nothing is issued, and Work's next invoice is the new business's", async () => {
    const store = await fx.makeStore(`bc-work-${run}`);
    await db().execute(sql`update commerce.stores set modules = array['work'] where id = ${store.storeId}::uuid`);
    await db().execute(sql`
      insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
      values (${store.storeId}::uuid, true, 'NO923456789MVA', 14, 'NO9386011117947', 'DNBANOKKXXX')
      on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA', bank_account = 'NO9386011117947', bic = 'DNBANOKKXXX'`);
    await due(store.storeId, { work_invoice: "AS-W-" });
    expect((await bc.runBusinessChanges()).applied).toBeGreaterThanOrEqual(1);
    const [settings] = await db().execute<Row>(sql`select vat_number from commerce.work_settings where store_id = ${store.storeId}::uuid`);
    expect(settings.vat_number).toBe("NO923609016MVA");

    const actor = { account: { id: store.ownerId }, store: { id: store.storeId } };
    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, billing_address, currency, locale, business, vat_treatment, billing_email)
      values (${store.storeId}::uuid, 'Acme', 'Acme AS', '984851006', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic', 'faktura@acme.example')
      returning id`);
    const draft = await invoices.createDraftInvoice(actor, { clientId: String(client.id) });
    if (!draft.ok) throw new Error(draft.problems.join());
    const lines = await invoices.saveLines(actor, draft.invoiceId, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 100, unitPriceMinor: 120_000, discountBp: 0, vatCategory: "standard" }]);
    if (!lines.ok) throw new Error(lines.problems.join());
    const issued = await invoices.issueInvoice(actor, { invoiceId: draft.invoiceId });
    if (!issued.ok) throw new Error(issued.problems.join());
    const [doc] = await db().execute<Row>(sql`select document_number, seller from commerce.work_invoices where id = ${issued.invoice.invoiceId}::uuid`);
    expect(String(doc.document_number)).toMatch(/^AS-W-\d+$/);
    expect(doc.seller).toMatchObject({ legal_name: "Human Web AS", organisation_number: "923609016", vat_number: "NO923609016MVA" });
  });
});
