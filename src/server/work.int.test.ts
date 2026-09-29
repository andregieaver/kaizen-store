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
const { getStore } = await import("./stores");

/**
 * Work's clients, assignments and tasks (docs/work.md 7.2 WP3) against a real
 * database: what is kept, what is refused, who may do what, and that one
 * store never sees or reaches another's.
 */

let a: WorkTestStore;
let b: WorkTestStore;
let owner: Membership;
let admin: Membership;

const client = (over: Record<string, unknown> = {}) => ({
  name: "Acme AS",
  legalName: "Acme Aksjeselskap",
  organisationNumber: "123456789",
  vatNumber: "NO123456789MVA",
  country: "NO",
  billingAddress: { line1: "Storgata 1", line2: "", postalCode: "0150", city: "Oslo" },
  billingEmail: "faktura@acme.example",
  contactName: "Kari",
  phone: "+47 22 00 00 00",
  locale: "nb-NO",
  currency: "NOK",
  defaultHourlyRateMinor: 150000,
  paymentDays: 20,
  business: true,
  vatTreatment: "domestic",
  usePrepaid: true,
  notes: "Send to the accountant",
  ...over,
});

const assignment = (clientId: string, over: Record<string, unknown> = {}) => ({
  clientId,
  name: "Website",
  billingType: "hourly",
  estimatedMinutes: 600,
  estimateAlertMinutes: 30,
  ...over,
});

async function newClient(member: Membership = owner, over: Record<string, unknown> = {}): Promise<string> {
  const made = await work.createClient(member, client(over));
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
}

async function newAssignment(
  member: Membership,
  clientId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const made = await work.createAssignment(member, assignment(clientId, over));
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
}

const today = async (store: Membership["store"]) =>
  String((await db().execute<Row>(sql`select commerce.work_today(${store.id}::uuid)::text as d`))[0].d);

const events = async (storeId: string, entityId: string) =>
  (
    await db().execute<Row>(sql`
      select type from commerce.work_events where store_id = ${storeId}::uuid and entity_id = ${entityId}::uuid order by id
    `)
  ).map((r) => String(r.type));

beforeAll(async () => {
  a = await makeWorkStore("work-a", getStore);
  b = await makeWorkStore("work-b", getStore);
  owner = a.owner;
  admin = a.admin;
});

afterAll(async () => {
  await closeDb();
});

