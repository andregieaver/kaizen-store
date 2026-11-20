import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { isTestedPlace, targetKindOf, testToken, TESTED_PLACES, type TargetKind, type TestedPlace } from "@/lib/ab-site";
import { experimentsTag, pageTag } from "@/lib/cache-tags";
import { isUuid, type Goal } from "@/lib/experiments";
import { parsePageContent, type PageContent } from "@/lib/page-content";

import { withPageAlts } from "./media-alts";
import { col, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * The storefront's reads of a store's running A/B tests (D148, docs/ab-testing.md): moved here from `experiments.ts`, which keeps the
 * assignment, exposure and event writers and imports nothing from here, so a page that only reads its tests imports no writer and a
 * route that only writes reaches no cached read (bloat review step 2.24). A reader: the database client, typed-rows, the media
 * library's alt texts, the tag leaf and pure src/lib code, never a writer, auth or an action file.
 */

/** The slug of a variant's page (type `variant`, which has no address on the site): a key, not a place. */
export const variantSlug = (experimentId: string, key: string) => `ab-${experimentId.slice(0, 8)}-${key}`;

export type PageExperiment = {
  id: string;
  goal: Goal;
  goalBlock: string | null;
  variants: { key: string; slug: string | null }[];
};

/** A store's running test as `runningTests()` reads it: the page under test (null once it is gone), its place, its goal and its versions. */
export type RunningTest = {
  id: string;
  targetPageId: string;
  /** The type of the page under test; null when the page is gone (the test still runs). */
  targetType: string | null;
  /** The page's place (`commerce.page_place()`): a working page, the front page, the All products page, or none. */
  targetRole: string | null;
  primaryGoal: string;
  goalParams: unknown;
  /** Every version, by letter: `pageId` is null for the original. */
  variants: { key: string; pageId: string | null }[];
};

const RUNNING_TEST = z.object({
  id: col.uuid,
  target_page_id: col.uuid,
  target_type: col.textOrNull,
  target_role: col.textOrNull,
  primary_goal: col.text,
  goal_params: z.unknown(),
  variants: z.array(z.object({ key: col.text, pageId: col.uuid.nullable() })),
});

/**
 * Every running test of a store, in one statement (bloat review step 2.18): the storefront's questions about running tests
 * (`experimentOfPage()`, `pageGoalTests()`, `storeHasExperiments()`, `siteTests()`, `runningExperimentIds()`) are filters over this one
 * cached read. Every read of running tests also asks `commerce.extension_on(store, 'ab_testing')` (D748). A test whose page is gone still
 * counts as running, as it did for the questions that never read the page.
 */
export async function runningTests(storeId: string): Promise<RunningTest[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId));
  const rows = await typedRows(
    RUNNING_TEST,
    sql`
      select e.id, e.target_page_id, p.type as target_type, commerce.page_place(e.store_id, e.target_page_id) as target_role, e.primary_goal, e.goal_params,
        coalesce((select jsonb_agg(jsonb_build_object('key', v.key, 'pageId', v.page_id) order by v.key)
          from commerce.experiment_variants v where v.experiment_id = e.id), '[]'::jsonb) as variants
      from commerce.experiments e
      left join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
      where e.store_id = ${storeId}::uuid and e.status = 'running' and commerce.extension_on(e.store_id, 'ab_testing')
      order by e.id
    `,
    readDb(),
  );
  return rows.map((r) => ({
    id: r.id,
    targetPageId: r.target_page_id,
    targetType: r.target_type,
    targetRole: r.target_role,
    primaryGoal: r.primary_goal,
    goalParams: r.goal_params,
    variants: r.variants,
  }));
}

/** The block a test's goal counts, if it counts one. */
const goalBlockOf = (params: unknown): string | null =>
  typeof (params as { block?: unknown } | null)?.block === "string" ? String((params as { block: string }).block) : null;

/**
 * The running test on a page, for drawing the page: a marker that tells the browser which version this is, and the
 * variants' pages to read. Cached with the store's tests, so a page without one stays as static as it was: a filter over
 * `runningTests()`.
 */
