import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { PageContent } from "@/lib/page-content";

import type { Account } from "./auth";

type Row = Record<string, unknown>;
/** What a tool answers, read loosely by the tests (the tools' own answers are plain JSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const admin = await import("./experiment-admin");
const managerTools = await import("./manager-tools");
const searchTest = await import("./search-experiment");

const run = Date.now().toString(36);
let storeId: string;
let storeSlug: string;
let account: Account;
let aboutId: string;

const ctx = (who: Account) => ({ account: who, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: () => {} }) as unknown as Parameters<typeof managerTools.runPlatformTool>[0];
const tool = async (name: string, input: unknown, who = account) => (await managerTools.runPlatformTool(ctx(who), name, input)) as Answer;

async function startedTest(name: string): Promise<string> {
  const made = await admin.createExperiment(account, storeId, { name, pageId: aboutId, goal: "orders" });
  if (!made.ok) throw new Error(made.problems.join(" "));
  const test = (await admin.getExperiment(storeId, made.id))!;
  const pageId = test.variants.find((v) => v.key === "b")!.pageId!;
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid`);
  const content = row.published as PageContent;
  const rows = content.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: `${b.text} (new)` } : b)) })) }));
  const next = JSON.stringify({ ...content, rows });
  await db().execute(sql`update commerce.pages set draft = ${next}::jsonb, published = ${next}::jsonb where id = ${pageId}::uuid`);
  const started = await admin.startExperiment(account, storeId, made.id);
  if (!started.ok) throw new Error(started.problems.join(" "));
  return made.id;
}

async function endAll() {
  for (const t of await admin.listExperiments(storeId)) if (t.status === "running") await admin.stopExperiment(account, storeId, t.id);
}

beforeAll(async () => {
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`pt-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`pt-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  storeSlug = `pt-${run}`;
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`pt-admin-${run}@example.com`}, 'PT Admin') returning id`);
  account = { id: String(acc.id), email: `pt-admin-${run}@example.com`, name: "PT Admin", platformAdmin: true };
  const [about] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss'`);
  aboutId = String(about.id);
});

beforeEach(endAll);

afterAll(async () => {
  await searchTest.stopExperiment(account.id);
  await closeDb();
});

describe("the platform AI manager's A/B tools (D148, phase 8)", () => {
  it("lists every store's tests with what needs a look first, and filters by store and by trouble", async () => {
    const id = await startedTest("Longer story");
    const fresh = await tool("list_ab_tests", { store: storeSlug });
    const mine = (r: Answer) => (r.tests as Answer[]).find((t) => t.id === id);
    expect(mine(fresh)).toMatchObject({ store: storeSlug, name: "Longer story", status: "Running", improves: expect.any(String), versions: 2, visitors_counted: 0 });
    expect(mine(fresh)!.needs_a_look).toBeUndefined();
    expect(fresh.overview.running).toBeGreaterThanOrEqual(1);
    expect(fresh.admin).toBe("/admin/platform/experiments");
    expect(fresh.note).toMatch(/cannot start, stop or change/);

    // Four days with nobody counted: it needs a look, and the filter finds it.
    await db().execute(sql`update commerce.experiments set started_at = now() - interval '4 days' where id = ${id}::uuid`);
    const quiet = await tool("list_ab_tests", { needs_attention: true, store: storeSlug });
    expect(mine(quiet)!.needs_a_look).toEqual(["Nobody has seen it in 4 days."]);
    expect((quiet.tests as Answer[]).every((t) => t.needs_a_look)).toBe(true);
    expect(quiet.overview.need_a_look).toBeGreaterThanOrEqual(1);

    // One store's, and a store without any.
    // Without a store the list is every store's, worst first, up to the limit.
    const every = await tool("list_ab_tests", { limit: 50 });
    expect(every.shown).toBe((every.tests as unknown[]).length);
    expect(every.of).toBeGreaterThanOrEqual(every.shown);
    const flagged = (every.tests as Answer[]).map((t) => Boolean(t.needs_a_look));
    expect(flagged).toEqual([...flagged].sort((a, b) => Number(b) - Number(a)));
    const demo = await tool("list_ab_tests", { store: "demo" });
    expect((demo.tests as Answer[]).some((t) => t.store === storeSlug)).toBe(false);
    await expect(tool("list_ab_tests", { store: "no-such-store-here" })).rejects.toThrow("No store at no-such-store-here");
  });

  it("explains a store's test with the owner's figures and verdict, and says what to tell the owner instead of what to press", async () => {
    const id = await startedTest("Explained");
    const said = await tool("explain_ab_test", { test: id });
    expect(said.store).toBe(storeSlug);
    expect(said.test).toMatchObject({ id, name: "Explained", status: "Running" });
    expect(said.verdict.kind).toMatch(/few|early/);
    expect(said.versions).toHaveLength(2);
    expect(said.split_between_versions).toBe("As promised.");
    expect(said.what_next).toEqual(["Nothing to do: it cannot say anything before its minimum visitors and days. Do not read anything into the figures yet."]);
    expect(said.admin).toBe("/admin/platform/experiments");
    // None of the owner's buttons are offered to the platform, and no link into the store's own admin.
    const everything = JSON.stringify(said);
    for (const owner of ["apply_winner", "start_experiment", "stop_experiment"]) expect(everything, owner).not.toContain(owner);
    expect(everything).not.toContain(`/admin/${storeSlug}/`);

    // A stopped one says who stopped it and that it waits for the owner.
    await admin.stopExperiment(null, storeId, id, "guardrail");
    const stopped = await tool("explain_ab_test", { test: id });
    expect(stopped.test.stop_reason).toContain("selling less");
    expect(stopped.what_next.join(" ")).toContain("owners were emailed");
  });

  it("says a test that has not started has no results yet, and what a scheduled one is waiting for", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Not yet", pageId: aboutId, goal: "orders" });
    if (!made.ok) throw new Error("not made");
    const said = await tool("explain_ab_test", { test: made.id });
    expect(said).toMatchObject({ store: storeSlug, results: "None yet: the test has not started." });
    expect(said.what_next[0]).toContain("Not started");
  });

  it("explains the search test and a store's recommendations in the engine's words", async () => {
    await searchTest.stopExperiment(account.id);
    expect(await searchTest.startExperiment(account.id, 0.5)).toEqual({ ok: true });
    const running = (await searchTest.runningExperiment())!;
    const listed = await tool("list_ab_tests", {});
    expect((listed.tests_that_run_on_their_own as Answer[]).find((t) => t.id === running.id)).toMatchObject({ what: "Search: keyword or hybrid", store: "every store" });
    const said = await tool("explain_ab_test", { test: running.id });
    expect(said).toMatchObject({ status: "Running", verdict: { headline: "Too early to say." } });
    expect(said.how_it_is_counted).toContain("no cookie");
    expect(said.also.headline).toBeTruthy();

    // A store's held-out recommendations: by the id the list gives, once it has tabs.
    await db().execute(sql`insert into commerce.recommendation_settings (store_id, enabled, holdout_percent) values (${storeId}::uuid, true, 20) on conflict (store_id) do update set enabled = true, holdout_percent = 20`);
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid limit 1`);
    for (const [arm, total] of [["ai", 40], ["baseline", 10]] as const) {
      await db().execute(sql`
        insert into commerce.recommendation_events (store_id, session, arm, placement, product_id, event)
        select ${storeId}::uuid, md5(${`${run}-${arm}-`} || n::text)::uuid::text, ${arm}, 'product', ${String(product.id)}::uuid, 'impression' from generate_series(1, ${total}::int) n
      `);
    }
    const id = `recommendations:${storeId}`;
    const recs = await tool("explain_ab_test", { test: id });
    expect(recs.test).toMatchObject({ id, store: storeSlug });
    expect(recs.verdict.headline).toBe("Too early to say.");
    expect(recs.also.detail).toContain("put a recommended product in the cart");
    expect(recs.how_it_is_counted).toContain("Tabs");
    await db().execute(sql`delete from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
  }, 30_000);

  it("refuses an id that is no test, and anyone who is not a platform admin", async () => {
    await expect(tool("explain_ab_test", { test: randomUUID() })).rejects.toThrow("No A/B test");
    await expect(tool("explain_ab_test", { test: "recommendations:not-an-id" })).rejects.toThrow("No A/B test");
    await expect(tool("explain_ab_test", { test: "something-else-entirely" })).rejects.toThrow("No A/B test");
    const other = { ...account, platformAdmin: false };
    await expect(tool("list_ab_tests", {}, other)).rejects.toThrow("Only platform admins");
    await expect(tool("explain_ab_test", { test: randomUUID() }, other)).rejects.toThrow("Only platform admins");
  });
});
