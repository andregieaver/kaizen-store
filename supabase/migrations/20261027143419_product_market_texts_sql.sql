-- A product's description for one country (wave 7 unit D, D338, docs/wave-7-storefront.md D1):
-- * private, as every commerce table: RLS on, no policy (server code reaches it through `db()`);
-- * catalogue: `clone_store()` and `duplicate_store()` carry the rows with the product, in the markets the copy has.

ALTER TABLE commerce.product_market_texts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('product_market_texts' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n',
    E'  INSERT INTO commerce.product_market_texts (store_id, product_id, market_code, locale, description)\n  SELECT v_store, commerce.clone_id(v_store, mt.product_id), mt.market_code, mt.locale, mt.description\n    FROM commerce.product_market_texts mt\n   WHERE mt.store_id = p_template_id\n     AND EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = v_store AND p.id = commerce.clone_id(v_store, mt.product_id))\n     AND EXISTS (SELECT 1 FROM commerce.markets m WHERE m.store_id = v_store AND m.code = mt.market_code);\n\n  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the market availability insert was not found'; END IF;
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
  IF position('product_market_texts' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n',
    E'  INSERT INTO commerce.product_market_texts (store_id, product_id, market_code, locale, description)\n  SELECT v_store, mp.new_id, mt.market_code, mt.locale, mt.description\n    FROM commerce.product_market_texts mt\n    JOIN pg_temp._copy_ids mp ON mp.old_id = mt.product_id\n   WHERE mt.store_id = p_source AND mp.new_id IS NOT NULL\n     AND EXISTS (SELECT 1 FROM commerce.markets m WHERE m.store_id = v_store AND m.code = mt.market_code);\n\n  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the market availability insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
