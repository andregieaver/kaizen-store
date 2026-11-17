import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { newPageContent, type PageContent } from "@/lib/page-content";
import { newBlock, newRow } from "@/lib/page-rows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { actingAs } = await import("./actor");
const { newStore } = await import("./inventory-test-support");
const { runOwnerTool } = await import("./owner-tools");
const { decideApproval } = await import("./owner-assistant");
const { saveAutonomy } = await import("./autopilot-settings");
const { autopilotTestsOf } = await import("./autopilot-tests");
const { decideAutopilotTests } = await import("./autopilot-test-decider");
const { watchAutopilotChanges } = await import("./autopilot-watch");
const admin = await import("./experiment-admin");
const pages = await import("./pages");
const stores = await import("./stores");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof newStore>>;

/**
 * The autopilot tests its page changes first (ecosystem plan E4.1, D729), on real stores: on a busy one, a change it would publish itself to a
 * live page becomes an A/B test (the live page the original, its change version B) and the page stays as it was; nothing more is published
 * on the page meanwhile, and its model may not stop the test; the store decides it by its verdict, making the change live within the owner's
 * levels or keeping it for their yes, and keeping the page as it was when the change does worse. On a quiet store, with the setting off, and
 * for a person, the page is published as before.
 */

let busy: TestStore;
let quiet: TestStore;
const PAGES = ["om-test", "kampanje-test", "tilbud-test", "nytt-test", "person-test", "nei-test"];
const ids: Record<string, string> = {};

const ctxOf = async (s: TestStore) => ({ account: s.member.account, store: (await stores.currentStore(s.slug))!, invalidate: () => {}, holder: { role: "owner" as const } });
const asAutopilot = <T>(run: () => Promise<T>) => actingAs("autopilot", run);

/** A page with one heading, published as `heading`. */
function pageWith(slug: string, heading: string): PageContent {
  const content = newPageContent();
  const row = newRow("1", () => `r-${randomUUID().slice(0, 8)}`);
  const block = newBlock("heading", () => `h-${randomUUID().slice(0, 8)}`);
  if (block.type !== "heading") throw new Error("not a heading");
  block.text = heading;
  block.level = 1;
  row.columns[0].blocks.push(block);
  return { ...content, title: heading, slug, rows: [row] };
}

/** The page's draft changed as the autopilot's `edit_page` leaves it: the heading's words, not yet published. */
async function changeDraft(s: TestStore, slug: string, heading: string) {
  const page = await pages.getPageForEdit(s.storeId, ids[`${s.slug}:${slug}`], "page");
  const rows = page!.draft.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: heading } : b)) })) }));
  const saved = await pages.savePage(s.member.account, s.storeId, ids[`${s.slug}:${slug}`], { ...page!.draft, rows }, { publish: false });
  if (!saved.ok) throw new Error(saved.problems.join(" "));
}

const headingOf = (content: unknown) => JSON.stringify((content as PageContent | null)?.rows ?? []).match(/"text":"([^"]*)"/)?.[1] ?? null;

async function pageRow(s: TestStore, slug: string) {
  const [row] = await db().execute<Row>(sql`select draft, published from commerce.pages where id = ${ids[`${s.slug}:${slug}`]}::uuid`);
  return { draft: headingOf(row.draft), live: headingOf(row.published) };
}

async function autopilotTest(s: TestStore, slug: string) {
  const [row] = await db().execute<Row>(sql`
    select t.experiment_id, t.goal, t.days, t.outcome, e.status, e.planned_end, e.started_at from commerce.autopilot_tests t
    join commerce.experiments e on e.id = t.experiment_id where t.store_id = ${s.storeId}::uuid and t.page_id = ${ids[`${s.slug}:${slug}`]}::uuid
    order by t.created_at desc limit 1
  `);
  return row;
}

/** The test has run 16 days and counted its versions: the original's and B's visitors, and how many of each reached checkout. */
async function answered(s: TestStore, experimentId: string, a: number, b: number) {
  await db().execute(sql`update commerce.experiments set started_at = now() - interval '16 days' where id = ${experimentId}::uuid`);
  await db().execute(sql`
    insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, first_seen)
    select ${s.storeId}::uuid, ${experimentId}::uuid, ${`${experimentId.slice(0, 8)}-`} || v.variant || '-' || n, v.variant, now() - interval '15 days'
    from (values ('a'::text, 2400), ('b'::text, 2380)) v(variant, total), generate_series(1, v.total) n
  `);
  await db().execute(sql`
    insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal)
    select ${s.storeId}::uuid, ${experimentId}::uuid, ${`${experimentId.slice(0, 8)}-`} || v.variant || '-' || n, v.variant, 'checkout'
    from (values ('a'::text, ${a}::int), ('b'::text, ${b}::int)) v(variant, total), generate_series(1, v.total) n
  `);
}

