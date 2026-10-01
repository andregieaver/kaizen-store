import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addCalendarDays, todayIn } from "@/lib/work-dates";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

// The email is WP7b's; what matters here is whether and when it is asked for, and that its failing changes nothing.
vi.mock("./work-emails", () => ({ sendInvoiceEmail: vi.fn(async () => ({ sent: true })) }));

const { sendInvoiceEmail } = await import("./work-emails");
const recurring = await import("./work-recurring");
const invoices = await import("./work-invoices");

/**
 * Work's repeating invoices (docs/work.md 7.2 WP8) against a real database: the job makes each due period's
 * draft once (however many runs overlap), respects the skip list, the 40-day window, month ends, pausing,
 * end dates and archived clients; issues and emails only what an owner switched on, and never lets a failed
 * email undo an invoice; leaves other stores and stores with Work off alone; and what a person may do.
 */

const run = Date.now().toString(36);
const IBAN = "NO9386011117947";
const emailMock = vi.mocked(sendInvoiceEmail);

type Fixture = { storeId: string; slug: string; owner: Membership; admin: Membership };

async function makeStore(tag: string, options: { work?: boolean } = {}): Promise<Fixture> {
  const name = `wr-${tag}-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [ownerRow] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no',
      modules = ${options.work === false ? sql`'{}'::text[]` : sql`array['work']`}
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic)
    values (${storeId}::uuid, true, 'NO923456789MVA', 14, ${IBAN}, 'DNBANOKKXXX')`);
  const [adminRow] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`admin-${name}@example.com`}, 'Admin') returning id, email`);
  const storeRef = { id: storeId, slug: name } as Membership["store"];
  const member = (id: unknown, email: unknown, role: "owner" | "admin"): Membership => ({
    account: { id: String(id), email: String(email), name: role, platformAdmin: false },
    role,
    store: storeRef,
  });
  return {
    storeId,
    slug: name,
    owner: member(ownerRow.id, ownerRow.email, "owner"),
    admin: member(adminRow.id, adminRow.email, "admin"),
  };
}

async function makeClient(f: Fixture, over: { address?: object | null; archived?: boolean; currency?: string } = {}): Promise<string> {
  const address = over.address === undefined ? { line1: "Kirkeveien 1", postalCode: "0364", city: "Oslo" } : (over.address ?? {});
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, country, billing_address, currency, locale, business, vat_treatment,
                                       billing_email, archived_at)
    values (${f.storeId}::uuid, 'Kunde AS', 'NO', ${JSON.stringify(address)}::jsonb, ${over.currency ?? "NOK"}, 'nb-NO', true, 'domestic',
            'faktura@kunde.no', ${over.archived ? sql`now()` : null})
    returning id`);
  return String(row.id);
}

/** A template as the form would send it (net price 9 500,00, a month's period), changed by `over`. */
const input = (clientId: string, over: Record<string, unknown> = {}) => ({
  clientId,
  name: "Retainer",
  description: "Monthly retainer",
  unit: "unit",
  quantityHundredths: 100,
  unitPriceMinor: 950_000,
  discountBp: 0,
  vatCategory: "standard",
  currency: "NOK",
  recurrenceInterval: 1,
  recurrencePeriod: "month",
  startDate: "2026-09-01",
  endDate: null,
  paymentDays: null,
  autoIssue: false,
  isActive: true,
  ...over,
});

async function makeTemplate(f: Fixture, clientId: string, over: Record<string, unknown> = {}): Promise<string> {
  const made = await recurring.createRecurring(f.owner, input(clientId, over));
  if (!made.ok) throw new Error(`Could not make the template: ${made.problems.join(" | ")}`);
  return made.id;
}

/** A moment on a given day in the store's time zone (noon, so daylight saving never changes the day). */
const at = (day: string) => new Date(`${day}T10:00:00Z`);

