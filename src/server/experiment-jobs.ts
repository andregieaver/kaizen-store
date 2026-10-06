import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { overdue } from "@/lib/experiments";

import { getExperiment, startExperiment, stopExperiment, unscheduleExperiment } from "./experiment-admin";
import { notifyGuardrailStop } from "./experiment-emails";
import { experimentResults } from "./experiment-results";
import { pruneExperimentData } from "./experiments";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * The A/B tests' upkeep (D148), from the five-minute cron and never throwing: a scheduled test whose time has come starts
 * (checked again as at any start: one that no longer can goes back to a draft with the reason, for its owner to read);
 * a test past its planned end and a week
 * of grace, or ninety days, is stopped; once an hour every running test's guardrail is looked at, and a version that
 * clearly lowers orders stops the test and the store's owners are emailed; old carts' visitors are forgotten.
 */
export async function runExperimentJobs(now = new Date()): Promise<{ started: number; stopped: number; checked: number; pruned: number }> {
  let started = 0;
  let stopped = 0;
  let checked = 0;
  try {
    const due = await db().execute<Row>(sql`
      select id, store_id from commerce.experiments where status = 'scheduled' and commerce.store_is_active(store_id) and scheduled_start <= ${now.toISOString()}::timestamptz order by scheduled_start
    `);
    for (const row of due) {
      const storeId = String(row.store_id);
      const id = String(row.id);
      try {
        const result = await startExperiment(null, storeId, id);
        if (result.ok) started += 1;
        else await unscheduleExperiment(null, storeId, id, `The scheduled start did not happen. ${result.problems.join(" ")}`.slice(0, 600));
      } catch (error) {
        console.error("[experiments] scheduled start failed", id, error);
      }
    }
  } catch (error) {
    console.error("[experiments] scheduled starts failed", error);
  }
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
        if (results.harmed && (await stopExperiment(null, storeId, id, "guardrail")).ok) {
          stopped += 1;
          // The owners are told after the stop has happened: a failure to send never undoes it.
          await notifyGuardrailStop(store, test, results);
        }
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
  return { started, stopped, checked, pruned };
}