beforeAll(async () => {
  // The decider looks at every store's autopilot tests: leave none undecided from earlier runs of this suite.
  await db().execute(sql`update commerce.autopilot_tests set outcome = 'left', decided_at = now() where outcome is null`);
  busy = await newStore("aptest-busy");
  quiet = await newStore("aptest-quiet");
  for (const s of [busy, quiet]) {
    await db().execute(sql`update commerce.stores set status = 'active', visit_counting = true where id = ${s.storeId}::uuid`);
    for (const slug of PAGES) {
      const saved = await pages.savePage(s.member.account, s.storeId, null, pageWith(slug, `${slug} as it is`), { publish: true });
      if (!saved.ok) throw new Error(saved.problems.join(" "));
      ids[`${s.slug}:${slug}`] = saved.id;
    }
    // 25 cookie choices, 15 of them accepting statistics: 60 % take part in a test.
    await db().execute(sql`
      insert into commerce.consents (store_id, visitor, choices, version)
      select ${s.storeId}::uuid, gen_random_uuid(), jsonb_build_object('necessary', true, 'statistics', g <= 15), '1' from generate_series(1, 25) g
    `);
  }
  // The busy store: yesterday 2,000 visits began on each page, one in ten reaching checkout; the quiet store had 20 on each.
  for (const [s, n] of [
    [busy, 2000],
    [quiet, 20],
  ] as const) {
    for (const slug of PAGES) {
      await db().execute(sql`
        insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path, checkout_at, first_seen, last_seen)
        select ${s.storeId}::uuid, (now() - interval '1 day')::date, substr(md5(random()::text || g::text), 1, 24), 'NO', 'mobile', 'direct', ${`/no/${slug}`},
          case when g % 10 = 0 then now() - interval '1 day' end, now() - interval '1 day', now() - interval '1 day'
        from generate_series(1, ${n}) g
      `);
    }
  }
});

afterAll(async () => {
  await closeDb();
});

