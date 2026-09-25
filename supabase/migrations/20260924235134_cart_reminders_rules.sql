-- Reminders about carts left at checkout (decision D33). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.abandoned_checkouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.cart_reminder_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.email_opt_outs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The captured checkout goes with its cart.
ALTER TABLE commerce.abandoned_checkouts ADD CONSTRAINT abandoned_checkouts_cart_fk
  FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts (store_id, id) ON DELETE CASCADE;
--> statement-breakpoint
-- A deleted discount code leaves the reminder without one.
ALTER TABLE commerce.cart_reminder_steps ADD CONSTRAINT cart_reminder_steps_discount_fk
  FOREIGN KEY (store_id, discount_code_id) REFERENCES commerce.discount_codes (store_id, id)
  ON DELETE SET NULL (discount_code_id);
--> statement-breakpoint
-- Every five minutes the database asks Kaizen to send the cart reminders that are due. Only on
-- Supabase (pg_cron, pg_net and Vault); the bearer token is made here and never leaves the
-- database: Kaizen checks it against Vault.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'kaizen_cron_secret') THEN
      PERFORM vault.create_secret(
        encode(extensions.gen_random_bytes(32), 'hex'),
        'kaizen_cron_secret',
        'Bearer token pg_cron sends to Kaizen''s scheduled jobs (D33)'
      );
    END IF;
    PERFORM cron.schedule(
      'kaizen-cart-reminders',
      '*/5 * * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenstore.cloud/api/cron/cart-reminders',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        )
      $job$
    );
    -- The subscription reminders (D29), daily at 07:00 UTC, whether or not Vercel Cron has its secret.
    PERFORM cron.schedule(
      'kaizen-subscription-reminders',
      '0 7 * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenstore.cloud/api/cron/subscription-reminders',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        )
      $job$
    );
  END IF;
END
$do$;