export async function experimentOfPage(storeId: string, pageId: string): Promise<PageExperiment | null> {
  // The test of a page with a place of its own (a working page, the front page, the All products page) is served from its route
  // (placeVersionFor()), not from the page's address: not found here.
  const test = (await runningTests(storeId)).find((t) => t.targetPageId === pageId && t.targetRole === null);
  if (!test) return null;
  const id = test.id;
  return {
    id,
    goal: test.primaryGoal as Goal,
    goalBlock: goalBlockOf(test.goalParams),
    variants: test.variants.map((v) => ({ key: v.key, slug: v.pageId !== null ? variantSlug(id, v.key) : null })),
  };
}

/**
 * The running tests whose goal is going on to this page (D148 phase 20), by id: the page draws a marker for them (`AbPageGoal`). Cached with the
 * store's tests, so a page no test counts stays as static as it was: a filter over `runningTests()`.
 */
export async function pageGoalTests(storeId: string, pageId: string): Promise<string[]> {
  if (!isUuid(pageId)) return [];
  return (await runningTests(storeId))
    .filter((t) => t.primaryGoal === "page" && (t.goalParams as { page?: unknown } | null)?.page === pageId)
    .map((t) => t.id);
}

/** Whether a store has a running test: the cookie banner and the assignment script are there only then. Cached with the tests: a filter over `runningTests()`. */
export async function storeHasExperiments(storeId: string): Promise<boolean> {
  return (await runningTests(storeId)).length > 0;
}

/** A running test of something every page shows (the header, the footer, or the product layout) or of a working page, as the pages that draw it need it. */
export type SiteTest = {
  id: string;
  /** The test's short name in an address (`testToken()`). */
  token: string;
  kind: Exclude<TargetKind, "page">;
  /** The working page under test, for a test of one (phase 9). */
  role: TestedPlace | null;
  targetPageId: string;
  goalBlock: string | null;
  /** The version pages, by letter. */
  versions: { key: string; pageId: string }[];
};

/**
 * The store's running tests of its header, footer or product layout. Cached with the tests: a store without one draws its pages as it always
 * did. A filter over `runningTests()`.
 */
export async function siteTests(storeId: string): Promise<SiteTest[]> {
  const places: readonly string[] = TESTED_PLACES;
  return (await runningTests(storeId)).flatMap((t): SiteTest[] => {
    if (t.targetType === null) return [];
    if (!(["header", "footer", "product_layout"].includes(t.targetType) || (t.targetRole !== null && places.includes(t.targetRole)))) return [];
    const kind = targetKindOf(t.targetType, t.targetRole);
    if (!kind || kind === "page") return [];
    return [
      {
        id: t.id,
        token: testToken(t.id),
        kind,
        role: isTestedPlace(t.targetRole) ? t.targetRole : null,
        targetPageId: t.targetPageId,
        goalBlock: goalBlockOf(t.goalParams),
        versions: t.variants.flatMap((v) => (v.pageId !== null ? [{ key: v.key, pageId: v.pageId }] : [])),
      },
    ];
  });
}

/**
 * The content of a version of the header, footer or product layout under test, as last published, with the original's
 * header overlay (the pages decide how to lie under a header from the original's, so a version keeps its look). Null while
 * the version is not published. Cached with the pages and the tests.
 */
export async function siteVersionContent(storeId: string, testId: string, key: string): Promise<{ id: string; content: PageContent } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId), `pages:${storeId}`);
  const [row] = await readDb().execute<Row>(sql`
    select v.page_id, vp.published as version, tp.published as original
    from commerce.experiment_variants v
    join commerce.experiments e on e.id = v.experiment_id and e.store_id = v.store_id
    join commerce.pages vp on vp.id = v.page_id and vp.store_id = v.store_id and vp.type = 'variant' and vp.published_at is not null
    join commerce.pages tp on tp.id = e.target_page_id and tp.store_id = e.store_id
    where v.store_id = ${storeId}::uuid and v.experiment_id = ${testId}::uuid and v.key = ${key} and e.status = 'running'
  `);
  if (row) cacheTag(pageTag(String(row.page_id)));
  const content = row ? parsePageContent(row.version) : null;
  if (!row || !content) return null;
  const original = parsePageContent(row.original);
  const [layout] = await withPageAlts([{ id: String(row.page_id), content: original?.overlay ? { ...content, overlay: original.overlay } : { ...content, overlay: undefined } }]);
  return layout;
}

/** The ids of a store's running tests, for the browser to know when it lacks an answer. Cached with the tests: a filter over `runningTests()`. */
export async function runningExperimentIds(storeId: string): Promise<string[]> {
  return (await runningTests(storeId)).map((t) => t.id);
}
