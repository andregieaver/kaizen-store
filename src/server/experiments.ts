import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";

import { db, readDb } from "@/db/client";
import { isTestedPlace, targetKindOf, testToken, TESTED_PLACES, type TargetKind, type TestedPlace } from "@/lib/ab-site";
import { decodeConsent, consentCookieName } from "@/lib/cookie-consent";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import {
  dataCookieName,
  decodeAssignments,
  isUuid,
  OUTSIDE,
  parseAudience,
  type Assignments,
  type Audience,
  type Device,
  type Goal,
} from "@/lib/experiments";

import { withPageAlts } from "./media-alts";

type Row = Record<string, unknown>;

/**
 * A/B tests of pages, as the storefront reads and writes them (D148, docs/ab-testing.md): which tests run for a store,
 * what a visitor was assigned, and the exposures and events that follow. Everything here treats the browser's cookies
 * as claims to check, and nothing records anyone who has not accepted statistics cookies.
 */

/** Refreshed when a test starts, stops or changes: the pages that show a test's marker are drawn again. */
export const experimentsTag = (storeId: string) => `experiments:${storeId}`;

/** The slug of a variant's page (type `variant`, which has no address on the site): a key, not a place. */
export const variantSlug = (experimentId: string, key: string) => `ab-${experimentId.slice(0, 8)}-${key}`;

export type RunningVariant = { key: string; share: number; pageId: string | null };
export type RunningExperiment = {
  id: string;
  storeId: string;
  /** What is tested: a page, the product layout, the header, the footer (D148, phase 3) or a working page (phase 9). */
  kind: TargetKind;
  /** The working page under test, for a test of one. */
  role: TestedPlace | null;
  targetPageId: string;
  /** The address of the page under test, as it is now. */
  slug: string;
  trafficShare: number;
  audience: Audience;
  goal: Goal;
  goalBlock: string | null;
  variants: RunningVariant[];
};

// ---------------------------------------------------------------------------
// What runs now
// ---------------------------------------------------------------------------

const MEMO_MS = 20_000;
const memo = new Map<string, { at: number; value: unknown }>();

async function remembered<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** Forgets what this server knows of a store's tests (others catch up within `MEMO_MS`). */
export function forgetRunning(storeId: string): void {
  memo.delete(`running:${storeId}`);
}

/**
 * The tests running for a store, for the proxy and the assignment: a short memory in the server, so enrolled visitors'
 * requests do not each ask the database.
 */
export function runningExperiments(storeId: string): Promise<RunningExperiment[]> {
  return remembered(`running:${storeId}`, MEMO_MS, async () => {
    const rows = await db().execute<Row>(sql`
      select e.id, e.target_page_id, p.slug, p.type as target_type, e.traffic_share::float8 as traffic_share, e.audience, e.primary_goal, e.goal_params,
        commerce.page_place(e.store_id, e.target_page_id) as target_role,
        (select jsonb_agg(jsonb_build_object('key', v.key, 'share', v.share::float8, 'pageId', v.page_id) order by v.key)
         from commerce.experiment_variants v where v.experiment_id = e.id) as variants
      from commerce.experiments e
      join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
      where e.store_id = ${storeId}::uuid and e.status = 'running'
    `);
    return rows.map(
      (r): RunningExperiment => ({
        id: String(r.id),
        storeId,
        kind: targetKindOf(String(r.target_type), r.target_role ? String(r.target_role) : null) ?? "page",
        role: isTestedPlace(r.target_role) ? r.target_role : null,
        targetPageId: String(r.target_page_id),
        slug: String(r.slug),
        trafficShare: Number(r.traffic_share),
        audience: parseAudience(r.audience),
        goal: r.primary_goal as Goal,
        goalBlock: typeof (r.goal_params as { block?: unknown })?.block === "string" ? String((r.goal_params as { block: string }).block) : null,
        variants: ((r.variants ?? []) as { key: string; share: number; pageId: string | null }[]).map((v) => ({ key: v.key, share: Number(v.share), pageId: v.pageId })),
      }),
    );
  });
}

