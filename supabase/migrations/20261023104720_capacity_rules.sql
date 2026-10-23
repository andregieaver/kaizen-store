-- Usage and limits (D314, docs/capacity.md 3, step 1.3).
--
-- The bytes each store keeps in Storage, for the daily measuring. Every store bucket's paths start with the store's id (checked in
-- src/server/media.ts: product-media, page-videos, field-files and digital-files are `{storeId}/…`; src/server/invoice-storage.ts:
-- documents are `{storeId}/invoices|credit-notes/…`; src/server/data-job-store.ts: imports and exports are `{storeId}/{job}/…`);
-- Kaizena Flow's own files are under `platform/` and count as store null. Avatars are a person's, not a store's, and are left out.
-- Where there is no Storage (local and test databases) the library's own sizes (commerce.media) stand in.
CREATE OR REPLACE FUNCTION commerce.storage_bytes_by_store()
RETURNS TABLE (store_id uuid, bytes bigint)
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $fn$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN QUERY
      SELECT m.store_id, coalesce(sum(m.size_bytes), 0)::bigint
        FROM commerce.media m
       GROUP BY m.store_id;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $sql$
    SELECT s.id, coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
      FROM storage.objects o
      LEFT JOIN commerce.stores s ON s.id::text = split_part(o.name, '/', 1)
     WHERE o.bucket_id IN ('product-media', 'page-videos', 'field-files', 'digital-files', 'documents', 'imports', 'exports')
       AND (s.id IS NOT NULL OR split_part(o.name, '/', 1) = 'platform')
     GROUP BY s.id
  $sql$;
END;
$fn$;
--> statement-breakpoint
-- Every day at 03:17 UTC Supabase's scheduler asks Kaizena Flow to measure what each store used (docs/capacity.md step 1.3), as it
-- asks for the other jobs. Not where the extensions are missing, such as in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    PERFORM cron.schedule(
      'kaizen-usage',
      '17 3 * * *',
      $job$
        SELECT net.http_post(
          url := 'https://kaizenaflow.com/api/cron/usage',
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
