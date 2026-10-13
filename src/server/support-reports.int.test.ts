import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { todayIn, addDays } from "@/lib/analytics-period";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const support = await import("./support");
const { agentAct } = await import("./support-agent");
const { deskReport, supportNow } = await import("./support-reports");
const { storeTotals } = await import("./support-platform");
const { systemDesk } = await import("./support-desk");
const { getStore } = await import("./stores");
const tools = await import("./support-manager-tools");
const email = await import("./support-email");
type Staff = import("./support-desk").StaffDesk;

/**
 * Support's report on seeded conversations (D216, step 14; `docs/analytics.md`, Support): the mode each started in is the desk's
 * then, the AI alone and the hand-overs come from the conversations' own times, the first answer from the queue, a missed one is
 * counted, requests and the partner's drafts are the desk's, another store's conversations count nowhere, and the platform's totals
 * give the same figures.
 */

const run = Date.now().toString(36);
const TZ = "Europe/Oslo";
let storeId: string;
let staff: Staff;
let otherId: string;
let slug: string;

async function newStore(name: string) {
  const slug = `reports-${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Reports ${name} ${run}`}, null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', time_zone = ${TZ} where id = ${id}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${id}::uuid, 'ai_first', false, false, true)`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  return { id, slug, account: { id: String(o.id), email: String(o.email), name: "Kari" } as unknown as Staff["account"] };
}

