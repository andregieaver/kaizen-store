import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { convertMinor } from "@/lib/work-calc";
import { addCalendarDays } from "@/lib/work-dates";

import type { Membership } from "./auth";
import { workErrorCode } from "./work-errors";
import type { Store } from "./stores";
import type { InvoiceLine, InvoiceResult, WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

// The actions ask the session who the member is; the tests answer for them (and audit for real).
const members = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/server/auth", async () => {
  const { sql: q } = await import("drizzle-orm");
  const { db: database } = await import("@/db/client");
  return {
    requireMember: async (slug: string) => {
      const member = members.get(slug);
      if (!member) throw new Error(`not a member of ${slug}`);
      return member;
    },
    audit: async (
      accountId: string | null,
      storeId: string | null,
      action: string,
      details: Record<string, unknown> = {},
    ) => {
      await database().execute(
        q`insert into commerce.audit_log (account_id, store_id, action, details)
          values (${accountId}::uuid, ${storeId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`,
      );
    },
  };
});

const invoices = await import("./work-invoices");
const actions = await import("@/app/admin/(gated)/[store]/work/invoice-actions");
const { getStore } = await import("./stores");

/**
 * Work's invoices (docs/work.md 7.2 WP4) against a real database: draft, lines from time, the mirror
 * between tasks and lines, issuing (numbers, snapshot, immutability), payments, credit notes, VAT
 * scenarios, the readiness checklist, one draft per assignment, isolation between stores, concurrent
 * issuing, the readers and the actions' rules.
 */

const run = Date.now().toString(36);
const IBAN = "NO9386011117947";

function ok<T extends object>(result: InvoiceResult<T>): Extract<InvoiceResult<T>, { ok: true }> {
  if (!result.ok) throw new Error(`Expected success, got: ${result.problems.join(" | ")} [${result.code ?? ""}]`);
  return result as Extract<InvoiceResult<T>, { ok: true }>;
}

function bad<T extends object>(result: InvoiceResult<T>): { problems: string[]; code?: string } {
  if (result.ok) throw new Error("Expected a failure, got success");
  return result;
}

type Fixture = { storeId: string; slug: string; accountId: string; actor: WorkActor };

async function makeStore(
  tag: string,
  options: { seller?: boolean; registered?: boolean; days?: number } = {},
): Promise<Fixture> {
  const name = `wi-${tag}-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  if (options.seller !== false) {
    await db().execute(sql`
      update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
        postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no', modules = array['work']
      where id = ${storeId}::uuid`);
    await db().execute(sql`
      insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic, payment_note)
      values (${storeId}::uuid, ${options.registered ?? true}, ${options.registered === false ? null : "NO923456789MVA"},
              ${options.days ?? 14}, ${IBAN}, 'DNBANOKKXXX', 'Pay by bank transfer, quote the invoice number.')`);
  } else {
    await db().execute(sql`update commerce.stores set modules = array['work'] where id = ${storeId}::uuid`);
  }
  const accountId = String(owner.id);
  return { storeId, slug: name, accountId, actor: { account: { id: accountId }, store: { id: storeId } } };
}

async function makeClient(
  f: Fixture,
  over: Partial<{
    name: string;
    country: string | null;
    treatment: string;
    business: boolean;
    vat: string | null;
    currency: string;
    locale: string | null;
    address: object;
    rate: number | null;
    legalName: string | null;
    paymentDays: number | null;
  }> = {},
): Promise<string> {
  const address = "address" in over ? over.address : { line1: "Kirkeveien 1", postalCode: "0364", city: "Oslo" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, country, billing_address, currency, default_hourly_rate_minor,
                                       locale, business, vat_treatment, vat_number, billing_email, payment_days)
    values (${f.storeId}::uuid, ${over.name ?? "Kunde AS"}, ${over.legalName ?? null}, ${"country" in over ? over.country : "NO"},
            ${JSON.stringify(address)}::jsonb, ${over.currency ?? "NOK"}, ${"rate" in over ? over.rate : 150000},
            ${"locale" in over ? over.locale : "nb-NO"}, ${over.business ?? true}, ${over.treatment ?? "domestic"},
            ${over.vat ?? null}, 'faktura@kunde.no', ${over.paymentDays ?? null})
    returning id`);
  return String(row.id);
}

async function makeAssignment(
  f: Fixture,
  clientId: string,
  over: { name?: string; billing?: "hourly" | "fixed_fee"; rate?: number | null; fixed?: number | null } = {},
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_assignments (store_id, client_id, name, billing_type, hourly_rate_minor, fixed_amount_minor)
    values (${f.storeId}::uuid, ${clientId}::uuid, ${over.name ?? "Rådgivning"}, ${over.billing ?? "hourly"},
            ${"rate" in over ? over.rate : 120000}, ${over.fixed ?? null})
    returning id`);
  return String(row.id);
}

async function makeTask(
  f: Fixture,
  assignmentId: string,
  title: string,
  estimate: number | null = null,
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_tasks (store_id, assignment_id, title, estimated_minutes, sort_order)
    values (${f.storeId}::uuid, ${assignmentId}::uuid, ${title}, ${estimate},
            (select coalesce(max(sort_order) + 1, 0) from commerce.work_tasks where assignment_id = ${assignmentId}::uuid))
    returning id`);
  return String(row.id);
}