const instances = async (templateId: string) =>
  (
    await db().execute<Row>(sql`
      select id, status, recurring_period::text as period, document_number, total_minor, subtotal_minor, service_from::text as service_from,
             service_to::text as service_to, payment_days
      from commerce.work_invoices where recurring_invoice_id = ${templateId}::uuid order by recurring_period`)
  ).map((r) => ({
    id: String(r.id),
    status: String(r.status),
    period: String(r.period),
    documentNumber: r.document_number ? String(r.document_number) : null,
    total: Number(r.total_minor),
    subtotal: Number(r.subtotal_minor),
    from: String(r.service_from),
    to: String(r.service_to),
    paymentDays: r.payment_days === null ? null : Number(r.payment_days),
  }));

const periods = async (templateId: string) => (await instances(templateId)).map((i) => i.period);

const events = async (templateId: string) =>
  (
    await db().execute<Row>(
      sql`select type, data from commerce.work_events where entity_id = ${templateId}::uuid order by id`,
    )
  ).map((r) => ({ type: String(r.type), data: r.data as Record<string, unknown> }));

const setAuto = (templateId: string, auto: boolean) =>
  db().execute(sql`update commerce.work_recurring_invoices set auto_issue = ${auto} where id = ${templateId}::uuid`);

beforeEach(() => {
  emailMock.mockClear();
  emailMock.mockImplementation(async () => ({ sent: true }));
});

afterAll(async () => {
  await closeDb();
});

// --- Making the drafts ----------------------------------------------------------------------------------------------------

