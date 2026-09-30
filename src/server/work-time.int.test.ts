import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";
import { workErrorCode, workErrorMessage, WORK_ERROR_MESSAGES } from "./work-errors";
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
const { getStore } = await import("./stores");

/**
 * Work's time entries and timers (docs/work.md 7.2 WP3) against a real
 * database: logging and its checks, who may change what, that time on an
 * issued invoice can no longer change, the filters and the unbilled reader,
 * and the timer rules (one per person, switching, rounding up, capping).
 */

let a: WorkTestStore;
let b: WorkTestStore;
let owner: Membership;
let admin: Membership;
let clientId: string;
let assignmentId: string;
let taskId: string;
let today: string;

const run = <T extends Row = Row>(query: ReturnType<typeof sql>) => db().execute<T>(query);

async function newClient(member: Membership): Promise<string> {
  const made = await work.createClient(member, {
    name: "Time Client",
    legalName: "Time Client AS",
    country: "NO",
    billingAddress: { line1: "Gata 1", line2: "", postalCode: "0150", city: "Oslo" },
    currency: "NOK",
    defaultHourlyRateMinor: 100000,
  });
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
}

async function newAssignment(member: Membership, client: string, over: Record<string, unknown> = {}): Promise<string> {
  const made = await work.createAssignment(member, { clientId: client, name: "Job", ...over });
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
}

async function log(member: Membership, over: Record<string, unknown> = {}): Promise<string> {
  const made = await time.logTime(member, {
    assignmentId,
    workDate: today,
    minutes: 60,
    billable: true,
    ...over,
  });
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
}

/** A draft invoice with one line of the assignment (an assignment has one draft at a time), taking the given entries. */
async function draftWith(
  member: Membership,
  job: string,
  entryIds: string[],
): Promise<{ invoiceId: string; lineId: string }> {
  const [invoice] = await run(sql`
    insert into commerce.work_invoices (store_id, client_id, assignment_id, currency)
    values (${member.store.id}::uuid, ${clientId}::uuid, ${job}::uuid, 'NOK') returning id
  `);
  const [line] = await run(sql`
    insert into commerce.work_invoice_lines (store_id, invoice_id, assignment_id, description, quantity_hundredths, unit_price_minor)
    values (${member.store.id}::uuid, ${String(invoice.id)}::uuid, ${job}::uuid, 'Consulting', 100, 100000) returning id
  `);
  for (const id of entryIds) {
    await run(sql`
      update commerce.work_time_entries set invoice_line_id = ${String(line.id)}::uuid
      where store_id = ${member.store.id}::uuid and id = ${id}::uuid
    `);
  }
  return { invoiceId: String(invoice.id), lineId: String(line.id) };
}

/** Makes a store able to issue an invoice (its legal details and bank account), then issues the draft. */
async function issue(member: Membership, invoiceId: string): Promise<void> {
  await run(sql`
    update commerce.stores set legal_name = 'Seller AS', organisation_number = '999888777', postal_address = 'Veien 2, 0150 Oslo',
      country = 'NO' where id = ${member.store.id}::uuid
  `);
  await run(sql`
    insert into commerce.work_settings (store_id, vat_registered, bank_account) values (${member.store.id}::uuid, false, 'NO9386011117947')
    on conflict (store_id) do update set vat_registered = false, bank_account = 'NO9386011117947'
  `);
  await run(
    sql`select * from commerce.issue_work_invoice(${member.store.id}::uuid, ${invoiceId}::uuid, ${member.account.id}::uuid)`,
  );
}

const events = async (storeId: string, entityId: string) =>
  (
    await run(
      sql`select type from commerce.work_events where store_id = ${storeId}::uuid and entity_id = ${entityId}::uuid order by id`,
    )
  ).map((r) => String(r.type));

beforeAll(async () => {
  a = await makeWorkStore("wtime-a", getStore);
  b = await makeWorkStore("wtime-b", getStore);
  owner = a.owner;
  admin = a.admin;
  clientId = await newClient(owner);
  assignmentId = await newAssignment(owner, clientId, { estimatedMinutes: 300 });
  const task = await work.createTask(owner, { assignmentId, title: "Analysis" });
  if (!task.ok) throw new Error("no task");
  taskId = task.id;
  today = String((await run(sql`select commerce.work_today(${owner.store.id}::uuid)::text as d`))[0].d);
});

