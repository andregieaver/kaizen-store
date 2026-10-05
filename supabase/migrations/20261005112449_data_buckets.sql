-- Data in and out (wave 2, D165, docs/wave-2-data.md 3.5): two private Storage buckets.
--
-- * `imports`: the CSV of a product import, `{store}/{uuid}/{safe name}`. Up to 15 MiB (`IMPORT_MAX_BYTES`), text only. The
--   browser uploads straight to it with a signed upload address the server makes; it has no storage policy of its own.
-- * `exports`: the parts of an export, `{store}/{job}/part-{n}.csv`. Written and read only by the server with the secret key,
--   like `documents`; a download is a signed address of 60 seconds made when a member presses the button.
--
-- Neither is public and neither has a policy. Files are deleted by application code (`pruneDataJobs()`), never SQL.
-- Storage exists only on Supabase, so this does nothing in plain Postgres (tests, CI, local development).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('imports', 'imports', false, 15728640, ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel'])
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
    VALUES ('exports', 'exports', false, ARRAY['text/csv'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
