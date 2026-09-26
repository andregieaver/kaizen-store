-- Consents (D58). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Proof of consent is kept 12 months, as long as a consent lasts: every
-- night the scheduler deletes older records. Not where pg_cron is missing,
-- such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'kaizen-consent-retention',
      '17 3 * * *',
      $job$ DELETE FROM commerce.consents WHERE created_at < now() - interval '12 months' $job$
    );
  END IF;
END;
$do$;