describe("the autopilot's change to a live page (E4.1)", () => {
  it("becomes an A/B test on a busy page: the live page the original, the change version B, the page as it was", async () => {
    await changeDraft(busy, "om-test", "A new promise");
    const ctx = await ctxOf(busy);
    const answer = (await asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "om-test", type: "page" }))) as { done: string; tested: string; ab_test: string };
    expect(answer.done).toContain("Not published yet");
    expect(answer.tested).toContain("Started an A/B test");
    const t = await autopilotTest(busy, "om-test");
    // Only checkout is counted in the store's funnel: two weeks answer a change of a fifth at 1,200 visitors a day who take part.
    expect(t).toMatchObject({ goal: "checkout", days: 14, outcome: null, status: "running" });
    expect(answer.ab_test).toBe(`/admin/${busy.slug}/experiments/${String(t.experiment_id)}`);
    const planned = Date.parse(String(t.planned_end)) - Date.parse(String(t.started_at));
    expect(Math.round(planned / 86_400_000)).toBe(14);
    const test = (await admin.getExperiment(busy.storeId, String(t.experiment_id)))!;
    expect(test).toMatchObject({ byAutopilot: true, goal: "checkout", trafficShare: 1 });
    expect(test.name).toBe("The autopilot's change to om-test as it is");
    // Version B is the change, published for its visitors; the page is still what it was, its draft back to what is live.
    const [b] = await db().execute<Row>(sql`select published from commerce.pages where id = ${test.variants.find((v) => v.key === "b")!.pageId}::uuid`);
    expect(headingOf(b.published)).toBe("A new promise");
    expect(await pageRow(busy, "om-test")).toEqual({ draft: "om-test as it is", live: "om-test as it is" });
    // The owner reads it on the Autopilot page.
    const shown = await autopilotTestsOf(busy.storeId);
    expect(shown.find((x) => x.experimentId === test.id)).toMatchObject({ page: "om-test as it is", state: "testing", daysLeft: 14 });
  });

  it("stacks nothing on a page under test, and its model may not stop or decide the test", async () => {
    const ctx = await ctxOf(busy);
    const t = await autopilotTest(busy, "om-test");
    await changeDraft(busy, "om-test", "Another promise");
    await expect(asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "om-test", type: "page" }))).rejects.toThrow(/tries an earlier change of the autopilot's/);
    await expect(asAutopilot(() => runOwnerTool(ctx, "stop_experiment", { experiment: String(t.experiment_id) }))).rejects.toThrow(/the autopilot's own test/);
    await expect(asAutopilot(() => runOwnerTool(ctx, "apply_winner", { experiment: String(t.experiment_id), version: "b" }))).rejects.toThrow(/the autopilot's own test/);
    // The database holds one undecided autopilot test a page.
    const draft = await admin.createExperiment(busy.member.account, busy.storeId, { name: "Another", pageId: ids[`${busy.slug}:om-test`], goal: "checkout" });
    if (!draft.ok) throw new Error(draft.problems.join(" "));
    await expect(
      db().execute(sql`
        insert into commerce.autopilot_tests (store_id, experiment_id, page_id, account_id, goal, days)
        values (${busy.storeId}::uuid, ${draft.id}::uuid, ${ids[`${busy.slug}:om-test`]}::uuid, ${busy.accountId}::uuid, 'checkout', 14)
      `),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/autopilot_tests.one_per_page/) } });
    await admin.deleteDraft(busy.member.account, busy.storeId, draft.id);
    expect((await autopilotTest(busy, "om-test")).status).toBe("running");
  });

  it("is published as before on a quiet page, with the setting off, and for a person", async () => {
    const quietCtx = await ctxOf(quiet);
    await changeDraft(quiet, "om-test", "Quiet change");
    const done = (await asAutopilot(() => runOwnerTool(quietCtx, "publish_page", { page: "om-test", type: "page" }))) as { done: string };
    expect(done.done).toContain("is published");
    expect(await pageRow(quiet, "om-test")).toEqual({ draft: "Quiet change", live: "Quiet change" });
    expect(await autopilotTest(quiet, "om-test")).toBeUndefined();

    const ctx = await ctxOf(busy);
    await saveAutonomy(ctx, { planning: { testsPageChanges: false } });
    await changeDraft(busy, "tilbud-test", "Off change");
    await asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "tilbud-test", type: "page" }));
    expect(await pageRow(busy, "tilbud-test")).toEqual({ draft: "Off change", live: "Off change" });
    await saveAutonomy(ctx, {});

    await changeDraft(busy, "person-test", "The owner's change");
    await runOwnerTool(ctx, "publish_page", { page: "person-test", type: "page" });
    expect(await pageRow(busy, "person-test")).toEqual({ draft: "The owner's change", live: "The owner's change" });
    expect(await autopilotTest(busy, "person-test")).toBeUndefined();
  });

  it("is not watched as a publish: the test's guardrails watch it", async () => {
    const run = await watchAutopilotChanges({ now: new Date(Date.now() + 7 * 3_600_000), everyRun: true });
    expect(run.judged).toBeGreaterThan(0);
    const [watched] = await db().execute<Row>(sql`
      select w.details from commerce.audit_log w join commerce.audit_log a on w.details ->> 'change' = a.id::text
      where w.store_id = ${busy.storeId}::uuid and w.action = 'ai.change_watched' and a.action = 'store.assistant.publish_page'
      order by a.created_at limit 1
    `);
    expect(watched.details).toMatchObject({ verdict: "not_watched", tool: "publish_page" });
    expect(String((watched.details as { words: string }).words)).toContain("A/B test");
  });
});