afterAll(async () => {
  await closeDb();
});

describe("logging time", () => {
  it("logs an entry for the member, and records it", async () => {
    const id = await log(admin, { minutes: 90, taskId, note: "  Kickoff meeting  ", billable: false });
    const entry = await time.getTimeEntry(owner.store.id, id);
    expect(entry).toMatchObject({
      assignmentId,
      assignmentName: "Job",
      clientId,
      clientName: "Time Client",
      taskId,
      taskTitle: "Analysis",
      accountId: admin.account.id,
      accountName: "Admin",
      workDate: today,
      minutes: 90,
      billable: false,
      note: "Kickoff meeting",
      prepaidMinutes: 0,
      invoiceableMinutes: 0,
      invoiceLineId: null,
      invoiceStatus: null,
      locked: false,
    });
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    const [event] = await run(sql`
      select data, account_id from commerce.work_events where store_id = ${owner.store.id}::uuid and entity_id = ${id}::uuid
    `);
    expect(event.data).toMatchObject({ minutes: 90, source: "manual", task_id: taskId });
    expect(event.account_id).toBe(admin.account.id);
  });

  it("checks the input, again on the server", async () => {
    const bad = async (over: Record<string, unknown>) =>
      time.logTime(owner, { assignmentId, workDate: today, minutes: 30, ...over });
    expect((await bad({ minutes: 0 })).ok).toBe(false);
    expect((await bad({ minutes: 1441 })).ok).toBe(false);
    expect((await bad({ minutes: 12.5 })).ok).toBe(false);
    expect((await bad({ workDate: "yesterday" })).ok).toBe(false);
    expect((await bad({ assignmentId: "nope" })).ok).toBe(false);
    expect((await bad({ note: "x".repeat(501) })).ok).toBe(false);
    expect((await time.logTime(owner, null)).ok).toBe(false);
    const tooBig = await bad({ minutes: 5000 });
    expect(tooBig).toEqual({ ok: false, problems: ["Log between 1 minute and 24 hours."] });
  });

  it("refuses a day that has not come", async () => {
    const tomorrow = String(
      (await run(sql`select (commerce.work_today(${owner.store.id}::uuid) + 1)::text as d`))[0].d,
    );
    const result = await time.logTime(owner, { assignmentId, workDate: tomorrow, minutes: 30 });
    expect(result).toEqual({ ok: false, problems: ["You cannot log time for a day that has not come yet."] });
    const yesterday = String(
      (await run(sql`select (commerce.work_today(${owner.store.id}::uuid) - 1)::text as d`))[0].d,
    );
    expect((await time.logTime(owner, { assignmentId, workDate: yesterday, minutes: 30 })).ok).toBe(true);
  });

  it("keeps a task with its own assignment", async () => {
    const other = await newAssignment(owner, clientId, { name: "Other job" });
    const wrongTask = await time.logTime(owner, { assignmentId: other, taskId, workDate: today, minutes: 15 });
    expect(wrongTask).toEqual({ ok: false, problems: ["That task is not on this assignment."] });
    const id = await log(owner, { minutes: 15 });
    const moved = await time.updateTimeEntry(owner, id, { assignmentId: other, taskId, workDate: today, minutes: 15 });
    expect(moved).toEqual({ ok: false, problems: ["That task is not on this assignment."] });
    expect(
      (await time.updateTimeEntry(owner, id, { assignmentId: other, taskId: null, workDate: today, minutes: 15 })).ok,
    ).toBe(true);
    expect((await time.getTimeEntry(owner.store.id, id))?.assignmentId).toBe(other);
  });

  it("never reaches another store's assignment or task", async () => {
    const theirClient = await newClient(b.owner);
    const theirAssignment = await newAssignment(b.owner, theirClient);
    const theirTask = await work.createTask(b.owner, { assignmentId: theirAssignment, title: "Theirs" });
    if (!theirTask.ok) throw new Error("no task");
    expect(await time.logTime(owner, { assignmentId: theirAssignment, workDate: today, minutes: 10 })).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
    expect(await time.logTime(owner, { assignmentId, taskId: theirTask.id, workDate: today, minutes: 10 })).toEqual({
      ok: false,
      problems: ["That task is not on this assignment."],
    });
    expect(await time.startTimer(owner, { assignmentId: theirAssignment })).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
    const [none] = await run(
      sql`select count(*)::int as n from commerce.work_timers where assignment_id = ${theirAssignment}::uuid`,
    );
    expect(none.n).toBe(0);

    // Theirs are not visible to us either.
    const theirs = b.owner.account.id;
    const id = await time.logTime(b.owner, { assignmentId: theirAssignment, workDate: today, minutes: 20 });
    if (!id.ok) throw new Error("no entry");
    expect(await time.getTimeEntry(owner.store.id, id.id)).toBeNull();
    expect((await time.listTimeEntries(owner.store.id, { assignmentId: theirAssignment })).entries).toEqual([]);
    expect((await time.listTimeEntries(owner.store.id, { accountId: theirs })).entries).toEqual([]);
    expect(await time.deleteTimeEntry(owner, id.id)).toEqual({
      ok: false,
      problems: ["This time entry no longer exists."],
    });
    expect(await time.setEntryNote(owner, id.id, { note: "mine now" })).toEqual({
      ok: false,
      problems: ["This time entry no longer exists."],
    });
    expect((await time.getTimeEntry(b.owner.store.id, id.id))?.note).toBeNull();
  });
});