/** The store an address names, for the proxy: the id of an open store by its slug. */
export function storeIdOfSlug(slug: string): Promise<string | null> {
  return remembered(`store:${slug}`, 60_000, async () => {
    const [row] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug} and status = 'active' and not is_template limit 1`);
    return row ? String(row.id) : null;
  });
}

export type PageExperiment = {
  id: string;
  goal: Goal;
  goalBlock: string | null;
  variants: { key: string; slug: string | null }[];
};

/**
 * The running test on a page, for drawing the page: a marker that tells the browser which version this is, and the
 * variants' pages to read. Cached with the store's tests, so a page without one stays as static as it was.
 */
export async function experimentOfPage(storeId: string, pageId: string): Promise<PageExperiment | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId));
  // The test of a page with a place of its own (a working page, the front page, the All products page) is served from its route
  // (placeVersionFor()), not from the page's address: not found here.
  const [row] = await readDb().execute<Row>(sql`
    select e.id, e.primary_goal, e.goal_params,
      (select jsonb_agg(jsonb_build_object('key', v.key, 'has_page', v.page_id is not null) order by v.key)
       from commerce.experiment_variants v where v.experiment_id = e.id) as variants
    from commerce.experiments e
    where e.store_id = ${storeId}::uuid and e.target_page_id = ${pageId}::uuid and e.status = 'running'
      and commerce.page_place(e.store_id, e.target_page_id) is null
  `);
  if (!row) return null;
  const id = String(row.id);
  return {
    id,
    goal: row.primary_goal as Goal,
    goalBlock: typeof (row.goal_params as { block?: unknown })?.block === "string" ? String((row.goal_params as { block: string }).block) : null,
    variants: ((row.variants ?? []) as { key: string; has_page: boolean }[]).map((v) => ({ key: v.key, slug: v.has_page ? variantSlug(id, v.key) : null })),
  };
}

/** Whether a store has a running test: the cookie banner and the assignment script are there only then. Cached with the tests. */
export async function storeHasExperiments(storeId: string): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId));
  const [row] = await readDb().execute<Row>(sql`select 1 as one from commerce.experiments where store_id = ${storeId}::uuid and status = 'running' limit 1`);
  return Boolean(row);
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

/** The store's running tests of its header, footer or product layout. Cached with the tests: a store without one draws its pages as it always did. */
export async function siteTests(storeId: string): Promise<SiteTest[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId));
  const rows = await readDb().execute<Row>(sql`
    select e.id, e.target_page_id, p.type as target_type, e.goal_params,
      commerce.page_place(e.store_id, e.target_page_id) as target_role,
      (select jsonb_agg(jsonb_build_object('key', v.key, 'pageId', v.page_id) order by v.key) from commerce.experiment_variants v where v.experiment_id = e.id and v.page_id is not null) as versions
    from commerce.experiments e join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
    where e.store_id = ${storeId}::uuid and e.status = 'running'
      and (p.type in ('header', 'footer', 'product_layout')
        or commerce.page_place(e.store_id, e.target_page_id) = any(${`{${TESTED_PLACES.join(",")}}`}::text[]))
    order by e.id
  `);
  return rows.flatMap((r): SiteTest[] => {
    const kind = targetKindOf(String(r.target_type), r.target_role ? String(r.target_role) : null);
    if (!kind || kind === "page") return [];
    return [
      {
        id: String(r.id),
        token: testToken(String(r.id)),
        kind,
        role: isTestedPlace(r.target_role) ? r.target_role : null,
        targetPageId: String(r.target_page_id),
        goalBlock: typeof (r.goal_params as { block?: unknown })?.block === "string" ? String((r.goal_params as { block: string }).block) : null,
        versions: ((r.versions ?? []) as { key: string; pageId: string }[]).map((v) => ({ key: v.key, pageId: v.pageId })),
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
  const content = row ? parsePageContent(row.version) : null;
  if (!row || !content) return null;
  const original = parsePageContent(row.original);
  const [layout] = await withPageAlts([{ id: String(row.page_id), content: original?.overlay ? { ...content, overlay: original.overlay } : { ...content, overlay: undefined } }]);
  return layout;
}

/** The ids of a store's running tests, for the browser to know when it lacks an answer. Cached with the tests. */
export async function runningExperimentIds(storeId: string): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(experimentsTag(storeId));
  const rows = await readDb().execute<Row>(sql`select id from commerce.experiments where store_id = ${storeId}::uuid and status = 'running' order by id`);
  return rows.map((r) => String(r.id));
}

// ---------------------------------------------------------------------------
// The visitor
// ---------------------------------------------------------------------------

/** Whether this browser has accepted statistics cookies for the store: the only way anyone is enrolled. */
export async function acceptedStatistics(storeId: string): Promise<boolean> {
  const stored = decodeConsent((await cookies()).get(consentCookieName(storeId))?.value);
  return stored?.choices.statistics === true;
}

/** What this browser holds for the store, read from its cookie; null when it holds nothing valid. */
export async function readAssignments(storeId: string): Promise<Assignments | null> {
  return decodeAssignments((await cookies()).get(dataCookieName(storeId))?.value);
}

export type Visit = { market: string; device: Device };

/**
 * Records that a visitor was shown a version (D148): once per visitor and test (the first sight counts), only for a
 * running test, a version the visitor's own cookie says they have, and only if they accepted statistics cookies.
 */
export async function recordExposure(storeId: string, experimentId: string, variant: string, visit: Visit): Promise<boolean> {
  if (!isUuid(experimentId) || variant === OUTSIDE || !/^[a-z0-9-]{0,24}$/.test(visit.market)) return false;
  if (!(await acceptedStatistics(storeId))) return false;
  const mine = await readAssignments(storeId);
  if (!mine || mine.versions[experimentId] !== variant) return false;
  try {
    const rows = await db().execute<Row>(sql`
      insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, market, device)
      select ${storeId}::uuid, e.id, ${mine.visitor}, v.key, ${visit.market}, ${visit.device}
      from commerce.experiments e join commerce.experiment_variants v on v.experiment_id = e.id and v.key = ${variant}
      where e.id = ${experimentId}::uuid and e.store_id = ${storeId}::uuid and e.status = 'running'
      on conflict (experiment_id, visitor) do nothing
      returning 1
    `);
    return rows.length > 0;
  } catch (error) {
    console.error("[experiments] exposure not recorded", error);
    return false;
  }
}

/** A click on the block a test counts: only from an exposed visitor, once, and only for the test's own block. */
export async function recordClick(storeId: string, experimentId: string, block: string): Promise<boolean> {
  if (!isUuid(experimentId) || block.length > 80) return false;
  if (!(await acceptedStatistics(storeId))) return false;
  const mine = await readAssignments(storeId);
  if (!mine || !mine.versions[experimentId] || mine.versions[experimentId] === OUTSIDE) return false;
  try {
    const rows = await db().execute<Row>(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, 'click', ${block}
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.experiment_id = ${experimentId}::uuid and x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
        and e.primary_goal = 'click' and e.goal_params ->> 'block' = ${block}
      on conflict do nothing
      returning 1
    `);
    return rows.length > 0;
  } catch (error) {
    console.error("[experiments] click not recorded", error);
    return false;
  }
}

