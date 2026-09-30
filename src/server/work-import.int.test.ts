import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { printableState } from "@/lib/work-invoice-print";
import { DEFAULT_OPTIONS, type ImportOptions, importId, planImport, renderSql } from "@/lib/work-import";
import { LIFE, sampleLifeExport } from "@/lib/work-import-fixture";

import { workErrorCode } from "./work-errors";
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
const emails = await import("./work-emails");
const exportsModule = await import("./work-exports");
const work = await import("./work");
const recurring = await import("./work-recurring");

/**
 * The import from Kaizen Life (docs/work.md WP15) against a real database: the generated SQL is run as it
 * is, in one transaction, on a store made the way an approved access request makes one. It reconciles with
 * the plan, does nothing the second time and nothing at all in a store that already has other Work rows;
 * what it made reads through the normal readers, imported invoices are never emailed, and an ordinary invoice
 * still takes the store's next number afterwards.
 */

const run = Date.now().toString(36);
const created: { storeId: string; email: string }[] = [];
let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

afterAll(async () => {
  // Issued invoices cannot be deleted (that is the point), so a test's data is removed with the rules switched off for this session.
  const client = await pool.connect();
  try {
    const { rows: tables } = await client.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'commerce' and c.column_name = 'store_id' order by 1`,
    );
    await client.query("set session_replication_role = replica");
    for (const { storeId, email } of created) {
      for (const { table_name } of tables) await client.query(`delete from commerce."${table_name}" where store_id = $1`, [storeId]);
      await client.query("delete from commerce.stores where id = $1", [storeId]);
      await client.query("delete from commerce.accounts where email = $1", [email]);
      await client.query("delete from commerce.access_requests where email = $1", [email]);
    }
    await client.query("set session_replication_role = origin");
  } finally {
    client.release();
  }
  await pool.end();
  await closeDb();
});

type Fixture = { storeId: string; slug: string; email: string; accountId: string; actor: WorkActor; options: ImportOptions };

async function makeStore(tag: string): Promise<Fixture> {
  const slug = `wimp-${tag}-${run}`;
  const email = `${slug}@example.com`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${email}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
  const storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no',
      time_zone = 'Europe/Oslo', modules = array['work']
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, 'NO923456789MVA', 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  created.push({ storeId, email });
  const accountId = String(owner.id);
  return {
    storeId,
    slug,
    email,
    accountId,
    actor: { account: { id: accountId }, store: { id: storeId } },
    options: { ...DEFAULT_OPTIONS, storeId, storeSlug: slug, accountEmail: email },
  };
}

/** Runs the generated SQL as one script, the way psql -1 or a single query would. */
const runScript = (script: string) => pool.query(script);
const count = async (table: string, storeId: string): Promise<number> => {
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from ${sql.raw(`commerce.${table}`)} where store_id = ${storeId}::uuid`);
  return Number(row.n);
};

const ok = <T extends object>(r: InvoiceResult<T>) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.problems.join(" | ")}`);
  return r as Extract<typeof r, { ok: true }>;
};

describe("the import from Kaizen Life", () => {
  let f: Fixture;
  let scriptText: string;
  const plan = () => planImport(sampleLifeExport(), f.options);
  const idOf = (kind: Parameters<typeof importId>[1], lifeId: string) => importId(f.storeId, kind, lifeId);

  beforeAll(async () => {
    f = await makeStore("main");
    // An integration that asks for every Work event: the import must queue none of them.
    await db().execute(sql`
      insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events)
      values (${f.storeId}::uuid, 'zapier', true, 'x', 'x',
              array['work_client.created', 'work_invoice.sent', 'work_invoice.paid', 'work_invoice.credited'])`);
    scriptText = renderSql(plan());
    await runScript(scriptText);
  });

  it("makes every planned row, and the totals reconcile with Life's", async () => {
    const p = plan();
    expect(await count("work_clients", f.storeId)).toBe(3);
    expect(await count("work_assignments", f.storeId)).toBe(3);
    expect(await count("work_tasks", f.storeId)).toBe(2);
    expect(await count("work_time_entries", f.storeId)).toBe(3);
    expect(await count("work_recurring_invoices", f.storeId)).toBe(1);
    expect(await count("work_invoices", f.storeId)).toBe(6);
    expect(await count("work_invoice_lines", f.storeId)).toBe(8);
    expect(await count("work_invoice_payments", f.storeId)).toBe(3);
    expect(p.skipped).toHaveLength(1); // Life's voided invoice

    const rows = await db().execute<Row>(sql`
      select id, status, imported, legacy_number, document_number, number, subtotal_minor, vat_minor, total_minor,
             (select coalesce(sum(l.incl_minor), 0) from commerce.work_invoice_lines l where l.store_id = i.store_id and l.invoice_id = i.id) as lines_incl
      from commerce.work_invoices i where store_id = ${f.storeId}::uuid`);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    let store = 0;
    let life = 0;
    for (const planned of p.invoices) {
      const row = byId.get(planned.id);
      expect(row, planned.lifeId).toBeDefined();
      expect(Number(row?.total_minor)).toBe(planned.totalMinor);
      expect(Number(row?.subtotal_minor) + Number(row?.vat_minor)).toBe(Number(row?.total_minor));
      expect(Number(row?.lines_incl)).toBe(planned.totalMinor);
      store += Number(row?.total_minor);
    }
    // Life's own frozen headers, in minor units: 5028.75 + 1237.50 + 1238.13 + 1676.66 + 1237.50 (+ the draft's lines, 2514.38).
    for (const total of [502875, 123750, 123813, 167666, 123750, 251438]) life += total;
    expect(store).toBe(life);

    expect(byId.get(idOf("invoice", LIFE.paidNumbered))).toMatchObject({ status: "paid", imported: true, legacy_number: "2154", document_number: "2154", number: null });
    expect(byId.get(idOf("invoice", LIFE.paidUnnumbered))).toMatchObject({ status: "paid", document_number: "Imported", legacy_number: null });
    expect(byId.get(idOf("invoice", LIFE.sentNumbered))).toMatchObject({ status: "sent", document_number: "2026-041", legacy_number: "2026-041" });
    expect(byId.get(idOf("invoice", LIFE.sentUnnumbered))).toMatchObject({ status: "sent", document_number: "Imported" });
    expect(byId.get(idOf("invoice", LIFE.draft))).toMatchObject({ status: "draft", imported: false, document_number: null, number: null, total_minor: "251438" });
  });

  it("dates payments by the day they were received, at noon in the store's time zone", async () => {
    const rows = await db().execute<Row>(sql`
      select i.document_number, p.received_on::text as received_on, p.method, p.reference, p.amount_minor, i.paid_at
      from commerce.work_invoice_payments p join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
      where p.store_id = ${f.storeId}::uuid order by p.received_on`);
    expect(rows.map((r) => [r.document_number, r.received_on, r.method, r.reference, Number(r.amount_minor)])).toEqual([
      ["Imported", "2026-04-17", "other", "imported", 123750],
      ["2154", "2026-06-25", "other", "imported", 502875],
      ["Imported", "2026-07-15", "other", "imported", 123813],
    ]);
    expect(new Date(String(rows[1].paid_at)).toISOString()).toBe("2026-06-25T10:00:00.000Z");
  });

  it("takes no series number, queues no integration event and writes one history entry per imported invoice", async () => {
    const series = await db().execute<Row>(sql`select series, next_number from commerce.document_series where store_id = ${f.storeId}::uuid and series like 'work%' order by series`);
    expect(series.map((s) => [s.series, Number(s.next_number)])).toEqual([["work_credit_note", 1], ["work_invoice", 1]]);
    expect(await count("integration_deliveries", f.storeId)).toBe(0);
    const events = await db().execute<Row>(sql`select type, count(*)::int as n from commerce.work_events where store_id = ${f.storeId}::uuid group by type`);
    expect(events).toEqual([{ type: "invoice.imported", n: 5 }]);
    expect(await count("email_messages", f.storeId)).toBe(0);
  });

  it("freezes the seller from the store and the buyer from the client", async () => {
    const [row] = await db().execute<Row>(sql`select seller, buyer, locale, payment_days, sent_at from commerce.work_invoices where id = ${idOf("invoice", LIFE.paidNumbered)}::uuid`);
    expect(row.seller).toMatchObject({ legal_name: "Konsulent AS", organisation_number: "923456789", vat_registered: true, vat_number: "NO923456789MVA", bank_account: "NO9386011117947", country: "NO" });
    expect(row.buyer).toMatchObject({ name: "Alfa AS", client_name: "Alfa AS", email: "regnskap@alfa.example", country: "NO", vat_treatment: "domestic", business: true });
    expect(row).toMatchObject({ locale: "nb-NO", payment_days: 12 });
    // No sent date in Life: noon on the issue day in Oslo.
    expect(new Date(String(row.sent_at)).toISOString()).toBe("2026-06-08T10:00:00.000Z");
  });

  it("does nothing the second time", async () => {
    const before = await db().execute<Row>(sql`select (select count(*)::int from commerce.work_events where store_id = ${f.storeId}::uuid) as events,
      (select count(*)::int from commerce.work_invoice_payments where store_id = ${f.storeId}::uuid) as payments`);
    await runScript(scriptText);
    await runScript(renderSql(plan()));
    expect(await count("work_clients", f.storeId)).toBe(3);
    expect(await count("work_invoices", f.storeId)).toBe(6);
    expect(await count("work_invoice_lines", f.storeId)).toBe(8);
    expect(await count("work_time_entries", f.storeId)).toBe(3);
    const after = await db().execute<Row>(sql`select (select count(*)::int from commerce.work_events where store_id = ${f.storeId}::uuid) as events,
      (select count(*)::int from commerce.work_invoice_payments where store_id = ${f.storeId}::uuid) as payments`);
    expect(after).toEqual(before);
  });

  it("stops, writing nothing, when the store has Work rows that are not from the import", async () => {
    const other = await makeStore("dirty");
    await db().execute(sql`insert into commerce.work_clients (store_id, name, currency) values (${other.storeId}::uuid, 'Egen kunde', 'NOK')`);
    const script = renderSql(planImport(sampleLifeExport(), other.options));
    await expect(runScript(script)).rejects.toThrow(/work_import\.store_not_empty: 1 rows in work_clients/);
    expect(await count("work_clients", other.storeId)).toBe(1);
    expect(await count("work_invoices", other.storeId)).toBe(0);
    // Also when the foreign row is an invoice, and after the first client was already made from this import.
    await db().execute(sql`delete from commerce.work_clients where store_id = ${other.storeId}::uuid`);
    await runScript(script);
    const [client] = await db().execute<Row>(sql`select id from commerce.work_clients where store_id = ${other.storeId}::uuid limit 1`);
    await db().execute(sql`insert into commerce.work_invoices (store_id, client_id, currency) values (${other.storeId}::uuid, ${String(client.id)}::uuid, 'NOK')`);
    await expect(runScript(script)).rejects.toThrow(/work_import\.store_not_empty: 1 rows in work_invoices/);
  });

  it("stops for the wrong store, a store without Work or a member that is not there", async () => {
    const wrongSlug = renderSql(planImport(sampleLifeExport(), { ...f.options, storeSlug: "no-such-slug" }));
    await expect(runScript(wrongSlug)).rejects.toThrow(/work_import\.store: no store no-such-slug/);
    const stranger = renderSql(planImport(sampleLifeExport(), { ...f.options, accountEmail: "stranger@example.com" }));
    await expect(runScript(stranger)).rejects.toThrow(/work_import\.member/);
    const off = await makeStore("off");
    await db().execute(sql`update commerce.stores set modules = '{}' where id = ${off.storeId}::uuid`);
    await expect(runScript(renderSql(planImport(sampleLifeExport(), off.options)))).rejects.toThrow(/work_import\.module/);
    const zone = await makeStore("zone");
    await db().execute(sql`update commerce.stores set time_zone = 'Europe/Stockholm' where id = ${zone.storeId}::uuid`);
    await expect(runScript(renderSql(planImport(sampleLifeExport(), zone.options)))).rejects.toThrow(/work_import\.time_zone/);
    for (const s of [off, zone]) expect(await count("work_clients", s.storeId)).toBe(0);
  });

  it("checks itself: a plan that disagrees with what the database made rolls everything back", async () => {
    const s = await makeStore("check");
    const p = planImport(sampleLifeExport(), s.options);
    // The plan claims an invoice is paid that has no payment: what was made is not what was planned, so the check refuses.
    const open = p.invoices.find((i) => i.lifeId === LIFE.sentNumbered);
    if (!open) throw new Error("fixture");
    open.status = "paid";
    await expect(runScript(renderSql(p))).rejects.toThrow(/work_import\.check: only 5 of 6 invoices/);
    expect(await count("work_clients", s.storeId)).toBe(0);
    expect(await count("work_invoices", s.storeId)).toBe(0);
  });

  it("reads through the normal readers: the list, an invoice and its document", async () => {
    const list = await invoices.listWorkInvoices(f.storeId, { sort: "oldest", pageSize: 50 });
    expect(list.total).toBe(6);
    expect(list.counts).toMatchObject({ draft: 1, sent: 2, paid: 3, void: 0 });
    const labels = list.rows.map((r) => r.documentNumber);
    expect(labels.filter((l) => l === "Imported")).toHaveLength(3);
    expect(labels).toContain("2154");
    expect(labels).toContain("2026-041");
    const draft = list.rows.find((r) => r.status === "draft");
    expect(draft?.documentNumber).toBeNull();
    // Sent long ago and never paid in Life: overdue, as it should say.
    const overdue = list.rows.find((r) => r.documentNumber === "2026-041");
    expect(overdue).toMatchObject({ status: "sent", overdue: true, totalMinor: 123750, paidMinor: 0, outstandingMinor: 123750 });
    // Search finds an imported invoice by its Life number.
    expect((await invoices.listWorkInvoices(f.storeId, { search: "2154" })).rows.map((r) => r.documentNumber)).toEqual(["2154"]);

    const detail = await invoices.getWorkInvoiceDetail(f.storeId, idOf("invoice", LIFE.paidNumbered));
    expect(detail?.invoice).toMatchObject({ status: "paid", imported: true, legacyNumber: "2154", documentNumber: "2154", number: null, totalMinor: 502875, issuedOn: "2026-06-08", dueOn: "2026-06-20", locale: "nb-NO" });
    expect(detail?.amounts).toEqual({ totalMinor: 502875, paidMinor: 502875, creditedMinor: 0, outstandingMinor: 0 });
    expect(detail?.payments).toHaveLength(1);
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]).toMatchObject({ description: "Landingsside", quantityHundredths: 300, unitPriceMinor: 149000, discountBp: 1000, exclMinor: 402300, vatMinor: 100575, inclMinor: 502875 });
    expect(detail?.seller?.legalName).toBe("Konsulent AS");
    expect(detail?.buyer?.name).toBe("Alfa AS");
    expect(detail?.events.map((e) => e.type)).toEqual(["invoice.imported"]);

    const doc = await invoices.invoiceDocumentData(f.storeId, idOf("invoice", LIFE.paidNumbered));
    expect(doc).toMatchObject({ imported: true, documentNumber: "2154", consistent: true, language: "nb" });
    expect(doc?.payment.paymentReference).toBe("2154");
    expect(doc?.totals.totalMinor).toBe(502875);
    expect(doc && printableState(doc)).toEqual({ printable: true });
    // Without a number of its own: no printed number, never the label, but still a document.
    const bare = await invoices.invoiceDocumentData(f.storeId, idOf("invoice", LIFE.sentUnnumbered));
    expect(bare).toMatchObject({ imported: true, documentNumber: null, status: "sent" });
    expect(bare?.payment.paymentReference).toBeNull();
    expect(bare && printableState(bare)).toEqual({ printable: true });
    expect(bare?.vatNotes.map((n) => n.key)).toEqual(["exempt"]);

    // The registers and the CSV show the label.
    const register = await exportsModule.invoiceRegister(f.storeId, {});
    expect(register.map((r) => r.documentNumber).sort()).toEqual(["2026-041", "2154", "Imported", "Imported", "Imported"]);
    const payments = await exportsModule.paymentRegister(f.storeId);
    expect(payments.map((r) => r.documentNumber).sort()).toEqual(["2154", "Imported", "Imported"]);
  });

  it("reads clients, assignments, time and the repeating invoice through the normal readers", async () => {
    const clients = await work.listClients(f.storeId);
    expect(clients.map((c) => c.name)).toEqual(["Alfa AS", "Beta & Sønn", "Gamma O'Neil"]);
    const alfa = await work.getClient(f.storeId, idOf("client", LIFE.alpha));
    expect(alfa).toMatchObject({ name: "Alfa AS", billingEmail: "regnskap@alfa.example", currency: "NOK", country: "NO", paymentDays: 21, defaultHourlyRateMinor: 149000 });
    const assignments = await work.listAssignments(f.storeId, { status: "all" });
    expect(assignments.map((a) => [a.name, a.status]).sort()).toEqual([["Faktura - Mai", "done"], ["Faktura - September", "active"], ["Fastpris nettside", "paused"]]);
    const tasks = await work.listTasks(f.storeId, idOf("assignment", LIFE.asgActive));
    expect(tasks.map((t) => t.title)).toEqual(["Design av forside", "Line item"]);

    const beta = await recurring.listRecurring(f.storeId, idOf("client", LIFE.beta));
    expect(beta.templates).toHaveLength(1);
    expect(beta.templates[0]).toMatchObject({ unitPriceMinor: 99000, currency: "NOK", isActive: true, autoIssue: false });
    // Its two imported invoices are its instances: the job would not make them again.
    expect(beta.templates[0].last?.status).toBeDefined();
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.work_invoices where store_id = ${f.storeId}::uuid and recurring_invoice_id = ${idOf("recurring", LIFE.recurring)}::uuid`);
    expect(n).toBe(2);

    const [line] = await db().execute<Row>(sql`select l.id, count(e.id)::int as entries, coalesce(sum(e.minutes), 0)::int as minutes
      from commerce.work_invoice_lines l left join commerce.work_time_entries e on e.store_id = l.store_id and e.invoice_line_id = l.id
      where l.store_id = ${f.storeId}::uuid and l.invoice_id = ${idOf("invoice", LIFE.draft)}::uuid and l.position = 0 group by l.id`);
    expect(line).toMatchObject({ entries: 1, minutes: 90 });
  });

  it("never emails an imported invoice", async () => {
    const result = await emails.sendInvoiceEmail(f.storeId, idOf("invoice", LIFE.sentNumbered));
    expect(result).toEqual({ sent: false, reason: "imported" });
    const reminder = await emails.sendPaymentReminderEmail(f.storeId, idOf("invoice", LIFE.sentNumbered));
    expect(reminder).toEqual({ sent: false, reason: "imported" });
    expect(await count("email_messages", f.storeId)).toBe(0);
    const [row] = await db().execute<Row>(sql`select sent_to, public_token from commerce.work_invoices where id = ${idOf("invoice", LIFE.sentNumbered)}::uuid`);
    expect(row).toEqual({ sent_to: null, public_token: null });
  });

  it("takes a payment, a credit note and no edits on an imported invoice", async () => {
    const target = idOf("invoice", LIFE.sentUnnumbered);
    const paid = ok(await invoices.recordPayment(f.actor, { invoiceId: target, amountMinor: 100000, receivedOn: "2026-09-01", method: "bank" }));
    expect(paid).toMatchObject({ status: "sent", amounts: { outstandingMinor: 67666 } });
    ok(await invoices.recordPayment(f.actor, { invoiceId: target, amountMinor: 67666, receivedOn: "2026-09-02", method: "bank" }));
    expect((await invoices.getWorkInvoiceDetail(f.storeId, target))?.invoice.status).toBe("paid");
    const refused = await db().execute(sql`update commerce.work_invoices set notes = 'x' where id = ${target}::uuid`).catch((e: unknown) => e);
    expect(workErrorCode(refused)).toBe("work_invoice.immutable");

    const credited = ok(await invoices.creditInvoice(f.actor, { invoiceId: idOf("invoice", LIFE.sentNumbered), reason: "Feil", kind: "full" }));
    expect(credited.creditNote.documentNumber).toBe("WCN-1");
    const detail = await invoices.getWorkInvoiceDetail(f.storeId, idOf("invoice", LIFE.sentNumbered));
    expect(detail?.invoice).toMatchObject({ status: "void", documentNumber: "2026-041", imported: true });
    expect(detail?.amounts).toMatchObject({ creditedMinor: 123750, outstandingMinor: 0 });
    expect(detail?.creditNotes[0].lines[0]).toMatchObject({ exclMinor: 99000, vatMinor: 24750 });
  });

  it("still makes and issues an ordinary invoice, numbered from the store's own series", async () => {
    // The imported clients have no address (Life kept none): an invoice to one is not ready, and says why.
    const draftToImported = ok(await invoices.createDraftInvoice(f.actor, { clientId: idOf("client", LIFE.alpha) })).invoiceId;
    ok(await invoices.saveLines(f.actor, draftToImported, [{ description: "Rådgivning", unit: "hour", quantityHundredths: 100, unitPriceMinor: 100_000, discountBp: 0, vatCategory: "standard" }]));
    const readiness = await invoices.invoiceReadiness(f.storeId, draftToImported);
    expect(readiness?.ready).toBe(false);
    expect(JSON.stringify(readiness)).toMatch(/address/i);

    const [client] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency, locale, business, vat_treatment)
      values (${f.storeId}::uuid, 'Ny kunde', 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb, 'NOK', 'nb-NO', true, 'domestic') returning id`);
    const newDraft = async () => {
      const id = ok(await invoices.createDraftInvoice(f.actor, { clientId: String(client.id) })).invoiceId;
      ok(await invoices.saveLines(f.actor, id, [{ description: "Workshop", unit: "hour", quantityHundredths: 400, unitPriceMinor: 100_000, discountBp: 0, vatCategory: "standard" }]));
      return id;
    };
    // Dated before the imported ones: the imported invoices are not part of the series' date order.
    const first = ok(await invoices.issueInvoice(f.actor, { invoiceId: await newDraft(), issuedOn: "2026-03-01" })).invoice;
    expect(first).toMatchObject({ documentNumber: "W-1", number: 1 });
    const second = ok(await invoices.issueInvoice(f.actor, { invoiceId: await newDraft() })).invoice;
    expect(second.documentNumber).toBe("W-2");
    const [row] = await db().execute<Row>(sql`select imported, legacy_number, seller from commerce.work_invoices where id = ${first.invoiceId}::uuid`);
    expect(row).toMatchObject({ imported: false, legacy_number: null });
    const series = await db().execute<Row>(sql`select next_number from commerce.document_series where store_id = ${f.storeId}::uuid and series = 'work_invoice'`);
    expect(Number(series[0].next_number)).toBe(3);
    // The settings' "last issued" is the last real number, not an imported one.
    const settings = await import("./work-settings");
    const state = await settings.getWorkSeries(f.storeId);
    expect(state.work_invoice).toMatchObject({ issued: 2, lastDocumentNumber: "W-2", nextDocumentNumber: "W-3" });
  });
});
