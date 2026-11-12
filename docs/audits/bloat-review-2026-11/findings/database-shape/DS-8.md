# DS-8 ✓ pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.20.
- **Second check:** corrected.
- **Where:** `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:64-113`, `docs/ci-migrations.md:30-46`, `scripts/lib/restore-check.mjs:22-30`, `evidence/prod-db-stats.md`
- **Evidence:** The statistics give 731 MB for the database: the cron schema 564 MB, commerce 124 MB. pg_cron writes one row to cron.job_run_details per run with the whole command text. The baseline schedules 9 jobs a minute, 1 every five minutes and 4 daily (baseline_4:93-113, which I read): 13,252 rows a day. Two of the daily jobs are retention deletes (consents, cookie_scans); none prunes the run log. rg for job_run_details over src, scripts and supabase finds nothing.
- **Cost today:** Measured: 564 MB, 77% of the database. Estimate: about 8 MB more a day at today's schedule (13,252 rows of about 0.6 KB), about 3 GB a year, whatever the number of stores. Larger backups, slower restores and branches. Paid by: The database
- **Saving:** Estimate: about 500 MB once (where TRUNCATE is allowed) and growth of about 8 MB a day stopped at about 60 MB (7 days of rows).
- **Risk:** Low. Nothing reads the run log. What could break: the role may lack TRUNCATE on the table, which the privilege test of step 3 handles; a TRUNCATE waits for pg_cron's own writes for a moment, inside the migration's 30 s lock limit. A failure shows as a red release job and nothing is applied.

## The fix

1. Before writing the file, read two facts on production (one read-only statement through the Supabase tool): select has_table_privilege('postgres', 'cron.job_run_details', 'TRUNCATE') as may_truncate, count(*) as rows, pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as size from cron.job_run_details.
2. Make a custom migration: pnpm exec drizzle-kit generate --custom --name cron_run_log_retention, then node scripts/prune-snapshots.mjs. Its body is one DO block that does nothing where the cron schema is missing (the tests' PGlite and CI's Postgres have none): IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN … END IF.
3. Inside the block, empty the log once: IF has_table_privilege(current_user, 'cron.job_run_details', 'TRUNCATE') THEN TRUNCATE cron.job_run_details; ELSE DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'; END IF. TRUNCATE gives the space back at once; a DELETE only lets it be reused. The app never reads this log (its own ledger is commerce.cron_jobs).
4. In the same block schedule the standing prune, as the two retention jobs at baseline_4:105-113 are scheduled: PERFORM cron.schedule('kaizen-cron-log-retention', '41 3 * * *', $job$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days' $job$). cron.schedule with a name replaces the job of that name, so the file can run again.
5. Do not edit baseline_4 (D572: a baseline is never edited). At the next quarterly squash, scripts/squash-migrations.mjs lists files with a scheduler step: fold this job into the new baseline_4 by hand (docs/ci-migrations.md:46).
6. Push the file; CI's release job applies it. Then check the advisors and record the file's version in docs/decisions.md under Migration versions.
7. If step 3 could only delete and the 564 MB matter (backups, branches), ask for one VACUUM FULL cron.job_run_details from a role that owns the table; otherwise leave it: the file stops growing.

**Done when:** On production a week after the deploy, the size-by-schema query in evidence/prod-db-stats.md shows the cron schema under 80 MB (564 MB today) where TRUNCATE ran, or select count(*) from cron.job_run_details is under 100,000 where only the delete could run.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/commerce.test.ts and every src/db/*.test.ts apply all migrations to PGlite through src/db/testing.ts: the file must be a no-op there (the guard of step 2).
- scripts/db-setup.mjs --seed on CI's Postgres service, which has no pg_cron: the same guard.
- src/lib/restore-check.test.ts and scripts/lib/restore-check.mjs:22-30: the restore check fails only for jobs that call out; the new job does not, so the test stays green. docs/runbooks/restore.md:36 unschedules every job on a copy, this one included.
- src/db/migration-safety.scan.test.ts: no hot table is touched.
- Rules: CLAUDE.md Database (never apply a migration by hand first; record the version; never edit a baseline) and docs/ci-migrations.md:30-46.

**Notes:** The verified report said to add the job 'in baseline_4's block and a new migration'; the baseline must not be edited, so only the new migration. Whether the postgres role may TRUNCATE or VACUUM FULL the table could not be checked here (production is not to be queried in this review). Fewer per-minute jobs (DQ-1) shrink the steady state further.