describe("the store decides the autopilot's test (E4.1)", () => {
  it("waits while the test has no answer", async () => {
    const run = await decideAutopilotTests({ everyRun: true });
    expect(run.waiting).toBeGreaterThan(0);
    expect((await autopilotTest(busy, "om-test")).outcome).toBeNull();
  });

  it("keeps the winner for the owner's yes at Ask me first, and makes it live on their yes", async () => {
    const t = await autopilotTest(busy, "om-test");
    // 2,400 and 2,380 visitors; 218 and 279 reached checkout: the change is better.
    await answered(busy, String(t.experiment_id), 218, 279);
    await decideAutopilotTests({ everyRun: true });
    const after = await autopilotTest(busy, "om-test");
    expect(after).toMatchObject({ outcome: "asked", status: "running" });
    expect(await pageRow(busy, "om-test")).toMatchObject({ live: "om-test as it is" });
    const [approval] = await db().execute<Row>(sql`
      select id, tool, status from commerce.assistant_approvals where store_id = ${busy.storeId}::uuid and tool = 'apply_winner' and args ->> 'experiment' = ${String(t.experiment_id)}
    `);
    expect(approval).toMatchObject({ tool: "apply_winner", status: "pending" });
    expect((await autopilotTestsOf(busy.storeId)).find((x) => x.experimentId === String(t.experiment_id))?.state).toBe("waiting");
    // Decided once: the next run asks nothing more.
    await decideAutopilotTests({ everyRun: true });
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.assistant_approvals where store_id = ${busy.storeId}::uuid and tool = 'apply_winner'`);
    expect(Number(n)).toBe(1);
    // The owner's yes: the change is the page.
    const decided = await decideApproval(busy.member, String(approval.id), true, () => {});
    expect(decided?.status).toBe("done");
    expect(await pageRow(busy, "om-test")).toEqual({ draft: "A new promise", live: "A new promise" });
    expect((await autopilotTestsOf(busy.storeId)).find((x) => x.experimentId === String(t.experiment_id))?.state).toBe("live");
  });

  it("keeps the page as it was when the owner says no to the winner", async () => {
    const ctx = await ctxOf(busy);
    await changeDraft(busy, "nei-test", "A change the owner does not want");
    await asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "nei-test", type: "page" }));
    const t = await autopilotTest(busy, "nei-test");
    await answered(busy, String(t.experiment_id), 218, 279);
    await decideAutopilotTests({ everyRun: true });
    const [approval] = await db().execute<Row>(sql`
      select id, conversation_id from commerce.assistant_approvals where store_id = ${busy.storeId}::uuid and tool = 'apply_winner' and args ->> 'experiment' = ${String(t.experiment_id)}
    `);
    // The same conversation as the first question's: one a store and person.
    const [{ n: conversations }] = await db().execute<Row>(sql`
      select count(distinct conversation_id)::int as n from commerce.autopilot_tests where store_id = ${busy.storeId}::uuid and conversation_id is not null
    `);
    expect(Number(conversations)).toBe(1);
    await decideApproval(busy.member, String(approval.id), false, () => {});
    const run = await decideAutopilotTests({ everyRun: true });
    expect(run.kept).toBe(1);
    expect(await autopilotTest(busy, "nei-test")).toMatchObject({ outcome: "kept", status: "discarded" });
    expect(await pageRow(busy, "nei-test")).toEqual({ draft: "nei-test as it is", live: "nei-test as it is" });
  });

  it("makes the winner live itself where the owner lets it act on the website", async () => {
    const ctx = await ctxOf(busy);
    await saveAutonomy(ctx, { levels: { website: "auto" } });
    await changeDraft(busy, "kampanje-test", "A bolder offer");
    await asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "kampanje-test", type: "page" }));
    const t = await autopilotTest(busy, "kampanje-test");
    expect(t.status).toBe("running");
    await answered(busy, String(t.experiment_id), 218, 279);
    const run = await decideAutopilotTests({ everyRun: true });
    expect(run.applied).toBe(1);
    expect(await autopilotTest(busy, "kampanje-test")).toMatchObject({ outcome: "applied", status: "applied" });
    expect(await pageRow(busy, "kampanje-test")).toEqual({ draft: "A bolder offer", live: "A bolder offer" });
    const [audited] = await db().execute<Row>(sql`
      select acted_by from commerce.audit_log where store_id = ${busy.storeId}::uuid and action = 'store.assistant.apply_winner' order by created_at desc limit 1
    `);
    expect(audited.acted_by).toBe("autopilot");
  });

  it("keeps the page as it was when the change does worse", async () => {
    const ctx = await ctxOf(busy);
    await changeDraft(busy, "nytt-test", "A worse heading");
    await asAutopilot(() => runOwnerTool(ctx, "publish_page", { page: "nytt-test", type: "page" }));
    const t = await autopilotTest(busy, "nytt-test");
    await answered(busy, String(t.experiment_id), 279, 218);
    const run = await decideAutopilotTests({ everyRun: true });
    expect(run.kept).toBe(1);
    expect(await autopilotTest(busy, "nytt-test")).toMatchObject({ outcome: "kept", status: "discarded" });
    expect(await pageRow(busy, "nytt-test")).toEqual({ draft: "nytt-test as it is", live: "nytt-test as it is" });
    expect((await autopilotTestsOf(busy.storeId)).find((x) => x.experimentId === String(t.experiment_id))?.state).toBe("kept");
  });
});
