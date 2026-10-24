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