describe("making a period's draft", () => {
  it("makes each due period's draft once, priced, with its line and service period, and again does nothing", async () => {
    const f = await makeStore("draft");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01", paymentDays: 30 });

    const first = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(first).toMatchObject({ stores: 1, generated: 1, issued: 0, emailed: 0, failed: 0 });
    const [draft, ...more] = await instances(t);
    expect(more).toEqual([]);
    expect(draft).toMatchObject({
      status: "draft",
      period: "2026-09-01",
      documentNumber: null,
      subtotal: 950_000,
      // 25 % VAT on the net price, worked out by the invoice module.
      total: 1_187_500,
      from: "2026-09-01",
      to: "2026-09-30",
      paymentDays: 30,
    });
    const [line] = await db().execute<Row>(sql`
      select description, unit, quantity_hundredths, unit_price_minor from commerce.work_invoice_lines where invoice_id = ${draft.id}::uuid`);
    expect(line).toMatchObject({ description: "Monthly retainer", unit: "unit", quantity_hundredths: 100 });
    expect(Number(line.unit_price_minor)).toBe(950_000);

    const again = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(again).toMatchObject({ generated: 0, issued: 0, failed: 0 });
    expect(await periods(t)).toEqual(["2026-09-01"]);
    expect((await events(t)).map((e) => e.type)).toEqual(["recurring.created", "recurring.generated"]);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it("makes each period once when runs overlap", async () => {
    const f = await makeStore("overlap");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01" });
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") })),
    );
    expect(runs.reduce((sum, r) => sum + r.generated, 0)).toBe(1);
    expect(runs.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    expect(await periods(t)).toEqual(["2026-09-01"]);
  });

  it("makes only the periods of the last 40 days by itself, and 'Generate now' reaches further back", async () => {
    const f = await makeStore("lookback");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-06-01" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    // 29 Sep less 40 days is 20 Aug: 1 Sep is in, 1 Aug is not.
    expect(await periods(t)).toEqual(["2026-09-01"]);
    const list = await recurring.listRecurring(f.storeId, client);
    expect(list.templates[0].open.map((o) => [o.period, o.invoiceId === null, o.overdueForJob])).toEqual(
      expect.arrayContaining([["2026-06-01", true, true], ["2026-07-01", true, true], ["2026-08-01", true, true]]),
    );
    const oldest = await recurring.generateRecurringNow(f.owner, t);
    expect(oldest).toMatchObject({ ok: true, created: true, period: "2026-06-01" });
    const named = await recurring.generateRecurringNow(f.owner, t, "2026-08-01");
    expect(named).toMatchObject({ ok: true, created: true, period: "2026-08-01" });
    // A period that has its invoice answers with it.
    const same = await recurring.generateRecurringNow(f.owner, t, "2026-08-01");
    expect(same).toMatchObject({ ok: true, created: false });
    expect(await periods(t)).toEqual(["2026-06-01", "2026-08-01", "2026-09-01"]);
    // The job does not fill the gap it was not asked to.
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await periods(t)).toEqual(["2026-06-01", "2026-08-01", "2026-09-01"]);
  });

  it("keeps a month's end: 31 Jan, 28 Feb, 31 Mar, without drifting", async () => {
    const f = await makeStore("monthend");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-01-31" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-03-05") });
    expect(await periods(t)).toEqual(["2026-01-31", "2026-02-28"]);
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-03-31") });
    expect(await periods(t)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect((await instances(t)).map((i) => [i.from, i.to])).toEqual([
      ["2026-01-31", "2026-02-27"],
      ["2026-02-28", "2026-03-30"],
      ["2026-03-31", "2026-04-29"],
    ]);
  });

  it("counts a week and a year from the start", async () => {
    const f = await makeStore("units");
    const client = await makeClient(f);
    const weekly = await makeTemplate(f, client, { name: "Weekly", recurrencePeriod: "week", recurrenceInterval: 2, startDate: "2026-09-01" });
    const yearly = await makeTemplate(f, client, { name: "Yearly", recurrencePeriod: "year", startDate: "2026-09-20" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await periods(weekly)).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
    expect(await periods(yearly)).toEqual(["2026-09-20"]);
  });

  it("leaves paused templates, ended ones, not-yet-started ones and archived clients alone", async () => {
    const f = await makeStore("quiet");
    const client = await makeClient(f);
    const archived = await makeClient(f, { archived: true });
    const paused = await makeTemplate(f, client, { name: "Paused", isActive: false });
    const ended = await makeTemplate(f, client, { name: "Ended", startDate: "2026-06-01", endDate: "2026-07-15" });
    const future = await makeTemplate(f, client, { name: "Future", startDate: "2026-11-01" });
    // A template of a client archived afterwards (new ones cannot be made for it).
    const [row] = await db().execute<Row>(sql`
      insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date)
      values (${f.storeId}::uuid, ${archived}::uuid, 'Old', 'Old', 100, 'NOK', '2026-09-01') returning id`);
    const result = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(result).toMatchObject({ generated: 0, failed: 0 });
    for (const id of [paused, ended, future, String(row.id)]) expect(await periods(id)).toEqual([]);
    // The ended one still reaches back only as far as the job looks: nothing within 40 days of 29 Sep.
    expect(
      await recurring.createRecurring(f.owner, input(archived)),
    ).toMatchObject({ ok: false, problems: ["This client is archived. Restore it before adding a repeating invoice."] });
  });

  it("does not generate for a period a person asks for that is not due", async () => {
    const f = await makeStore("notdue");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-15" });
    const today = todayIn("Europe/Oslo");
    expect(await recurring.generateRecurringNow(f.owner, t, "2026-09-16")).toMatchObject({ ok: false });
    expect(await recurring.generateRecurringNow(f.owner, t, addCalendarDays(today, 400))).toMatchObject({ ok: false });
    expect(await recurring.generateRecurringNow(f.owner, t, "not a day")).toMatchObject({ ok: false });
  });
});

// --- Skipping -----------------------------------------------------------------------------------------------------------------

