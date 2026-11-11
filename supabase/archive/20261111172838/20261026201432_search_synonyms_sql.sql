-- Search synonyms (wave 6 unit F1, D324, docs/wave-6-catalogue.md F.1).
-- * Row security on, no policy, as every table of the private schema.
-- * `search_synonyms_rules()`: a store keeps at most 500 groups.
-- * `clone_store()` and `duplicate_store()` copy a store's groups with it.

ALTER TABLE commerce.search_synonyms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.search_synonyms_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('search_synonyms:' || NEW.store_id::text, 0));
  IF (SELECT count(*) FROM commerce.search_synonyms s WHERE s.store_id = NEW.store_id) >= 500 THEN
    RAISE EXCEPTION 'A store keeps at most 500 synonym groups.' USING ERRCODE = 'check_violation', CONSTRAINT = 'search_synonyms_max';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER search_synonyms_rules BEFORE INSERT ON commerce.search_synonyms
  FOR EACH ROW EXECUTE FUNCTION commerce.search_synonyms_rules();
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('search_synonyms' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.price_breaks (store_id, product_id, variant_id, from_quantity, percent, amounts)\n',
    E'  INSERT INTO commerce.search_synonyms (store_id, locale, kind, words, means, created_at, updated_at)\n  SELECT v_store, s.locale, s.kind, s.words, s.means, s.created_at, s.updated_at FROM commerce.search_synonyms s WHERE s.store_id = p_template_id;\n\n  INSERT INTO commerce.price_breaks (store_id, product_id, variant_id, from_quantity, percent, amounts)\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the price breaks insert was not found'; END IF;
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
  IF position('search_synonyms' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n',
    E'  INSERT INTO commerce.search_synonyms (store_id, locale, kind, words, means, created_at, updated_at)\n  SELECT v_store, s.locale, s.kind, s.words, s.means, s.created_at, s.updated_at FROM commerce.search_synonyms s WHERE s.store_id = p_source;\n\n  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the price anchor was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
