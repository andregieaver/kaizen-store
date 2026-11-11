-- Looks at pages (D310, docs/ai-autopilot.md 9): written only by src/server/page-looks.ts, never through the Data API.
ALTER TABLE commerce.page_looks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Every minute Supabase's scheduler asks Kaizena Flow to take the looks still waiting (a look is usually taken at once, when it is asked
-- for). Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-page-looks',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/page-looks',
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
