-- Cookie scans and owners' notes on what they find (D58). Like every
-- commerce table: row-level security on, no policies.
ALTER TABLE commerce.cookie_scans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.cookie_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every minute Supabase's scheduler asks Kaizen to run the next scan: one
-- an owner asked for, else the site scanned longest ago once its last scan
-- is a week old. Every night scans older than 90 days go, except each
-- site's latest finished one. Not where the extensions are missing, such
-- as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-cookie-scan',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenstore.cloud/api/cron/cookie-scan',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'kaizen-cookie-scan-retention',
      '23 3 * * *',
      $job$
        DELETE FROM commerce.cookie_scans s
        WHERE s.created_at < now() - interval '90 days'
          AND s.id <> coalesce((
            SELECT l.id FROM commerce.cookie_scans l
            WHERE l.store_id IS NOT DISTINCT FROM s.store_id AND l.status = 'done'
            ORDER BY l.finished_at DESC LIMIT 1
          ), '00000000-0000-0000-0000-000000000000'::uuid)
      $job$
    );
  END IF;
END
$do$;
