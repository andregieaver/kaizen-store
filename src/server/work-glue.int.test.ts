import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";
import { makeWorkStore, type WorkTestStore } from "./work-test-support";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const work = await import("./work");
const time = await import("./work-time");
const invoices = await import("./work-invoices");
const settings = await import("./work-settings");
const { getStore } = await import("./stores");

/**
 * The glue between Work's tasks and time (`work.ts`, `work-time.ts`) and its draft invoices
 * (`work-invoices.ts`, docs/work.md 4.6, 7.2 WP3/WP4), against a real database: a task and its
 * line on the assignment's draft move together in one transaction, logged and timed hours follow
 * onto the line, a client's or the store's VAT details re-price the drafts, time on a draft is
 * changed by taking it off first, a timer can be discarded, and a day is "today" where the store is.
 */

let ctx: WorkTestStore;
let owner: Membership;
let clientId: string;
let today: string;

const run = <T extends Row = Row>(query: ReturnType<typeof sql>) => db().execute<T>(query);
const one = async (query: ReturnType<typeof sql>): Promise<Row> => (await run(query))[0];

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Expected success, got: ${(result as unknown as { problems: string[] }).problems.join(" | ")}`);
  return result as Extract<T, { ok: true }>;
}

const clientBody = (over: Record<string, unknown> = {}) => ({
  name: "Glue Client",
  legalName: "Glue Client AS",
  country: "NO",
  billingAddress: { line1: "Gata 1", line2: "", postalCode: "0150", city: "Oslo" },
  billingEmail: "faktura@glue.example",
  currency: "NOK",
  business: true,
  vatTreatment: "domestic",
  defaultHourlyRateMinor: 100000,
  ...over,
});

async function newAssignment(over: Record<string, unknown> = {}): Promise<string> {
  return ok(await work.createAssignment(owner, { clientId, name: "Retainer", hourlyRateMinor: 120000, ...over })).id;
}

const draftFor = async (assignmentId: string): Promise<string> =>
  ok(await invoices.createDraftInvoice({ account: owner.account, store: owner.store }, { assignmentId })).invoiceId;

const detail = async (invoiceId: string) => (await invoices.getWorkInvoiceDetail(owner.store.id, invoiceId))!;
const lines = async (invoiceId: string) => (await detail(invoiceId)).lines;

async function log(assignmentId: string, taskId: string | null, minutes: number, over: Record<string, unknown> = {}) {
  return ok(await time.logTime(owner, { assignmentId, taskId, workDate: today, minutes, billable: true, ...over })).id;
}

const lineOf = async (entryId: string): Promise<string | null> => {
  const row = await one(sql`select invoice_line_id from commerce.work_time_entries where id = ${entryId}::uuid`);
  return row.invoice_line_id ? String(row.invoice_line_id) : null;
};

beforeAll(async () => {
  ctx = await makeWorkStore("glue", getStore);
  owner = ctx.owner;
  await run(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no'
    where id = ${owner.store.id}::uuid`);
  await run(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${owner.store.id}::uuid, true, 'NO923456789MVA', 14, 'NO9386011117947', 'DNBANOKKXXX')`);
  clientId = ok(await work.createClient(owner, clientBody())).id;
  today = String((await one(sql`select commerce.work_today(${owner.store.id}::uuid)::text as d`)).d);
});

afterAll(async () => {
  await closeDb();
});

describe("a task and its line on the assignment's draft", () => {
  it("makes a line with a task added while a draft exists, priced at the assignment's rate", async () => {
    const job = await newAssignment({ name: "Made with task" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Audit", estimatedMinutes: 120 })).id;
    const found = await lines(draft);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      taskId: task,
      description: "Audit",
      quantityHundredths: 200,
      unitPriceMinor: 120000,
      exclMinor: 240000,
    });
    expect((await detail(draft)).invoice.totalMinor).toBeGreaterThan(240000); // VAT on top
  });

  it("adds no line when the assignment has no draft, and a second task adds a second line", async () => {
    const job = await newAssignment({ name: "No draft yet" });
    const first = ok(await work.createTask(owner, { assignmentId: job, title: "Before" })).id;
    expect(Number((await one(sql`select count(*)::int as n from commerce.work_invoice_lines where task_id = ${first}::uuid`)).n)).toBe(0);
    const draft = await draftFor(job);
    ok(await work.createTask(owner, { assignmentId: job, title: "One", estimatedMinutes: 30 }));
    ok(await work.createTask(owner, { assignmentId: job, title: "Two" }));
    expect((await lines(draft)).map((l) => l.description)).toEqual(["One", "Two"]);
  });

  it("renames the line with the task, without a second line, and leaves an estimate change alone", async () => {
    const job = await newAssignment({ name: "Rename" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Old name", estimatedMinutes: 60 })).id;
    ok(await work.renameTask(owner, task, "New name"));
    let found = await lines(draft);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ description: "New name", taskId: task, quantityHundredths: 100 });
    // The estimate only seeds a new line (as in Life): changing it later does not move the line's hours.
    ok(await work.setTaskEstimate(owner, task, 300));
    ok(await work.setTaskStatus(owner, task, "done"));
    found = await lines(draft);
    expect(found).toHaveLength(1);
    expect(found[0].quantityHundredths).toBe(100);
  });

  it("follows the hours logged on the task, billable only, and takes the time onto the line", async () => {
    const job = await newAssignment({ name: "Hours" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Build" })).id;
    const e1 = await log(job, task, 30);
    const e2 = await log(job, task, 45);
    const free = await log(job, task, 500, { billable: false });
    const noTask = await log(job, null, 90);
    const [line] = await lines(draft);
    expect(line).toMatchObject({ quantityHundredths: 125, timeMinutes: 75, exclMinor: 150000 });
    expect(await lineOf(e1)).toBe(line.id);
    expect(await lineOf(e2)).toBe(line.id);
    expect(await lineOf(free)).toBeNull();
    expect(await lineOf(noTask)).toBeNull();
  });

  it("leaves a fixed fee alone when time is logged", async () => {
    const job = await newAssignment({ name: "Fee", billingType: "fixed_fee", fixedAmountMinor: 500000 });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Phase" })).id;
    const before = (await lines(draft))[0];
    await log(job, task, 600);
    const after = (await lines(draft))[0];
    expect(after.quantityHundredths).toBe(before.quantityHundredths);
    expect(after.unitPriceMinor).toBe(before.unitPriceMinor);
  });

  it("puts a timer's stopped time on the task's line, and a timer it stops when another starts", async () => {
    const job = await newAssignment({ name: "Timer" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Clocked" })).id;
    const other = ok(await work.createTask(owner, { assignmentId: job, title: "Second" })).id;
    ok(await time.startTimer(owner, { assignmentId: job, taskId: task }));
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '29 minutes 30 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid`);
    const stopped = ok(await time.stopTimer(owner));
    expect(stopped.entry?.minutes).toBe(30);
    let found = await lines(draft);
    expect(found.find((l) => l.taskId === task)).toMatchObject({ quantityHundredths: 50, timeMinutes: 30 });

    ok(await time.startTimer(owner, { assignmentId: job, taskId: task }));
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '14 minutes 30 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid`);
    const switched = ok(await time.startTimer(owner, { assignmentId: job, taskId: other }));
    expect(switched.stopped?.minutes).toBe(15);
    found = await lines(draft);
    expect(found.find((l) => l.taskId === task)?.quantityHundredths).toBe(75);
    ok(await time.stopTimer(owner));
  });

  it("puts unbilled time on the line when it becomes billable or changes, and keeps the draft's time fixed", async () => {
    const job = await newAssignment({ name: "Update" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Edited" })).id;
    const attached = await log(job, task, 60);
    const free = await log(job, task, 40, { billable: false });
    const body = { assignmentId: job, taskId: task, workDate: today, note: null };
    expect((await lines(draft))[0].quantityHundredths).toBe(100);

    // Non-billable to billable: the task's line takes it.
    ok(await time.updateTimeEntry(owner, free, { ...body, minutes: 40, billable: true }));
    expect((await lines(draft))[0].quantityHundredths).toBe(167);
    expect(await lineOf(free)).not.toBeNull();

    // On the draft, minutes are fixed and the refusal says what to do; the date and note still change.
    const refused = await time.updateTimeEntry(owner, attached, { ...body, minutes: 90, billable: true });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problems.join(" ")).toMatch(/Take off invoice/);
    const refusedDelete = await time.deleteTimeEntry(owner, attached);
    expect(!refusedDelete.ok && refusedDelete.problems.join(" ")).toMatch(/Take off invoice/);

    // Take it off (the invoice's own release), then change it: the line follows both steps.
    ok(await invoices.releaseTimeFromDrafts({ account: owner.account, store: owner.store }, [attached]));
    expect((await lines(draft))[0].quantityHundredths).toBe(67);
    ok(await time.updateTimeEntry(owner, attached, { ...body, minutes: 90, billable: true }));
    expect((await lines(draft))[0].quantityHundredths).toBe(217); // 40 + 90 minutes = 130 min
    // A note alone never moves time on or off a line.
    ok(await time.updateTimeEntry(owner, attached, { ...body, minutes: 90, billable: true, note: "Only a note" }));
    expect((await lines(draft))[0].quantityHundredths).toBe(217);
    // Released time can be deleted, and the line's hours are already right.
    ok(await invoices.releaseTimeFromDrafts({ account: owner.account, store: owner.store }, [attached]));
    ok(await time.deleteTimeEntry(owner, attached));
    expect((await lines(draft))[0].quantityHundredths).toBe(67);
  });

  it("takes a deleted task's line off the draft, releases its time and keeps the time and the totals right", async () => {
    const job = await newAssignment({ name: "Delete" });
    const draft = await draftFor(job);
    const keep = ok(await work.createTask(owner, { assignmentId: job, title: "Keep", estimatedMinutes: 60 })).id;
    const drop = ok(await work.createTask(owner, { assignmentId: job, title: "Drop", estimatedMinutes: 60 })).id;
    const entry = await log(job, drop, 30);
    const before = (await detail(draft)).invoice.totalMinor;
    expect((await lines(draft)).map((l) => l.taskId)).toEqual([keep, drop]);

    ok(await work.deleteTask(owner, drop));
    const found = await lines(draft);
    expect(found.map((l) => l.taskId)).toEqual([keep]);
    expect((await detail(draft)).invoice.totalMinor).toBeLessThan(before);
    // The time stays on the assignment, without a task and off any line.
    const row = await one(sql`select task_id, invoice_line_id from commerce.work_time_entries where id = ${entry}::uuid`);
    expect(row).toMatchObject({ task_id: null, invoice_line_id: null });
  });

  it("keeps a line on an issued invoice when its task is deleted", async () => {
    const job = await newAssignment({ name: "Issued" });
    const draft = await draftFor(job);
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Delivered", estimatedMinutes: 60 })).id;
    ok(await invoices.issueInvoice({ account: owner.account, store: owner.store }, { invoiceId: draft }));
    ok(await work.deleteTask(owner, task));
    const found = await lines(draft);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ description: "Delivered", taskId: null });
    expect((await detail(draft)).invoice.status).toBe("sent");
    // A new task on the assignment adds no line to an issued invoice (no draft: nothing).
    ok(await work.createTask(owner, { assignmentId: job, title: "Next" }));
    expect(await lines(draft)).toHaveLength(1);
  });
});

