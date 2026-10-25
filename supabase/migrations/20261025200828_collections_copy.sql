-- Copying a store keeps its categories' and tags' own pages and the owner's order of their products (wave 6 unit A, D319,
-- docs/wave-6-catalogue.md 3.5): `terms.description`, `image_url`, `image_thumbnail_url` and `texts` are the store's own set-up, and
-- `product_terms.position` is part of the catalogue, so `clone_store()` (a new store from its template) and `duplicate_store()` (a copy of a
-- store) carry them. Pictures keep their addresses here; `duplicate_store()`'s job moves them into the copy's library as it does every
-- other address (`mediaUses()`, `rewriteAddresses()`). The live definitions are patched, one change each (as 20261005162123_redirects_copy.sql
-- did), so nothing a later migration changed is lost.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('requires_unit_price, seo, description' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, requires_unit_price, seo)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price, seo\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the term insert was not found, so the term pages are not copied'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'INSERT INTO commerce.product_terms (store_id, product_id, term_id)\n  SELECT v_store, commerce.clone_id(v_store, pt.product_id), commerce.clone_id(v_store, pt.term_id)\n',
    E'INSERT INTO commerce.product_terms (store_id, product_id, term_id, position)\n  SELECT v_store, commerce.clone_id(v_store, pt.product_id), commerce.clone_id(v_store, pt.term_id), pt.position\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product term insert was not found, so the order is not copied'; END IF;
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
  IF position('requires_unit_price, seo, description' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo\n',
    E'INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts)\n  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position, created_at, updated_at, requires_unit_price, seo, description, image_url, image_thumbnail_url, texts\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the term insert was not found, so the term pages are not copied'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'INSERT INTO commerce.product_terms (store_id, product_id, term_id, content_type)\n  SELECT v_store, m.new_id, commerce.clone_id(v_store, pt.term_id), pt.content_type\n',
    E'INSERT INTO commerce.product_terms (store_id, product_id, term_id, content_type, position)\n  SELECT v_store, m.new_id, commerce.clone_id(v_store, pt.term_id), pt.content_type, pt.position\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product term insert was not found, so the order is not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
