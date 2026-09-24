-- Product pictures live in a public Supabase Storage bucket, one folder per
-- store. Only the server uploads (with the secret key); anyone can read, as
-- shoppers must. The browser shrinks pictures to WebP before upload, so the
-- 5 MB limit is generous.
--
-- Storage exists only on Supabase, so this does nothing in plain Postgres
-- (local development, CI, tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('product-media', 'product-media', true, 5242880,
            ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
