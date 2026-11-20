import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { FAILING_AFTER, type CronJobRow } from "@/lib/cron-health";
import { pooled } from "@/lib/job-pool";

import { flushCacheEvents, inJob, withReport, type JobReport } from "./cache-events";
import { cronAuthorised } from "./cron-auth";
import { noteFirstRequest } from "./instance-start";
import { log } from "./log";
import { textList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * Scheduled jobs keep their last run in `commerce.cron_jobs` (PSI 2026-10-24, REL-06), so a job that stops or keeps failing shows on
 * the platform home (`src/lib/cron-health.ts`) instead of going unnoticed. Every cron route runs inside `tracked()`, and the
 * five-minute dispatcher runs each of its jobs through `runJobs()`: a job that throws, or reports an error it caught (`report()`, bloat
 * review step 1.26), is logged and recorded as failed, and the others finish.
 */

/** Writes a finished run. Never throws: a ledger that cannot be written must not stop the job it records. */
async function record(job: string, everySeconds: number, started: Date, error: unknown | null): Promise<void> {
  const finished = new Date();
  const ok = error === null;
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  const message = ok ? null : (error instanceof Error ? `${error.name}: ${error.message}${cause}` : String(error)).slice(0, 1000);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.cron_jobs as j
        (job, every_seconds, last_started_at, last_finished_at, last_ok_at, last_error, last_error_at, last_duration_ms, runs, failures)
      values (
        ${job}, ${everySeconds}, ${started.toISOString()}::timestamptz, ${finished.toISOString()}::timestamptz,
        ${ok ? finished.toISOString() : null}::timestamptz, ${message}, ${ok ? null : finished.toISOString()}::timestamptz,
        ${finished.getTime() - started.getTime()}, 1, ${ok ? 0 : 1}
      )
      on conflict (job) do update set
        every_seconds = excluded.every_seconds,
        last_started_at = excluded.last_started_at,
        last_finished_at = excluded.last_finished_at,
        last_ok_at = coalesce(excluded.last_ok_at, j.last_ok_at),
        last_error = coalesce(excluded.last_error, j.last_error),
        last_error_at = coalesce(excluded.last_error_at, j.last_error_at),
        last_duration_ms = excluded.last_duration_ms,
        runs = j.runs + 1,
        failures = case when excluded.failures = 0 then 0 else j.failures + 1 end
      returning failures, last_ok_at`);
    // The run that makes it failing (D389, REL-02): the platform's admins are told once for this turn.
    if (!ok && Number(row?.failures) === FAILING_AFTER) {
      const { alertFailingJob } = await import("./cron-alerts");
      await alertFailingJob(job, { failedAt: finished, lastOkAt: row?.last_ok_at ? new Date(String(row.last_ok_at)).toISOString() : null, error: message });
    }
  } catch (writeError) {
    log("warn", "cron.record_failed", { job }, writeError);
  }
}

/**
 * Runs one job and keeps its run: the job's answer, or null when it threw (logged as `cron.job_failed` and counted). The job is handed
 * a `report()` for errors it catches: the run is then counted as failed once it ends. `everySeconds` is how often its schedule runs it,
 * which is how late it may be (`allowanceSeconds()`).
 */
export async function tracked<T>(job: string, everySeconds: number, run: (report: JobReport) => Promise<T>): Promise<T | null> {
  const started = new Date();
  const reported: { part: string | null; error: unknown }[] = [];
  const report: JobReport = (error, part) => {
    reported.push({ part: part ?? null, error });
    log("error", "cron.job_part_failed", { job, part: part ?? null }, error);
  };
  try {
    const result = await inJob(job, () => withReport(report, () => run(report)));
    // A part that failed and was reported: the run is failed, and still answers what its other parts did.
    const failed =
      reported.length === 0
        ? null
        : new Error(`${reported.length} part(s) failed (${reported.map((r) => r.part ?? "?").join(", ")})`, { cause: reported[0].error });
    await record(job, everySeconds, started, failed);
    await flushCacheEvents();
    return result;
  } catch (error) {
    log("error", "cron.job_failed", { job, durationMs: Date.now() - started.getTime() }, error);
    await record(job, everySeconds, started, error);
    await flushCacheEvents();
    return null;
  }
}

/**
 * The day of a once-a-day job that runs from the five-minute dispatcher (D436): claims `day` (the date in `timeZone`) for `job` in the
 * ledger and answers true for the one run that took it, false when a run already did, so overlapping runs and the day's later ones leave
 * it alone (a run that then fails waits for the next day). The claimed run works inside `tracked(job, 86_400, …)`, which keeps how it
 * went, so the platform home says when the job is late (more than a day and six hours) or keeps failing.
 */
export async function claimDay(job: string, day: string, timeZone: string, now: Date = new Date()): Promise<boolean> {
  const claimed = await typedRows(
    z.object({ job: col.text }),
    sql`
      insert into commerce.cron_jobs as j (job, every_seconds, last_started_at) values (${job}, 86400, ${now.toISOString()}::timestamptz)
      on conflict (job) do update set last_started_at = excluded.last_started_at, every_seconds = excluded.every_seconds
        where j.last_started_at is null or (j.last_started_at at time zone ${timeZone})::date < ${day}::date
      returning j.job`,
  );
  return claimed.length > 0;
}

/** A job's key as the ledger keeps it: `storeCopies` → `store-copies` (the table takes lower case only). */
export const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Jobs that no longer run (their work moved elsewhere): their rows are deleted on each dispatcher run, so a retired job never reads as late
 * on the platform home or `/status`. Add a job's full name here when it is taken out of a `runJobs()` list.
 */
export const RETIRED_JOBS: readonly string[] = [
  // The DSA notices' senders are forgotten by the retention rule `content_report_senders` (runRetention) since 31 October 2026.
  "dispatcher.content-reports",
  // Pruned daily or hourly since bloat review step 0.31 (daily.* and hourly.* rows).
  "dispatcher.searches",
  "dispatcher.cache",
  "dispatcher.forms",
  "dispatcher.chat",
  "dispatcher.recommendations",
  "dispatcher.docs-counts",
  "dispatcher.replications",
  "dispatcher.api-idempotency",
  "dispatcher.oauth-tokens",
];

/**
 * How many dispatcher jobs run at once: one fewer than the pool's five connections (`src/db/client.ts`), so a job that needs a second
 * connection, the ledger's write or a page render still finds one.
 */
export const JOB_LANES = 4;
/** How long a job holds its lane before the next job takes it (the job goes on, and is recorded when it ends). */
export const JOB_LANE_MS = 60_000;

/**
 * Runs a dispatcher's jobs four at a time (`JOB_LANES`), each tracked as `{prefix}.{name}` in kebab case; each answer is the job's, or
 * null when it threw. A job that has run for `JOB_LANE_MS` gives its lane to the next and is still recorded when it ends.
 */
export async function runJobs<J extends Record<string, (report: JobReport) => Promise<unknown>>>(
  prefix: string,
  everySeconds: number,
  jobs: J,
  options: { lanes?: number; laneMs?: number } = {},
): Promise<{ [K in keyof J]: Awaited<ReturnType<J[K]>> | null }> {
  const names = Object.keys(jobs) as (keyof J & string)[];
  if (RETIRED_JOBS.length > 0) {
    await db()
      .execute(sql`delete from commerce.cron_jobs where job = any(${textList(RETIRED_JOBS)})`)
      .catch((error: unknown) => log("warn", "cron.retire_failed", {}, error));
  }
  const results = await pooled(
    names.map((name) => () => tracked(`${prefix}.${kebab(name)}`, everySeconds, (report) => jobs[name](report))),
    {
      lanes: options.lanes ?? JOB_LANES,
      laneMs: options.laneMs ?? JOB_LANE_MS,
      onLaneGivenUp: (i) => log("warn", "cron.lane_given_up", { job: `${prefix}.${kebab(names[i])}`, afterMs: options.laneMs ?? JOB_LANE_MS }),
    },
  );
  return Object.fromEntries(names.map((name, i) => [name, results[i]])) as { [K in keyof J]: Awaited<ReturnType<J[K]>> | null };
}

/**
 * The work a route does after answering (`after()`), kept as a job of its own, `{route}.work`: the route's own row records only that it
 * answered (bloat review step 1.26).
 */
export function trackedWork<T>(route: string, everySeconds: number, run: (report: JobReport) => Promise<T>): Promise<T | null> {
  return tracked(`${route}.work`, everySeconds, run);
}

/** Every job's last run, for the platform's view of them. */
export async function cronJobRows(): Promise<CronJobRow[]> {
  const rows = await db().execute<Row>(sql`
    select job, every_seconds, last_finished_at, last_ok_at, last_error, failures from commerce.cron_jobs order by job`);
  return rows.map((row) => ({
    job: String(row.job),
    everySeconds: Number(row.every_seconds),
    lastFinishedAt: row.last_finished_at ? new Date(String(row.last_finished_at)).toISOString() : null,
    lastOkAt: row.last_ok_at ? new Date(String(row.last_ok_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    failures: Number(row.failures),
  }));
}

/**
 * A cron route's handler, kept as a job `route.{name}` run every `everySeconds`: requests without the cron secret are refused and not
 * recorded; an answer of 500 or more counts as a failed run. Export it as the route's `GET` and `POST`.
 */
export function trackedRoute(job: string, everySeconds: number, handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    noteFirstRequest("job", after);
    if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
    const response = await tracked(job, everySeconds, async () => {
      const answer = await handler(request);
      if (answer.status >= 500) throw new Error(`The route answered ${answer.status}.`);
      return answer;
    });
    return response ?? new Response("The job failed; see the logs.", { status: 500, headers: { "Cache-Control": "no-store" } });
  };
}
