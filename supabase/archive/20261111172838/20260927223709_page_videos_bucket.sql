-- Background videos for page rows live in a public Supabase Storage bucket,
-- one folder per store ("platform" for Kaizen's pages). Videos are too large
-- for a server request, so the owner's browser uploads each straight to the
-- bucket through a signed upload the server makes for one new path; anyone
-- can read, as visitors must. 50 MB is Storage's own limit per file.
--
-- Storage exists only on Supabase, so this does nothing in plain Postgres
-- (local development, CI, tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('page-videos', 'page-videos', true, 52428800, ARRAY['video/mp4', 'video/webm'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
