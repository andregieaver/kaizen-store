import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { closeDb, db } = await import("@/db/client");
const fx = await import("./invoice-test-fixture");
const pd = await import("./pipedrive");
type Row = Record<string, unknown>;

/**
 * Moving in from Pipedrive (S7, D477) against a real database, Pipedrive stood in for (two records a page, so every feed pages): a check
 * counts and writes nothing; an import brings companies, customers, pipelines, deals, activities and notes, each linked to where it came from;
 * a second import brings nothing twice; a refused token ends the run and says so.
 */

afterAll(async () => {
  await closeDb();
});

const run = Date.now().toString(36);
const TOKEN = "0123456789abcdef0123456789abcdef01234567";

function fakePipedrive(lists: Record<string, unknown[]>, o: { refuse?: boolean } = {}) {
  return (async (input: URL | string) => {
    const url = new URL(String(input));
    if (o.refuse) return new Response('{"success":false}', { status: 401 });
    if (url.pathname === "/v1/users/me") return Response.json({ success: true, data: { name: "Lisa", company_name: "Human Web", company_id: 991 } });
    const all = lists[url.pathname] ?? [];
    if (url.pathname.startsWith("/v1/")) {
      const start = Number(url.searchParams.get("start") ?? 0);
      return Response.json({ success: true, data: all.slice(start, start + 2), additional_data: { pagination: { more_items_in_collection: start + 2 < all.length, next_start: start + 2 } } });
    }
    const at = Number(url.searchParams.get("cursor") ?? 0);
    return Response.json({ success: true, data: all.slice(at, at + 2), additional_data: { next_cursor: at + 2 < all.length ? String(at + 2) : null } });
  }) as unknown as typeof globalThis.fetch;
}

async function settle(storeId: string, fetch: typeof globalThis.fetch) {
  for (let i = 0; i < 40; i++) {
    const r = await pd.advancePipedrive(storeId, { fetch, sleep: async () => {} });
    if (!r || r.status !== "running") return r;
  }
  throw new Error("the run did not end");
}

async function counts(storeId: string) {
  const [c] = await db().execute<Row>(sql`
    select (select count(*)::int from commerce.customer_companies where store_id = ${storeId}::uuid) as companies,
           (select count(*)::int from commerce.customers where store_id = ${storeId}::uuid) as customers,
           (select count(*)::int from commerce.deals where store_id = ${storeId}::uuid) as deals,
           (select count(*)::int from commerce.activities where store_id = ${storeId}::uuid) as activities,
           (select count(*)::int from commerce.customer_notes where store_id = ${storeId}::uuid) as notes`);
  return c;
}

