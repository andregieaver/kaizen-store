import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { overdue } from "@/lib/experiments";

import { getExperiment, stopExperiment } from "./experiment-admin";
import { experimentResults } from "./experiment-results";
import { pruneExperimentData } from "./experiments";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * The A/B tests' upkeep (D148), from the five-minute cron and never throwing: a test past its planned end and a week
 * of grace, or ninety days, is stopped; once an hour every running test's guardrail is looked at, and a version that
 * clearly lowers orders stops the test; old carts' visitors are forgotten.
 */
export async function runExperimentJobs(now = new Date()): Promise<{ stopped: number; checked: number; pruned: number }> {
  let stopped = 0;
  let checked = 0;
  try {
    const running = await db().execute<Row>(sql`
      select e.id, e.store_id, s.slug, e.started_at, e.planned_end from commerce.experiments e join commerce.stores s on s.id = e.store_id where e.status = 'running'
    `);
    const hourly = now.getUTCMinutes() < 5;
    for (const row of running) {
      const storeId = String(row.store_id);
      const id = String(row.id);
      try {
        if (overdue(row.planned_end ? new Date(String(row.planned_end)) : null, row.started_at ? new Date(String(row.started_at)) : null, now)) {
          if ((await stopExperiment(null, storeId, id, "planned_end")).ok) stopped += 1;
          continue;
        }
        if (!hourly) continue;
        const [store, test] = await Promise.all([getStore(String(row.slug)), getExperiment(storeId, id)]);
        if (!store || !test) continue;
        checked += 1;
        const results = await experimentResults(store, test, now);
        if (results.harmed && (await stopExperiment(null, storeId, id, "guardrail")).ok) stopped += 1;
      } catch (error) {
        console.error("[experiments] check failed", id, error);
      }
    }
  } catch (error) {
    console.error("[experiments] jobs failed", error);
  }
  let pruned = 0;
  try {
    pruned = await pruneExperimentData();
  } catch (error) {
    console.error("[experiments] prune failed", error);
  }
  return { stopped, checked, pruned };
}
