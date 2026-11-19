import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import {
  AUTOPILOT_TEST_OUTCOMES,
  chooseTest,
  DECIDED_SHOWN_DAYS,
  daysLeft,
  testState,
  type NotTested,
  type TestChoice,
  type TestState,
} from "@/lib/autopilot-tests";
import { EXPERIMENT_STATUSES } from "@/lib/experiments";
import type { PageContent } from "@/lib/page-content";

import type { Account } from "./auth";
import { autonomyFor } from "./autopilot-settings";
import { createExperiment, deleteDraft, getExperiment, publishedContentOf, runningTestOf, startExperiment, testablePages, testRoom } from "./experiment-admin";
import { experimentTraffic } from "./experiment-traffic";
import { log } from "./log";
import { OwnerToolError } from "./owner-tool-error";
import { savePage } from "./pages";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { experimentsEn } from "@/lib/admin-messages/experiments.en";

/**
 * The autopilot tests its page changes first (ecosystem plan E4.1, D729, `src/lib/autopilot-tests.ts`): when it would publish a change to a
 * live page itself (`publish_page` run as the autopilot, never on a person's yes) and the page's visitors would answer an A/B test within
 * three weeks, the change becomes version B of an ordinary test of the page, the live page its original, the store's guardrails as on every
 * test, and the page's draft goes back to what is live (the change is kept in version B and in the page's versions, D305). Where traffic is too
 * low, the store runs as many tests as it may, the page is one tests cannot cover, or the owner switched it off, the page is published as
 * before and the watch (D628) guards it. One undecided autopilot test per page (the database holds it); a running test refuses any publish of
 * its page. The only writer of `commerce.autopilot_tests` besides the decider (`src/server/autopilot-test-decider.ts`).
 */

/** What became of a publish the autopilot asked for: a test it started, or why it publishes as before. */
export type PublishTest = { started: TestChoice & { experimentId: string; name: string } } | { notTested: NotTested };

/** A page as `publish_page` read it: its id, its draft and whether what is live differs from the draft. */
type PageToPublish = { id: string; state: "draft" | "published" | "changed"; draft: PageContent };

/** The store decides an autopilot test by code (the decider): only then may a stop or a winner of it run as the autopilot. */
const deciding = new AsyncLocalStorage<true>();
export const asTheStoresDecision = <T>(run: () => Promise<T>): Promise<T> => deciding.run(true, run);
export const decidingAutopilotTest = (): boolean => deciding.getStore() === true;

/** Whether a test is one the autopilot started to try its own change. */
export async function isAutopilotTest(storeId: string, experimentId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(experimentId)) return false;
  const row = await typedRow(
    z.object({ yes: col.bool }),
    sql`select exists (select 1 from commerce.autopilot_tests where store_id = ${storeId}::uuid and experiment_id = ${experimentId}::uuid) as yes`,
  );
  return row?.yes === true;
}

/**
 * Starts a test of the autopilot's change instead of publishing it, where the store's traffic answers one soon enough; otherwise says why not,
 * and the caller publishes as before. Called by `publish_page` after its own checks (a page in a running test, a blocking accessibility issue).
 */