describe("skipping a period", () => {
  it("is never generated, whether skipped before or after its draft was made", async () => {
    const f = await makeStore("skip");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-07-01" });
    // A period nobody has made yet.
    expect(await recurring.skipRecurringPeriod(f.owner, t, "2026-09-01")).toEqual({ ok: true });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await periods(t)).toEqual([]);
    // Restored, the job makes it.
    expect(await recurring.restoreRecurringPeriod(f.owner, t, "2026-09-01")).toEqual({ ok: true });
    expect(await recurring.restoreRecurringPeriod(f.owner, t, "2026-09-01")).toMatchObject({ ok: false });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await periods(t)).toEqual(["2026-09-01"]);
    // Skipped when its draft exists: the draft is deleted and the period stays skipped.
    expect(await recurring.skipRecurringPeriod(f.owner, t, "2026-09-01")).toEqual({ ok: true });
    expect(await periods(t)).toEqual([]);
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await periods(t)).toEqual([]);
    expect(await recurring.generateRecurringNow(f.owner, t, "2026-09-01")).toMatchObject({
      ok: false,
      problems: ["This period was skipped. Restore it first."],
    });
    const [row] = await db().execute<Row>(sql`select skipped_periods::text[] as skipped from commerce.work_recurring_invoices where id = ${t}::uuid`);
    expect(row.skipped).toEqual(["2026-09-01"]);
    expect((await events(t)).map((e) => e.type)).toEqual(
      expect.arrayContaining(["recurring.skipped", "recurring.restored", "recurring.generated"]),
    );
  });

  it("holds when a draft is deleted from the invoice screens, without saying anything here", async () => {
    const f = await makeStore("deleted");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    const [draft] = await instances(t);
    expect(await invoices.deleteDraft({ account: f.owner.account, store: f.owner.store }, draft.id)).toEqual({ ok: true });
    const result = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(result.generated).toBe(0);
    expect(await periods(t)).toEqual([]);
  });

  it("is refused for a period that has been issued, or is not the template's", async () => {
    const f = await makeStore("skipissued");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    const issued = await recurring.issueRecurringNow(f.owner, t, "2026-09-01", { email: false });
    expect(issued).toMatchObject({ ok: true });
    expect(await recurring.skipRecurringPeriod(f.owner, t, "2026-09-01")).toMatchObject({
      ok: false,
      problems: ["This period has been invoiced. Credit that invoice if it was a mistake."],
    });
    expect(await recurring.skipRecurringPeriod(f.owner, t, "2026-09-02")).toMatchObject({ ok: false });
    expect(await recurring.skipRecurringPeriod(f.owner, t, "2026-08-01")).toMatchObject({ ok: false });
  });
});

// --- Issuing ---------------------------------------------------------------------------------------------------------------------

