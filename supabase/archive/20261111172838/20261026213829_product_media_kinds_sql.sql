-- Videos and 3D in the product gallery (wave 6 unit G, D325, docs/wave-6-catalogue.md Unit G).
-- * The public `product-models` bucket: one GLB file per model, 20 MB at most, uploaded straight from the owner's browser into the store's
--   folder through a signed upload the server makes, readable by anyone as visitors must. Storage exists only on Supabase, so this does
--   nothing in plain Postgres (local development, CI, tests).
-- * `clone_store()` and `duplicate_store()` copy a gallery item's kind, source and file (and `clone_store()` the thumbnail it left out).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('product-models', 'product-models', true, 20971520, ARRAY['model/gltf-binary'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('m.media_url' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt)\n  SELECT v_store, commerce.clone_id(v_store, m.product_id), m.url, m.position, m.alt\n',
    E'  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt, thumbnail_url, kind, source, media_url)\n' ||
    E'  SELECT v_store, commerce.clone_id(v_store, m.product_id), m.url, m.position, m.alt, m.thumbnail_url, m.kind, m.source, m.media_url\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product media insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('pm.media_url' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt, thumbnail_url)\n  SELECT v_store, m.new_id, pm.url, pm.position, pm.alt, pm.thumbnail_url\n',
    E'  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt, thumbnail_url, kind, source, media_url)\n' ||
    E'  SELECT v_store, m.new_id, pm.url, pm.position, pm.alt, pm.thumbnail_url, pm.kind, pm.source, pm.media_url\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product media insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
