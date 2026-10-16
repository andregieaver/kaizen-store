-- The scheduler's jobs call Kaizena Flow's own domain (D240). `kaizenstore.cloud` now redirects to `kaizenaflow.com` (308), and the
-- redirect drops the Authorization header, so every scheduled call was refused (401) once the domain moved: the five-minute job, the
-- cookie scan, the integrations and the daily reminders. Each job keeps its name, schedule and body; only the address changes. Not where
-- pg_cron is missing, such as in tests.
DO $do$
DECLARE
  job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR job IN SELECT jobid, command FROM cron.job WHERE command LIKE '%https://kaizenstore.cloud/api/cron/%' LOOP
      PERFORM cron.alter_job(job.jobid, command := replace(job.command, 'https://kaizenstore.cloud/api/cron/', 'https://kaizenaflow.com/api/cron/'));
    END LOOP;
  END IF;
END
$do$;
