# CR-5 ✓ pg_cron's own run log is never pruned and is 77% of the database

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.25.
- **Second check:** corrected.
- **Where:** `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:93-114`, `docs/runbooks/restore.md:32-36`
- **Evidence:** pg_cron writes one row to cron.job_run_details for every run and never deletes them. The baseline schedules 14 jobs; two are retention deletes for commerce tables, none for cron's own log. A search for job_run_details and log_run over src, scripts, docs and supabase/migrations finds nothing outside the first draft of this review. Measured in production: the cron schema is 564 MB of a 731 MB database; the app's own schema is 124 MB.
- **Cost today:** 564 MB today (measured), 77% of the database. It grows by 13,250 rows a day at today's schedule: estimate 8 to 21 MB a day, 3 to 8 GB a year (the row size is not measured). Paid by: The database: disk, every backup and every restore. It grows with the schedule, not with use.
- **Saving:** Up to 564 MB of 731 MB (measured size; how much comes back depends on the truncate or vacuum), and 8 to 21 MB a day of growth stopped (estimate).
- **Risk:** Low. The log is only useful for recent debugging; commerce.cron_jobs already keeps each job's health. If the postgres role may not delete from cron.job_run_details, the job fails quietly each hour and the size keeps growing: the done-when check catches it. Whether the role may delete was not checked in this review.

## The fix

1. One custom migration (name it cron_log_retention), inside the same guard as the baseline's cron block: cron.schedule('kaizen-cron-log-retention', '41 * * * *', a delete from cron.job_run_details where runid in (select runid from cron.job_run_details where end_time < now() - interval '7 days' limit 20000)). Delete in batches because the postgres role's 15 s statement limit (code review 1.5) most likely applies to pg_cron's own sessions too (not tested here); 24 batches of 20,000 clear the backlog in a day.
2. Once, by a person in the Supabase SQL editor after the first day: read the size (the 'size by schema' query in prod-db-stats.md), then truncate or vacuum full cron.job_run_details if the role is allowed. If it is not, do nothing more: the deleted space is reused and the file stops growing.
3. Record the migration's version and the decision in docs/decisions.md, and add the log to the retention list in docs/capacity.md.

**Done when:** select min(end_time) from cron.job_run_details is never older than 8 days, and the 'size by schema' query shows the cron schema under 60 MB after the one-off truncate (or the same size within 10 MB two weeks apart without it).

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/commerce.test.ts is not affected (the block is skipped where pg_cron is absent). src/db/migration-safety.scan.test.ts must pass for the file.
- scripts/restore-check.mjs:69 counts jobs that call out; the new job does not call out, so a restored copy is not flagged by it.
- Rule: docs/capacity.md:112 (a table that grows gets a retention rule). The log holds no personal data, so src/lib/retention.ts needs no new rule.

**Notes:** The auditor's first figure (190 MB) was an estimate; 564 MB is the measurement. CR-1's single tick cuts new rows by about 87%, so do this first and CR-1 after.
