-- The bucket of files sent with forms, and the rule that they never change.
-- Files sent with forms (D738 F6b, docs/forms.md 15.2): a private bucket of WebP, JPEG and PDF up to 3 MB, no policy. The server writes
-- and reads with the secret key; the owner downloads a file through the admin, never from a public address. Fold into baseline_4's bucket
-- list at the next quarterly squash.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('form-files', 'form-files', false, 3000000, ARRAY['image/webp', 'image/jpeg', 'application/pdf']::text[])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
--> statement-breakpoint

-- A response's files are what was sent, as its answers are (D738 F6b): only its state changes.
CREATE OR REPLACE FUNCTION commerce.form_responses_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT f.store_id INTO NEW.store_id FROM commerce.forms f WHERE f.id = NEW.form_id;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.answers IS DISTINCT FROM OLD.answers OR NEW.contact_email IS DISTINCT FROM OLD.contact_email OR NEW.path IS DISTINCT FROM OLD.path
     OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.delivery IS DISTINCT FROM OLD.delivery OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.files IS DISTINCT FROM OLD.files THEN
    RAISE EXCEPTION 'form_responses.fixed: a response keeps what was sent; only its state changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
