-- The autopilot's loop (D309, docs/ai-autopilot.md 7.3, 7.4): its settings are written only by src/server/autopilot-settings.ts, never through
-- the Data API.
ALTER TABLE commerce.autopilot_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Every minute Supabase's scheduler asks Kaizena Flow to run the next steps of the plans that are running, as it asks for the broadcasts.
-- Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-autopilot',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/autopilot',
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
END
$do$;