describe("clients", () => {
  it("creates a client with everything kept as sent, and records it", async () => {
    const made = await work.createClient(owner, client());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const got = await work.getClient(owner.store.id, made.id);
    expect(got).toMatchObject({
      name: "Acme AS",
      legalName: "Acme Aksjeselskap",
      vatNumber: "NO123456789MVA",
      country: "NO",
      billingAddress: { line1: "Storgata 1", postalCode: "0150", city: "Oslo" },
      currency: "NOK",
      defaultHourlyRateMinor: 150000,
      paymentDays: 20,
      business: true,
      vatTreatment: "domestic",
      archivedAt: null,
      activeAssignments: 0,
      loggedMinutes: 0,
      unbilledMinutes: 0,
    });
    expect(await events(owner.store.id, made.id)).toEqual(["client.created"]);
    expect(JSON.parse(JSON.stringify(got))).toEqual(got);
  });

  it("checks what it is sent again, as the browser is not trusted", async () => {
    const empty = await work.createClient(owner, client({ name: "  " }));
    expect(empty).toEqual({ ok: false, problems: ["Give the client a name."] });
    const badMoney = await work.createClient(owner, client({ defaultHourlyRateMinor: -5 }));
    expect(badMoney.ok).toBe(false);
    const decimal = await work.createClient(owner, client({ defaultHourlyRateMinor: 10.5 }));
    expect(decimal.ok).toBe(false);
    const consumerReverse = await work.createClient(owner, client({ business: false, vatTreatment: "reverse_charge" }));
    expect(consumerReverse.ok).toBe(false);
    const nonsense = await work.createClient(owner, "not an object");
    expect(nonsense.ok).toBe(false);
    const unknownCountry = await work.createClient(owner, client({ country: "ZZ" }));
    expect(unknownCountry).toEqual({ ok: false, problems: ["Choose a country from the list."] });
  });

  it("refuses to link a customer of another store", async () => {
    const [company] = await db().execute<Row>(sql`
      insert into commerce.customer_companies (store_id, name) values (${b.owner.store.id}::uuid, 'Theirs') returning id
    `);
    const result = await work.createClient(owner, client({ customerCompanyId: String(company.id) }));
    expect(result).toEqual({ ok: false, problems: ["That customer company does not exist."] });
  });

  it("orders clients as they were added and filters by archive", async () => {
    const first = await newClient(owner, { name: "Zed Ltd" });
    const second = await newClient(owner, { name: "Alpha Ltd" });
    const list = await work.listClients(owner.store.id);
    const names = list.map((c) => c.name);
    expect(names.indexOf("Zed Ltd")).toBeLessThan(names.indexOf("Alpha Ltd"));

    expect((await work.setClientArchived(owner, second, true)).ok).toBe(true);
    expect((await work.listClients(owner.store.id)).map((c) => c.id)).not.toContain(second);
    expect((await work.listClients(owner.store.id, { archived: "archived" })).map((c) => c.id)).toEqual([second]);
    expect((await work.listClients(owner.store.id, { archived: "all" })).map((c) => c.id)).toEqual(
      expect.arrayContaining([first, second]),
    );
    expect((await work.getClient(owner.store.id, second))?.archivedAt).toBeTruthy();

    expect((await work.setClientArchived(admin, second, false)).ok).toBe(true);
    expect((await work.getClient(owner.store.id, second))?.archivedAt).toBeNull();
    expect(await events(owner.store.id, second)).toEqual(["client.created", "client.archived", "client.unarchived"]);
  });

  it("searches names, contacts and emails", async () => {
    const id = await newClient(owner, {
      name: "Searchable Co",
      contactName: "Zorro Bandolero",
      billingEmail: "z@bandit.example",
    });
    const byName = await work.listClients(owner.store.id, { search: "SEARCHABLE" });
    expect(byName.map((c) => c.id)).toEqual([id]);
    expect((await work.listClients(owner.store.id, { search: "bandolero" })).map((c) => c.id)).toEqual([id]);
    expect((await work.listClients(owner.store.id, { search: "bandit.example" })).map((c) => c.id)).toEqual([id]);
    expect(await work.listClients(owner.store.id, { search: "no such client anywhere" })).toEqual([]);
  });

  it("updates a client and refuses one that is not the store's", async () => {
    const id = await newClient(owner, { name: "Old name" });
    expect((await work.updateClient(admin, id, client({ name: "New name", currency: "EUR" }))).ok).toBe(true);
    expect(await work.getClient(owner.store.id, id)).toMatchObject({ name: "New name", currency: "EUR" });
    expect(await events(owner.store.id, id)).toContain("client.updated");

    expect(await work.updateClient(b.owner, id, client())).toEqual({
      ok: false,
      problems: ["This client no longer exists."],
    });
    expect((await work.getClient(owner.store.id, id))?.name).toBe("New name");
    expect(await work.updateClient(owner, "not-a-uuid", client())).toEqual({
      ok: false,
      problems: ["This client no longer exists."],
    });
  });

  it("never shows one store's clients to another", async () => {
    const id = await newClient(owner, { name: "Only in A" });
    expect(await work.getClient(b.owner.store.id, id)).toBeNull();
    expect((await work.listClients(b.owner.store.id, { archived: "all" })).map((c) => c.id)).not.toContain(id);
    expect(await work.setClientArchived(b.owner, id, true)).toEqual({
      ok: false,
      problems: ["This client no longer exists."],
    });
    expect((await work.getClient(owner.store.id, id))?.archivedAt).toBeNull();
    expect(await work.deleteClient(b.owner, id)).toEqual({ ok: false, problems: ["This client no longer exists."] });
    expect(await work.getClient(owner.store.id, id)).not.toBeNull();
  });

  it("lets only an owner delete a client, and only one without history", async () => {
    const id = await newClient(owner, { name: "Delete me" });
    expect(await work.deleteClient(admin, id)).toEqual({ ok: false, problems: ["Only an owner can delete a client."] });
    expect(await work.getClient(owner.store.id, id)).not.toBeNull();

    expect((await work.deleteClient(owner, id)).ok).toBe(true);
    expect(await work.getClient(owner.store.id, id)).toBeNull();
    const [logged] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${owner.store.id}::uuid and action = 'work.client.deleted'
      order by created_at desc limit 1
    `);
    expect(logged.details).toMatchObject({ clientId: id, name: "Delete me" });

    const kept = await newClient(owner, { name: "Has history" });
    await newAssignment(owner, kept);
    const refused = await work.deleteClient(owner, kept);
    expect(refused).toEqual({
      ok: false,
      problems: ["This client has assignments or invoices, so it cannot be deleted. Archive it instead."],
    });
    expect(await work.getClient(owner.store.id, kept)).not.toBeNull();
  });

  it("keeps a client with an invoice even against a direct delete (the database restricts)", async () => {
    const id = await newClient(owner, { name: "Invoiced" });
    await db().execute(sql`
      insert into commerce.work_invoices (store_id, client_id, currency) values (${owner.store.id}::uuid, ${id}::uuid, 'NOK')
    `);
    const refused = await work.deleteClient(owner, id);
    expect(refused.ok).toBe(false);
    await expect(
      db().execute(
        sql`delete from commerce.work_clients where store_id = ${owner.store.id}::uuid and id = ${id}::uuid`,
      ),
    ).rejects.toThrow();
  });
});

describe("assignments", () => {
  it("creates one for a client, with its defaults and no invoice", async () => {
    const clientId = await newClient();
    const made = await work.createAssignment(
      admin,
      assignment(clientId, { name: "Retainer", startDate: "2026-09-01" }),
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const got = await work.getAssignment(owner.store.id, made.id);
    expect(got).toMatchObject({
      clientId,
      clientName: "Acme AS",
      currency: "NOK",
      name: "Retainer",
      status: "active",
      billingType: "hourly",
      estimatedMinutes: 600,
      startDate: "2026-09-01",
      endDate: null,
      estimateAlertMinutes: 30,
      createdBy: admin.account.id,
      draftInvoiceId: null,
      issuedInvoices: 0,
    });
    expect(got?.summary).toMatchObject({
      loggedMinutes: 0,
      rateMinor: 150000,
      rateSource: "client",
      remainingMinutes: 600,
      utilisationPercent: 0,
      stage: "ok",
      invoiced: false,
    });
    expect(await events(owner.store.id, made.id)).toEqual(["assignment.created"]);
  });

  it("checks the input, the client and archived clients", async () => {
    const clientId = await newClient();
    expect((await work.createAssignment(owner, assignment(clientId, { name: "" }))).ok).toBe(false);
    expect(
      (await work.createAssignment(owner, assignment(clientId, { billingType: "fixed_fee", fixedAmountMinor: null })))
        .ok,
    ).toBe(false);
    expect(
      (await work.createAssignment(owner, assignment(clientId, { startDate: "2026-09-10", endDate: "2026-09-01" }))).ok,
    ).toBe(false);
    expect((await work.createAssignment(owner, assignment(clientId, { estimatedMinutes: 1.5 }))).ok).toBe(false);

    const otherStoresClient = await newClient(b.owner);
    expect(await work.createAssignment(owner, assignment(otherStoresClient))).toEqual({
      ok: false,
      problems: ["Choose one of your clients."],
    });

    await work.setClientArchived(owner, clientId, true);
    const archived = await work.createAssignment(owner, assignment(clientId));
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.problems[0]).toMatch(/archived/);
  });

  it("lists per client and overall, hiding archived clients' unless asked", async () => {
    const c1 = await newClient(owner, { name: "List One" });
    const c2 = await newClient(owner, { name: "List Two" });
    const a1 = await newAssignment(owner, c1, { name: "One" });
    const a2 = await newAssignment(owner, c2, { name: "Two" });
    const done = await newAssignment(owner, c2, { name: "Finished" });
    await work.setAssignmentStatus(owner, done, "done");

    const ofOne = await work.listAssignments(owner.store.id, { clientId: c1 });
    expect(ofOne.map((x) => x.id)).toEqual([a1]);
    const open = await work.listAssignments(owner.store.id);
    expect(open.map((x) => x.id)).toEqual(expect.arrayContaining([a1, a2]));
    expect(open.map((x) => x.id)).not.toContain(done);
    expect(
      (await work.listAssignments(owner.store.id, { clientId: c2, status: "all" })).map((x) => x.id).sort(),
    ).toEqual([a2, done].sort());
    expect((await work.listAssignments(owner.store.id, { status: "done" })).map((x) => x.id)).toContain(done);

    await work.setClientArchived(owner, c1, true);
    expect((await work.listAssignments(owner.store.id)).map((x) => x.id)).not.toContain(a1);
    expect((await work.listAssignments(owner.store.id, { includeArchivedClients: true })).map((x) => x.id)).toContain(
      a1,
    );
    expect((await work.listAssignments(owner.store.id, { clientId: c1 })).map((x) => x.id)).toEqual([a1]);
    expect(await work.listAssignments(owner.store.id, { clientId: "nope" })).toEqual([]);
  });

  it("works out the summary from the entries: logged, billable, unbilled, estimate and amounts", async () => {
    const clientId = await newClient(owner, { defaultHourlyRateMinor: 120000 });
    const id = await newAssignment(owner, clientId, { estimatedMinutes: 120, estimateAlertMinutes: 30 });
    const day = await today(owner.store);
    for (const [minutes, billable] of [
      [60, true],
      [30, true],
      [20, false],
    ] as const) {
      const logged = await time.logTime(owner, { assignmentId: id, workDate: day, minutes, billable });
      expect(logged.ok).toBe(true);
    }
    const got = await work.getAssignment(owner.store.id, id);
    expect(got?.summary).toMatchObject({
      loggedMinutes: 110,
      billableMinutes: 90,
      unbilledMinutes: 90,
      rateMinor: 120000,
      rateSource: "client",
      // 90 minutes is 1.5 h at 1 200,00
      billableAmountMinor: 180000,
      unbilledAmountMinor: 180000,
      estimatedMinutes: 120,
      remainingMinutes: 10,
      utilisationPercent: 92,
      stage: "near",
    });
    await time.logTime(owner, { assignmentId: id, workDate: day, minutes: 15, billable: true });
    expect((await work.getAssignment(owner.store.id, id))?.summary).toMatchObject({
      remainingMinutes: -5,
      stage: "over",
    });

    const clients = await work.listClients(owner.store.id);
    expect(clients.find((c) => c.id === clientId)).toMatchObject({
      activeAssignments: 1,
      loggedMinutes: 125,
      billableMinutes: 105,
      unbilledMinutes: 105,
    });
  });

  it("uses the assignment's own rate, and the fixed fee, in its amounts", async () => {
    const clientId = await newClient(owner, { defaultHourlyRateMinor: 100000 });
    const own = await newAssignment(owner, clientId, { hourlyRateMinor: 200000, estimatedMinutes: null });
    const fixed = await newAssignment(owner, clientId, {
      billingType: "fixed_fee",
      fixedAmountMinor: 500000,
      estimatedMinutes: null,
    });
    const day = await today(owner.store);
    await time.logTime(owner, { assignmentId: own, workDate: day, minutes: 60 });
    await time.logTime(owner, { assignmentId: fixed, workDate: day, minutes: 60 });
    expect((await work.getAssignment(owner.store.id, own))?.summary).toMatchObject({
      rateSource: "assignment",
      rateMinor: 200000,
      billableAmountMinor: 200000,
      remainingMinutes: null,
      utilisationPercent: null,
      stage: "ok",
    });
    expect((await work.getAssignment(owner.store.id, fixed))?.summary).toMatchObject({
      billableAmountMinor: 500000,
      unbilledAmountMinor: 500000,
      rateMinor: 0,
    });
  });

  it("updates an assignment and records a status change", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    const updated = await work.updateAssignment(
      admin,
      id,
      assignment(clientId, { name: "Renamed", status: "paused", estimatedMinutes: 90 }),
    );
    expect(updated.ok).toBe(true);
    expect(await work.getAssignment(owner.store.id, id)).toMatchObject({
      name: "Renamed",
      status: "paused",
      estimatedMinutes: 90,
    });
    expect(await events(owner.store.id, id)).toEqual(["assignment.created", "assignment.status_changed"]);
    expect(await work.updateAssignment(b.owner, id, assignment(clientId))).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
  });

  it("moves between active, paused and done in any direction, and never to invoiced", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    for (const status of ["paused", "done", "active", "done", "paused"] as const) {
      expect((await work.setAssignmentStatus(owner, id, status)).ok).toBe(true);
      expect((await work.getAssignment(owner.store.id, id))?.status).toBe(status);
    }
    const invoiced = await work.setAssignmentStatus(owner, id, "invoiced");
    expect(invoiced).toEqual({ ok: false, problems: ["Choose active, paused or done."] });
    expect((await work.getAssignment(owner.store.id, id))?.status).toBe("paused");
    expect(await work.setAssignmentStatus(b.owner, id, "done")).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
  });

  it("changes its client only while it has no time and no invoices", async () => {
    const c1 = await newClient(owner, { name: "Move from" });
    const c2 = await newClient(owner, { name: "Move to" });
    const id = await newAssignment(owner, c1);
    expect((await work.updateAssignment(owner, id, assignment(c2))).ok).toBe(true);
    expect((await work.getAssignment(owner.store.id, id))?.clientId).toBe(c2);

    await time.logTime(owner, { assignmentId: id, workDate: await today(owner.store), minutes: 30 });
    const refused = await work.updateAssignment(owner, id, assignment(c1));
    expect(refused).toEqual({
      ok: false,
      problems: ["An assignment with time or invoices cannot move to another client."],
    });
    expect((await work.getAssignment(owner.store.id, id))?.clientId).toBe(c2);
  });

  it("cannot be deleted once it has time, an invoice or a running timer", async () => {
    const clientId = await newClient();
    const empty = await newAssignment(owner, clientId, { name: "Empty" });
    const withTime = await newAssignment(owner, clientId, { name: "With time" });
    const withInvoice = await newAssignment(owner, clientId, { name: "With invoice" });
    const withTimer = await newAssignment(owner, clientId, { name: "With timer" });
    await time.logTime(owner, { assignmentId: withTime, workDate: await today(owner.store), minutes: 10 });
    await db().execute(sql`
      insert into commerce.work_invoices (store_id, client_id, assignment_id, currency)
      values (${owner.store.id}::uuid, ${clientId}::uuid, ${withInvoice}::uuid, 'NOK')
    `);
    expect((await time.startTimer(owner, { assignmentId: withTimer })).ok).toBe(true);

    const timeRefused = await work.deleteAssignment(owner, withTime);
    expect(timeRefused.ok).toBe(false);
    if (!timeRefused.ok) expect(timeRefused.problems[0]).toMatch(/Time has been logged/);
    const invoiceRefused = await work.deleteAssignment(owner, withInvoice);
    expect(invoiceRefused.ok).toBe(false);
    if (!invoiceRefused.ok) expect(invoiceRefused.problems[0]).toMatch(/has invoices/);
    const timerRefused = await work.deleteAssignment(owner, withTimer);
    expect(timerRefused.ok).toBe(false);
    if (!timerRefused.ok) expect(timerRefused.problems[0]).toMatch(/timer is running/);
    for (const id of [withTime, withInvoice, withTimer])
      expect(await work.getAssignment(owner.store.id, id)).not.toBeNull();

    // And the database itself keeps a worked-on assignment, whoever asks.
    await expect(
      db().execute(
        sql`delete from commerce.work_assignments where store_id = ${owner.store.id}::uuid and id = ${withTime}::uuid`,
      ),
    ).rejects.toThrow();

    expect(await work.deleteAssignment(b.owner, empty)).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
    expect((await work.deleteAssignment(admin, empty)).ok).toBe(true);
    expect(await work.getAssignment(owner.store.id, empty)).toBeNull();
    await time.stopTimer(owner);
  });

  it("never shows one store's assignment to another", async () => {
    const clientId = await newClient(owner);
    const id = await newAssignment(owner, clientId);
    expect(await work.getAssignment(b.owner.store.id, id)).toBeNull();
    expect(await work.getAssignmentDetail(b.owner.store.id, id)).toBeNull();
    expect((await work.listAssignments(b.owner.store.id, { status: "all" })).map((x) => x.id)).not.toContain(id);
    expect(await work.listAssignments(b.owner.store.id, { clientId, status: "all" })).toEqual([]);
  });

  it("gives the forms their defaults from the Work settings", async () => {
    const fresh = await work.formDefaults(owner.store);
    expect(fresh.paymentDays).toBe(14);
    expect(fresh.estimateAlert).toEqual({ minutes: 10, popup: true, sound: false });
    expect(fresh.currency).toMatch(/^[A-Z]{3}$/);
    await db().execute(sql`
      insert into commerce.work_settings (store_id, default_currency, default_payment_days, estimate_alert_minutes, estimate_alert_popup, estimate_alert_sound)
      values (${owner.store.id}::uuid, 'SEK', 30, 5, false, true)
      on conflict (store_id) do update set default_currency = 'SEK', default_payment_days = 30, estimate_alert_minutes = 5,
        estimate_alert_popup = false, estimate_alert_sound = true
    `);
    expect(await work.formDefaults(owner.store)).toMatchObject({
      currency: "SEK",
      paymentDays: 30,
      estimateAlert: { minutes: 5, popup: false, sound: true },
    });
  });
});

describe("tasks", () => {
  it("adds tasks at the end, with their estimate, and reads them with their time", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId, { estimateAlertMinutes: 15 });
    const one = await work.createTask(owner, { assignmentId: id, title: "Design", estimatedMinutes: 120 });
    const two = await work.createTask(admin, { assignmentId: id, title: "Build" });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    await time.logTime(owner, { assignmentId: id, taskId: one.id, workDate: await today(owner.store), minutes: 110 });
    await time.logTime(owner, {
      assignmentId: id,
      taskId: one.id,
      workDate: await today(owner.store),
      minutes: 30,
      billable: false,
    });

    const detail = await work.getAssignmentDetail(owner.store.id, id);
    expect(detail?.tasks.map((t) => [t.title, t.sortOrder])).toEqual([
      ["Design", 0],
      ["Build", 1],
    ]);
    expect(detail?.tasks[0]).toMatchObject({
      status: "open",
      estimatedMinutes: 120,
      loggedMinutes: 140,
      billableMinutes: 110,
      remainingMinutes: -20,
      utilisationPercent: 117,
      stage: "over",
    });
    expect(detail?.tasks[1]).toMatchObject({
      estimatedMinutes: null,
      loggedMinutes: 0,
      remainingMinutes: null,
      stage: "ok",
    });
    expect(await events(owner.store.id, one.id)).toEqual(["task.created"]);
  });

  it("checks a task's title, estimate and assignment", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    expect((await work.createTask(owner, { assignmentId: id, title: "  " })).ok).toBe(false);
    expect((await work.createTask(owner, { assignmentId: id, title: "x", estimatedMinutes: 0 })).ok).toBe(false);
    expect((await work.createTask(owner, { assignmentId: "nope", title: "x" })).ok).toBe(false);
    expect(await work.createTask(b.owner, { assignmentId: id, title: "Sneaky" })).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
    expect(await work.listTasks(owner.store.id, id)).toEqual([]);
  });

  it("renames, toggles and re-estimates a task, and records each", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    const made = await work.createTask(owner, { assignmentId: id, title: "First name" });
    if (!made.ok) throw new Error("no task");
    expect((await work.renameTask(owner, made.id, "Second name")).ok).toBe(true);
    expect((await work.setTaskStatus(admin, made.id, "done")).ok).toBe(true);
    expect((await work.setTaskEstimate(owner, made.id, 45)).ok).toBe(true);
    expect(await work.getTask(owner.store.id, made.id)).toMatchObject({
      title: "Second name",
      status: "done",
      estimatedMinutes: 45,
    });
    expect((await work.setTaskEstimate(owner, made.id, null)).ok).toBe(true);
    expect((await work.getTask(owner.store.id, made.id))?.estimatedMinutes).toBeNull();
    expect((await work.setTaskStatus(owner, made.id, "open")).ok).toBe(true);
    expect(await events(owner.store.id, made.id)).toEqual([
      "task.created",
      "task.renamed",
      "task.toggled",
      "task.estimated",
      "task.estimated",
      "task.toggled",
    ]);

    expect((await work.renameTask(owner, made.id, "")).ok).toBe(false);
    expect((await work.setTaskStatus(owner, made.id, "invoiced")).ok).toBe(false);
    expect((await work.setTaskEstimate(owner, made.id, -3)).ok).toBe(false);
    expect((await work.getTask(owner.store.id, made.id))?.title).toBe("Second name");
  });

  it("does not let another store change a task", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    const made = await work.createTask(owner, { assignmentId: id, title: "Mine" });
    if (!made.ok) throw new Error("no task");
    expect(await work.renameTask(b.owner, made.id, "Stolen")).toEqual({
      ok: false,
      problems: ["This task no longer exists."],
    });
    expect(await work.setTaskStatus(b.owner, made.id, "done")).toEqual({
      ok: false,
      problems: ["This task no longer exists."],
    });
    expect(await work.setTaskEstimate(b.owner, made.id, 5)).toEqual({
      ok: false,
      problems: ["This task no longer exists."],
    });
    expect(await work.deleteTask(b.owner, made.id)).toEqual({ ok: false, problems: ["This task no longer exists."] });
    expect(await work.getTask(b.owner.store.id, made.id)).toBeNull();
    expect(await work.getTask(owner.store.id, made.id)).toMatchObject({ title: "Mine", status: "open" });
  });

  it("reorders tasks as dragged, leaves ones not named after the named, and refuses strangers", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    const other = await newAssignment(owner, clientId, { name: "Other" });
    const ids: string[] = [];
    for (const title of ["A", "B", "C", "D"]) {
      const made = await work.createTask(owner, { assignmentId: id, title });
      if (!made.ok) throw new Error("no task");
      ids.push(made.id);
    }
    const foreign = await work.createTask(owner, { assignmentId: other, title: "Foreign" });
    if (!foreign.ok) throw new Error("no task");
    const titles = async () => (await work.listTasks(owner.store.id, id)).map((t) => t.title).join("");

    expect((await work.reorderTasks(owner, id, [ids[3], ids[1], ids[0], ids[2]])).ok).toBe(true);
    expect(await titles()).toBe("DBAC");
    // Only two are named: they lead, the rest keep their order after them.
    expect((await work.reorderTasks(admin, id, [ids[2], ids[0]])).ok).toBe(true);
    expect(await titles()).toBe("CADB");
    expect((await work.listTasks(owner.store.id, id)).map((t) => t.sortOrder)).toEqual([0, 1, 2, 3]);

    const stranger = await work.reorderTasks(owner, id, [ids[0], foreign.id]);
    expect(stranger).toEqual({ ok: false, problems: ["One of those tasks is not on this assignment."] });
    expect(await titles()).toBe("CADB");
    expect((await work.reorderTasks(owner, id, ["nope"])).ok).toBe(false);
    expect(await work.reorderTasks(b.owner, id, [ids[0]])).toEqual({
      ok: false,
      problems: ["This assignment no longer exists."],
    });
    expect((await work.reorderTasks(owner, id, [])).ok).toBe(true);
    expect(await titles()).toBe("CADB");
  });

  it("deletes a task and keeps its time, but not while a timer runs on it or once its time is invoiced", async () => {
    const clientId = await newClient();
    const id = await newAssignment(owner, clientId);
    const plain = await work.createTask(owner, { assignmentId: id, title: "Plain" });
    const running = await work.createTask(owner, { assignmentId: id, title: "Running" });
    if (!plain.ok || !running.ok) throw new Error("no task");
    const logged = await time.logTime(owner, {
      assignmentId: id,
      taskId: plain.id,
      workDate: await today(owner.store),
      minutes: 25,
    });
    if (!logged.ok) throw new Error("no entry");

    expect((await work.deleteTask(admin, plain.id)).ok).toBe(true);
    expect(await work.getTask(owner.store.id, plain.id)).toBeNull();
    const entry = await time.getTimeEntry(owner.store.id, logged.id);
    expect(entry).toMatchObject({ minutes: 25, taskId: null });
    expect(await events(owner.store.id, plain.id)).toEqual(["task.created", "task.deleted"]);

    await time.startTimer(owner, { assignmentId: id, taskId: running.id });
    const refused = await work.deleteTask(owner, running.id);
    expect(refused).toEqual({ ok: false, problems: ["A timer is running on this task. Stop it first."] });
    expect(await work.getTask(owner.store.id, running.id)).not.toBeNull();
    await time.stopTimer(owner);
    expect((await work.deleteTask(owner, running.id)).ok).toBe(true);
  });
});