/**
 * A form sent by an enrolled visitor (D148, phase 11): called by the form endpoint after the site has accepted the answer (a robot's, a
 * repeat of the day's and a refused one never get here), for every running test whose goal is this form and that the visitor was exposed
 * to. Once per visitor and form; never fails what it rides on, and says nothing when there is no cookie.
 */
export async function recordFormSent(storeId: string, block: string): Promise<void> {
  try {
    if (block.length > 80) return;
    const mine = await readAssignments(storeId);
    if (!mine) return;
    if (!(await acceptedStatistics(storeId))) return;
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, 'form', ${block}
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
        and e.primary_goal = 'form' and e.goal_params ->> 'block' = ${block}
      on conflict do nothing
    `);
  } catch (error) {
    console.error("[experiments] form not recorded", error);
  }
}

/**
 * A cart or a checkout of an enrolled visitor (D148): the cart is tied to the visitor so a paid order can be traced
 * back, and a cart or checkout event is kept for every running test the visitor was exposed to. Never fails what it
 * rides on: it is called after the cart or the checkout has done its work, and says nothing when there is no cookie.
 */
export async function recordExperimentCart(storeId: string, cartId: string, goal: "cart" | "checkout"): Promise<void> {
  try {
    const mine = await readAssignments(storeId);
    if (!mine || !isUuid(cartId)) return;
    if (!(await acceptedStatistics(storeId))) return;
    await db().execute(sql`
      insert into commerce.experiment_carts (store_id, cart_id, visitor)
      values (${storeId}::uuid, ${cartId}::uuid, ${mine.visitor})
      on conflict (store_id, cart_id) do nothing
    `);
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
      select x.store_id, x.experiment_id, x.visitor, x.variant, ${goal}, ''
      from commerce.experiment_exposures x join commerce.experiments e on e.id = x.experiment_id and e.status = 'running'
      where x.store_id = ${storeId}::uuid and x.visitor = ${mine.visitor}
      on conflict do nothing
    `);
  } catch (error) {
    console.error("[experiments] cart not recorded", error);
  }
}

/** Counts a visitor's requests so a script cannot fill the tables: false past the limit (the same window as the chat's). */
export async function takeExperimentRequest(storeId: string, visitor: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`ab:${visitor}`}, date_bin('10 minutes', now(), '2000-01-01'), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= 120;
}

/** Forgets old carts' visitors (90 days) and the exposures of tests that ended over a year ago (the daily job). */
export async function pruneExperimentData(): Promise<number> {
  const carts = await db().execute<Row>(sql`delete from commerce.experiment_carts where created_at < now() - interval '90 days' returning 1`);
  return carts.length;
}