describe("issuing", () => {
  it("does not issue or email by itself unless the template says so (off by default)", async () => {
    const f = await makeStore("autooff");
    const client = await makeClient(f);
    const made = await recurring.createRecurring(f.owner, { ...input(client), autoIssue: undefined });
    expect(made.ok).toBe(true);
    const [row] = await db().execute<Row>(sql`select auto_issue from commerce.work_recurring_invoices where store_id = ${f.storeId}::uuid`);
    expect(row.auto_issue).toBe(false);
    const result = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(result).toMatchObject({ generated: 1, issued: 0, emailed: 0 });
    const [draft] = await instances((made as { id: string }).id);
    expect(draft).toMatchObject({ status: "draft", documentNumber: null });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-10-05") });
    expect(emailMock).not.toHaveBeenCalled();
    // Nothing was issued, however late the job ran: every period it made is still a draft. (`listRecurring` reads the real
    // date, so which later periods are due depends on the day the test runs.)
    expect((await instances((made as { id: string }).id)).map((i) => [i.status, i.documentNumber])).toEqual(
      (await instances((made as { id: string }).id)).map(() => ["draft", null]),
    );
    expect((await recurring.listRecurring(f.storeId, client)).templates[0].open.map((o) => o.period)).toContain("2026-09-01");
  });

  it("issues and emails what is made, once, when the template issues by itself", async () => {
    const f = await makeStore("autoon");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01", autoIssue: true });
    const first = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(first).toMatchObject({ generated: 1, issued: 1, emailed: 1, failed: 0 });
    const [invoice] = await instances(t);
    expect(invoice).toMatchObject({ status: "sent", documentNumber: "W-1", total: 1_187_500, period: "2026-09-01" });
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(emailMock).toHaveBeenCalledWith(f.storeId, invoice.id, { by: null });
    // Issued on the store's today (never the period's day), by nobody in particular.
    const [row] = await db().execute<Row>(sql`select issued_on::text as d, created_by from commerce.work_invoices where id = ${invoice.id}::uuid`);
    expect(String(row.d)).toBe(todayIn("Europe/Oslo"));
    expect(row.created_by).toBeNull();

    const again = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(again).toMatchObject({ generated: 0, issued: 0, emailed: 0 });
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect((await events(t)).map((e) => e.type)).toEqual(["recurring.created", "recurring.generated", "recurring.issued"]);
  });

  it("issues a run's periods once each when runs overlap, and emails once", async () => {
    const f = await makeStore("autorace");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01", autoIssue: true });
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") })),
    );
    expect(runs.reduce((sum, r) => sum + r.issued, 0)).toBe(1);
    expect(runs.reduce((sum, r) => sum + r.generated, 0)).toBe(1);
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect((await instances(t)).map((i) => i.status)).toEqual(["sent"]);
  });

  it("issues an older draft of a due period when the template is switched to auto-issue", async () => {
    const f = await makeStore("autolate");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-06-01" });
    // A draft from long ago, made by a person; the job would not make it, but it issues a draft whatever its age.
    await recurring.generateRecurringNow(f.owner, t, "2026-06-01");
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect((await instances(t)).map((i) => i.status)).toEqual(["draft", "draft"]);
    await setAuto(t, true);
    const result = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(result).toMatchObject({ generated: 0, issued: 2, emailed: 2 });
    expect((await instances(t)).map((i) => [i.period, i.status, i.documentNumber])).toEqual([
      ["2026-06-01", "sent", "W-1"],
      ["2026-09-01", "sent", "W-2"],
    ]);
  });

  it("never undoes an invoice because its email failed, and does not send it again", async () => {
    const f = await makeStore("mailfail");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-09-01", autoIssue: true });
    emailMock.mockImplementationOnce(async () => ({ sent: false, reason: "no_recipient" }));
    const first = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(first).toMatchObject({ generated: 1, issued: 1, emailed: 0, failed: 0 });
    expect((await instances(t)).map((i) => i.status)).toEqual(["sent"]);
    const failed = (await events(t)).find((e) => e.type === "recurring.email_failed");
    expect(failed?.data).toMatchObject({ reason: "no_recipient", period: "2026-09-01" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(emailMock).toHaveBeenCalledTimes(1);

    // A mail that throws is the same.
    const g = await makeStore("mailthrow");
    const other = await makeClient(g);
    const u = await makeTemplate(g, other, { startDate: "2026-09-01", autoIssue: true });
    emailMock.mockImplementationOnce(async () => {
      throw new Error("mail is down");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = await recurring.prepareDueRecurringWork({ storeId: g.storeId, now: at("2026-09-29") });
    quiet.mockRestore();
    expect(second).toMatchObject({ issued: 1, emailed: 0, failed: 0 });
    expect((await instances(u)).map((i) => i.status)).toEqual(["sent"]);
  });

  it("leaves a draft it cannot issue as a draft, says why once a day, and tries again next time", async () => {
    const f = await makeStore("notready");
    const client = await makeClient(f, { address: null });
    const t = await makeTemplate(f, client, { startDate: "2026-09-01", autoIssue: true });
    const first = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(first).toMatchObject({ generated: 1, issued: 0, failed: 1 });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect((await instances(t)).map((i) => i.status)).toEqual(["draft"]);
    const said = (await events(t)).filter((e) => e.type === "recurring.issue_failed");
    expect(said).toHaveLength(1);
    expect(JSON.stringify(said[0].data)).toContain("billing address");
    expect(emailMock).not.toHaveBeenCalled();
    // Fixed, it is issued by the next run.
    await db().execute(sql`
      update commerce.work_clients set billing_address = '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb where id = ${client}::uuid`);
    const fixed = await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(fixed).toMatchObject({ generated: 0, issued: 1, emailed: 1, failed: 0 });
  });

  it("'Issue now' makes the draft if needed, issues it, emails it on request, and only once", async () => {
    const f = await makeStore("issuenow");
    const client = await makeClient(f);
    const t = await makeTemplate(f, client, { startDate: "2026-06-01" });
    const now = await recurring.issueRecurringNow(f.admin, t, "2026-06-01");
    expect(now).toMatchObject({ ok: true, documentNumber: "W-1", emailed: true });
    expect(emailMock).toHaveBeenCalledWith(f.storeId, expect.any(String), { by: f.admin.account.id });
    expect((await instances(t)).map((i) => [i.period, i.status])).toEqual([["2026-06-01", "sent"]]);
    expect(await recurring.issueRecurringNow(f.admin, t, "2026-06-01")).toMatchObject({
      ok: false,
      problems: ["This period has already been issued."],
    });
    // Without the email.
    await recurring.generateRecurringNow(f.owner, t, "2026-07-01");
    emailMock.mockClear();
    const quiet = await recurring.issueRecurringNow(f.owner, t, "2026-07-01", { email: false });
    expect(quiet).toMatchObject({ ok: true, documentNumber: "W-2", emailed: false, emailReason: "not_requested" });
    expect(emailMock).not.toHaveBeenCalled();
    // A failed mail is said, and the invoice stays issued.
    emailMock.mockImplementationOnce(async () => ({ sent: false, reason: "no_recipient" }));
    const failed = await recurring.issueRecurringNow(f.owner, t, "2026-08-01");
    expect(failed).toMatchObject({ ok: true, emailed: false, emailReason: "no_recipient" });
    expect((await instances(t)).map((i) => i.status)).toEqual(["sent", "sent", "sent"]);
    // A period that is not due is not made.
    expect(await recurring.issueRecurringNow(f.owner, t, "2026-06-02")).toMatchObject({ ok: false });
  });

  it("'Issue now' keeps the draft and says what is missing when the invoice is not ready", async () => {
    const f = await makeStore("issuebad");
    const client = await makeClient(f, { address: null });
    const t = await makeTemplate(f, client, { startDate: "2026-09-01" });
    const result = await recurring.issueRecurringNow(f.owner, t, "2026-09-01");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain("billing address");
    expect(result.problems.join(" ")).toContain("kept as a draft");
    expect((await instances(t)).map((i) => i.status)).toEqual(["draft"]);
  });
});

// --- Stores -------------------------------------------------------------------------------------------------------------------

describe("stores", () => {
  it("only makes a store's own invoices, and skips stores with Work off or closed", async () => {
    const a = await makeStore("iso-a");
    const b = await makeStore("iso-b");
    const off = await makeStore("iso-off", { work: false });
    const closed = await makeStore("iso-closed");
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${closed.storeId}::uuid`);
    const ta = await makeTemplate(a, await makeClient(a), { startDate: "2026-09-01" });
    const tb = await makeTemplate(b, await makeClient(b), { startDate: "2026-09-01", autoIssue: true });
    // A template made while Work was on, in a store that has switched it off since (a store with Work off has none to begin with).
    const [offClient] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency, business, vat_treatment)
      values (${off.storeId}::uuid, 'K', 'NO', '{"line1":"a","postalCode":"1","city":"b"}'::jsonb, 'NOK', true, 'domestic') returning id`);
    const [offTemplate] = await db().execute<Row>(sql`
      insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date, auto_issue)
      values (${off.storeId}::uuid, ${String(offClient.id)}::uuid, 'Off', 'Off', 100, 'NOK', '2026-09-01', true) returning id`);
    const [closedClient] = await db().execute<Row>(sql`
      insert into commerce.work_clients (store_id, name, country, billing_address, currency, business, vat_treatment)
      values (${closed.storeId}::uuid, 'K', 'NO', '{"line1":"a","postalCode":"1","city":"b"}'::jsonb, 'NOK', true, 'domestic') returning id`);
    const [closedTemplate] = await db().execute<Row>(sql`
      insert into commerce.work_recurring_invoices (store_id, client_id, name, description, unit_price_minor, currency, start_date)
      values (${closed.storeId}::uuid, ${String(closedClient.id)}::uuid, 'Closed', 'Closed', 100, 'NOK', '2026-09-01') returning id`);

    // One store only.
    const onlyA = await recurring.prepareDueRecurringWork({ storeId: a.storeId, now: at("2026-09-29") });
    expect(onlyA).toMatchObject({ stores: 1, generated: 1, issued: 0 });
    expect(await periods(tb)).toEqual([]);

    // Every store: the rest with Work on.
    const all = await recurring.prepareDueRecurringWork({ now: at("2026-09-29") });
    expect(all.stores).toBeGreaterThanOrEqual(1);
    expect(await periods(ta)).toEqual(["2026-09-01"]);
    expect(await periods(tb)).toEqual(["2026-09-01"]);
    expect((await instances(tb)).map((i) => i.status)).toEqual(["sent"]);
    expect(await periods(String(offTemplate.id))).toEqual([]);
    expect(await periods(String(closedTemplate.id))).toEqual([]);
    // Each invoice is its own store's.
    const stores = await db().execute<Row>(sql`
      select i.store_id from commerce.work_invoices i where i.recurring_invoice_id in (${ta}::uuid, ${tb}::uuid) order by i.recurring_invoice_id`);
    expect(new Set(stores.map((r) => String(r.store_id)))).toEqual(new Set([a.storeId, b.storeId]));
    const mailed = emailMock.mock.calls.map((call) => call[0]);
    expect(mailed.filter((id) => id === b.storeId)).toHaveLength(1);
    for (const other of [a.storeId, off.storeId, closed.storeId]) expect(mailed).not.toContain(other);
  });

  it("does not let one store read or change another's templates", async () => {
    const a = await makeStore("cross-a");
    const b = await makeStore("cross-b");
    const clientA = await makeClient(a);
    const clientB = await makeClient(b);
    const ta = await makeTemplate(a, clientA, { startDate: "2026-09-01" });
    const notFound = { ok: false, problems: ["This repeating invoice no longer exists."] };
    expect(await recurring.updateRecurring(b.owner, ta, input(clientB))).toMatchObject(notFound);
    expect(await recurring.setRecurringActive(b.owner, ta, false)).toMatchObject(notFound);
    expect(await recurring.deleteRecurring(b.owner, ta)).toMatchObject(notFound);
    expect(await recurring.generateRecurringNow(b.owner, ta, "2026-09-01")).toMatchObject(notFound);
    expect(await recurring.skipRecurringPeriod(b.owner, ta, "2026-09-01")).toMatchObject(notFound);
    expect(await recurring.restoreRecurringPeriod(b.owner, ta, "2026-09-01")).toMatchObject({ ok: false });
    expect(await recurring.issueRecurringNow(b.owner, ta, "2026-09-01")).toMatchObject(notFound);
    expect(await recurring.listRecurring(b.storeId, clientA)).toEqual({ today: expect.any(String), templates: [] });
    expect(await recurring.createRecurring(b.owner, input(clientA))).toMatchObject({ ok: false });
    const [row] = await db().execute<Row>(sql`select is_active from commerce.work_recurring_invoices where id = ${ta}::uuid`);
    expect(row.is_active).toBe(true);
  });
});

// --- Templates ----------------------------------------------------------------------------------------------------------------

describe("templates", () => {
  it("are made, listed with where they stand, changed, paused and started again", async () => {
    const f = await makeStore("crud");
    const client = await makeClient(f);
    const today = todayIn("Europe/Oslo");
    const t = await makeTemplate(f, client, { startDate: addCalendarDays(today, -3), name: "Hosting" });
    const listed = await recurring.listRecurring(f.storeId, client);
    expect(listed.today).toBe(today);
    expect(listed.templates).toHaveLength(1);
    expect(listed.templates[0]).toMatchObject({
      id: t,
      name: "Hosting",
      description: "Monthly retainer",
      unitPriceMinor: 950_000,
      currency: "NOK",
      autoIssue: false,
      isActive: true,
      skippedPeriods: [],
      invoiceCount: 0,
      last: null,
    });
    expect(listed.templates[0].open.map((o) => o.period)).toEqual([addCalendarDays(today, -3)]);
    expect(listed.templates[0].next).toHaveLength(2);

    const changed = await recurring.updateRecurring(f.owner, t, input(client, { name: "Hosting plus", unitPriceMinor: 1_000_000, startDate: addCalendarDays(today, -3) }));
    expect(changed).toEqual({ ok: true, id: t });
    expect(await recurring.updateRecurring(f.owner, t, input(client, { name: "" }))).toMatchObject({ ok: false });
    expect(await recurring.updateRecurring(f.owner, t, input(await makeClient(f)))).toMatchObject({
      ok: false,
      problems: ["A repeating invoice stays with its client."],
    });

    expect(await recurring.setRecurringActive(f.admin, t, false)).toEqual({ ok: true });
    expect(await recurring.prepareDueRecurringWork({ storeId: f.storeId })).toMatchObject({ generated: 0 });
    expect((await recurring.listRecurring(f.storeId, client)).templates[0]).toMatchObject({ isActive: false, name: "Hosting plus" });
    expect(await recurring.setRecurringActive(f.admin, t, true)).toEqual({ ok: true });
    expect(await recurring.prepareDueRecurringWork({ storeId: f.storeId })).toMatchObject({ generated: 1 });
    const [draft] = await instances(t);
    expect(draft.subtotal).toBe(1_000_000);
    expect((await events(t)).map((e) => e.type)).toEqual([
      "recurring.created",
      "recurring.updated",
      "recurring.paused",
      "recurring.resumed",
      "recurring.generated",
    ]);
  });

  it("are deleted only while they have made nothing, and paused after that", async () => {
    const f = await makeStore("delete");
    const client = await makeClient(f);
    const empty = await makeTemplate(f, client, { startDate: "2027-01-01" });
    expect(await recurring.deleteRecurring(f.admin, empty)).toEqual({ ok: true });
    expect(await recurring.deleteRecurring(f.admin, empty)).toMatchObject({ ok: false });
    const used = await makeTemplate(f, client, { startDate: "2026-09-01" });
    await recurring.prepareDueRecurringWork({ storeId: f.storeId, now: at("2026-09-29") });
    expect(await recurring.deleteRecurring(f.admin, used)).toMatchObject({
      ok: false,
      problems: ["This repeating invoice has made invoices, so it cannot be deleted. Pause it instead."],
    });
    expect(await recurring.setRecurringActive(f.admin, used, false)).toEqual({ ok: true });
  });

  it("leave automatic issuing to owners", async () => {
    const f = await makeStore("owneronly");
    const client = await makeClient(f);
    expect(await recurring.createRecurring(f.admin, input(client, { autoIssue: true }))).toMatchObject({
      ok: false,
      problems: ["Only an owner can switch automatic issuing on or off."],
    });
    const made = await recurring.createRecurring(f.admin, input(client));
    expect(made.ok).toBe(true);
    const id = (made as { id: string }).id;
    expect(await recurring.updateRecurring(f.admin, id, input(client, { autoIssue: true }))).toMatchObject({ ok: false });
    expect(await recurring.updateRecurring(f.owner, id, input(client, { autoIssue: true }))).toEqual({ ok: true, id });
    // An admin may change everything else, and leaves it on.
    expect(await recurring.updateRecurring(f.admin, id, input(client, { autoIssue: true, name: "Renamed" }))).toEqual({ ok: true, id });
    expect(await recurring.updateRecurring(f.admin, id, input(client, { autoIssue: false }))).toMatchObject({ ok: false });
  });

  it("refuse what the schedule cannot be", async () => {
    const f = await makeStore("invalid");
    const client = await makeClient(f);
    for (const bad of [
      { recurrenceInterval: 5 },
      { recurrencePeriod: "day" },
      { endDate: "2026-08-01" },
      { quantityHundredths: 0 },
      { unitPriceMinor: -1 },
      { currency: "XX" },
      { paymentDays: 100 },
    ]) {
      expect(await recurring.createRecurring(f.owner, input(client, bad))).toMatchObject({ ok: false });
    }
    expect(await recurring.createRecurring(f.owner, input("not-a-client"))).toMatchObject({ ok: false });
    expect(await recurring.createRecurring(f.owner, input("6f1c0f37-5f39-4d0e-9d55-7f0d0f6a1001"))).toMatchObject({
      ok: false,
      problems: ["This client no longer exists."],
    });
  });
});
