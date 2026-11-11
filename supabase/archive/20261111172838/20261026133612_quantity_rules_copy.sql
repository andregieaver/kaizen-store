-- Quantity rules (wave 6 unit E1, D323, docs/wave-6-catalogue.md E.1): `clone_store()` and `duplicate_store()` carry a variant's minimum,
-- maximum and step with the rest of it.

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('quantity_step' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold\n  )\n  SELECT commerce.clone_id(v_store, v.id),',
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold,\n    min_quantity, max_quantity, quantity_step\n  )\n  SELECT commerce.clone_id(v_store, v.id),');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the variant insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold\n    FROM commerce.product_variants v\n    JOIN commerce.products p ON p.id = v.product_id\n',
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold,\n         v.min_quantity, v.max_quantity, v.quantity_step\n    FROM commerce.product_variants v\n    JOIN commerce.products p ON p.id = v.product_id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the variant select was not found'; END IF;
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
  IF position('quantity_step' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold\n  )\n  SELECT m.new_id,',
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold,\n    min_quantity, max_quantity, quantity_step\n  )\n  SELECT m.new_id,');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the variant insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold\n    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id\n',
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold,\n         v.min_quantity, v.max_quantity, v.quantity_step\n    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the variant select was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