describe("changing and deleting entries", () => {
  it("lets owners change any entry and admins their own", async () => {
    const adminsEntry = await log(admin, { minutes: 40 });
    const ownersEntry = await log(owner, { minutes: 50 });
    const input = (minutes: number) => ({ assignmentId, workDate: today, minutes, billable: true, note: "edited" });

    expect((await time.updateTimeEntry(owner, adminsEntry, input(45))).ok).toBe(true);
    expect((await time.getTimeEntry(owner.store.id, adminsEntry))?.minutes).toBe(45);
    expect((await time.updateTimeEntry(admin, adminsEntry, input(41))).ok).toBe(true);

    const refused = { ok: false, problems: ["Only an owner can change time logged by someone else."] };
    expect(await time.updateTimeEntry(admin, ownersEntry, input(1))).toEqual(refused);
    expect(await time.setEntryNote(admin, ownersEntry, { note: "hm" })).toEqual(refused);
    expect(await time.deleteTimeEntry(admin, ownersEntry)).toEqual(refused);
    expect(await time.getTimeEntry(owner.store.id, ownersEntry)).toMatchObject({ minutes: 50, note: null });

    expect((await time.deleteTimeEntry(admin, adminsEntry)).ok).toBe(true);
    expect(await time.getTimeEntry(owner.store.id, adminsEntry)).toBeNull();
    expect((await time.deleteTimeEntry(owner, ownersEntry)).ok).toBe(true);
    expect(await events(owner.store.id, adminsEntry)).toEqual([
      "time.logged",
      "time.updated",
      "time.updated",
      "time.deleted",
    ]);
  });

  it("changes only the note with setEntryNote", async () => {
    const id = await log(owner, { minutes: 20 });
    expect((await time.setEntryNote(owner, id, { note: "  Wrote the report " })).ok).toBe(true);
    expect(await time.getTimeEntry(owner.store.id, id)).toMatchObject({ note: "Wrote the report", minutes: 20 });
    expect((await time.setEntryNote(owner, id, { note: "" })).ok).toBe(true);
    expect((await time.getTimeEntry(owner.store.id, id))?.note).toBeNull();
    expect((await time.setEntryNote(owner, id, { note: "x".repeat(501) })).ok).toBe(false);
  });

  it("changes a draft invoice's time only in its date and note", async () => {
    const job = await newAssignment(owner, clientId, { name: "Draft job" });
    const id = await log(owner, { assignmentId: job, minutes: 30 });
    const { lineId } = await draftWith(owner, job, [id]);
    expect(await time.getTimeEntry(owner.store.id, id)).toMatchObject({
      invoiceLineId: lineId,
      invoiceStatus: "draft",
      locked: false,
    });
    const same = { assignmentId: job, workDate: today, minutes: 30, billable: true };
    const onDraft =
      "This time is on a draft invoice, so it cannot be changed or deleted as it is. Choose 'Take off invoice' for it (or remove its line from the draft) first, then change or delete it. Only its date and note can be changed while it is on the invoice.";
    expect(await time.updateTimeEntry(owner, id, { ...same, minutes: 45 })).toEqual({ ok: false, problems: [onDraft] });
    expect(await time.updateTimeEntry(owner, id, { ...same, billable: false })).toEqual({
      ok: false,
      problems: [onDraft],
    });
    expect(await time.deleteTimeEntry(owner, id)).toEqual({ ok: false, problems: [onDraft] });
    expect((await time.updateTimeEntry(owner, id, { ...same, note: "just a note" })).ok).toBe(true);
    expect((await time.setEntryNote(owner, id, { note: "another" })).ok).toBe(true);
    expect(await time.getTimeEntry(owner.store.id, id)).toMatchObject({ minutes: 30, note: "another" });
  });

  it("cannot change or delete time on an issued invoice, and says why", async () => {
    const job = await newAssignment(owner, clientId, { name: "Issued job" });
    const id = await log(owner, { assignmentId: job, minutes: 120 });
    const other = await log(owner, { assignmentId: job, minutes: 15 });
    const { invoiceId } = await draftWith(owner, job, [id]);
    await issue(owner, invoiceId);

    const entry = await time.getTimeEntry(owner.store.id, id);
    expect(entry).toMatchObject({ invoiceStatus: "sent", locked: true, invoiceId });
    expect(entry?.invoiceNumber).toBeTruthy();

    const immutable = { ok: false, problems: [WORK_ERROR_MESSAGES["work_time.immutable"]] };
    const same = { assignmentId: job, workDate: today, minutes: 120, billable: true };
    expect(await time.updateTimeEntry(owner, id, { ...same, minutes: 60 })).toEqual(immutable);
    expect(await time.updateTimeEntry(owner, id, same)).toEqual(immutable);
    expect(await time.setEntryNote(owner, id, { note: "too late" })).toEqual(immutable);
    expect(await time.deleteTimeEntry(owner, id)).toEqual(immutable);
    expect(await time.getTimeEntry(owner.store.id, id)).toMatchObject({ minutes: 120, note: null });

    // The database itself refuses it, whoever asks, and its error is the one the mapper knows.
    let raised: unknown;
    try {
      await run(
        sql`delete from commerce.work_time_entries where store_id = ${owner.store.id}::uuid and id = ${id}::uuid`,
      );
    } catch (error) {
      raised = error;
    }
    expect(workErrorCode(raised)).toBe("work_time.immutable");
    expect(workErrorMessage(raised)).toBe(WORK_ERROR_MESSAGES["work_time.immutable"]);

    // Other time on the same assignment is free.
    expect((await time.deleteTimeEntry(owner, other)).ok).toBe(true);
  });

  it("releases time again when its invoice is fully credited", async () => {
    const job = await newAssignment(owner, clientId, { name: "Credited job" });
    const id = await log(owner, { assignmentId: job, minutes: 75 });
    const { invoiceId } = await draftWith(owner, job, [id]);
    await issue(owner, invoiceId);
    await run(
      sql`select * from commerce.credit_work_invoice(${owner.store.id}::uuid, ${invoiceId}::uuid, ${owner.account.id}::uuid, 'Mistake')`,
    );
    expect(await time.getTimeEntry(owner.store.id, id)).toMatchObject({ locked: false, invoiceLineId: null });
    expect((await time.deleteTimeEntry(owner, id)).ok).toBe(true);
  });
});

