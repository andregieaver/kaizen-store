import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { targetKindOf } from "@/lib/ab-site";
import { type Goal, type ExperimentStatus } from "@/lib/experiments";
import { attentionOrder, flagsOf, overviewOf, type Flag, type Overview } from "@/lib/platform-experiments";

import { getExperiment } from "./experiment-admin";
import { experimentResults } from "./experiment-results";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/** What a platform admin sees of one store's test: read-only. */
export type PlatformTest = {
  id: string;
  storeId: string;
  store: { slug: string; name: string };
  name: string;
  status: ExperimentStatus;
  goal: Goal;
  /** What is tested: the page's address or the kind of thing (header, footer, product layout). */
  target: { type: string; slug: string; title: string; part: string | null; role?: string | null };
  versions: number;
  exposed: number;
  /** Visitors per version while the test runs, for the split. */
  split: { key: string; visitors: number }[] | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  plannedEnd: Date | null;
  scheduledStart: Date | null;
  createdAt: Date;
  stopReason: string | null;
  appliedVariant: string | null;
  /** Why a scheduled start did not happen, for a draft it sent back. */
  scheduleProblem: string | null;
  /** The verdict's sentence, for a running test. */
  headline: string | null;
  flags: Flag[];
};

export type PlatformExperiments = { tests: PlatformTest[]; overview: Overview; truncated: boolean };

const LIMIT = 300;
/** Results are read for this many running tests at a time, so the database is not asked for all of them at once. */
const BATCH = 4;

const date = (value: unknown) => (value ? new Date(String(value)) : null);

/**
 * Every store's A/B tests (D148, phase 5): what is running, scheduled or waiting for a decision, with the verdict and what
 * needs a look (`flagsOf()`). `everything` adds drafts, applied and discarded tests. Nothing here changes a test.
 */
export async function platformExperiments(everything = false, now = new Date()): Promise<PlatformExperiments> {
  const rows = await db().execute<Row>(sql`
    select e.id, e.store_id, e.name, e.status, e.primary_goal, e.started_at, e.stopped_at, e.planned_end, e.scheduled_start, e.created_at,
           e.stop_reason, e.applied_variant, e.schedule_problem, e.target_part,
           s.slug as store_slug, s.name as store_name, p.slug as page_slug, p.type as page_type, p.draft->>'title' as page_title,
           (select r.role from commerce.page_roles r where r.store_id = e.store_id and r.page_id = e.target_page_id) as page_role,
           (select count(*)::int from commerce.experiment_variants v where v.experiment_id = e.id) as versions,
           (select count(*)::int from commerce.experiment_exposures x where x.experiment_id = e.id) as exposed
    from commerce.experiments e
    join commerce.stores s on s.id = e.store_id
    join commerce.pages p on p.id = e.target_page_id and p.store_id = e.store_id
    where ${everything ? sql`true` : sql`(e.status in ('running', 'scheduled', 'stopped') or (e.status = 'draft' and e.schedule_problem is not null))`}
    order by e.created_at desc
    limit ${LIMIT + 1}
  `);
  const truncated = rows.length > LIMIT;

  const tests: PlatformTest[] = [];
  const running: { test: PlatformTest; row: Row }[] = [];
  for (const row of rows.slice(0, LIMIT)) {
    const status = row.status as ExperimentStatus;
    const test: PlatformTest = {
      id: String(row.id),
      storeId: String(row.store_id),
      store: { slug: String(row.store_slug), name: String(row.store_name) },
      name: String(row.name),
      status,
      goal: row.primary_goal as Goal,
      target: {
        type: targetKindOf(String(row.page_type), row.page_role ? String(row.page_role) : null) ?? "page",
        role: row.page_role ? String(row.page_role) : null,
        slug: String(row.page_slug),
        title: String(row.page_title ?? row.page_slug),
        part: row.target_part ? String(row.target_part) : null,
      },
      versions: Number(row.versions),
      exposed: Number(row.exposed),
      split: null,
      startedAt: date(row.started_at),
      stoppedAt: date(row.stopped_at),
      plannedEnd: date(row.planned_end),
      scheduledStart: date(row.scheduled_start),
      createdAt: new Date(String(row.created_at)),
      stopReason: row.stop_reason ? String(row.stop_reason) : null,
      appliedVariant: row.applied_variant ? String(row.applied_variant) : null,
      scheduleProblem: row.schedule_problem ? String(row.schedule_problem) : null,
      headline: null,
      flags: [],
    };
    tests.push(test);
    if (status === "running") running.push({ test, row });
  }

  const results = new Map<string, { verdict: string; headline: string; harmed: string | null; split: PlatformTest["split"] }>();
  for (let i = 0; i < running.length; i += BATCH) {
    await Promise.all(
      running.slice(i, i + BATCH).map(async ({ test, row }) => {
        try {
          const [store, info] = await Promise.all([getStore(String(row.store_slug)), getExperiment(test.storeId, test.id)]);
          if (!store || !info) return;
          const r = await experimentResults(store, info, now);
          results.set(test.id, { verdict: r.verdict.kind, headline: r.verdict.headline, harmed: r.harmed, split: r.figures.map((f) => ({ key: f.key, visitors: f.visitors })) });
        } catch (error) {
          console.error("[experiments] platform view could not read results", test.id, error);
        }
      }),
    );
  }

  for (const test of tests) {
    const found = results.get(test.id);
    test.headline = found?.headline ?? null;
    test.split = found?.split ?? null;
    test.flags = flagsOf(
      {
        status: test.status,
        startedAt: test.startedAt,
        stoppedAt: test.stoppedAt,
        plannedEnd: test.plannedEnd,
        stopReason: test.stopReason,
        scheduleProblem: test.scheduleProblem,
        exposed: test.exposed,
        verdict: found?.verdict ?? null,
        harmed: found?.harmed ?? null,
      },
      now,
    );
  }
  const ordered = attentionOrder(tests);
  return { tests: ordered, overview: overviewOf(ordered), truncated };
}