export async function testInsteadOfPublishing(a: { account: Account; store: Store }, page: PageToPublish, now = new Date()): Promise<PublishTest> {
  const settings = await autonomyFor(a.store.id, now);
  if (!settings.planning.testsPageChanges) return { notTested: "off" };
  // Only a change to a page that is live: a new page has nothing to test against, and a page whose draft is what is live changes nothing.
  if (page.state !== "changed") return { notTested: "not_live" };
  const target = (await testablePages(a.store.id)).find((t) => t.id === page.id);
  if (!target || target.partOnly || (target.kind !== "page" && target.kind !== "role")) return { notTested: "not_testable" };
  const room = await testRoom(a.store.id);
  if (room.allows === 0 || room.running >= room.allows) return { notTested: "no_room" };
  const choice = chooseTest(await experimentTraffic(a.store, [target], now), target.id, experimentsEn);
  if ("none" in choice) return { notTested: choice.none };
  const original = await publishedContentOf(a.store.id, page.id);
  if (!original) return { notTested: "not_live" };

  // The test's name in the admin language of whoever the autopilot works for: the test is theirs to read.
  const w = EXPERIMENTS_WORDS[adminLangOf(a.account.adminLocale ?? null)].autopilot;
  const title = original.title?.trim() || target.title;
  const name = fillWords(w.name, { page: title }).slice(0, 120);
  const made = await createExperiment(a.account, a.store.id, {
    name,
    pageId: page.id,
    goal: choice.goal,
    trafficShare: 1,
    plannedEnd: new Date(now.getTime() + choice.days * 86_400_000),
  });
  if (!made.ok) {
    log("warn", "autopilot.test_not_made", { storeId: a.store.id, pageId: page.id, problems: made.problems.length });
    return { notTested: "not_testable" };
  }
  const given = async (why: string): Promise<PublishTest> => {
    log("warn", "autopilot.test_not_started", { storeId: a.store.id, pageId: page.id, why });
    await deleteDraft(a.account, a.store.id, made.id);
    // Someone started a test of the page meanwhile: publishing now would spoil it, as `publish_page` refuses.
    const running = await runningTestOf(a.store.id, page.id);
    if (running) throw new OwnerToolError(`This page is now in the running A/B test "${running.name}". Publishing a change now would spoil its results.`);
    return { notTested: "not_testable" };
  };
  // Version B is the autopilot's change: the page's draft, under the version's own address and name.
  const test = await getExperiment(a.store.id, made.id);
  const b = test?.variants.find((v) => v.key === "b");
  const copy = b?.pageId ? await publishedContentOf(a.store.id, b.pageId) : null;
  if (!b?.pageId || !copy) return given("no_version");
  const version = await savePage(a.account, a.store.id, b.pageId, { ...page.draft, slug: copy.slug, title: copy.title }, { publish: true, type: "variant", variantOf: "page" });
  if (!version.ok) return given("version_not_saved");
  // Kept before the start, so a second change to the page under test is refused by the database (one undecided autopilot test a page).
  try {
    await db().execute(sql`
      insert into commerce.autopilot_tests (store_id, experiment_id, page_id, account_id, goal, days)
      values (${a.store.id}::uuid, ${made.id}::uuid, ${page.id}::uuid, ${a.account.id}::uuid, ${choice.goal}, ${choice.days})
    `);
  } catch (error) {
    log("warn", "autopilot.test_not_kept", { storeId: a.store.id, pageId: page.id }, error);
    return given("not_kept");
  }
  const started = await startExperiment(a.account, a.store.id, made.id);
  if (!started.ok) return given("not_started");
  // The page's draft goes back to what is live: the change is version B now, and nothing of it waits to be published over the test.
  const reset = await savePage(a.account, a.store.id, page.id, original, { publish: false, type: "page" });
  if (!reset.ok) log("warn", "autopilot.test_draft_not_reset", { storeId: a.store.id, pageId: page.id });
  log("info", "autopilot.change_tested", { storeId: a.store.id, experimentId: made.id, goal: choice.goal, days: choice.days });
  return { started: { ...choice, experimentId: made.id, name } };
}

const TEST_ROW = z.object({
  experiment_id: col.uuid,
  page: col.text,
  status: z.enum(EXPERIMENT_STATUSES),
  applied_variant: col.textOrNull,
  planned_end: col.timestamp.nullable(),
  outcome: z.enum(AUTOPILOT_TEST_OUTCOMES).nullable(),
  days: col.int,
  created_at: col.timestamp,
});

/** One of the autopilot's tests as its page and report say it: the page, what state it is in and, while it runs, about how many days are left. */
export type AutopilotTest = { experimentId: string; page: string; state: TestState; daysLeft: number | null; at: string };

/**
 * The store's autopilot tests to show: each still running or waiting for a yes, and those decided in the last `DECIDED_SHOWN_DAYS`, newest
 * first. The page is named by its live title, else its address.
 */
export async function autopilotTestsOf(storeId: string, options: { now?: Date; limit?: number; accountId?: string } = {}): Promise<AutopilotTest[]> {
  const now = options.now ?? new Date();
  const rows = await typedRows(
    TEST_ROW,
    sql`
      select t.experiment_id, coalesce(nullif(p.published ->> 'title', ''), p.slug) as page, e.status, e.applied_variant, e.planned_end, t.outcome, t.days, t.created_at
      from commerce.autopilot_tests t
      join commerce.experiments e on e.store_id = t.store_id and e.id = t.experiment_id
      join commerce.pages p on p.store_id = t.store_id and p.id = t.page_id
      where t.store_id = ${storeId}::uuid ${options.accountId ? sql`and t.account_id = ${options.accountId}::uuid` : sql``}
        and (t.outcome is null or t.outcome = 'asked' or t.decided_at > ${now.toISOString()}::timestamptz - make_interval(days => ${DECIDED_SHOWN_DAYS}))
        and e.status <> 'draft'
      order by t.created_at desc
      limit ${options.limit ?? 10}
    `,
  );
  return rows.map((r) => {
    const state = testState(r.status, r.applied_variant, r.outcome);
    return { experimentId: r.experiment_id, page: r.page, state, daysLeft: state === "testing" ? daysLeft(r.planned_end, now, r.days) : null, at: r.created_at };
  });
}
