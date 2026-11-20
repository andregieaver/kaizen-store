import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { log } from "./log";

/**
 * How a scheduled job tells of an error it caught so its other parts can go on (bloat review step 1.26): logged, and the run counted as
 * failed once the job ends (`tracked()` in `cron-runs.ts`). `part` is a fixed word for what failed, never a person's data. Kept apart from
 * `cron-runs.ts` so a job's module imports only this.
 */
export type JobReport = (error: unknown, part?: string) => void;

/** The report outside a scheduled run (a test, a person's action): logged only. */
const logOnly: JobReport = (error, part) => log("error", "cron.job_part_failed", { part: part ?? null }, error);

const reportScope = new AsyncLocalStorage<JobReport>();

/** Runs `run` with `report` as the job's report, for `jobReport()` inside it. */
export const withReport = <T>(report: JobReport, run: () => Promise<T>): Promise<T> => reportScope.run(report, run);

/**
 * The report of the scheduled job this code runs in (`tracked()` keeps it in scope, as `inJob()` keeps the job's name), or `logOnly`
 * outside one. An entry function reads it once, `const report = jobReport();`, and reports each error it catches.
 */
export const jobReport = (): JobReport => reportScope.getStore() ?? logOnly;
