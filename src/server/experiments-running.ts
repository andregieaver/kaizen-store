import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isTestedPlace, targetKindOf, type TargetKind, type TestedPlace } from "@/lib/ab-site";
import { parseAudience, type Audience, type Goal } from "@/lib/experiments";

import { forgetRemembered, remembered } from "./short-memory";

type Row = Record<string, unknown>;

/**
 * The A/B tests running for a store, as the proxy and the assignment read them (D148, docs/ab-testing.md): moved here from `experiments.ts`,
 * which re-exports them, so the proxy reads the database client, the short memory and pure src/lib code only (bloat review step 2.20).
 */

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

/** Forgets what this server knows of a store's tests (others catch up within `MEMO_MS`). */
export function forgetRunning(storeId: string): void {
  forgetRemembered(`running:${storeId}`);
}

/**
 * The tests running for a store, for the proxy and the assignment: a short memory in the server, so enrolled visitors'
 * requests do not each ask the database.
 */
export function runningExperiments(storeId: string): Promise<RunningExperiment[]> {
  return remembered(`running:${storeId}`, async () => {
    const rows = await db().execute<Row>(sql`
      select e.id, e.target_page_id, p.slug, p.type as target_type, e.traffic_share::float8 as traffic_share, e.audience, e.primary_goal, e.goal_params,
        commerce.page_place(e.store_id, e.target_page_id) as target_role,
        (select jsonb_agg(jsonb_build_object('key', v.key, 'share', v.share::float8, 'pageId', v.page_id) order by v.key)
         from commerce.experiment_variants v where v.experiment_id = e.id) as variants
      from commerce.experiments e
      join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
      where e.store_id = ${storeId}::uuid and e.status = 'running' and commerce.extension_on(e.store_id, 'ab_testing')
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
  }, MEMO_MS);
}

/** The store an address names, for the proxy: the id of an open store by its slug. */
export function storeIdOfSlug(slug: string): Promise<string | null> {
  return remembered(`store:${slug}`, async () => {
    const [row] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug} and status = 'active' and not (is_template or starter or sandbox) limit 1`);
    return row ? String(row.id) : null;
  }, 60_000);
}
