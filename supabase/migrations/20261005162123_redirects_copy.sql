-- Copying a store keeps its categories' and tags' search texts (wave 2, D168, docs/wave-2-redirects.md 3.5): `terms.seo` is the store's own
-- set-up, so a new store from the template (`clone_store()`) and a copy of a store (`duplicate_store()`) carry it with the term. Redirects and the
-- 404 report are history of the original's addresses and are never copied (`never` in COPY_RULES), and neither function inserts into them.
-- The live definitions are patched, one change each (as 20261004171501_unit_price_rules.sql did), so nothing a later migration changed is lost.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('requires_unit_price, seo' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, requires_unit_price)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, requires_unit_price, seo)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price, seo\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the term insert was not found, so seo is not copied'; END IF;
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
  IF position('requires_unit_price, seo' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the term insert was not found, so seo is not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
