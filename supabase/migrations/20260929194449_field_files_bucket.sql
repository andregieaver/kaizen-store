-- Files for custom fields (D118) live in a public Supabase Storage bucket, one
-- folder per store. Like videos, they are uploaded from the owner's browser
-- straight to the bucket through a signed upload the server makes for one new
-- path; anyone can read, as visitors must. 50 MB is Storage's own limit per file.
--
-- Storage exists only on Supabase, so this does nothing in plain Postgres
-- (local development, CI, tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'field-files', 'field-files', true, 52428800,
      ARRAY[
        'application/pdf', 'application/zip', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ]
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