async function logMinutes(
  f: Fixture,
  assignmentId: string,
  taskId: string | null,
  minutes: number,
  over: { billable?: boolean; prepaid?: number; daysAgo?: number } = {},
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_time_entries (store_id, assignment_id, task_id, account_id, work_date, minutes, billable, prepaid_minutes)
    values (${f.storeId}::uuid, ${assignmentId}::uuid, ${taskId}::uuid, ${f.accountId}::uuid,
            (commerce.work_today(${f.storeId}::uuid) - ${over.daysAgo ?? 2}::int), ${minutes}, ${over.billable ?? true}, ${over.prepaid ?? 0})
    returning id`);
  return String(row.id);
}

const asInput = (l: InvoiceLine) => ({
  id: l.id,
  assignmentId: l.assignmentId,
  taskId: l.taskId,
  description: l.description,
  unit: l.unit,
  quantityHundredths: l.quantityHundredths,
  unitPriceMinor: l.unitPriceMinor,
  discountBp: l.discountBp,
  vatCategory: l.vatCategory,
  quantityManual: l.quantityManual,
});

const newLine = (over: Record<string, unknown> = {}) => ({
  description: "Materials",
  unit: "unit",
  quantityHundredths: 100,
  unitPriceMinor: 5000,
  discountBp: 0,
  vatCategory: "standard",
  ...over,
});

/** The database refuses with a rule's code (the driver wraps the message, so the code is found in the chain of causes). */
async function expectRule(run: () => Promise<unknown>, code: string) {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(workErrorCode(caught)).toBe(code);
}

const one = async <T extends Row = Row>(query: ReturnType<typeof sql>): Promise<T> => (await db().execute<T>(query))[0];
const today = async (f: Fixture) =>
  String((await one(sql`select commerce.work_today(${f.storeId}::uuid)::text as d`)).d);
const eventTypes = async (f: Fixture, invoiceId: string) =>
  (
    await db().execute<Row>(
      sql`select type from commerce.work_events where store_id = ${f.storeId}::uuid and entity_id = ${invoiceId}::uuid order by id`,
    )
  ).map((r) => String(r.type));

afterAll(async () => {
  await closeDb();
});

// --- The main lifecycle: draft, time, issue, pay, reverse, credit -------------------------------------------------------

describe("the invoice lifecycle", () => {
  let f: Fixture;
  let client: string;
  let assignment: string;
  let t1: string;
  let t2: string;
  let entries: Record<string, string>;
  let draftId: string;
  let issuedId: string;

  beforeAll(async () => {
    f = await makeStore("life", { days: 30 });
    client = await makeClient(f, { name: "Kunde AS", legalName: "Kunde Norge AS" });
    assignment = await makeAssignment(f, client, { name: "Rådgivning", rate: 120000 });
    t1 = await makeTask(f, assignment, "Design");
    t2 = await makeTask(f, assignment, "Utvikling", 240);
    entries = {
      e1: await logMinutes(f, assignment, t1, 60),
      e2: await logMinutes(f, assignment, t1, 45),
      e3: await logMinutes(f, assignment, t2, 20),
      e4: await logMinutes(f, assignment, null, 90),
      e5: await logMinutes(f, assignment, t2, 30, { billable: false }),
      e6: await logMinutes(f, assignment, t2, 60, { prepaid: 60 }),
      e7: await logMinutes(f, assignment, t1, 40, { prepaid: 10 }),
    };
  });

  it("previews the next number without taking it", async () => {
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-1");
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-1");
  });

  it("starts a draft with the client's defaults, and only one draft per assignment", async () => {
    const created = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: assignment }));
    draftId = created.invoiceId;
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, draftId))!;
    expect(detail.invoice).toMatchObject({
      status: "draft",
      documentNumber: null,
      currency: "NOK",
      clientId: client,
      assignmentId: assignment,
      paymentDays: null,
      effectivePaymentDays: 30, // the settings', as neither the invoice nor the client sets any
      locale: "nb-NO",
    });
    expect(detail.invoice.tentativeDueOn).toBe(addCalendarDays(detail.today, 30));

    const second = bad(await invoices.createDraftInvoice(f.actor, { assignmentId: assignment }));
    expect(second.code).toBe("draft_exists");
    expect(second.problems[0]).toMatch(/already has a draft/);
    // The database enforces it as well.
    await expect(
      db().execute(sql`insert into commerce.work_invoices (store_id, client_id, assignment_id, currency)
                       values (${f.storeId}::uuid, ${client}::uuid, ${assignment}::uuid, 'NOK')`),
    ).rejects.toThrow();
    // An invoice on its own has no such limit.
    ok(await invoices.createDraftInvoice(f.actor, { clientId: client }));
    const other = await makeClient(f, { name: "Annen AS" });
    expect(
      bad(await invoices.createDraftInvoice(f.actor, { clientId: other, assignmentId: assignment })).problems[0],
    ).toMatch(/another client/);
    expect(await eventTypes(f, draftId)).toEqual(["invoice.created"]);
  });

  it("makes lines from unbilled time, attaches it, and follows the rules for what counts", async () => {
    const before = await invoices.unbilledTime(f.storeId, { assignmentId: assignment });
    const byTask = new Map(before.map((g) => [g.taskId, g]));
    expect(byTask.get(t1)).toMatchObject({ entries: 3, minutes: 135, rateMinor: 120000, amountMinor: 270000 });
    expect(byTask.get(t2)).toMatchObject({ entries: 1, minutes: 20 });
    expect(byTask.get(null)).toMatchObject({ entries: 1, minutes: 90 });

    const made = ok(await invoices.generateLinesFromTime(f.actor, draftId));
    expect(made).toMatchObject({ added: 3, updated: 0, attachedEntries: 5, minutes: 245 });

    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, draftId))!;
    const line = (title: string) => detail.lines.find((l) => l.description === title)!;
    expect(line("Design")).toMatchObject({
      quantityHundredths: 225,
      unitPriceMinor: 120000,
      exclMinor: 270000,
      vatMinor: 67500,
    });
    expect(line("Utvikling")).toMatchObject({ quantityHundredths: 33, exclMinor: 39600, vatMinor: 9900 });
    expect(line("Rådgivning")).toMatchObject({
      quantityHundredths: 150,
      exclMinor: 180000,
      vatMinor: 45000,
      taskId: null,
    });
    expect(detail.totals).toMatchObject({ subtotalMinor: 489600, vatMinor: 122400, totalMinor: 612000 });
    expect(detail.invoice.totalMinor).toBe(612000);
    expect(detail.totals.vatGroups).toEqual([
      { category: "standard", vatBp: 2500, netMinor: 489600, vatMinor: 122400, grossMinor: 612000 },
    ]);

    const attached = await db().execute<Row>(
      sql`select id, invoice_line_id from commerce.work_time_entries where store_id = ${f.storeId}::uuid and assignment_id = ${assignment}::uuid`,
    );
    const on = new Map(attached.map((r) => [String(r.id), r.invoice_line_id]));
    for (const key of ["e1", "e2", "e3", "e4", "e7"]) expect(on.get(entries[key]), key).not.toBeNull();
    expect(on.get(entries.e5)).toBeNull(); // not billable
    expect(on.get(entries.e6)).toBeNull(); // paid for in advance

    // Run again: nothing is taken twice.
    expect(ok(await invoices.generateLinesFromTime(f.actor, draftId))).toMatchObject({ added: 0, updated: 0 });
    expect((await invoices.getWorkInvoiceDetail(f.storeId, draftId))!.totals.totalMinor).toBe(612000);
  });

  it("saves lines by id in the browser's order, pairs new lines with tasks, and refuses client-sent totals", async () => {
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, draftId))!;
    const inputs = detail.lines.map(asInput);
    const materials = newLine({ description: "Materials" });

    const refused = bad(await invoices.saveLines(f.actor, draftId, [...inputs, { ...materials, exclMinor: 1 }]));
    expect(refused.problems[0]).toMatch(/worked out by the server/);
    expect(bad(await invoices.saveDraft(f.actor, draftId, { totalMinor: 1 })).problems[0]).toMatch(
      /worked out by the server/,
    );

    const tasksBefore = Number(
      (await one(sql`select count(*)::int as n from commerce.work_tasks where assignment_id = ${assignment}::uuid`)).n,
    );
    const saved = ok(await invoices.saveLines(f.actor, draftId, [...inputs.slice().reverse(), materials]));
    expect(saved.lines.map((l) => l.id).slice(0, 3)).toEqual(inputs.map((l) => l.id).reverse());
    expect(saved.lines.map((l) => l.position)).toEqual([0, 1, 2, 3]);
    expect(saved.preview.totals).toMatchObject({ subtotalMinor: 494600, vatMinor: 123650, totalMinor: 618250 });
    // The two lines that had no task each got one (the unnamed-time line and Materials).
    const tasksAfter = Number(
      (await one(sql`select count(*)::int as n from commerce.work_tasks where assignment_id = ${assignment}::uuid`)).n,
    );
    expect(tasksAfter).toBe(tasksBefore + 2);
    expect(saved.lines.every((l) => l.taskId)).toBe(true);

    // The time stays attached through a save.
    const still = await one(
      sql`select count(*)::int as n from commerce.work_time_entries where assignment_id = ${assignment}::uuid and invoice_line_id is not null`,
    );
    expect(Number(still.n)).toBe(5);

    // A rename follows into the task.
    const fresh = (await invoices.getWorkInvoiceDetail(f.storeId, draftId))!;
    ok(
      await invoices.saveLines(
        f.actor,
        draftId,
        fresh.lines.map((l) => ({
          ...asInput(l),
          ...(l.description === "Design" ? { description: "Design work" } : {}),
        })),
      ),
    );
    const task = await one(sql`select title from commerce.work_tasks where id = ${t1}::uuid`);
    expect(task.title).toBe("Design work");
  });

  it("reports what is missing before issuing, and issues nothing", async () => {
    const readiness = (await invoices.invoiceReadiness(f.storeId, draftId))!;
    expect(readiness).toMatchObject({ ready: true, needsFxRate: false, homeCurrency: "NOK" });
    const preview = (await invoices.invoiceDocumentData(f.storeId, draftId))!;
    expect(preview).toMatchObject({ draft: true, documentNumber: null, status: "draft" });
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-1");
  });

  it("issues the draft: number W-1, frozen amounts, snapshot, one event, a token", async () => {
    const wrongTotal = bad(await invoices.issueInvoice(f.actor, { invoiceId: draftId, expectedTotalMinor: 1 }));
    expect(wrongTotal.code).toBe("total_changed");
    expect(wrongTotal.problems[0]).toMatch(/total is now/);
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-1"); // the failed attempt used no number

    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: draftId, expectedTotalMinor: 618250 })).invoice;
    issuedId = issued.invoiceId;
    expect(issued).toMatchObject({
      documentNumber: "W-1",
      number: 1,
      totalMinor: 618250,
      subtotalMinor: 494600,
      vatMinor: 123650,
      currency: "NOK",
    });
    expect(issued.dueOn).toBe(addCalendarDays(issued.issuedOn, 30));
    expect(issued.publicToken.length).toBeGreaterThan(20);

    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, issuedId))!;
    expect(detail.invoice).toMatchObject({
      status: "sent",
      documentNumber: "W-1",
      locale: "nb-NO",
      paymentDays: 30,
      vatNotes: [],
    });
    expect(detail.totals.totalMinor).toBe(618250);
    expect(detail.seller).toMatchObject({
      legalName: "Konsulent AS",
      organisationNumber: "923456789",
      vatNumber: "NO923456789MVA",
      bankAccount: IBAN,
    });
    expect(detail.buyer).toMatchObject({
      name: "Kunde Norge AS",
      clientName: "Kunde AS",
      country: "NO",
      vatTreatment: "domestic",
    });
    expect(detail.amounts).toEqual({ totalMinor: 618250, paidMinor: 0, creditedMinor: 0, outstandingMinor: 618250 });
    expect(detail.lines.find((l) => l.description === "Design work")).toMatchObject({ vatBp: 2500, exclMinor: 270000 });
    expect(detail.readiness).toBeNull();

    const types = await eventTypes(f, issuedId);
    expect(types.filter((t) => t === "invoice.issued")).toHaveLength(1);
    expect(types).toEqual(["invoice.created", "invoice.issued"]);
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-2");
    expect(await invoices.findInvoiceByToken(issued.publicToken)).toEqual({ storeId: f.storeId, invoiceId: issuedId });
    expect(await invoices.findInvoiceByToken("x".repeat(30))).toBeNull();
  });

  it("gives the document everything from the snapshot, in the client's language", async () => {
    const doc = (await invoices.invoiceDocumentData(f.storeId, issuedId))!;
    expect(doc).toMatchObject({
      kind: "invoice",
      draft: false,
      language: "nb",
      documentNumber: "W-1",
      consistent: true,
      currency: "NOK",
      vatNotes: [],
      vatHome: null,
    });
    expect(doc.labels.invoice).toBe("Faktura");
    expect(doc.dueOn).toBe(addCalendarDays(doc.issuedOn!, 30));
    expect(doc.payment).toMatchObject({
      bankAccount: IBAN,
      bic: "DNBANOKKXXX",
      paymentReference: "W-1",
      amountDueMinor: 618250,
    });
    expect(doc.latePaymentNote).toMatch(/forsinkelsesrente/);
    expect(doc.lines).toHaveLength(4);
    expect(doc.totals.vatGroups).toEqual([
      { category: "standard", vatBp: 2500, netMinor: 494600, vatMinor: 123650, grossMinor: 618250 },
    ]);
    expect(doc.seller.legalName).toBe("Konsulent AS");
    expect(doc.buyer.name).toBe("Kunde Norge AS");
    // A later change to the client or the store does not reach the issued document.
    await db().execute(sql`update commerce.work_clients set legal_name = 'Nytt Navn AS' where id = ${client}::uuid`);
    await db().execute(sql`update commerce.stores set legal_name = 'Endret AS' where id = ${f.storeId}::uuid`);
    const again = (await invoices.invoiceDocumentData(f.storeId, issuedId))!;
    expect(again.buyer.name).toBe("Kunde Norge AS");
    expect(again.seller.legalName).toBe("Konsulent AS");
    await db().execute(sql`update commerce.work_clients set legal_name = 'Kunde Norge AS' where id = ${client}::uuid`);
    await db().execute(sql`update commerce.stores set legal_name = 'Konsulent AS' where id = ${f.storeId}::uuid`);
  });

  it("is immutable once issued: lines, time, the invoice and its deletion", async () => {
    const lines = (await invoices.getWorkInvoiceDetail(f.storeId, issuedId))!.lines;
    expect(bad(await invoices.saveLines(f.actor, issuedId, lines.map(asInput))).problems[0]).toMatch(/issued/);
    expect(
      bad(await invoices.saveDraft(f.actor, issuedId, { clientId: client, currency: "NOK", lines: [] })).problems[0],
    ).toMatch(/issued/);
    expect(bad(await invoices.generateLinesFromTime(f.actor, issuedId)).problems[0]).toMatch(/issued/);
    expect(bad(await invoices.deleteDraft(f.actor, issuedId)).problems[0]).toMatch(/cannot be deleted/);
    expect(bad(await invoices.issueInvoice(f.actor, { invoiceId: issuedId })).problems[0]).toMatch(/issued/);
    expect(bad(await invoices.releaseTimeFromDrafts(f.actor, [entries.e1])).problems[0]).toMatch(/issued invoice/);

    await expectRule(
      () => db().execute(sql`update commerce.work_time_entries set minutes = 61 where id = ${entries.e1}::uuid`),
      "work_time.immutable",
    );
    await expectRule(
      () => db().execute(sql`delete from commerce.work_time_entries where id = ${entries.e1}::uuid`),
      "work_time.immutable",
    );
    await expectRule(
      () =>
        db().execute(
          sql`update commerce.work_invoice_lines set quantity_hundredths = 1 where id = ${lines[0].id}::uuid`,
        ),
      "work_invoice.immutable",
    );
    await expectRule(
      () => db().execute(sql`delete from commerce.work_invoices where id = ${issuedId}::uuid`),
      "work_invoice.immutable",
    );
  });

  it("records partial and full payments, sets paid, reverses, and refuses what does not fit", async () => {
    expect(
      bad(
        await invoices.recordPayment(f.actor, { invoiceId: issuedId, amountMinor: 700000, receivedOn: await today(f) }),
      ).problems[0],
    ).toMatch(/more than what is outstanding/);
    const tomorrow = addCalendarDays(await today(f), 1);
    expect(
      bad(await invoices.recordPayment(f.actor, { invoiceId: issuedId, amountMinor: 100, receivedOn: tomorrow }))
        .problems[0],
    ).toMatch(/future/);

    const first = ok(
      await invoices.recordPayment(f.actor, {
        invoiceId: issuedId,
        amountMinor: 100000,
        receivedOn: await today(f),
        method: "bank",
        reference: "KID 1",
      }),
    );
    expect(first).toMatchObject({ status: "sent", amounts: { paidMinor: 100000, outstandingMinor: 518250 } });
    const second = ok(
      await invoices.recordPayment(f.actor, { invoiceId: issuedId, amountMinor: 518250, receivedOn: await today(f) }),
    );
    expect(second).toMatchObject({ status: "paid", amounts: { paidMinor: 618250, outstandingMinor: 0 } });
    const paid = await one(sql`select status, paid_at from commerce.work_invoices where id = ${issuedId}::uuid`);
    expect(paid.status).toBe("paid");
    expect(paid.paid_at).not.toBeNull();
    expect(
      bad(await invoices.recordPayment(f.actor, { invoiceId: issuedId, amountMinor: 1, receivedOn: await today(f) }))
        .problems[0],
    ).toMatch(/already paid in full/);

    const reversed = ok(await invoices.reversePayment(f.actor, { paymentId: second.paymentId, reason: "Bounced" }));
    expect(reversed).toMatchObject({ status: "sent", amounts: { paidMinor: 100000, outstandingMinor: 518250 } });
    expect(bad(await invoices.reversePayment(f.actor, { paymentId: second.paymentId })).problems[0]).toMatch(
      /already been reversed/,
    );
    expect(bad(await invoices.reversePayment(f.actor, { paymentId: reversed.reversalId })).problems[0]).toMatch(
      /Only a payment that was received/,
    );

    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, issuedId))!;
    expect(detail.payments.map((p) => [p.amountMinor, p.reversed, p.reverses !== null])).toEqual([
      [100000, false, false],
      [518250, true, false],
      [-518250, false, true],
    ]);
    // The triggers wrote the history; the server wrote none of it a second time.
    const types = await eventTypes(f, issuedId);
    expect(types.filter((t) => t === "payment.recorded")).toHaveLength(2);
    expect(types.filter((t) => t === "payment.reversed")).toHaveLength(1);
    expect(types.filter((t) => t === "invoice.paid")).toHaveLength(1);
    expect(types.filter((t) => t === "invoice.reopened")).toHaveLength(1);
  });

  it("credits the whole invoice with the refund of what was paid, voids it and releases its time", async () => {
    expect(
      bad(await invoices.creditInvoice(f.actor, { invoiceId: issuedId, kind: "full", reason: "" })).problems[0],
    ).toMatch(/Say why/);
    const credit = ok(
      await invoices.creditInvoice(f.actor, {
        invoiceId: issuedId,
        kind: "full",
        reason: "Wrong client",
        refund: { method: "bank" },
      }),
    ).creditNote;
    expect(credit).toMatchObject({ documentNumber: "WCN-1", totalMinor: 618250, voided: true, refundedMinor: 100000 });

    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, issuedId))!;
    expect(detail.invoice.status).toBe("void");
    expect(detail.amounts).toMatchObject({ creditedMinor: 618250, paidMinor: 0 });
    expect(detail.payments.at(-1)).toMatchObject({ amountMinor: -100000, refund: true });
    expect(detail.creditNotes).toHaveLength(1);
    expect(detail.creditNotes[0].lines).toHaveLength(4);
    const types = await eventTypes(f, issuedId);
    expect(types).toContain("invoice.credited");
    expect(types).toContain("payment.refunded");

    const released = await one(
      sql`select count(*)::int as n from commerce.work_time_entries where assignment_id = ${assignment}::uuid and invoice_line_id is not null`,
    );
    expect(Number(released.n)).toBe(0);

    expect(
      bad(await invoices.creditInvoice(f.actor, { invoiceId: issuedId, kind: "full", reason: "Again" })).problems[0],
    ).toMatch(/already fully credited/);
    expect(
      bad(await invoices.recordPayment(f.actor, { invoiceId: issuedId, amountMinor: 1, receivedOn: await today(f) }))
        .problems[0],
    ).toMatch(/fully credited/);

    const note = (await invoices.creditNoteDocumentData(f.storeId, credit.creditNoteId))!;
    expect(note).toMatchObject({
      kind: "credit_note",
      documentNumber: "WCN-1",
      invoiceNumber: "W-1",
      full: true,
      language: "nb",
      consistent: true,
    });
    expect(note.wording.statement).toBe("Denne kreditnotaen krediterer faktura W-1 i sin helhet.");
    expect(note.totals.totalMinor).toBe(618250);
    const doc = (await invoices.invoiceDocumentData(f.storeId, issuedId))!;
    expect(doc.creditNotes.map((c) => c.documentNumber)).toEqual(["WCN-1"]);
  });

  it("bills the released time again on a new draft, and the next number continues without a gap", async () => {
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: assignment })).invoiceId;
    expect(ok(await invoices.generateLinesFromTime(f.actor, draft))).toMatchObject({ added: 3, attachedEntries: 5 });
    // A deleted draft burns no number.
    const throwaway = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(await invoices.deleteDraft(f.actor, throwaway));
    expect(await invoices.getWorkInvoiceDetail(f.storeId, throwaway)).toBeNull();
    expect(await eventTypes(f, throwaway)).toContain("invoice.deleted");
    const second = ok(await invoices.issueInvoice(f.actor, { invoiceId: draft })).invoice;
    expect(second.documentNumber).toBe("W-2");
    // Deleting a draft leaves the assignment, its tasks and time alone.
    const third = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(await invoices.saveLines(f.actor, third, [newLine({ description: "Fixed part", unitPriceMinor: 10000 })]));
    expect(ok(await invoices.issueInvoice(f.actor, { invoiceId: third })).invoice.documentNumber).toBe("W-3");
    const numbers = await db().execute<Row>(
      sql`select number from commerce.work_invoices where store_id = ${f.storeId}::uuid and number is not null order by number`,
    );
    expect(numbers.map((r) => Number(r.number))).toEqual([1, 2, 3]);
  });
});

// --- Credit notes in parts, with time --------------------------------------------------------------------------------------------

describe("credit notes in parts", () => {
  it("credit lines by quantity, add up to the invoice, and release the time only when all is credited", async () => {
    const f = await makeStore("part");
    const client = await makeClient(f);
    const a = await makeAssignment(f, client, { rate: 100000 });
    const ta = await makeTask(f, a, "Workshop");
    const tb = await makeTask(f, a, "Report");
    const entryA = await logMinutes(f, a, ta, 120);
    await logMinutes(f, a, tb, 60);
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    ok(await invoices.generateLinesFromTime(f.actor, draft));
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: draft })).invoice;
    expect(issued.totalMinor).toBe(375000); // 2.00 h and 1.00 h at 1 000.00, plus 25 % VAT
    const lines = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!.lines;
    const workshop = lines.find((l) => l.description === "Workshop")!;
    const report = lines.find((l) => l.description === "Report")!;

    const tooMuch = bad(
      await invoices.creditInvoice(f.actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "Too many hours",
        lines: [{ lineId: workshop.id, quantityHundredths: 300 }],
      }),
    );
    expect(tooMuch.problems[0]).toMatch(/more than what is left/);

    const part = ok(
      await invoices.creditInvoice(f.actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "Half an hour too many",
        lines: [{ lineId: workshop.id, quantityHundredths: 50 }],
      }),
    ).creditNote;
    expect(part).toMatchObject({ documentNumber: "WCN-1", totalMinor: 62500, voided: false });
    let detail = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!;
    expect(detail.invoice.status).toBe("sent");
    expect(detail.amounts).toMatchObject({ creditedMinor: 62500, outstandingMinor: 312500 });
    expect(detail.lines.find((l) => l.id === workshop.id)!.creditedQuantityHundredths).toBe(50);
    // The time stays on the invoice after a partial credit.
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${entryA}::uuid`))
        .invoice_line_id,
    ).not.toBeNull();

    const rest = ok(
      await invoices.creditInvoice(f.actor, { invoiceId: issued.invoiceId, kind: "full", reason: "Cancelled" }),
    ).creditNote;
    expect(rest).toMatchObject({ documentNumber: "WCN-2", totalMinor: 312500, voided: true });
    detail = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!;
    expect(detail.creditNotes.reduce((sum, c) => sum + c.totalMinor, 0)).toBe(detail.invoice.totalMinor);
    expect(detail.creditNotes[1].lines.map((l) => [l.description, l.quantityHundredths]).sort()).toEqual([
      ["Report", 100],
      ["Workshop", 150],
    ]);
    expect(detail.lines.find((l) => l.id === report.id)!.creditedQuantityHundredths).toBe(100);
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${entryA}::uuid`))
        .invoice_line_id,
    ).toBeNull();
    expect(
      bad(await invoices.creditInvoice(f.actor, { invoiceId: issued.invoiceId, kind: "full", reason: "x" }))
        .problems[0],
    ).toMatch(/fully credited/);
  });

  it("refunds only what was paid beyond what is owed, and rolls the credit note back otherwise", async () => {
    const f = await makeStore("refund");
    const client = await makeClient(f);
    const draft = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(
      await invoices.saveLines(f.actor, draft, [
        newLine({ description: "Workshop", quantityHundredths: 400, unitPriceMinor: 100000 }),
      ]),
    );
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: draft })).invoice; // 400 000 + 100 000 VAT
    expect(issued.totalMinor).toBe(500000);
    ok(
      await invoices.recordPayment(f.actor, {
        invoiceId: issued.invoiceId,
        amountMinor: 500000,
        receivedOn: await today(f),
      }),
    );
    const line = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!.lines[0];
    // Crediting 1.00 h (125 000 with VAT) of a fully paid invoice: at most 125 000 can be paid back.
    const tooBig = bad(
      await invoices.creditInvoice(f.actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "One hour",
        lines: [{ lineId: line.id, quantityHundredths: 100 }],
        refund: { amountMinor: 200000, method: "bank" },
      }),
    );
    expect(tooBig.problems[0]).toMatch(/at most|most that can be refunded/);
    const untouched = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!;
    expect(untouched.creditNotes).toHaveLength(0); // rolled back with the refund
    expect(
      await one(
        sql`select next_number from commerce.document_series where store_id = ${f.storeId}::uuid and series = 'work_credit_note'`,
      ),
    ).toMatchObject({ next_number: "1" });

    const ok1 = ok(
      await invoices.creditInvoice(f.actor, {
        invoiceId: issued.invoiceId,
        kind: "partial",
        reason: "One hour",
        lines: [{ lineId: line.id, quantityHundredths: 100 }],
        refund: { method: "bank" },
      }),
    ).creditNote;
    expect(ok1).toMatchObject({ totalMinor: 125000, refundedMinor: 125000, voided: false });
    const after = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!;
    expect(after.invoice.status).toBe("paid"); // what was paid still covers what is owed
    expect(after.amounts).toMatchObject({ paidMinor: 375000, creditedMinor: 125000, outstandingMinor: 0 });
  });
});

// --- Numbers -------------------------------------------------------------------------------------------------------------------------

describe("numbering", () => {
  it("is gap-free across invoices and concurrent issuing gives distinct numbers", async () => {
    const f = await makeStore("num");
    const client = await makeClient(f);
    const drafts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
      ok(await invoices.saveLines(f.actor, d, [newLine({ description: `Line ${i}`, unitPriceMinor: 10000 + i })]));
      drafts.push(d);
    }
    const results = await Promise.all(
      drafts.slice(0, 3).map((invoiceId) => invoices.issueInvoice(f.actor, { invoiceId })),
    );
    const numbers = results.map((r) => ok(r).invoice.number).sort();
    expect(numbers).toEqual([1, 2, 3]);
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-4");

    // The same draft issued twice at once: one wins, the other is told it is issued.
    const race = await Promise.all([
      invoices.issueInvoice(f.actor, { invoiceId: drafts[3] }),
      invoices.issueInvoice(f.actor, { invoiceId: drafts[3] }),
    ]);
    expect(race.filter((r) => r.ok)).toHaveLength(1);
    expect(bad(race.find((r) => !r.ok)!).problems[0]).toMatch(/issued/);
    const all = await db().execute<Row>(
      sql`select number from commerce.work_invoices where store_id = ${f.storeId}::uuid order by number`,
    );
    expect(all.map((r) => Number(r.number))).toEqual([1, 2, 3, 4]);
  });

  it("refuses a date in the future and, until confirmed, one before the previous invoice's", async () => {
    const f = await makeStore("dates");
    const client = await makeClient(f);
    const make = async (description: string) => {
      const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
      ok(await invoices.saveLines(f.actor, d, [newLine({ description })]));
      return d;
    };
    const now = await today(f);
    ok(await invoices.issueInvoice(f.actor, { invoiceId: await make("First") }));
    const second = await make("Second");
    expect(
      bad(await invoices.issueInvoice(f.actor, { invoiceId: second, issuedOn: addCalendarDays(now, 1) })).problems[0],
    ).toMatch(/future/);
    const early = bad(await invoices.issueInvoice(f.actor, { invoiceId: second, issuedOn: addCalendarDays(now, -5) }));
    expect(early.code).toBe("date_before_previous");
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-2");
    const confirmed = ok(
      await invoices.issueInvoice(f.actor, {
        invoiceId: second,
        issuedOn: addCalendarDays(now, -5),
        confirmEarlierDate: true,
      }),
    );
    expect(confirmed.invoice).toMatchObject({
      documentNumber: "W-2",
      issuedOn: addCalendarDays(now, -5),
      dueOn: addCalendarDays(now, 9),
    });
  });
});

// --- VAT ---------------------------------------------------------------------------------------------------------------------------------------

describe("VAT scenarios", () => {
  it("charges nothing and says why when the store is not registered for VAT", async () => {
    const f = await makeStore("noreg", { registered: false });
    const client = await makeClient(f);
    const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(
      await invoices.saveLines(f.actor, d, [
        newLine({ description: "Advice", quantityHundredths: 200, unitPriceMinor: 100000 }),
      ]),
    );
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, d))!;
    expect(detail.totals).toMatchObject({ subtotalMinor: 200000, vatMinor: 0, totalMinor: 200000 });
    expect(detail.invoice.vatNotes).toEqual(["not_registered"]);
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: d })).invoice;
    expect(issued).toMatchObject({ totalMinor: 200000, vatMinor: 0 });
    const doc = (await invoices.invoiceDocumentData(f.storeId, issued.invoiceId))!;
    expect(doc.vatNotes[0].key).toBe("not_registered");
    expect(doc.vatNotes[0].text).toMatch(/Merverdiavgift er ikke beregnet/); // nb-NO client
    expect(doc.seller.vatRegistered).toBe(false);
  });

  it("uses reverse charge for an EU business with a VAT number, and asks for the exchange rate", async () => {
    const f = await makeStore("rc");
    const client = await makeClient(f, {
      name: "Kunde GmbH",
      country: "DE",
      treatment: "reverse_charge",
      vat: "DE123456789",
      currency: "EUR",
      locale: "de-DE",
      address: { line1: "Hauptstr. 1", postalCode: "10115", city: "Berlin" },
    });
    const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    // "standard" in the editor follows the client: the line becomes reverse charge, at 0 %.
    const saved = ok(
      await invoices.saveLines(f.actor, d, [
        newLine({ description: "Consulting", quantityHundredths: 1000, unitPriceMinor: 10000 }),
      ]),
    );
    expect(saved.preview.lines[0]).toMatchObject({
      vatCategory: "reverse_charge",
      vatBp: 0,
      exclMinor: 100000,
      vatMinor: 0,
    });
    expect(saved.preview.totals.totalMinor).toBe(100000);

    const readiness = (await invoices.invoiceReadiness(f.storeId, d))!;
    expect(readiness.needsFxRate).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.problems.map((p) => p.code)).toContain("fx_rate_required");
    expect(readiness.problems.find((p) => p.code === "reverse_charge_seller_not_eu")?.severity).toBe("warning");
    const notReady = bad(await invoices.issueInvoice(f.actor, { invoiceId: d }));
    expect(notReady.code).toBe("not_ready");
    expect(notReady.problems.join(" ")).toMatch(/exchange rate/);
    expect(bad(await invoices.issueInvoice(f.actor, { invoiceId: d, fxRate: "abc" })).problems[0]).toMatch(
      /exchange rate must be/,
    );

    const withRate = (await invoices.invoiceReadiness(f.storeId, d, { fxRate: "11,5" }))!;
    expect(withRate.ready).toBe(true);
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: d, fxRate: "11.5" })).invoice;
    expect(issued).toMatchObject({ totalMinor: 100000, vatMinor: 0, vatHomeMinor: 0 });
    const doc = (await invoices.invoiceDocumentData(f.storeId, issued.invoiceId))!;
    expect(doc.language).toBe("en"); // German documents fall back to English
    expect(doc.vatNotes.map((n) => n.key)).toEqual(["reverse_charge"]);
    expect(doc.buyer).toMatchObject({ vatNumber: "DE123456789", country: "DE", vatTreatment: "reverse_charge" });
    expect(doc.vatHome).toMatchObject({ currency: "NOK", rate: "11.50000000" });
  });

  it("lists a missing VAT number for reverse charge, and lines follow the client when its treatment changes", async () => {
    const f = await makeStore("rc2");
    const client = await makeClient(f, {
      name: "Kunde SE AB",
      country: "SE",
      treatment: "domestic",
      currency: "NOK",
      address: { line1: "Storgatan 1", postalCode: "111 22", city: "Stockholm" },
    });
    const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(
      await invoices.saveLines(f.actor, d, [
        newLine({ description: "Work", quantityHundredths: 100, unitPriceMinor: 100000 }),
      ]),
    );
    expect((await invoices.getWorkInvoiceDetail(f.storeId, d))!.totals.vatMinor).toBe(25000);
    // The owner now treats the client as reverse charge, but has no VAT number for it yet.
    await db().execute(
      sql`update commerce.work_clients set vat_treatment = 'reverse_charge' where id = ${client}::uuid`,
    );
    // The draft's header is kept current for the lists when the client's treatment changes, by the hook.
    expect(await invoices.refreshDraftInvoices(db(), { storeId: f.storeId, clientId: client })).toBe(1);
    expect((await invoices.listWorkInvoices(f.storeId)).rows[0]).toMatchObject({ id: d, totalMinor: 100000 });
    const readiness = (await invoices.invoiceReadiness(f.storeId, d))!;
    expect(readiness.problems.map((p) => p.code)).toContain("buyer_vat_number");
    expect(bad(await invoices.issueInvoice(f.actor, { invoiceId: d })).problems.join(" ")).toMatch(/VAT number/);
    await db().execute(sql`update commerce.work_clients set vat_number = 'SE556677889901' where id = ${client}::uuid`);
    // The draft's lines were saved as standard: issuing aligns them, so it is 0 % now.
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: d })).invoice;
    expect(issued).toMatchObject({ vatMinor: 0, totalMinor: 100000, vatHomeMinor: null });
    const line = (await invoices.getWorkInvoiceDetail(f.storeId, issued.invoiceId))!.lines[0];
    expect(line).toMatchObject({ vatCategory: "reverse_charge", vatBp: 0 });
  });

  it("states the VAT in the seller's currency for an invoice in a foreign currency", async () => {
    const f = await makeStore("fx");
    const client = await makeClient(f, {
      name: "Privat",
      business: false,
      country: "NO",
      currency: "EUR",
      locale: "en-GB",
    });
    const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(
      await invoices.saveLines(f.actor, d, [
        newLine({ description: "Coaching", quantityHundredths: 100, unitPriceMinor: 20000 }),
      ]),
    );
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, d))!;
    expect(detail.totals).toMatchObject({ subtotalMinor: 20000, vatMinor: 5000, totalMinor: 25000 });
    const issued = ok(await invoices.issueInvoice(f.actor, { invoiceId: d, fxRate: "11.5" })).invoice;
    expect(issued.vatHomeMinor).toBe(convertMinor(5000, "11.5"));
    expect(issued.vatHomeMinor).toBe(57500);
    const doc = (await invoices.invoiceDocumentData(f.storeId, issued.invoiceId))!;
    expect(doc.vatHome).toEqual({ amountMinor: 57500, currency: "NOK", rate: "11.50000000" });
    expect(doc.language).toBe("en");
    expect(
      invoices.suggestFxRate(
        new Map([
          ["NOK", { rate: 11.5 }],
          ["SEK", { rate: 11 }],
        ]),
        "NOK",
        "EUR",
      ),
    ).toBe("11.50000000");
    expect(invoices.suggestFxRate(new Map(), "NOK", "SEK")).toBeNull();
  });

  it("aligns a line's category with the client's treatment (pure)", () => {
    const ctx = {
      sellerVatRegistered: true,
      clientTreatment: "domestic" as const,
      clientBusiness: true,
      standardRateBp: 2500,
    };
    expect(invoices.alignCategory(ctx, "reverse_charge")).toBe("standard");
    expect(invoices.alignCategory(ctx, "exempt")).toBe("exempt");
    expect(invoices.alignCategory({ ...ctx, clientTreatment: "outside_scope" }, "standard")).toBe("outside_scope");
    expect(
      invoices.alignCategory({ ...ctx, clientBusiness: false, clientTreatment: "reverse_charge" }, "standard"),
    ).toBe("standard");
    expect(
      invoices.alignCategory({ ...ctx, sellerVatRegistered: false, clientTreatment: "reverse_charge" }, "standard"),
    ).toBe("standard");
  });
});

// --- Readiness -----------------------------------------------------------------------------------------------------------------------------------

describe("the readiness checklist", () => {
  it("lists everything that is missing at once, and nothing is issued", async () => {
    const f = await makeStore("ready", { seller: false });
    const client = await makeClient(f, { country: null, address: {} });
    const empty = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    const noLines = (await invoices.invoiceReadiness(f.storeId, empty))!;
    expect(noLines.problems.map((p) => p.code)).toContain("no_lines");

    ok(await invoices.saveLines(f.actor, empty, [newLine({ description: "Work", unitPriceMinor: 10000 })]));
    const readiness = (await invoices.invoiceReadiness(f.storeId, empty))!;
    expect(readiness.ready).toBe(false);
    const codes = readiness.problems.map((p) => p.code);
    for (const code of [
      "seller_legal_name",
      "seller_organisation_number",
      "seller_address",
      "seller_country",
      "seller_bank_account",
      "buyer_address",
      "buyer_country",
    ]) {
      expect(codes, code).toContain(code);
    }
    expect(readiness.problems.every((p) => p.message.length > 10 && p.where)).toBe(true);

    const refused = bad(await invoices.issueInvoice(f.actor, { invoiceId: empty }));
    expect(refused.code).toBe("not_ready");
    expect(refused.problems.length).toBeGreaterThanOrEqual(7);
    expect(await invoices.nextInvoiceNumberPreview(f.storeId)).toBe("W-1");
    expect((await one(sql`select status from commerce.work_invoices where id = ${empty}::uuid`)).status).toBe("draft");

    // What the database's own checklist says agrees: it is not issued even if the pure checks were bypassed.
    const sqlProblems = (await one(sql`select commerce.work_invoice_problems(${f.storeId}::uuid, ${empty}::uuid) as p`))
      .p as string[];
    expect(sqlProblems).toEqual(
      expect.arrayContaining(["seller_name", "seller_address", "buyer_address", "buyer_country"]),
    );

    // Completing the details makes it ready.
    await db().execute(sql`
      update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0150 Oslo',
             country = 'NO' where id = ${f.storeId}::uuid`);
    await db().execute(
      sql`insert into commerce.work_settings (store_id, vat_number, bank_account) values (${f.storeId}::uuid, 'NO923456789MVA', ${IBAN})`,
    );
    await db().execute(
      sql`update commerce.work_clients set country = 'NO', billing_address = '{"line1":"Gata 1","postalCode":"0150","city":"Oslo"}'::jsonb where id = ${client}::uuid`,
    );
    expect((await invoices.invoiceReadiness(f.storeId, empty))!.ready).toBe(true);
    expect(ok(await invoices.issueInvoice(f.actor, { invoiceId: empty })).invoice.documentNumber).toBe("W-1");
  });

  it("does not issue a draft with a zero total", async () => {
    const f = await makeStore("zero");
    const client = await makeClient(f);
    const d = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    ok(await invoices.saveLines(f.actor, d, [newLine({ unitPriceMinor: 0 })]));
    const readiness = (await invoices.invoiceReadiness(f.storeId, d))!;
    expect(readiness.problems.map((p) => p.code)).toContain("zero_total");
    expect(bad(await invoices.issueInvoice(f.actor, { invoiceId: d })).problems.join(" ")).toMatch(/zero|amount/i);
  });
});

// --- The mirror between tasks and lines, and time on drafts -----------------------------------------------------------------------------------------

describe("tasks, lines and time", () => {
  let f: Fixture;
  let client: string;

  beforeAll(async () => {
    f = await makeStore("mirror");
    client = await makeClient(f);
  });

  it("mirrors a new task as a line priced at the assignment's rate, and follows its logged time", async () => {
    const a = await makeAssignment(f, client, { name: "Retainer", rate: 90000 });
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    const t = await makeTask(f, a, "Audit", 120);

    expect(
      await invoices.syncTaskToDraftLine(db(), {
        storeId: f.storeId,
        assignmentId: a,
        task: { id: t, title: "Audit", estimatedMinutes: 120 },
      }),
    ).toBe(draft);
    let lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Audit",
      quantityHundredths: 200,
      unitPriceMinor: 90000,
      taskId: t,
      exclMinor: 180000,
    });
    // Renamed: the line follows, no second line appears.
    await invoices.syncTaskToDraftLine(db(), {
      storeId: f.storeId,
      assignmentId: a,
      task: { id: t, title: "Security audit", estimatedMinutes: 120 },
    });
    lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines.map((l) => l.description)).toEqual(["Security audit"]);
    // No draft, no line.
    const other = await makeAssignment(f, client, { name: "Nothing" });
    const otherTask = await makeTask(f, other, "X");
    expect(
      await invoices.syncTaskToDraftLine(db(), {
        storeId: f.storeId,
        assignmentId: other,
        task: { id: otherTask, title: "X", estimatedMinutes: null },
      }),
    ).toBeNull();

    // Time logged on the task becomes the line's hours, and is attached to it.
    const e1 = await logMinutes(f, a, t, 30);
    const e2 = await logMinutes(f, a, t, 45);
    const nonBillable = await logMinutes(f, a, t, 500, { billable: false });
    expect(await invoices.syncTaskHoursToDraftLine(db(), { storeId: f.storeId, taskId: t })).toBe(draft);
    lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines[0]).toMatchObject({
      quantityHundredths: 125,
      timeMinutes: 75,
      exclMinor: 112500,
      unitPriceMinor: 90000,
    });
    const attached = await db().execute<Row>(
      sql`select id from commerce.work_time_entries where invoice_line_id = ${lines[0].id}::uuid`,
    );
    expect(attached.map((r) => String(r.id)).sort()).toEqual([e1, e2].sort());
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${nonBillable}::uuid`))
        .invoice_line_id,
    ).toBeNull();

    // A quantity the owner typed is never rewritten by logged time; the time is still taken so it is not billed twice.
    ok(
      await invoices.saveLines(f.actor, draft, [
        { ...asInput(lines[0]), quantityHundredths: 300, quantityManual: true },
      ]),
    );
    const e3 = await logMinutes(f, a, t, 60);
    await invoices.syncTaskHoursToDraftLine(db(), { storeId: f.storeId, taskId: t });
    lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines[0].quantityHundredths).toBe(300);
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${e3}::uuid`)).invoice_line_id,
    ).toBe(lines[0].id);

    // Taking time off the draft releases it, and the hours follow when the line is not typed by hand.
    ok(await invoices.saveLines(f.actor, draft, [{ ...asInput(lines[0]), quantityManual: false }]));
    ok(await invoices.releaseTimeFromDrafts(f.actor, [e2]));
    lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines[0].quantityHundredths).toBe(150); // 30 + 60 minutes
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${e2}::uuid`)).invoice_line_id,
    ).toBeNull();

    // Removing the task's line from the draft releases its time; the task and its time stay.
    expect(await invoices.removeLinesForTask(db(), { storeId: f.storeId, taskId: t })).toEqual([draft]);
    expect((await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines).toHaveLength(0);
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${e1}::uuid`)).invoice_line_id,
    ).toBeNull();
    expect(Number((await one(sql`select count(*)::int as n from commerce.work_tasks where id = ${t}::uuid`)).n)).toBe(
      1,
    );
  });

  it("keeps a task with time when its line is removed, and drops one without", async () => {
    const a = await makeAssignment(f, client, { name: "Cleanup" });
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    const saved = ok(
      await invoices.saveLines(f.actor, draft, [
        newLine({ description: "With time" }),
        newLine({ description: "Without time" }),
      ]),
    );
    const [withTime, without] = saved.lines;
    await logMinutes(f, a, withTime.taskId, 30);
    expect(await invoices.syncTaskHoursToDraftLine(db(), { storeId: f.storeId, taskId: withTime.taskId! })).toBe(draft);
    ok(await invoices.saveLines(f.actor, draft, []));
    expect(
      Number(
        (await one(sql`select count(*)::int as n from commerce.work_tasks where id = ${withTime.taskId}::uuid`)).n,
      ),
    ).toBe(1);
    expect(
      Number((await one(sql`select count(*)::int as n from commerce.work_tasks where id = ${without.taskId}::uuid`)).n),
    ).toBe(0);
    expect(
      Number(
        (
          await one(
            sql`select count(*)::int as n from commerce.work_time_entries where assignment_id = ${a}::uuid and invoice_line_id is not null`,
          )
        ).n,
      ),
    ).toBe(0);
  });

  it("refuses lines that point at another client's assignment or at a task that is not the line's", async () => {
    const a = await makeAssignment(f, client, { name: "Own" });
    const other = await makeClient(f, { name: "Other AS" });
    const foreign = await makeAssignment(f, other, { name: "Foreign" });
    const foreignTask = await makeTask(f, foreign, "Foreign task");
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    expect(bad(await invoices.saveLines(f.actor, draft, [newLine({ assignmentId: foreign })])).problems[0]).toMatch(
      /not this client's/,
    );
    expect(bad(await invoices.saveLines(f.actor, draft, [newLine({ taskId: foreignTask })])).problems[0]).toMatch(
      /not on its assignment/,
    );
    // A task of the line's own assignment can be paired once.
    const own = await makeTask(f, a, "Own task");
    const saved = ok(await invoices.saveLines(f.actor, draft, [newLine({ taskId: own })]));
    expect(saved.lines[0].taskId).toBe(own);
    expect(
      bad(await invoices.saveLines(f.actor, draft, [{ ...newLine(), id: saved.lines[0].id }, newLine({ taskId: own })]))
        .problems[0],
    ).toMatch(/already has/);
  });

  it("makes one line at the fee for a fixed-fee assignment, once, and never rewrites it as hours", async () => {
    const a = await makeAssignment(f, client, { name: "Website", billing: "fixed_fee", rate: null, fixed: 5000000 });
    const t = await makeTask(f, a, "Build");
    const e1 = await logMinutes(f, a, t, 600);
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    expect(ok(await invoices.generateLinesFromTime(f.actor, draft))).toMatchObject({ added: 1 });
    let lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Website",
      unit: "unit",
      quantityHundredths: 100,
      unitPriceMinor: 5000000,
      exclMinor: 5000000,
    });
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${e1}::uuid`)).invoice_line_id,
    ).toBe(lines[0].id);
    expect(ok(await invoices.generateLinesFromTime(f.actor, draft))).toMatchObject({ added: 0 });
    // Logged time never rewrites the fee.
    await logMinutes(f, a, t, 60);
    await invoices.syncTaskHoursToDraftLine(db(), { storeId: f.storeId, taskId: t });
    lines = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines;
    expect(lines[0]).toMatchObject({ quantityHundredths: 100, exclMinor: 5000000 });
    // Once an issued invoice bills the fee, another draft is told so.
    ok(await invoices.issueInvoice(f.actor, { invoiceId: draft }));
    const second = ok(await invoices.createDraftInvoice(f.actor, { clientId: client })).invoiceId;
    const again = ok(await invoices.generateLinesFromTime(f.actor, second, { assignmentIds: [a] }));
    expect(again.added).toBe(0);
    expect(again.notes.join(" ")).toMatch(/already bills/);
  });

  it("takes time from the client's assignments for an invoice on its own, within a period", async () => {
    const c = await makeClient(f, { name: "Periodic AS", rate: 100000 });
    const a1 = await makeAssignment(f, c, { name: "Alpha", rate: null });
    const a2 = await makeAssignment(f, c, { name: "Beta", rate: 200000 });
    await logMinutes(f, a1, null, 60, { daysAgo: 40 });
    await logMinutes(f, a1, null, 30, { daysAgo: 3 });
    await logMinutes(f, a2, null, 60, { daysAgo: 3 });
    const draft = ok(await invoices.createDraftInvoice(f.actor, { clientId: c })).invoiceId;
    const from = addCalendarDays(await today(f), -10);
    const made = ok(await invoices.generateLinesFromTime(f.actor, draft, { from }));
    expect(made.added).toBe(2);
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!;
    const byName = new Map(detail.lines.map((l) => [l.description, l]));
    // Alpha has no rate of its own: the client's default applies. The older entry is outside the period.
    expect(byName.get("Alpha")).toMatchObject({ quantityHundredths: 50, unitPriceMinor: 100000 });
    expect(byName.get("Beta")).toMatchObject({ quantityHundredths: 100, unitPriceMinor: 200000 });
    // More time later: run again, and the existing line takes it.
    await logMinutes(f, a1, null, 30, { daysAgo: 1 });
    expect(ok(await invoices.generateLinesFromTime(f.actor, draft, { from }))).toMatchObject({
      added: 0,
      updated: 1,
      attachedEntries: 1,
    });
    expect(
      (await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines.find((l) => l.description === "Alpha")!
        .quantityHundredths,
    ).toBe(100);
    expect((await invoices.unbilledTime(f.storeId, { clientId: c })).map((g) => g.minutes)).toEqual([60]);
    // Only the chosen assignment.
    const draft2 = ok(await invoices.createDraftInvoice(f.actor, { clientId: c })).invoiceId;
    expect(ok(await invoices.generateLinesFromTime(f.actor, draft2, { assignmentIds: [a1] })).added).toBe(1);
  });

  it("deletes a draft and leaves the assignment, tasks and time", async () => {
    const a = await makeAssignment(f, client, { name: "Keep" });
    const t = await makeTask(f, a, "Keep task");
    const e = await logMinutes(f, a, t, 30);
    const draft = ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a })).invoiceId;
    ok(await invoices.generateLinesFromTime(f.actor, draft));
    ok(await invoices.deleteDraft(f.actor, draft));
    expect(await invoices.getWorkInvoiceDetail(f.storeId, draft)).toBeNull();
    expect(
      (await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${e}::uuid`)).invoice_line_id,
    ).toBeNull();
    expect(Number((await one(sql`select count(*)::int as n from commerce.work_tasks where id = ${t}::uuid`)).n)).toBe(
      1,
    );
    expect(
      Number((await one(sql`select count(*)::int as n from commerce.work_assignments where id = ${a}::uuid`)).n),
    ).toBe(1);
    // The assignment can have a new draft.
    ok(await invoices.createDraftInvoice(f.actor, { assignmentId: a }));
  });
});

// --- Another store's rows are never found --------------------------------------------------------------------------------------------------------------

describe("stores are apart", () => {
  it("does not find, change, issue or pay another store's invoice, and cannot point into it", async () => {
    const mine = await makeStore("iso-a");
    const theirs = await makeStore("iso-b");
    const theirClient = await makeClient(theirs);
    const theirAssignment = await makeAssignment(theirs, theirClient);
    const theirTask = await makeTask(theirs, theirAssignment, "Secret");
    const theirEntry = await logMinutes(theirs, theirAssignment, theirTask, 30);
    const theirDraft = ok(await invoices.createDraftInvoice(theirs.actor, { assignmentId: theirAssignment })).invoiceId;
    ok(await invoices.generateLinesFromTime(theirs.actor, theirDraft));
    const theirIssued = ok(await invoices.issueInvoice(theirs.actor, { invoiceId: theirDraft })).invoice;
    const pay = ok(
      await invoices.recordPayment(theirs.actor, {
        invoiceId: theirIssued.invoiceId,
        amountMinor: 100,
        receivedOn: await today(theirs),
      }),
    );
    const draft2 = ok(await invoices.createDraftInvoice(theirs.actor, { clientId: theirClient })).invoiceId;

    expect(await invoices.getWorkInvoiceDetail(mine.storeId, theirIssued.invoiceId)).toBeNull();
    expect(await invoices.invoiceDocumentData(mine.storeId, theirIssued.invoiceId)).toBeNull();
    expect(await invoices.invoiceReadiness(mine.storeId, draft2)).toBeNull();
    expect((await invoices.listWorkInvoices(mine.storeId)).total).toBe(0);
    expect((await invoices.listWorkInvoices(theirs.storeId)).total).toBe(2);
    expect(await invoices.unbilledTime(mine.storeId)).toEqual([]);

    expect(bad(await invoices.createDraftInvoice(mine.actor, { clientId: theirClient })).problems[0]).toMatch(
      /no longer exists/,
    );
    expect(bad(await invoices.createDraftInvoice(mine.actor, { assignmentId: theirAssignment })).problems[0]).toMatch(
      /no longer exists/,
    );
    expect(bad(await invoices.saveLines(mine.actor, draft2, [newLine()])).problems[0]).toMatch(/no longer exists/);
    expect(bad(await invoices.generateLinesFromTime(mine.actor, draft2)).problems[0]).toMatch(/no longer exists/);
    expect(bad(await invoices.issueInvoice(mine.actor, { invoiceId: draft2 })).problems[0]).toMatch(/no longer exists/);
    expect(bad(await invoices.deleteDraft(mine.actor, draft2)).problems[0]).toMatch(/no longer exists/);
    expect(
      bad(
        await invoices.recordPayment(mine.actor, {
          invoiceId: theirIssued.invoiceId,
          amountMinor: 1,
          receivedOn: await today(mine),
        }),
      ).problems[0],
    ).toMatch(/no longer exists/);
    expect(bad(await invoices.reversePayment(mine.actor, { paymentId: pay.paymentId })).problems[0]).toMatch(
      /no longer exists/,
    );
    expect(
      bad(await invoices.creditInvoice(mine.actor, { invoiceId: theirIssued.invoiceId, kind: "full", reason: "x" }))
        .problems[0],
    ).toMatch(/no longer exists/);
    expect(ok(await invoices.releaseTimeFromDrafts(mine.actor, [theirEntry])).released).toBe(0);
    expect(await invoices.findInvoiceByToken(theirIssued.publicToken)).toEqual({
      storeId: theirs.storeId,
      invoiceId: theirIssued.invoiceId,
    });

    // Lines of my own draft cannot point at their assignment or task.
    const myClient = await makeClient(mine);
    const myDraft = ok(await invoices.createDraftInvoice(mine.actor, { clientId: myClient })).invoiceId;
    expect(
      bad(await invoices.saveLines(mine.actor, myDraft, [newLine({ assignmentId: theirAssignment })])).problems.length,
    ).toBe(1);
    // …nor can SQL: the composite keys refuse it.
    await expect(
      db().execute(sql`insert into commerce.work_invoice_lines (store_id, invoice_id, description, task_id)
                       values (${mine.storeId}::uuid, ${myDraft}::uuid, 'x', ${theirTask}::uuid)`),
    ).rejects.toThrow();
  });
});

// --- The list -------------------------------------------------------------------------------------------------------------------------------------------

describe("the invoice list", () => {
  it("filters by status, client, overdue and dates, searches, sorts and pages", async () => {
    const f = await makeStore("list");
    const c1 = await makeClient(f, { name: "Alfa AS", legalName: "Alfa Holding AS" });
    const c2 = await makeClient(f, { name: "Beta AS" });
    const now = await today(f);
    const issue = async (
      clientId: string,
      price: number,
      over: { issuedOn?: string; days?: number; reference?: string } = {},
    ) => {
      const d = ok(
        await invoices.createDraftInvoice(f.actor, { clientId, paymentDays: over.days, reference: over.reference }),
      ).invoiceId;
      ok(await invoices.saveLines(f.actor, d, [newLine({ description: "Work", unitPriceMinor: price })]));
      return ok(
        await invoices.issueInvoice(f.actor, { invoiceId: d, issuedOn: over.issuedOn, confirmEarlierDate: true }),
      ).invoice;
    };
    const overdue = await issue(c1, 100000, { issuedOn: addCalendarDays(now, -40), days: 14, reference: "PO-778" }); // due 26 days ago
    const current = await issue(c2, 200000);
    const paid = await issue(c1, 300000);
    ok(
      await invoices.recordPayment(f.actor, {
        invoiceId: paid.invoiceId,
        amountMinor: paid.totalMinor,
        receivedOn: now,
      }),
    );
    const draft = ok(await invoices.createDraftInvoice(f.actor, { clientId: c2 })).invoiceId;

    const all = await invoices.listWorkInvoices(f.storeId);
    expect(all.total).toBe(4);
    expect(all.counts).toEqual({ draft: 1, sent: 2, paid: 1, void: 0, overdue: 1 });
    expect(all.rows[0]).toMatchObject({ id: draft, status: "draft", documentNumber: null }); // drafts first

    const status = async (s: "draft" | "sent" | "paid" | "void" | "open") =>
      (await invoices.listWorkInvoices(f.storeId, { status: s })).rows.map((r) => r.id);
    expect(await status("draft")).toEqual([draft]);
    expect((await status("sent")).sort()).toEqual([overdue.invoiceId, current.invoiceId].sort());
    expect(await status("paid")).toEqual([paid.invoiceId]);
    expect(await status("void")).toEqual([]);

    const late = await invoices.listWorkInvoices(f.storeId, { overdue: true });
    expect(late.rows.map((r) => r.id)).toEqual([overdue.invoiceId]);
    expect(late.rows[0]).toMatchObject({ overdue: true, daysOverdue: 26, outstandingMinor: overdue.totalMinor });
    expect((await invoices.listWorkInvoices(f.storeId, { clientId: c2 })).total).toBe(2);
    expect((await invoices.listWorkInvoices(f.storeId, { clientId: "nonsense" })).total).toBe(0);

    const range = await invoices.listWorkInvoices(f.storeId, { issuedFrom: addCalendarDays(now, -10), issuedTo: now });
    expect(range.rows.map((r) => r.id).sort()).toEqual([current.invoiceId, paid.invoiceId].sort());

    expect((await invoices.listWorkInvoices(f.storeId, { search: "W-1" })).rows.map((r) => r.documentNumber)).toContain(
      "W-1",
    );
    expect((await invoices.listWorkInvoices(f.storeId, { search: "holding" })).total).toBe(2); // the client's legal name
    expect((await invoices.listWorkInvoices(f.storeId, { search: "po-778" })).rows.map((r) => r.id)).toEqual([
      overdue.invoiceId,
    ]);
    expect((await invoices.listWorkInvoices(f.storeId, { search: "%" })).total).toBe(0); // not a wildcard

    const paged = await invoices.listWorkInvoices(f.storeId, { pageSize: 2, page: 2, sort: "total" });
    expect(paged).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(paged.rows).toHaveLength(2);
    const byTotal = await invoices.listWorkInvoices(f.storeId, { sort: "total" });
    expect(byTotal.rows.map((r) => r.totalMinor)).toEqual(
      [...byTotal.rows.map((r) => r.totalMinor)].sort((x, y) => y - x),
    );
    const byDue = await invoices.listWorkInvoices(f.storeId, { status: "sent", sort: "due" });
    expect(byDue.rows[0].id).toBe(overdue.invoiceId);
  });
});

// --- The actions ---------------------------------------------------------------------------------------------------------------------------------------

describe("the actions", () => {
  let f: Fixture;
  let owner: Membership;
  let admin: Membership;
  let off: Membership;
  let client: string;

  beforeAll(async () => {
    f = await makeStore("act");
    const store = (await getStore(f.slug)) as Store;
    const [ownerAccount] = await db().execute<Row>(
      sql`select id, email from commerce.accounts where id = ${f.accountId}::uuid`,
    );
    owner = {
      account: { id: f.accountId, email: String(ownerAccount.email), name: "O", platformAdmin: false },
      role: "owner",
      store,
    } as Membership;
    const [adminAccount] = await db().execute<Row>(
      sql`insert into commerce.accounts (email, name) values (${`admin-${run}@example.com`}, 'A') returning id, email`,
    );
    admin = {
      account: { id: String(adminAccount.id), email: String(adminAccount.email), name: "A", platformAdmin: false },
      role: "admin",
      store,
    } as Membership;
    members.set(f.slug, owner);
    const offStore = await makeStore("act-off", { seller: false });
    const offRow = (await getStore(offStore.slug)) as Store;
    await db().execute(sql`update commerce.stores set modules = '{}' where id = ${offStore.storeId}::uuid`);
    off = { ...owner, store: { ...offRow, workOn: false } } as Membership;
    members.set(offStore.slug, off);
    (off as unknown as { slug: string }).slug = offStore.slug;
    client = await makeClient(f);
  });

  it("run the whole flow for a member, audit what has weight, and refuse what is not allowed", async () => {
    const offSlug = (off as unknown as { slug: string }).slug;
    expect(bad(await actions.createDraftInvoiceAction(offSlug, { clientId: client })).problems[0]).toMatch(
      /switched off/,
    );
    await expect(actions.createDraftInvoiceAction("nobody", { clientId: client })).rejects.toThrow(/not a member/);

    const draft = ok(await actions.createDraftInvoiceAction(f.slug, { clientId: client })).invoiceId;
    const detail = (await invoices.getWorkInvoiceDetail(f.storeId, draft))!;
    expect(detail.invoice.status).toBe("draft");
    ok(
      await actions.saveInvoiceLinesAction(f.slug, draft, [
        newLine({ description: "Advice", quantityHundredths: 200, unitPriceMinor: 100000 }),
      ] as never),
    );
    expect(
      bad(
        await actions.saveDraftInvoiceAction(f.slug, draft, {
          clientId: client,
          currency: "NOK",
          lines: [],
          totalMinor: 5,
        } as never),
      ).problems[0],
    ).toMatch(/worked out by the server/);
    ok(await actions.saveInvoiceHeaderAction(f.slug, draft, { reference: "PO-1", notes: "Thanks" }));
    expect((await actions.invoiceReadinessAction(f.slug, draft)) as { readiness: { ready: boolean } }).toMatchObject({
      ok: true,
      readiness: { ready: true },
    });

    const issued = ok(
      await actions.issueInvoiceAction(f.slug, { invoiceId: draft, expectedTotalMinor: 250000 }),
    ).invoice;
    expect(issued.documentNumber).toBe("W-1");
    const audits = await db().execute<Row>(
      sql`select action, details from commerce.audit_log where store_id = ${f.storeId}::uuid order by created_at`,
    );
    expect(audits.map((a) => String(a.action))).toContain("work.invoice.issued");
    expect(audits.find((a) => a.action === "work.invoice.issued")!.details).toMatchObject({
      documentNumber: "W-1",
      totalMinor: 250000,
    });

    const payment = ok(
      await actions.recordPaymentAction(f.slug, {
        invoiceId: issued.invoiceId,
        amountMinor: 50000,
        receivedOn: await today(f),
      }),
    );
    ok(await actions.reversePaymentAction(f.slug, { paymentId: payment.paymentId, reason: "Wrong invoice" }));
    expect(
      (await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${f.storeId}::uuid`)).map(
        (a) => String(a.action),
      ),
    ).toContain("work.payment.reversed");

    // Only an owner credits.
    members.set(f.slug, admin);
    expect(
      bad(await actions.creditInvoiceAction(f.slug, { invoiceId: issued.invoiceId, kind: "full", reason: "Mistake" }))
        .problems[0],
    ).toMatch(/Only an owner/);
    ok(
      await actions.recordPaymentAction(f.slug, {
        invoiceId: issued.invoiceId,
        amountMinor: 10000,
        receivedOn: await today(f),
      }),
    ); // admins may record payments
    members.set(f.slug, owner);
    const credit = ok(
      await actions.creditInvoiceAction(f.slug, {
        invoiceId: issued.invoiceId,
        kind: "full",
        reason: "Mistake",
        refund: { method: "bank" },
      }),
    );
    expect(credit.creditNote).toMatchObject({ documentNumber: "WCN-1", voided: true, refundedMinor: 10000 });
    expect(
      (await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${f.storeId}::uuid`)).map(
        (a) => String(a.action),
      ),
    ).toContain("work.invoice.credited");

    // Drafts can be deleted by an admin; an issued invoice cannot.
    const another = ok(await actions.createDraftInvoiceAction(f.slug, { clientId: client })).invoiceId;
    members.set(f.slug, admin);
    ok(await actions.deleteDraftInvoiceAction(f.slug, another));
    expect(bad(await actions.deleteDraftInvoiceAction(f.slug, issued.invoiceId)).problems[0]).toMatch(
      /cannot be deleted/,
    );
    members.set(f.slug, owner);
  });

  it("make lines from time and take it off a draft", async () => {
    const a = await makeAssignment(f, client, { name: "Via actions" });
    const e = await logMinutes(f, a, null, 90);
    const draft = ok(await actions.createDraftInvoiceAction(f.slug, { assignmentId: a })).invoiceId;
    expect(ok(await actions.generateLinesFromTimeAction(f.slug, draft))).toMatchObject({
      added: 1,
      attachedEntries: 1,
      minutes: 90,
    });
    expect(ok(await actions.releaseTimeFromInvoiceAction(f.slug, [e]))).toMatchObject({ released: 1 });
    expect((await invoices.getWorkInvoiceDetail(f.storeId, draft))!.lines[0].quantityHundredths).toBe(0);
  });
});
