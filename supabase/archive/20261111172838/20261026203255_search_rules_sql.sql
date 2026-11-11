-- Search merchandising (wave 6 unit F2, D324, docs/wave-6-catalogue.md F.2).
-- * Row security on, no policy, as every table of the private schema.
-- * `search_rules_rules()`: a store keeps at most 200 rules.
-- * `clone_store()` and `duplicate_store()` copy a store's rules with it, products and terms mapped to the copy's (a rule whose product was
--   left behind stays behind).

ALTER TABLE commerce.search_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION commerce.search_rules_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('search_rules:' || NEW.store_id::text, 0));
  IF (SELECT count(*) FROM commerce.search_rules r WHERE r.store_id = NEW.store_id) >= 200 THEN
    RAISE EXCEPTION 'A store keeps at most 200 search rules.' USING ERRCODE = 'check_violation', CONSTRAINT = 'search_rules_max';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER search_rules_rules BEFORE INSERT ON commerce.search_rules
  FOR EACH ROW EXECUTE FUNCTION commerce.search_rules_rules();
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('search_rules' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'FROM commerce.search_synonyms s WHERE s.store_id = p_template_id;\n',
    E'FROM commerce.search_synonyms s WHERE s.store_id = p_template_id;\n\n' ||
    E'  INSERT INTO commerce.search_rules (store_id, action, product_id, term_id, target, queries, match, position, created_at, updated_at)\n' ||
    E'  SELECT v_store, r.action, CASE WHEN r.product_id IS NOT NULL THEN commerce.clone_id(v_store, r.product_id) END,\n' ||
    E'         CASE WHEN r.term_id IS NOT NULL THEN commerce.clone_id(v_store, r.term_id) END, r.target, r.queries, r.match, r.position, r.created_at, r.updated_at\n' ||
    E'    FROM commerce.search_rules r\n' ||
    E'   WHERE r.store_id = p_template_id\n' ||
    E'     AND (r.product_id IS NULL OR EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = v_store AND p.id = commerce.clone_id(v_store, r.product_id)))\n' ||
    E'     AND (r.term_id IS NULL OR EXISTS (SELECT 1 FROM commerce.terms t WHERE t.store_id = v_store AND t.id = commerce.clone_id(v_store, r.term_id)));\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the search synonyms insert was not found'; END IF;
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
  IF position('search_rules' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'FROM commerce.search_synonyms s WHERE s.store_id = p_source;\n',
    E'FROM commerce.search_synonyms s WHERE s.store_id = p_source;\n\n' ||
    E'  INSERT INTO commerce.search_rules (store_id, action, product_id, term_id, target, queries, match, position, created_at, updated_at)\n' ||
    E'  SELECT v_store, r.action, mp.new_id, mt.new_id, r.target, r.queries, r.match, r.position, r.created_at, r.updated_at\n' ||
    E'    FROM commerce.search_rules r\n' ||
    E'    LEFT JOIN pg_temp._copy_ids mp ON mp.old_id = r.product_id\n' ||
    E'    LEFT JOIN pg_temp._copy_ids mt ON mt.old_id = r.term_id\n' ||
    E'   WHERE r.store_id = p_source AND (r.product_id IS NULL OR mp.new_id IS NOT NULL) AND (r.term_id IS NULL OR mt.new_id IS NOT NULL);\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the search synonyms insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