describe("VAT details re-price the drafts", () => {
  it("follows a client's VAT treatment", async () => {
    const client = ok(await work.createClient(owner, clientBody({ name: "Treatment Client" }))).id;
    const job = ok(await work.createAssignment(owner, { clientId: client, name: "Treated", hourlyRateMinor: 100000 })).id;
    const draft = ok(
      await invoices.createDraftInvoice({ account: owner.account, store: owner.store }, { assignmentId: job }),
    ).invoiceId;
    ok(await work.createTask(owner, { assignmentId: job, title: "Advice", estimatedMinutes: 60 }));
    expect((await detail(draft)).invoice).toMatchObject({ subtotalMinor: 100000, vatMinor: 25000, totalMinor: 125000 });

    ok(
      await work.updateClient(
        owner,
        client,
        clientBody({ name: "Treatment Client", country: "SE", vatNumber: "SE556677889901", vatTreatment: "reverse_charge" }),
      ),
    );
    expect((await detail(draft)).invoice).toMatchObject({ subtotalMinor: 100000, vatMinor: 0, totalMinor: 100000 });
    expect((await lines(draft))[0].vatMinor).toBe(0);

    ok(await work.updateClient(owner, client, clientBody({ name: "Treatment Client" })));
    expect((await detail(draft)).invoice).toMatchObject({ vatMinor: 25000, totalMinor: 125000 });
  });

  it("follows the store's VAT registration", async () => {
    const client = ok(await work.createClient(owner, clientBody({ name: "Registration Client" }))).id;
    const job = ok(await work.createAssignment(owner, { clientId: client, name: "Registered", hourlyRateMinor: 100000 })).id;
    const draft = ok(
      await invoices.createDraftInvoice({ account: owner.account, store: owner.store }, { assignmentId: job }),
    ).invoiceId;
    ok(await work.createTask(owner, { assignmentId: job, title: "Advice", estimatedMinutes: 60 }));
    expect((await detail(draft)).invoice.vatMinor).toBe(25000);

    const current = await settings.getWorkSettings(owner.store.id);
    ok(await settings.saveWorkSettings(owner, { ...current, vatRegistered: false }));
    expect((await detail(draft)).invoice).toMatchObject({ vatMinor: 0, totalMinor: 100000 });

    ok(await settings.saveWorkSettings(owner, { ...current, vatRegistered: true }));
    expect((await detail(draft)).invoice).toMatchObject({ vatMinor: 25000, totalMinor: 125000 });
  });
});

