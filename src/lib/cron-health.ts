/**
 * Whether a scheduled job is keeping up (PSI 2026-10-24, REL-06): every run of a cron route and of each job in the five-minute
 * dispatcher is kept as one row of `commerce.cron_jobs` (`src/server/cron-runs.ts`), and this says from that row whether the job
 * is fine, late (it has not finished a run for longer than its schedule allows) or failing (its last runs ended in an error).
 * Pure, so the platform home and its tests read the same rule.
 */

export type CronJobRow = {
  job: string;
  everySeconds: number;
  lastFinishedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  failures: number;
};

export type CronHealth = "ok" | "late" | "failing";

/** Runs in a row that ended in an error before a job counts as failing: one bad run is a hiccup the next usually clears. */
export const FAILING_AFTER = 3;

/**
 * How long past its last finished run a job may go: its interval, then twice that again but at least ten minutes (so a job every
 * minute is late after eleven, the five-minute jobs after fifteen) and at most six hours (a daily job is late after thirty hours).
 */
export function allowanceSeconds(everySeconds: number): number {
  return everySeconds + Math.min(Math.max(2 * everySeconds, 600), 6 * 3600);
}

export function cronHealth(row: CronJobRow, now: Date = new Date()): CronHealth {
  if (row.failures >= FAILING_AFTER) return "failing";
  // The work a route does after answering (trackedWork) runs only when there is work: never late, only failing or ok (bloat review
  // step 1.26).
  if (row.job.endsWith(".work")) return "ok";
  if (!row.lastFinishedAt) return "late";
  const age = (now.getTime() - new Date(row.lastFinishedAt).getTime()) / 1000;
  return age > allowanceSeconds(row.everySeconds) ? "late" : "ok";
}

/** The jobs that need a look, failing first, then the longest late. */
export function jobsNeedingLook(rows: readonly CronJobRow[], now: Date = new Date()): (CronJobRow & { health: CronHealth })[] {
  return rows
    .map((row) => ({ ...row, health: cronHealth(row, now) }))
    .filter((row) => row.health !== "ok")
    .sort((a, b) =>
      a.health !== b.health ? (a.health === "failing" ? -1 : 1) : (a.lastFinishedAt ?? "").localeCompare(b.lastFinishedAt ?? ""),
    );
}

/** What the outside heartbeat answers (F3, D672): whether the scheduler is alive, and how many jobs are late or failing. Counts only. */
export type CronHeartbeat = { ok: boolean; routes: number; lateRoutes: number; lateJobs: number; failingJobs: number };

/**
 * The scheduler is alive while every scheduled route (`route.*`, what the scheduler calls) has finished a run within its allowance: a route
 * gone quiet means nothing is calling the jobs. A dispatcher job that is late or failing is counted but does not stop the beat: it has its
 * own email (`FAILING_AFTER`), and the scheduler that runs it is fine. No route kept at all is not alive either.
 */
export function cronHeartbeat(rows: readonly CronJobRow[], now: Date = new Date()): CronHeartbeat {
  const routes = rows.filter((r) => r.job.startsWith("route."));
  const health = rows.map((r) => ({ route: r.job.startsWith("route."), health: cronHealth(r, now) }));
  const lateRoutes = health.filter((h) => h.route && h.health === "late").length;
  return {
    ok: routes.length > 0 && lateRoutes === 0,
    routes: routes.length,
    lateRoutes,
    lateJobs: health.filter((h) => !h.route && h.health === "late").length,
    failingJobs: health.filter((h) => h.health === "failing").length,
  };
}

/** The jobs the watcher (`/api/cron/watchdog`, bloat review step 1.22) reads: the five-minute dispatcher's route row; step 3.1 adds the tick's row here. */
export const WATCHED_JOBS = ["route.cart-reminders"] as const;

/** A watched job whose last finished run is older than this has stopped: the dispatcher runs every five minutes, so fifteen minutes is three missed runs. */
export const STOPPED_AFTER_SECONDS = 900;

/** The watched jobs that have stopped: each with its age in minutes (null for a job that never finished a run or has no row at all). Empty while all are fresh. */
export function stoppedJobs(rows: readonly CronJobRow[], now: Date = new Date()): { job: string; minutes: number | null }[] {
  const stopped: { job: string; minutes: number | null }[] = [];
  for (const job of WATCHED_JOBS) {
    const row = rows.find((r) => r.job === job);
    if (!row?.lastFinishedAt) {
      stopped.push({ job, minutes: null });
      continue;
    }
    const age = (now.getTime() - new Date(row.lastFinishedAt).getTime()) / 1000;
    if (age > STOPPED_AFTER_SECONDS) stopped.push({ job, minutes: Math.floor(age / 60) });
  }
  return stopped;
}

/**
 * The status page's jobs check (step 1.22): failing when any job is failing; late when a dispatcher job, the watcher (`route.watchdog`) or a
 * daily job (a period of a day or more) is late. A late one-minute route is not: it has its own row on the platform home.
 */
export function jobsCheck(rows: readonly CronJobRow[], now: Date = new Date()): { ok: boolean; reason: "failing" | "late" | null } {
  const look = jobsNeedingLook(rows, now);
  if (look.some((j) => j.health === "failing")) return { ok: false, reason: "failing" };
  if (look.some((j) => j.health === "late" && (j.job.startsWith("dispatcher") || j.job === "route.watchdog" || j.everySeconds >= 86_400))) return { ok: false, reason: "late" };
  return { ok: true, reason: null };
}
