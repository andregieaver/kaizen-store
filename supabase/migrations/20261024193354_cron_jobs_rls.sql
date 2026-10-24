-- Scheduled jobs' last runs (PSI 2026-10-24, REL-06): written only by src/server/cron-runs.ts, never through the Data API.
ALTER TABLE commerce.cron_jobs ENABLE ROW LEVEL SECURITY;
