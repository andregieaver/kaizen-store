import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { tracked } from "./cron-runs";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/** The ledger's own rule for a job's key (`cron_jobs_job`), with the `pgcron.` the jobs here are kept under. */
const LEDGER_KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

/** pg_cron keeps every run in `cron.job_run_details`; the daily prune (`kaizen-cron-log-retention`, step 0.25) holds it to seven days. */
const LOG_TOO_OLD_DAYS = 8;

/**
 * pg_cron's own SQL jobs in the ledger (bloat review step 1.22): the jobs that call a route have rows of their own (`route.*`), but the
 * ones that run SQL (`kaizen-consent-retention`, `kaizen-cookie-scan-retention`, `kaizen-cron-log-retention`) left no trace. Once a day,
 * from the daily route, each is kept as `pgcron.{name}` with a day's period: failing when its newest run failed or none is recorded. One more
 * row, `pgcron.run-log`, fails when the oldest row of `cron.job_run_details` is over eight days old, which is the prune not running.
 * A database without pg_cron (a local one) is left alone. Returns how many jobs were kept and the names whose check failed.
 */
export async function checkPgCronJobs(): Promise<{ jobs: number; failed: string[] }> {
  const present = await typedRow(z.object({ present: col.bool }), sql`select to_regclass('cron.job') is not null as present`);
  if (!present?.present) return { jobs: 0, failed: [] };
  const jobs = await typedRows(
    z.object({ jobid: col.text, jobname: col.text }),
    sql`select jobid::text as jobid, jobname from cron.job where command not ilike '%net.http_post%' and jobname like 'kaizen-%' order by jobname`,
  );
  const failed: string[] = [];
  let kept = 0;
  for (const job of jobs) {
    const name = `pgcron.${job.jobname}`;
    if (!LEDGER_KEY.test(name)) {
      log("warn", "pg_cron_jobs.name_skipped", { length: job.jobname.length });
      continue;
    }
    const run = await typedRow(
      z.object({ status: col.textOrNull }),
      sql`select status from cron.job_run_details where jobid = ${job.jobid}::bigint order by start_time desc limit 1`,
    );
    const answer = await tracked(name, 86_400, async () => {
      if (!run) throw new Error("no run recorded");
      if (run.status === "failed") throw new Error("last run failed");
      return true;
    });
    kept += 1;
    if (answer === null) failed.push(name);
  }
  const logAge = await typedRow(
    z.object({ stale: col.bool }),
    sql`select coalesce(min(end_time) < now() - make_interval(days => ${LOG_TOO_OLD_DAYS}), false) as stale from cron.job_run_details`,
  );
  const runLog = await tracked("pgcron.run-log", 86_400, async () => {
    if (logAge?.stale) throw new Error(`the oldest row of cron.job_run_details is over ${LOG_TOO_OLD_DAYS} days old: its prune is not running`);
    return true;
  });
  kept += 1;
  if (runLog === null) failed.push("pgcron.run-log");
  return { jobs: kept, failed };
}
