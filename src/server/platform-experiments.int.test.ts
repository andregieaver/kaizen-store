import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { PageContent } from "@/lib/page-content";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const admin = await import("./experiment-admin");
const view = await import("./platform-experiments");

const run = Date.now().toString(36);
let storeId: string;
let account: Account;
let aboutId: string;

/** A running test of the about page: its copy is changed, so the test may start. */
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

/** One running test per page: leave none behind, whatever an earlier test did. */
async function endAll() {
  for (const t of await admin.listExperiments(storeId)) if (t.status === "running") await admin.stopExperiment(account, storeId, t.id);
}

const ours = async (everything = false) => (await view.platformExperiments(everything)).tests.filter((t) => t.storeId === storeId);

beforeAll(async () => {
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`pv-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`pv-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`pv-admin-${run}@example.com`}, 'PV Admin') returning id`);
  account = { id: String(acc.id), email: `pv-admin-${run}@example.com`, name: "PV Admin", platformAdmin: true };
  const [about] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss'`);
  aboutId = String(about.id);
});

beforeEach(endAll);

afterAll(async () => {
  await closeDb();
});

describe("the platform's view of every store's tests (D148, phase 5)", () => {
  it("shows a running test with its store, target, split and verdict, and flags one nobody has seen", async () => {
    const id = await startedTest("Longer story");
    const [fresh] = await ours();
    expect(fresh).toMatchObject({ id, name: "Longer story", status: "running", goal: "orders", versions: 2, exposed: 0 });
    expect(fresh.store.slug).toBe(`pv-${run}`);
    expect(fresh.target).toMatchObject({ type: "page", slug: "om-oss" });
    expect(fresh.split).toEqual([{ key: "a", visitors: 0 }, { key: "b", visitors: 0 }]);
    expect(fresh.headline).toBeTruthy();
    // Just started: nothing to look at.
    expect(fresh.flags).toEqual([]);

    await db().execute(sql`update commerce.experiments set started_at = now() - interval '4 days' where id = ${id}::uuid`);
    const [quiet] = await ours();
    expect(quiet.flags.map((f) => f.kind)).toEqual(["quiet"]);

    // Visitors, evenly divided: the flag goes away and the split is shown.
    await db().execute(sql`
      insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant)
      select ${storeId}::uuid, ${id}::uuid, md5(v.variant || n::text)::uuid::text, v.variant from (values ('a'::text), ('b'::text)) v(variant), generate_series(1, 30) n
    `);
    const [seen] = await ours();
    expect(seen.exposed).toBe(60);
    expect(seen.split).toEqual([{ key: "a", visitors: 30 }, { key: "b", visitors: 30 }]);
    expect(seen.flags).toEqual([]);
    await admin.stopExperiment(account, storeId, id);
  });

  it("lists a stopped test waiting for a decision, a guardrail stop at once, and leaves the decided and the drafts out unless asked", async () => {
    const stopped = await startedTest("Stopped by the guardrail");
    await admin.stopExperiment(null, storeId, stopped, "guardrail");
    const decided = await startedTest("Decided");
    await admin.stopExperiment(account, storeId, decided);
    await admin.discardExperiment(account, storeId, decided);
    const draft = await admin.createExperiment(account, storeId, { name: "A draft", pageId: aboutId, goal: "orders" });
    expect(draft.ok).toBe(true);

    const active = await ours();
    const byName = Object.fromEntries(active.map((t) => [t.name, t]));
    expect(byName["Stopped by the guardrail"]).toMatchObject({ status: "stopped", stopReason: "guardrail" });
    expect(byName["Stopped by the guardrail"].flags.map((f) => f.kind)).toEqual(["undecided"]);
    expect(byName.Decided).toBeUndefined();
    expect(byName["A draft"]).toBeUndefined();

    const all = Object.fromEntries((await ours(true)).map((t) => [t.name, t]));
    expect(all.Decided.status).toBe("discarded");
    expect(all["A draft"].status).toBe("draft");
  }, 30_000);

  it("lists a store's held-out recommendations by tabs, in the engine's words, with the same figures as its own report (phase 7)", async () => {
    const units = await import("./platform-unit-tests");
    const events = await import("./recommend-events");
    const rowOf = async () => (await units.platformUnitTests()).find((r) => r.store?.slug === `pv-${run}`);
    // Not enabled, or nothing counted yet: not listed.
    expect(await rowOf()).toBeUndefined();
    await db().execute(sql`
      insert into commerce.recommendation_settings (store_id, enabled, holdout_percent) values (${storeId}::uuid, true, 20)
      on conflict (store_id) do update set enabled = true, holdout_percent = 20
    `);
    expect(await rowOf()).toBeUndefined();

    // 1,600 tabs got the AI's order and 400 the plain one (the 20 % asked for); 15 % and 8 % of them clicked.
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid limit 1`);
    const tabs = async (arm: "ai" | "baseline", total: number, clickers: number) => {
      const session = sql`md5(${`${run}-${arm}-`} || n::text)::uuid::text`;
      await db().execute(sql`
        insert into commerce.recommendation_events (store_id, session, arm, placement, product_id, event)
        select ${storeId}::uuid, ${session}, ${arm}, 'product', ${String(product.id)}::uuid, 'impression' from generate_series(1, ${total}::int) n
      `);
      await db().execute(sql`
        insert into commerce.recommendation_events (store_id, session, arm, placement, product_id, event)
        select ${storeId}::uuid, ${session}, ${arm}, 'product', ${String(product.id)}::uuid, 'click' from generate_series(1, ${clickers}::int) n
      `);
    };
    await tabs("ai", 1600, 240);
    await tabs("baseline", 400, 32);

    const report = await events.recommendationReport(storeId, 30);
    const row = (await rowOf())!;
    expect(row).toMatchObject({ kind: "recommendations", unit: "tab", status: "running", call: "better", headline: "The AI's order is better than The plain order." });
    expect(row.control.units).toBe(report.arms.find((a) => a.arm === "baseline")!.visitors);
    expect(row.treatment.units).toBe(report.arms.find((a) => a.arm === "ai")!.visitors);
    expect(row.detail).toContain("The AI's order: 15 % of tabs clicked a recommendation; The plain order: 8 %.");
    // The same call the store's own report makes, since both count with the engine's arithmetic.
    expect(report.comparison.clicked.verdict).toBe("a_better");
    expect(row.flags).toEqual([]);

    // A split far from the 20 % asked for is flagged (here the held-out share is set to 5 %).
    await db().execute(sql`update commerce.recommendation_settings set holdout_percent = 5 where store_id = ${storeId}::uuid`);
    expect((await rowOf())!.flags.map((f) => f.kind)).toEqual(["broken"]);
    await db().execute(sql`delete from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
  }, 30_000);

  it("flags a scheduled start that went back to a draft, and counts what it shows", async () => {
    const made = await admin.createExperiment(account, storeId, { name: "Scheduled", pageId: aboutId, goal: "orders" });
    if (!made.ok) throw new Error("not made");
    await db().execute(sql`update commerce.experiments set schedule_problem = 'Publish it first.' where id = ${made.id}::uuid`);
    const found = (await ours()).find((t) => t.id === made.id)!;
    expect(found.status).toBe("draft");
    expect(found.flags.map((f) => f.kind)).toEqual(["schedule"]);
    expect(found.scheduleProblem).toBe("Publish it first.");

    const { overview, tests } = await view.platformExperiments();
    expect(overview.needAttention).toBe(tests.filter((t) => t.flags.length > 0).length);
    expect(overview.running).toBe(tests.filter((t) => t.status === "running").length);
  });
});