describe("listing entries", () => {
  it("filters by assignment, task, person, day, billable and billing state, and adds them up", async () => {
    const clean = await newAssignment(owner, clientId, { name: "Listing job" });
    const t1 = await work.createTask(owner, { assignmentId: clean, title: "Alpha work" });
    if (!t1.ok) throw new Error("no task");
    const older = String((await run(sql`select (commerce.work_today(${owner.store.id}::uuid) - 3)::text as d`))[0].d);
    const e1 = await log(owner, { assignmentId: clean, taskId: t1.id, minutes: 60, note: "Kickoff call" });
    const e2 = await log(admin, { assignmentId: clean, minutes: 30, billable: false, note: "Internal chat" });
    const e3 = await log(owner, { assignmentId: clean, minutes: 45, workDate: older });

    const all = await time.listTimeEntries(owner.store.id, { assignmentId: clean });
    // Newest day first, and within a day the last logged first.
    expect(all.entries.map((e) => e.id)).toEqual([e2, e1, e3]);
    expect(all.totals).toEqual({ count: 3, minutes: 135, billableMinutes: 105, unbilledMinutes: 105 });

    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, taskId: t1.id })).entries.map((e) => e.id),
    ).toEqual([e1]);
    const noTask = await time.listTimeEntries(owner.store.id, { assignmentId: clean, taskId: "__none__" });
    expect(noTask.entries.map((e) => e.id).sort()).toEqual([e2, e3].sort());
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, query: "KICKOFF" })).entries.map((e) => e.id),
    ).toEqual([e1]);
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, query: "alpha" })).entries.map((e) => e.id),
    ).toEqual([e1]);
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, accountId: admin.account.id })).entries.map(
        (e) => e.id,
      ),
    ).toEqual([e2]);
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, billable: false })).entries.map((e) => e.id),
    ).toEqual([e2]);
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, from: older, to: older })).entries.map(
        (e) => e.id,
      ),
    ).toEqual([e3]);
    expect((await time.listTimeEntries(owner.store.id, { assignmentId: clean, from: today })).entries).toHaveLength(2);
    expect((await time.listTimeEntries(owner.store.id, { clientId, assignmentId: clean })).entries).toHaveLength(3);
    expect(await time.listTimeEntries(owner.store.id, { assignmentId: "nope" })).toMatchObject({
      entries: [],
      totals: { count: 0 },
    });
    expect((await time.listTimeEntries(owner.store.id, { from: "31.12.2026" })).entries).toEqual([]);

    const page = await time.listTimeEntries(owner.store.id, { assignmentId: clean, limit: 1, offset: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.totals.count).toBe(3);

    const [invoice] = await run(sql`
      insert into commerce.work_invoices (store_id, client_id, assignment_id, currency)
      values (${owner.store.id}::uuid, ${clientId}::uuid, ${clean}::uuid, 'NOK') returning id
    `);
    const [line] = await run(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, assignment_id, description, quantity_hundredths, unit_price_minor)
      values (${owner.store.id}::uuid, ${String(invoice.id)}::uuid, ${clean}::uuid, 'Work', 100, 100000) returning id
    `);
    await run(
      sql`update commerce.work_time_entries set invoice_line_id = ${String(line.id)}::uuid where id = ${e1}::uuid`,
    );
    const unbilled = await time.listTimeEntries(owner.store.id, { assignmentId: clean, billing: "unbilled" });
    expect(unbilled.entries.map((e) => e.id)).toEqual([e3]);
    expect(unbilled.totals.unbilledMinutes).toBe(45);
    expect(
      (await time.listTimeEntries(owner.store.id, { assignmentId: clean, billing: "on_draft" })).entries.map(
        (e) => e.id,
      ),
    ).toEqual([e1]);
    expect((await time.listTimeEntries(owner.store.id, { assignmentId: clean, billing: "invoiced" })).entries).toEqual(
      [],
    );
  });

  it("gives the invoice server the billable time no line has taken", async () => {
    const job = await newAssignment(owner, clientId, { name: "Unbilled job" });
    const other = await newAssignment(owner, clientId, { name: "Unbilled other" });
    const older = String((await run(sql`select (commerce.work_today(${owner.store.id}::uuid) - 5)::text as d`))[0].d);
    const first = await log(owner, { assignmentId: job, minutes: 30, workDate: older });
    const second = await log(owner, { assignmentId: job, minutes: 20 });
    const free = await log(owner, { assignmentId: job, minutes: 10, billable: false });
    const elsewhere = await log(owner, { assignmentId: other, minutes: 5 });
    const taken = await log(owner, { assignmentId: job, minutes: 25 });
    const [invoice] = await run(sql`
      insert into commerce.work_invoices (store_id, client_id, assignment_id, currency)
      values (${owner.store.id}::uuid, ${clientId}::uuid, ${job}::uuid, 'NOK') returning id
    `);
    const [line] = await run(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, assignment_id, description, quantity_hundredths, unit_price_minor)
      values (${owner.store.id}::uuid, ${String(invoice.id)}::uuid, ${job}::uuid, 'Work', 100, 100000) returning id
    `);
    await run(
      sql`update commerce.work_time_entries set invoice_line_id = ${String(line.id)}::uuid where id = ${taken}::uuid`,
    );

    const forJob = await time.unbilledEntries(owner.store.id, { assignmentId: job });
    expect(forJob.map((e) => e.id)).toEqual([first, second]);
    expect(forJob.every((e) => e.billable && e.invoiceLineId === null)).toBe(true);
    expect(forJob.map((e) => e.invoiceableMinutes)).toEqual([30, 20]);
    expect(forJob.map((e) => e.id)).not.toContain(free);
    expect((await time.unbilledEntries(owner.store.id, { assignmentId: job, until: older })).map((e) => e.id)).toEqual([
      first,
    ]);
    const ofClient = await time.unbilledEntries(owner.store.id, { clientId, assignmentId: other });
    expect(ofClient.map((e) => e.id)).toEqual([elsewhere]);
    expect(await time.unbilledEntries(b.owner.store.id, { assignmentId: job })).toEqual([]);
    expect(await time.unbilledEntries(owner.store.id, { until: "later" })).toEqual([]);
  });
});

