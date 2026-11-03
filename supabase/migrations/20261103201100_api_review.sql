-- The Admin API's review fixes (wave 14 unit C, D440 review). All additive.
--
-- * `integration_deliveries.erased_at`: a delivery about a person who was erased (D162) loses its payload, is not sent if it waits, and is
--   never sent again (`resendDelivery()`).
-- * `integration_deliveries_unbuilt_idx`: the deliveries not built yet, which `queue_integration_event()` looks for (per endpoint, subject
--   and event) inside every transaction that queues one, `inventory.updated` from each stock write.
-- * The `api-uploads` bucket: pictures sent over the Admin API (`POST /media/uploads`), private, picture types only, up to 20 MiB
--   (`UPLOAD_MAX_BYTES`). The server signs a one-time upload address for it and reads, then removes, the file; no policy of its own.
--   Storage exists only on Supabase, so this part does nothing in plain Postgres (tests, CI, local development).
ALTER TABLE "commerce"."integration_deliveries" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "integration_deliveries_unbuilt_idx" ON "commerce"."integration_deliveries" USING btree ("endpoint_id","subject_id","event") WHERE "commerce"."integration_deliveries"."status" = 'pending' and "commerce"."integration_deliveries"."payload" is null;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('api-uploads', 'api-uploads', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
