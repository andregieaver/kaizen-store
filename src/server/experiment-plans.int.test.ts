import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { consentCookieName, encodeConsent } from "@/lib/cookie-consent";
import { dataCookieName, encodeAssignments, PLAN_WITHOUT_TESTS, planFullProblem } from "@/lib/experiments";
import type { PageContent } from "@/lib/page-content";

import type { Account } from "./auth";

/**
 * A/B tests as a plan's feature (D148 phase 21): a plan's `ab_tests_running` is how many tests its stores run at once, 0 a plan without
 * them. A store on each kind of plan is tried here (none, without, one at a time, more than the engine's), and a store that moves to a plan
 * without them keeps its running test and its visitors' versions, and starts no new one, a scheduled one included.
 */

type Row = Record<string, unknown>;
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const admin = await import("./experiment-admin");
const engine = await import("./experiments");
const jobs = await import("./experiment-jobs");
const limits = await import("./limits");
const tools = await import("./experiment-tools");
const stores = await import("./stores");

const run = Date.now().toString(36);
let storeId: string;
let account: Account;
const pageIds: string[] = [];
const plans: Record<"none" | "one" | "many", string> = { none: "", one: "", many: "" };

/** Puts the store on a plan (or on none), and forgets what the server remembered of its limits, as a change of plan does within the minute. */
async function onPlan(plan: keyof typeof plans | null) {
  await db().execute(sql`delete from commerce.store_billing where store_id = ${storeId}::uuid`);
  if (plan) await db().execute(sql`insert into commerce.store_billing (store_id, plan_id, status) values (${storeId}::uuid, ${plans[plan]}::uuid, 'active')`);
  limits.forgetLimits(storeId);
}