describe("moving in from Pipedrive", () => {
  it("checks, brings over, and on a second run brings nothing twice", async () => {
    const store = await fx.makeStore(`pipedrive-${run}`);
    const owner = await fx.ownerOf(store);
    const kari = `kari-${run}@kunde.no`;
    const lists = {
      "/v1/users": [
        { id: 4, name: "Owner", email: owner.account.email.toUpperCase(), active_flag: true },
        { id: 5, name: "Someone", email: `someone-${run}@else.no`, active_flag: true },
      ],
      "/api/v2/organizations": [{ id: 7, name: "Kunde AS" }, { id: 8, name: "Tom AS" }],
      "/api/v2/persons": [
        { id: 11, name: "Kari", emails: [{ value: kari, primary: true }], phones: [{ value: "+47 900 00 000", primary: true }], org_id: 7 },
        { id: 12, name: "Ola", emails: [] },
        { id: 13, name: "Per", emails: [{ value: `per-${run}@kunde.no`, primary: true }] },
      ],
      "/api/v2/pipelines": [{ id: 1, name: "Pipedrive sales", order_nr: 1 }],
      "/api/v2/stages": [
        { id: 3, pipeline_id: 1, name: "Quote sent", order_nr: 3, deal_probability: 60 },
        { id: 4, pipeline_id: 1, name: "Won over", order_nr: 4 },
      ],
      "/api/v2/deals": [
        { id: 21, title: "Totes", status: "open", pipeline_id: 1, stage_id: 3, person_id: 11, org_id: 7, value: 1250, currency: "NOK", owner_id: 4, add_time: "2026-10-01T08:00:00Z" },
        { id: 22, title: "Aprons", status: "lost", pipeline_id: 1, stage_id: 4, org_id: 8, lost_reason: "Too dear", lost_time: "2026-10-20T10:00:00Z" },
        { id: 23, title: "Nobody", status: "open", pipeline_id: 1, stage_id: 3, person_id: 12 },
      ],
      "/api/v2/activities": [
        { id: 31, type: "call", subject: "Call Kari", due_date: "2026-11-09", due_time: "09:30", deal_id: 21, owner_id: 4 },
        { id: 32, type: "email", subject: "", due_date: "2026-11-01", done: true, person_id: 13 },
        { id: 33, type: "task", subject: "No day", deal_id: 21 },
      ],
      "/v1/notes": [
        { id: 41, content: "<p>Met at the fair.</p>", org_id: 7, add_time: "2026-10-02 12:00:00" },
        { id: 42, content: "<p>About Ola.</p>", person_id: 12 },
        { id: 43, content: "<p>On the deal.</p>", deal_id: 21 },
      ],
    };
    const fetch = fakePipedrive(lists);

    expect(await pd.connectPipedrive(owner, ` "${TOKEN}" `, { fetch })).toEqual({ ok: true, name: "Lisa", company: "Human Web" });
    expect(await pd.pipedriveMove(store.storeId)).toMatchObject({ tokenHint: "…4567", account: "991", accountName: "Human Web", run: null });
    const [kept] = await db().execute<Row>(sql`select token_encrypted from commerce.crm_moves where store_id = ${store.storeId}::uuid`);
    expect(String(kept.token_encrypted)).not.toContain(TOKEN);

    // The check: counted, nothing written.
    const before = await counts(store.storeId);
    expect(await pd.startPipedriveRun(owner, "check")).toEqual({ ok: true });
    expect(await pd.startPipedriveRun(owner, "import")).toEqual({ ok: false });
    const checked = await settle(store.storeId, fetch);
    expect(checked).toMatchObject({
      mode: "check",
      status: "done",
      already: 0,
      plan: { companies: 2, customers: 2, pipelines: 1, stages: 2, deals: { open: 1, won: 0, lost: 1 }, activities: 2, notes: 2, skipped: { person_no_email: 1, deal_no_one: 1, activity_no_day: 1, note_no_one: 1 } },
    });
    expect(checked?.seen).toBeUndefined();
    expect(await counts(store.storeId)).toEqual(before);

    // The import: the same counts, now written.
    expect(await pd.startPipedriveRun(owner, "import")).toEqual({ ok: true });
    const imported = await settle(store.storeId, fetch);
    expect(imported).toMatchObject({ mode: "import", status: "done", already: 0, plan: checked!.plan, owners: { "4": owner.account.id } });
    const after = await counts(store.storeId);
    expect(after).toEqual({ companies: Number(before.companies) + 2, customers: Number(before.customers) + 2, deals: 2, activities: 2, notes: 2 });

    const [k] = await db().execute<Row>(sql`
      select c.name, c.phone, co.name as company from commerce.customers c left join commerce.customer_companies co on co.id = c.company_id
       where c.store_id = ${store.storeId}::uuid and lower(c.email) = ${kari}`);
    expect(k).toEqual({ name: "Kari", phone: "+47 900 00 000", company: "Kunde AS" });
    const deals = await db().execute<Row>(sql`
      select d.title, d.status, d.estimate_minor::int as estimate, d.currency, d.owner_id, d.closed_via, d.close_reason, s.name as stage, p.name as pipeline
        from commerce.deals d join commerce.deal_stages s on s.id = d.stage_id join commerce.deal_pipelines p on p.id = d.pipeline_id
       where d.store_id = ${store.storeId}::uuid order by d.title`);
    expect(deals).toEqual([
      { title: "Aprons", status: "lost", estimate: null, currency: "NOK", owner_id: null, closed_via: "person", close_reason: "Too dear", stage: "Won over", pipeline: "Pipedrive sales" },
      { title: "Totes", status: "open", estimate: 125000, currency: "NOK", owner_id: owner.account.id, closed_via: null, close_reason: null, stage: "Quote sent", pipeline: "Pipedrive sales" },
    ]);
    const activities = await db().execute<Row>(sql`
      select kind, title, note, timed, to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as due_at, assignee_id, done_at is not null as done, notified_at is not null as told
        from commerce.activities where store_id = ${store.storeId}::uuid order by title`);
    expect(activities).toEqual([
      { kind: "call", title: "Call Kari", note: null, timed: true, due_at: "2026-11-09 09:30", assignee_id: owner.account.id, done: false, told: true },
      // Untimed: due at the start of its day in the store's zone (Oslo).
      { kind: "task", title: "email", note: null, timed: false, due_at: "2026-10-31 23:00", assignee_id: null, done: true, told: true },
    ]);
    // The organisation's note and the deal's both go on Kari, the one person of Kunde AS and the deal's.
    const notes = await db().execute<Row>(sql`select email, body from commerce.customer_notes where store_id = ${store.storeId}::uuid order by body`);
    expect(notes).toEqual([
      { email: kari, body: "Met at the fair." },
      { email: kari, body: "On the deal." },
    ]);

    // A second run: everything came before, nothing twice.
    expect(await pd.startPipedriveRun(owner, "import")).toEqual({ ok: true });
    const again = await settle(store.storeId, fetch);
    expect(again).toMatchObject({ status: "done", plan: { companies: 0, customers: 0, deals: { open: 0, won: 0, lost: 0 }, activities: 0, notes: 0 } });
    expect(again?.already).toBe(13);
    expect(await counts(store.storeId)).toEqual(after);

    // A deleted deal stays deleted: its link keeps it from coming back, and a check counts it as come before.
    await db().execute(sql`delete from commerce.deals where store_id = ${store.storeId}::uuid and title = 'Aprons'`);
    expect(await pd.startPipedriveRun(owner, "check")).toEqual({ ok: true });
    expect(await settle(store.storeId, fetch)).toMatchObject({ already: 13, plan: { deals: { open: 0, won: 0, lost: 0 } } });

    const [audit] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'integration.pipedrive_imported' order by created_at limit 1`);
    expect(audit.details).toMatchObject({ account: "991", customers: 2, deals: 2, notes: 2 });

    await pd.disconnectPipedrive(owner);
    expect(await pd.pipedriveMove(store.storeId)).toBeNull();
    const [links] = await db().execute<Row>(sql`select count(*)::int as n from commerce.crm_move_links where store_id = ${store.storeId}::uuid`);
    expect(links.n).toBe(13);
  });

  it("says a token Pipedrive refuses is one, and ends a run when Pipedrive stops taking it", async () => {
    const store = await fx.makeStore(`pipedrive-refused-${run}`);
    const owner = await fx.ownerOf(store);
    expect(await pd.connectPipedrive(owner, "not a token")).toEqual({ ok: false, problem: "not_a_token" });
    expect(await pd.connectPipedrive(owner, TOKEN, { fetch: fakePipedrive({}, { refuse: true }) })).toEqual({ ok: false, problem: "refused" });
    expect(await pd.connectPipedrive(owner, TOKEN, { fetch: fakePipedrive({}) })).toMatchObject({ ok: true });
    expect(await pd.startPipedriveRun(owner, "import")).toEqual({ ok: true });
    expect(await settle(store.storeId, fakePipedrive({}, { refuse: true }))).toMatchObject({ status: "failed", problem: "token_refused" });
  });
});