describe("timers", () => {
  it("starts a timer, one per person, and reads it", async () => {
    expect(await time.getRunningTimer(owner.account.id)).toBeNull();
    const started = await time.startTimer(owner, { assignmentId, taskId });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.stopped).toBeNull();
    expect(new Date(started.startedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const running = await time.getRunningTimer(owner.account.id);
    expect(running).toMatchObject({
      accountId: owner.account.id,
      assignmentId,
      assignmentName: "Job",
      clientName: "Time Client",
      taskId,
      taskTitle: "Analysis",
      startedAt: started.startedAt,
    });
    expect(running?.elapsedSeconds).toBeLessThan(5);
    expect(await time.getRunningTimer(admin.account.id)).toBeNull();
    // The admin has a timer of their own.
    expect((await time.startTimer(admin, { assignmentId })).ok).toBe(true);
    const all = await time.listRunningTimers(owner.store.id);
    expect(all.map((t) => t.accountId).sort()).toEqual([owner.account.id, admin.account.id].sort());
    expect(all.find((t) => t.accountId === admin.account.id)?.accountName).toBe("Admin");
    await time.stopTimer(owner);
    await time.stopTimer(admin);
  });

  it("stops and logs the running timer when another starts", async () => {
    const other = await newAssignment(owner, clientId, { name: "Switch target" });
    await time.startTimer(owner, { assignmentId, taskId });
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '10 minutes 5 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const switched = await time.startTimer(owner, { assignmentId: other });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    // Every started minute counts: 10 min 5 s is 11.
    expect(switched.stopped).toMatchObject({ assignmentId, taskId, minutes: 11 });
    const entry = await time.getTimeEntry(owner.store.id, switched.stopped!.id);
    expect(entry).toMatchObject({ billable: true, accountId: owner.account.id, minutes: 11, note: null });
    const now = await time.getRunningTimer(owner.account.id);
    expect(now?.assignmentId).toBe(other);
    expect(now?.taskId).toBeNull();
    const [count] = await run(sql`
      select count(*)::int as n from commerce.work_timers where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    expect(count.n).toBe(1);
    expect(await events(owner.store.id, switched.stopped!.id)).toEqual(["time.logged"]);
    await time.stopTimer(owner);
  });

  it("runs one timer across all a person's stores: starting in another store logs the first to its own (D123)", async () => {
    // The owner of store A also works in store B.
    await run(sql`
      insert into commerce.store_members (store_id, account_id, role)
      values (${b.owner.store.id}::uuid, ${owner.account.id}::uuid, 'admin') on conflict do nothing`);
    const inB: Membership = { account: owner.account, role: "admin", store: b.owner.store };
    const theirClient = await newClient(b.owner);
    const theirJob = await newAssignment(b.owner, theirClient, { name: "Elsewhere" });

    expect((await time.startTimer(owner, { assignmentId })).ok).toBe(true);
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '29 minutes 5 seconds'
      where account_id = ${owner.account.id}::uuid`);
    const moved = await time.startTimer(inB, { assignmentId: theirJob });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // The clock that ran in store A is logged there, to A's assignment, and reported.
    expect(moved.stopped).toMatchObject({ assignmentId, minutes: 30 });
    const logged = await time.getTimeEntry(owner.store.id, moved.stopped!.id);
    expect(logged).toMatchObject({ accountId: owner.account.id, minutes: 30 });
    expect(await time.getTimeEntry(b.owner.store.id, moved.stopped!.id)).toBeNull();

    // One timer, now in store B, read without naming a store and with the store's name.
    const running = await time.getRunningTimer(owner.account.id);
    expect(running).toMatchObject({
      assignmentId: theirJob,
      storeId: b.owner.store.id,
      storeSlug: b.owner.store.slug,
      storeName: b.owner.store.name,
    });
    const [count] = await run(sql`select count(*)::int as n from commerce.work_timers where account_id = ${owner.account.id}::uuid`);
    expect(count.n).toBe(1);

    // Not shown once the person has left the store it runs in.
    await run(sql`update commerce.store_members set disabled_at = now() where store_id = ${b.owner.store.id}::uuid and account_id = ${owner.account.id}::uuid`);
    expect(await time.getRunningTimer(owner.account.id)).toBeNull();
    await run(sql`update commerce.store_members set disabled_at = null where store_id = ${b.owner.store.id}::uuid and account_id = ${owner.account.id}::uuid`);
    await time.stopTimer(inB);
  });

  it("rounds a stopped timer up to the minute, at least one, and logs it on the day it started", async () => {
    await time.startTimer(owner, { assignmentId });
    const quick = await time.stopTimer(owner);
    expect(quick).toMatchObject({ ok: true, capped: false, entry: { minutes: 1, assignmentId } });

    await time.startTimer(owner, { assignmentId });
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '61 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const stopped = await time.stopTimer(owner, { note: "  Reviewed the draft " });
    expect(stopped.ok && stopped.entry?.minutes).toBe(2);
    if (!stopped.ok || !stopped.entry) return;
    expect(await time.getTimeEntry(owner.store.id, stopped.entry.id)).toMatchObject({
      note: "Reviewed the draft",
      billable: true,
    });
    expect(await time.getRunningTimer(owner.account.id)).toBeNull();

    // Just short of a whole number of minutes is that many, not one more.
    await time.startTimer(owner, { assignmentId });
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '2 minutes 58 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const exact = await time.stopTimer(owner);
    expect(exact.ok && exact.entry?.minutes).toBe(3);
  });

  it("logs a timer left running for days as a day, and says it was cut", async () => {
    await time.startTimer(owner, { assignmentId });
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '3 days'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const [expected] = await run(sql`
      select (started_at at time zone (select time_zone from commerce.stores where id = ${owner.store.id}::uuid))::date::text as d
      from commerce.work_timers where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const stopped = await time.stopTimer(owner);
    expect(stopped).toMatchObject({ ok: true, capped: true, entry: { minutes: 1440, workDate: String(expected.d) } });
  });

  it("does nothing when no timer runs", async () => {
    const [before] = await run(
      sql`select count(*)::int as n from commerce.work_time_entries where store_id = ${owner.store.id}::uuid`,
    );
    expect(await time.stopTimer(owner)).toEqual({ ok: true, entry: null, capped: false });
    const [after] = await run(
      sql`select count(*)::int as n from commerce.work_time_entries where store_id = ${owner.store.id}::uuid`,
    );
    expect(after.n).toBe(before.n);
  });

  it("lets only an owner stop someone else's timer", async () => {
    await time.startTimer(admin, { assignmentId });
    expect(await time.stopTimer(admin, { forAccountId: owner.account.id })).toEqual({
      ok: false,
      problems: ["Only an owner can stop someone else's timer."],
    });
    expect(await time.getRunningTimer(admin.account.id)).not.toBeNull();
    const stopped = await time.stopTimer(owner, { forAccountId: admin.account.id });
    expect(stopped.ok && stopped.entry?.minutes).toBe(1);
    if (stopped.ok && stopped.entry) {
      expect((await time.getTimeEntry(owner.store.id, stopped.entry.id))?.accountId).toBe(admin.account.id);
    }
    expect(await time.getRunningTimer(admin.account.id)).toBeNull();
    expect((await time.stopTimer(owner, { forAccountId: "nope" })).ok).toBe(false);
  });

  it("checks the timer's assignment and task", async () => {
    const other = await newAssignment(owner, clientId, { name: "Not the task's" });
    expect(await time.startTimer(owner, { assignmentId: other, taskId })).toEqual({
      ok: false,
      problems: ["That task is not on this assignment."],
    });
    expect((await time.startTimer(owner, { assignmentId: "nope" })).ok).toBe(false);
    expect(await time.getRunningTimer(owner.account.id)).toBeNull();
  });

  it("stops a timer whose task is deleted only after the timer is stopped", async () => {
    const own = await work.createTask(owner, { assignmentId, title: "Short-lived" });
    if (!own.ok) throw new Error("no task");
    await time.startTimer(owner, { assignmentId, taskId: own.id });
    expect((await work.deleteTask(owner, own.id)).ok).toBe(false);
    expect(await time.getRunningTimer(owner.account.id)).not.toBeNull();
    await time.stopTimer(owner);
  });
});

describe("estimate warnings", () => {
  it("measures a timer against its task's estimate first, else the assignment's", async () => {
    const job = await newAssignment(owner, clientId, {
      name: "Warned job",
      estimatedMinutes: 100,
      estimateAlertMinutes: 10,
    });
    const estimated = await work.createTask(owner, { assignmentId: job, title: "Estimated", estimatedMinutes: 60 });
    const plain = await work.createTask(owner, { assignmentId: job, title: "Plain" });
    if (!estimated.ok || !plain.ok) throw new Error("no task");
    await log(owner, { assignmentId: job, taskId: estimated.id, minutes: 30, billable: false });
    await log(owner, { assignmentId: job, taskId: plain.id, minutes: 20 });

    await time.startTimer(owner, { assignmentId: job, taskId: estimated.id });
    let timer = await time.getRunningTimer(owner.account.id);
    expect(timer?.estimate).toMatchObject({
      target: "task",
      estimatedMinutes: 60,
      loggedMinutes: 30,
      remainingAtStartMinutes: 30,
      settings: { minutes: 10, popup: true, sound: false },
      stage: "ok",
      alert: null,
    });

    // 22 whole minutes on top of 30 leaves 8 of 60: below the 10-minute threshold.
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '22 minutes 30 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    timer = await time.getRunningTimer(owner.account.id);
    expect(timer?.elapsedSeconds).toBeGreaterThanOrEqual(1350);
    expect(timer?.estimate).toMatchObject({ stage: "near", alert: "near" });

    await run(sql`
      update commerce.work_timers set started_at = now() - interval '31 minutes'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    expect((await time.getRunningTimer(owner.account.id))?.estimate).toMatchObject({
      stage: "over",
      alert: "over",
    });

    // A task without an estimate falls back on the assignment's: 50 logged of 100, all tasks together.
    const switched = await time.startTimer(owner, { assignmentId: job, taskId: plain.id });
    if (!switched.ok || !switched.stopped) throw new Error("the first timer was not stopped");
    timer = await time.getRunningTimer(owner.account.id);
    expect(timer?.estimate).toMatchObject({
      target: "assignment",
      estimatedMinutes: 100,
      // 30 + 20 logged by hand, and the minutes the first timer was logged as.
      loggedMinutes: 50 + switched.stopped.minutes,
    });
    await time.stopTimer(owner);
  });

  it("has nothing to warn about without an estimate, or with warnings off", async () => {
    const none = await newAssignment(owner, clientId, { name: "No estimate" });
    await time.startTimer(owner, { assignmentId: none });
    expect((await time.getRunningTimer(owner.account.id))?.estimate).toBeNull();

    const off = await newAssignment(owner, clientId, {
      name: "Warnings off",
      estimatedMinutes: 10,
      estimateAlertMinutes: null,
    });
    await time.startTimer(owner, { assignmentId: off });
    await run(sql`
      update commerce.work_timers set started_at = now() - interval '29 minutes 5 seconds'
      where store_id = ${owner.store.id}::uuid and account_id = ${owner.account.id}::uuid
    `);
    const timer = await time.getRunningTimer(owner.account.id);
    expect(timer?.estimate).toMatchObject({ settings: { minutes: null }, stage: "ok", alert: null });
    await time.stopTimer(owner);
  });
});