/** A draft of page `n` whose version B differs from the original, ready to start. */
async function readyDraft(n: number): Promise<string> {
  const made = await admin.createExperiment(account, storeId, { name: `Plan test ${n}`, pageId: pageIds[n], goal: "orders" });
  if (!made.ok) throw new Error(made.problems.join(" "));
  const version = (await admin.getExperiment(storeId, made.id))!.variants.find((v) => v.key === "b")!.pageId!;
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${version}::uuid`);
  const content = row.published as PageContent;
  const next = JSON.stringify({ ...content, rows: content.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: `${b.text} (B)` } : b)) })) })) });
  await db().execute(sql`update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb where id = ${version}::uuid`);
  return made.id;
}

async function endAll() {
  for (const t of await admin.listExperiments(storeId)) {
    if (t.status === "running") await admin.stopExperiment(account, storeId, t.id);
    if (t.status === "scheduled") await admin.unscheduleExperiment(account, storeId, t.id);
  }
  engine.forgetRunning(storeId);
}

beforeAll(async () => {
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`abplan-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`abplan-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`abplan-admin-${run}@example.com`}, 'AB Plan') returning id`);
  account = { id: String(acc.id), email: `abplan-admin-${run}@example.com`, name: "AB Plan", platformAdmin: false };
  // Three published pages of their own, copies of the about page, so three tests can run at once.
  const [about] = await db().execute<Row>(sql`select published from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss'`);
  for (const slug of ["plan-a", "plan-b", "plan-c"]) {
    const content = JSON.stringify({ ...(about.published as PageContent), slug });
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at) values (${storeId}::uuid, ${slug}, 'page', ${content}::jsonb, ${content}::jsonb, now()) returning id`);
    pageIds.push(String(page.id));
  }
  for (const [kind, value] of [["none", 0], ["one", 1], ["many", 9]] as const) {
    const [plan] = await db().execute<Row>(sql`insert into commerce.plans (name, position) values (${`AB ${kind} ${run}`}, 900) returning id`);
    plans[kind] = String(plan.id);
    await db().execute(sql`insert into commerce.plan_limits (plan_id, key, value) values (${plans[kind]}::uuid, 'ab_tests_running', ${value})`);
  }
  if (!(await stores.getOpenStore(`abplan-${run}`))) throw new Error("The test store is not open.");
});

beforeEach(async () => {
  await onPlan(null);
  await endAll();
  jar.clear();
});

afterAll(async () => {
  await endAll();
  await db().execute(sql`delete from commerce.store_billing where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.plans set active = false where id in (${plans.none}::uuid, ${plans.one}::uuid, ${plans.many}::uuid)`);
  await closeDb();
});

describe("A/B tests on each kind of plan (D148 phase 21)", () => {
  it("lets a store on no plan, or a plan that does not limit them, run the engine's five", async () => {
    expect(await admin.testRoom(storeId)).toEqual({ planAllows: null, allows: 5, running: 0 });
    await onPlan("many");
    // A plan's nine is never more than the engine's five.
    expect(await admin.testRoom(storeId)).toEqual({ planAllows: 9, allows: 5, running: 0 });
    for (const n of [0, 1]) expect(await admin.startExperiment(account, storeId, await readyDraft(n))).toEqual({ ok: true });
    expect((await admin.testRoom(storeId)).running).toBe(2);
  });

  it("makes no test on a plan without them, and names the plans that have them", async () => {
    await onPlan("none");
    expect(await admin.createExperiment(account, storeId, { name: "No", pageId: pageIds[0], goal: "orders" })).toEqual({ ok: false, problems: [PLAN_WITHOUT_TESTS] });
    const named = await admin.plansWithTests();
    expect(named).toContain(`AB one ${run}`);
    expect(named).toContain(`AB many ${run}`);
    expect(named).not.toContain(`AB none ${run}`);
    // The AI manager is told why, in its own tools.
    const ctx = { store: (await stores.getOpenStore(`abplan-${run}`))!, account } as Parameters<typeof tools.listExperimentsTool>[0];
    const listed = await tools.listExperimentsTool(ctx, { limit: 10 } as never);
    expect(listed).toMatchObject({ most_at_once: 0, plan: expect.stringContaining("does not include A/B tests") });
  });

  it("runs one at a time on a plan of one: a second waits as a draft, in the plan's words", async () => {
    await onPlan("one");
    const first = await readyDraft(0);
    const second = await readyDraft(1);
    expect(await admin.startExperiment(account, storeId, first)).toEqual({ ok: true });
    expect(await admin.startExperiment(account, storeId, second)).toEqual({ ok: false, problems: [planFullProblem(1)] });
    expect(await admin.startProblemsOf(storeId, second)).toEqual([planFullProblem(1)]);
    await admin.stopExperiment(account, storeId, first);
    expect(await admin.startExperiment(account, storeId, second)).toEqual({ ok: true });
  });
});

describe("moving to a plan without A/B tests (D148 phase 21)", () => {
  it("keeps the running test and its visitors' versions, and starts no new one, a scheduled one included", async () => {
    await onPlan("many");
    const running = await readyDraft(0);
    expect(await admin.startExperiment(account, storeId, running)).toEqual({ ok: true });
    const later = await readyDraft(1);
    const at = new Date(Date.now() + 5 * 60_000);
    expect(await admin.scheduleExperiment(account, storeId, later, at)).toEqual({ ok: true });

    await onPlan("none");
    engine.forgetRunning(storeId);
    expect((await engine.runningExperiments(storeId)).map((t) => t.id)).toEqual([running]);
    // A visitor who holds version B is still counted in it.
    const visitor = randomUUID();
    jar.set(consentCookieName(storeId), encodeConsent({ visitor, version: "statistics", choices: { preferences: false, statistics: true, marketing: false, recordings: false } }));
    jar.set(dataCookieName(storeId), encodeAssignments({ visitor, versions: { [running]: "b" } }));
    expect(await engine.recordExposure(storeId, running, "b", { market: "no", device: "mobile" })).toBe(true);
    // The scheduled test does not start when its time comes: it goes back to a draft that says why.
    await jobs.runExperimentJobs(new Date(at.getTime() + 60_000));
    const back = (await admin.getExperiment(storeId, later))!;
    expect(back.status).toBe("draft");
    const [row] = await db().execute<Row>(sql`select schedule_problem from commerce.experiments where id = ${later}::uuid`);
    expect(String(row.schedule_problem)).toContain(PLAN_WITHOUT_TESTS);
    // The running test is still decided as before: stopped, with what it counted.
    expect(await admin.stopExperiment(account, storeId, running)).toEqual({ ok: true });
    const [counted] = await db().execute<Row>(sql`select count(*)::int as n from commerce.experiment_exposures where experiment_id = ${running}::uuid`);
    expect(counted.n).toBe(1);
  });
});
