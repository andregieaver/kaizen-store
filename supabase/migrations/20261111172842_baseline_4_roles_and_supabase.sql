-- kaizen:baseline-through=20261111172838_sms_campaign_index.sql
-- What a dump of one database cannot carry (code review FD3, D570), kept by hand and carried to each new cut by
-- scripts/squash-migrations.mjs: the `postgres` role's limits, and what exists only on Supabase (Storage buckets, the scheduler, its
-- secret). Written from production as it stood on 11 November 2026; each step guarded, so plain Postgres (CI, local databases, PGlite)
-- skips what it has not got. A later migration that adds such a step is folded in here at the next squash.

-- A transaction the app left unfinished must not hold one of the pooler's few connections (D37). `transaction_timeout` exists from
-- Postgres 17 (production).
ALTER ROLE postgres SET idle_in_transaction_session_timeout = '30s';
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE $sql$ALTER ROLE postgres SET transaction_timeout = '60s'$sql$;
  END IF;
END
$$;

-- Every query the app sends is bounded (code review 1.5, D567): 15 seconds to run, 5 to wait for a lock. Only on Supabase, so a slow
-- test machine is not cut short.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER ROLE postgres SET statement_timeout = '15s';
    ALTER ROLE postgres SET lock_timeout = '5s';
  END IF;
END
$$;

-- The dashboard's "enable RLS on new tables" function is SECURITY DEFINER: nobody calls it directly (an event trigger needs no EXECUTE).
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
    END IF;
  END IF;
END
$$;

-- Storage's buckets: none has a policy; the server reaches them with the secret key, the browser through signed addresses.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('api-uploads', 'api-uploads', false, 20971520, ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]),
      ('avatars', 'avatars', true, 524288, ARRAY['image/webp','image/jpeg']::text[]),
      ('digital-files', 'digital-files', false, NULL, NULL::text[]),
      ('documents', 'documents', false, NULL, NULL::text[]),
      ('exports', 'exports', false, NULL, ARRAY['text/csv']::text[]),
      ('field-files', 'field-files', true, 52428800, ARRAY['application/pdf','application/zip','text/plain','text/csv','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']::text[]),
      ('imports', 'imports', false, 15728640, ARRAY['text/csv','text/plain','application/vnd.ms-excel']::text[]),
      ('page-videos', 'page-videos', true, 52428800, ARRAY['video/mp4','video/webm']::text[]),
      ('product-media', 'product-media', true, 5242880, ARRAY['image/webp','image/jpeg','image/png','image/avif']::text[]),
      ('product-models', 'product-models', true, 20971520, ARRAY['model/gltf-binary']::text[]),
      ('review-pictures', 'review-pictures', false, 614400, ARRAY['image/webp','image/jpeg']::text[])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

-- The scheduler (D33): pg_cron calls the app's cron routes with a secret kept in Vault, and keeps two retention rules of its own.
-- `cron.schedule` with a name replaces the job of that name, so this can run again.
DO $do$
DECLARE
  call text := $call$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/%s',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'kaizen_cron_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $call$;
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
        'Bearer token pg_cron sends to Kaizena Flow''s scheduled jobs (D33)'
      );
    END IF;
    PERFORM cron.schedule('kaizen-autopilot', '* * * * *', format(call, 'autopilot'));
    PERFORM cron.schedule('kaizen-broadcasts', '* * * * *', format(call, 'broadcasts'));
    PERFORM cron.schedule('kaizen-cart-reminders', '*/5 * * * *', format(call, 'cart-reminders'));
    PERFORM cron.schedule('kaizen-cookie-scan', '* * * * *', format(call, 'cookie-scan'));
    PERFORM cron.schedule('kaizen-dream-factory', '* * * * *', format(call, 'dream-factory'));
    PERFORM cron.schedule('kaizen-integrations', '* * * * *', format(call, 'integrations'));
    PERFORM cron.schedule('kaizen-pack-pictures', '* * * * *', format(call, 'pack-pictures'));
    PERFORM cron.schedule('kaizen-page-jobs', '* * * * *', format(call, 'page-jobs'));
    PERFORM cron.schedule('kaizen-page-looks', '* * * * *', format(call, 'page-looks'));
    PERFORM cron.schedule('kaizen-subscription-reminders', '0 7 * * *', format(call, 'subscription-reminders'));
    PERFORM cron.schedule('kaizen-theme-shots', '* * * * *', format(call, 'theme-shots'));
    PERFORM cron.schedule('kaizen-usage', '17 3 * * *', format(call, 'usage'));
    PERFORM cron.schedule('kaizen-consent-retention', '17 3 * * *', $job$ DELETE FROM commerce.consents WHERE created_at < now() - interval '12 months' $job$);
    PERFORM cron.schedule('kaizen-cookie-scan-retention', '23 3 * * *', $job$
        DELETE FROM commerce.cookie_scans s
        WHERE s.created_at < now() - interval '90 days'
          AND s.id <> coalesce((
            SELECT l.id FROM commerce.cookie_scans l
            WHERE l.store_id IS NOT DISTINCT FROM s.store_id AND l.status = 'done'
            ORDER BY l.finished_at DESC LIMIT 1
          ), '00000000-0000-0000-0000-000000000000'::uuid)
      $job$);
  END IF;
END
$do$;
