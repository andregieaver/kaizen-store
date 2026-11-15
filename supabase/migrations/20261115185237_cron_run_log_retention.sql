-- pg_cron's own run log (cron.job_run_details) grows by one row a run and nothing pruned it: 564 MB of a 731 MB database on 11 November 2026.
-- Emptied once here, then kept to seven days by a daily job. Nothing reads the log: the app's own ledger of jobs is commerce.cron_jobs.
-- A database without pg_cron (the tests' PGlite, CI's Postgres) has no cron schema and skips all of it.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
    AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'cron' AND c.relname = 'job_run_details') THEN
    IF has_table_privilege(current_user, 'cron.job_run_details', 'TRUNCATE') THEN
      TRUNCATE cron.job_run_details;
    ELSIF has_table_privilege(current_user, 'cron.job_run_details', 'DELETE') THEN
      DELETE FROM cron.job_run_details WHERE coalesce(end_time, start_time) < now() - interval '7 days';
    ELSE
      RAISE NOTICE 'cron.job_run_details: no right to truncate or delete; the backlog stays';
    END IF;
    -- cron.schedule with a name replaces the job of that name, so this can run again.
    PERFORM cron.schedule('kaizen-cron-log-retention', '41 3 * * *', $job$ DELETE FROM cron.job_run_details WHERE coalesce(end_time, start_time) < now() - interval '7 days' $job$);
  END IF;
END
$do$;