describe("discarding a timer", () => {
  it("throws away the member's own timer without logging it, and says so in the history", async () => {
    const job = await newAssignment({ name: "Discard" });
    const task = ok(await work.createTask(owner, { assignmentId: job, title: "Oops" })).id;
    expect(ok(await time.discardTimer(owner)).discarded).toBe(false);

    ok(await time.startTimer(owner, { assignmentId: job, taskId: task }));
    ok(await time.startTimer(ctx.admin, { assignmentId: job }));
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '12 minutes'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid`);
    expect(ok(await time.discardTimer(owner)).discarded).toBe(true);
    expect(await time.getRunningTimer(owner.account.id)).toBeNull();
    // Nothing was logged, and the admin's timer is untouched.
    expect((await time.listTimeEntries(owner.store.id, { assignmentId: job })).entries).toHaveLength(0);
    expect(await time.getRunningTimer(ctx.admin.account.id)).not.toBeNull();
    const events = await run(sql`
      select data from commerce.work_events
      where store_id = ${owner.store.id}::uuid and type = 'timer.discarded' and account_id = ${owner.account.id}::uuid`);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ assignment_id: job, task_id: task, minutes: 12 });
    ok(await time.stopTimer(ctx.admin));
    // Discarding again finds nothing running.
    expect(ok(await time.discardTimer(owner)).discarded).toBe(false);
  });
});

describe("a day that has not come, in the store's time zone", () => {
  it("compares with today where the store is, not in UTC", async () => {
    const job = await newAssignment({ name: "Zones" });
    const zoneDay = async (zone: string) =>
      String((await one(sql`select (now() at time zone ${zone})::date::text as d`)).d);
    const ahead = await zoneDay("Pacific/Kiritimati"); // UTC+14
    const behind = await zoneDay("Pacific/Pago_Pago"); // UTC-11
    expect(ahead > behind).toBe(true);
    const original = String((await one(sql`select time_zone from commerce.stores where id = ${owner.store.id}::uuid`)).time_zone);
    try {
      await run(sql`update commerce.stores set time_zone = 'Pacific/Kiritimati' where id = ${owner.store.id}::uuid`);
      expect((await time.logTime(owner, { assignmentId: job, workDate: ahead, minutes: 10 })).ok).toBe(true);
      await run(sql`update commerce.stores set time_zone = 'Pacific/Pago_Pago' where id = ${owner.store.id}::uuid`);
      expect(await time.logTime(owner, { assignmentId: job, workDate: ahead, minutes: 10 })).toEqual({
        ok: false,
        problems: ["You cannot log time for a day that has not come yet."],
      });
      expect((await time.logTime(owner, { assignmentId: job, workDate: behind, minutes: 10 })).ok).toBe(true);
    } finally {
      await run(sql`update commerce.stores set time_zone = ${original} where id = ${owner.store.id}::uuid`);
    }
  });
});
