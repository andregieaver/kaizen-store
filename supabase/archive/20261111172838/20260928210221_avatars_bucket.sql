-- Profile pictures (D97) of accounts and store customers live in a public
-- Supabase Storage bucket: `accounts/{account}/…` and
-- `customers/{store}/{customer}/…`, each a new random name, uploaded by the
-- server with the secret key after the browser has cropped the picture to a
-- small square. Anyone with the address can read it, as with product
-- pictures; addresses are only shown to the person and to the store's staff.
--
-- Storage exists only on Supabase, so this does nothing in plain Postgres
-- (local development, CI, tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('avatars', 'avatars', true, 524288, ARRAY['image/webp', 'image/jpeg'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
