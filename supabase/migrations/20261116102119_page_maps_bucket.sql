-- Heatmaps' pictures (D656, docs/heatmaps-and-recordings.md 6.3): a private bucket, JPEG only, no policy. The server writes with the
-- secret key and the admin shows a picture through a signed address. Fold into baseline_4's bucket list at the next quarterly squash.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('page-maps', 'page-maps', false, 10485760, ARRAY['image/jpeg']::text[])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
