import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { checkPgCronJobs } = await import("./pg-cron-jobs");

type Row = Record<string, unknown>;

/**
 * pg_cron's own SQL jobs in the ledger (bloat review step 1.22). A local or CI database may have no pg_cron: the check leaves it alone, and the
 * rest of this file builds a stand-in `cron` schema shaped as pg_cron's (only where there is none, so the real extension is never touched).
 */
const present = async () => Boolean((await db().execute<Row>(sql`select to_regclass('cron.job') is not null as present`))[0]?.present);
const standIn = !(await present());
const failures = async (job: string) => {
  const [row] = await db().execute<Row>(sql`select failures from commerce.cron_jobs where job = ${job}`);
  return row ? Number(row.failures) : null;
};

afterAll(async () => {
  await db().execute(sql`delete from commerce.cron_jobs where job like 'pgcron.%'`);
  if (standIn) await db().execute(sql`drop schema if exists cron cascade`);
  await closeDb();
});

describe("pg_cron's SQL jobs in the ledger", () => {
  it("leaves a database without pg_cron alone", async () => {
    if (!standIn) {
      console.log("pg_cron is installed here: the check below runs against the real jobs in production only");
      return;
    }
    expect(await checkPgCronJobs()).toEqual({ jobs: 0, failed: [] });
  });

  it.skipIf(!standIn)("keeps each SQL job as a row, a failed last run as a failure, and a log over 8 days old as the log's", async () => {
    await db().execute(sql`
      create schema cron;
      create table cron.job (jobid bigint, jobname text, command text);
      create table cron.job_run_details (jobid bigint, status text, start_time timestamptz, end_time timestamptz);
      insert into cron.job values
        (9001, 'kaizen-consent-retention', 'delete from commerce.consents'),
        (9002, 'kaizen-cookie-scan-retention', 'delete from commerce.cookie_scans'),
        (9003, 'kaizen-route-job', 'select net.http_post(url := ''x'')');
      insert into cron.job_run_details values
        (9001, 'succeeded', now() - interval '1 hour', now() - interval '1 hour'),
        (9002, 'failed', now() - interval '1 hour', now() - interval '1 hour'),
        (9003, 'succeeded', now() - interval '1 hour', now() - interval '1 hour')
    `);
    const first = await checkPgCronJobs();
    expect(first.jobs).toBe(3);
    expect(first.failed).toEqual(["pgcron.kaizen-cookie-scan-retention"]);
    expect(await failures("pgcron.kaizen-consent-retention")).toBe(0);
    expect(await failures("pgcron.kaizen-cookie-scan-retention")).toBe(1);
    expect(await failures("pgcron.run-log")).toBe(0);
    expect(await failures("pgcron.kaizen-route-job")).toBeNull();
    await db().execute(sql`insert into cron.job_run_details values (9003, 'succeeded', now() - interval '9 days', now() - interval '9 days')`);
    const second = await checkPgCronJobs();
    expect(second.failed).toContain("pgcron.run-log");
    expect(await failures("pgcron.run-log")).toBe(1);
  });
});