async function started(store = storeId): Promise<string> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale)
    values (${store}::uuid, 'site', ${(await support.deskSettings(systemDesk(store)))?.mode === "people" ? "queue" : "ai"}, ${`r-${Math.random()}`}, 'nb-NO') returning id
  `);
  return String(c.id);
}
const end = (id: string, store = storeId) => support.transition(systemDesk(store), id, "end", { kind: "customer" });

beforeAll(async () => {
  const made = await newStore("a");
  storeId = made.id;
  slug = made.slug;
  staff = { desk: systemDesk(storeId), store: { id: storeId, slug: made.slug, name: "Reports a" }, account: made.account, canWrite: true, holder: { role: "owner" } };
  otherId = (await newStore("b")).id;

  // Ten the AI handled alone, nine resolved by its summary, one not; one rated bad, nine good.
  for (let i = 0; i < 10; i++) {
    const id = await started();
    await support.addMessage(staff.desk, id, "customer", null, "Hi");
    await support.addMessage(staff.desk, id, "ai", null, "Hello");
    await end(id);
    await db().execute(sql`update commerce.support_conversations set summary = ${JSON.stringify({ title: "T", text: "secret words", outcome: i === 0 ? "unresolved" : "resolved", topics: ["delivery"] })}::jsonb, rating = ${i === 0 ? "bad" : "good"}, tone = 50 where id = ${id}::uuid`);
  }
  // Two handed to a person: one asked for, answered from the partner's draft; one missed.
  const answered = await started();
  await support.addMessage(staff.desk, answered, "customer", null, "A person please");
  await support.transition(staff.desk, answered, "handoff", { kind: "customer" }, { reason: "customer" });
  await agentAct(staff, answered, { kind: "claim" });
  await support.addMessage(staff.desk, answered, "partner", staff.account.id, "", { kind: "suggestion", data: { facts: [], recommendation: "Say hi", draft: "Hei!" } });
  expect(await agentAct(staff, answered, { kind: "reply", body: "Hei!", partnerDraft: true })).toEqual({ ok: true });
  await agentAct(staff, answered, { kind: "end" });
  const missed = await started();
  await support.addMessage(staff.desk, missed, "customer", null, "Anyone?");
  await support.transition(staff.desk, missed, "handoff", { kind: "customer" }, { reason: "customer" });
  await end(missed);
  // A staff request, decided.
  await db().execute(sql`
    insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, status, decided_at, created_at)
    values (${answered}::uuid, ${storeId}::uuid, 'refund', 'staff', '{}'::jsonb, 'Refund order 1', 'done', now(), now() - interval '20 minutes')
  `);
  // One still with the AI, and one in mode people.
  await started();
  await db().execute(sql`update commerce.support_settings set mode = 'people' where store_id = ${storeId}::uuid`);
  const people = await started();
  await end(people);
  // Another store's conversation counts only for that store.
  await end(await started(otherId), otherId);
});
afterAll(async () => closeDb());

const today = () => todayIn(new Date(), TZ);
const period = () => ({ from: today(), to: addDays(today(), 1) });

describe("support's report on seeded conversations", () => {
  it("counts the desk's conversations by the mode each started in, and nothing of another store's", async () => {
    const { report } = await deskReport(staff.desk, period(), TZ);
    expect(report.conversations).toBe(14);
    expect(report.byMode).toEqual({ off: 0, ai_first: 13, people: 1, unknown: 0 });
    expect(report.open).toBe(1);
  });

  it("works out the AI alone, its resolved share (its judgement), hand-overs, the first answer and missed ones from the times", async () => {
    const { report } = await deskReport(staff.desk, period(), TZ);
    expect(report.aiAlone).toEqual({ count: 10, of: 12, share: 10 / 12 });
    expect(report.aiResolved).toEqual({ count: 9, of: 10, share: 0.9 });
    expect(report.handover).toMatchObject({ count: 2, of: 12 });
    expect(report.handoverWhy.customer).toBe(2);
    expect(report.firstAnswer.n).toBe(1);
    expect(report.firstAnswer.median).toBeNull();
    // The missed one, and the people-only one that ended in the queue.
    expect(report.missed).toMatchObject({ count: 2, of: 3 });
    expect(report.rating).toEqual({ count: 9, of: 10, share: 0.9 });
    expect(report.tone).toMatchObject({ good: 10 });
    expect(report.topics).toEqual([{ topic: "delivery", count: 10 }]);
    expect(report.requests).toMatchObject({ opened: 1, done: 1 });
    expect(report.drafts).toEqual({ offered: 1, used: 1, share: null });
  });

  it("says what is waiting now, counts only", async () => {
    const now = await supportNow(staff.desk, TZ);
    expect(now).toMatchObject({ waiting: 0, withAi: 1, withPerson: 0, startedToday: 14 });
  });

  it("gives the platform the same figures per store, and a period before nothing", async () => {
    const { stores } = await storeTotals(period());
    const mine = stores.find((s) => s.store.id === storeId)!;
    const theirs = stores.find((s) => s.store.id === otherId)!;
    // The same figures, without what the platform never reads (requests and the partner's drafts live with the transcripts).
    const own = (await deskReport(staff.desk, period(), TZ)).report;
    for (const figure of ["conversations", "byMode", "aiAlone", "aiResolved", "handover", "firstAnswer", "missed", "timeToEnd", "rating", "tone", "topics"] as const) {
      expect(mine.report[figure]).toEqual(own[figure]);
    }
    expect(mine.report.requests.opened).toBe(0);
    expect(mine.report.drafts.offered).toBe(0);
    expect(mine.mode).toBe("people");
    expect(theirs.report.conversations).toBe(1);
    const before = await deskReport(staff.desk, { from: addDays(today(), -10), to: addDays(today(), -9) }, TZ);
    expect(before.report.conversations).toBe(0);
  });
});

describe("the AI manager's support tools and the integrations' event (step 14)", () => {
  it("gives the overview in words worked out by the report, counts only", async () => {
    const store = (await getStore(slug))!;
    const overview = await tools.supportOverviewTool({ store });
    expect(overview.who_answers).toBe("people answer, no AI");
    expect(overview.now).toMatchObject({ waiting_for_a_person: 0, with_the_ai: 1, started_today: 14 });
    expect(overview.last_30_days.handled_by_ai_alone).toBe("83.3 % (10 of 12)");
    // One answered after waiting: what is missing, never a median of one.
    expect(overview.last_30_days.time_to_first_answer).toBe("Not shown: 1 of the 10 needed");
    expect(JSON.stringify(overview)).not.toContain("secret words");
  });

  it("lists conversations by title, summary, status and link, never their words", async () => {
    const store = (await getStore(slug))!;
    const listed = await tools.listSupportConversationsTool({ store }, { status: "ended", limit: 20 });
    expect(listed.count).toBe(13);
    const summarised = listed.conversations.find((c) => c.summary === "secret words")!;
    expect(summarised).toMatchObject({ title: "T", status: "ended", topics: ["Delivery"] });
    expect(summarised.link).toMatch(new RegExp(`^/admin/${slug}/support\\?c=`));
    expect(JSON.stringify(listed)).not.toMatch(/Hi"|Hello"|A person please|Anyone\?/);
  });

  it("gives the platform Kaizen's desk and the stores' totals, never a store's conversation", async () => {
    const overview = await tools.platformSupportOverviewTool();
    expect(overview.kaizen_desk.now).toBeDefined();
    expect(overview.stores_last_30_days.conversations).toBeGreaterThanOrEqual(15);
    expect(overview.stores_last_30_days.stores_with_support).toBeGreaterThanOrEqual(2);
    expect(overview.stores_last_30_days.busiest.length).toBeLessThanOrEqual(5);
    for (const busy of overview.stores_last_30_days.busiest) expect(Object.keys(busy).sort()).toEqual(["conversations", "handed_to_a_person", "missed", "store"]);
    expect(JSON.stringify(overview)).not.toMatch(/secret words|support\?c=/);
  });

  it("queues support.waiting for the store's integrations once per time a conversation waits", async () => {
    await db().execute(sql`
      insert into commerce.store_integrations (store_id, provider, webhook_url_encrypted, webhook_hint, events, enabled)
      values (${storeId}::uuid, 'zapier', 'x', 'x', array['support.waiting'], true)
    `);
    await db().execute(sql`update commerce.support_settings set notify_after_minutes = 1 where store_id = ${storeId}::uuid`);
    const waiting = await started();
    await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '10 minutes' where id = ${waiting}::uuid`);
    await email.sendWaitingAlerts(new Date());
    await email.sendWaitingAlerts(new Date());
    const queued = await db().execute<Row>(sql`select subject_id from commerce.integration_deliveries where store_id = ${storeId}::uuid and event = 'support.waiting'`);
    expect(queued.map((r) => String(r.subject_id))).toEqual([waiting]);
    const { buildPayload } = await import("./integrations");
    const payload = await buildPayload({ id: storeId, slug, name: "Reports a" }, { id: "d", event: "support.waiting", subjectId: waiting, createdAt: new Date().toISOString() });
    expect(payload).toMatchObject({ event: "support.waiting", support: { waiting: 1 } });
    expect(JSON.stringify(payload)).not.toContain(waiting);
  });
});
