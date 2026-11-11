-- Drop shipping (D550, docs/drop-shipping.md): a supplier's own location belongs to the original store's supplier, so a store's copies
-- (clone_store, duplicate_store) leave it out with the stock kept there. A copy's variants are the store's own (`supplier_id` is not in their
-- column lists), and suppliers are never copied (store-copy-rules.ts).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store'::regproc);
  IF position('supplier_id IS NULL' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'    FROM commerce.inventory_locations WHERE store_id = p_template_id;\n',
      E'    FROM commerce.inventory_locations WHERE store_id = p_template_id AND supplier_id IS NULL;\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the copy of the locations was not found'; END IF;
    v_def := v_new;
    v_new := replace(v_def,
      E'    FROM commerce.inventory_levels l\n   WHERE l.store_id = p_template_id\n',
      E'    FROM commerce.inventory_levels l\n   WHERE l.store_id = p_template_id\n     AND NOT EXISTS (SELECT 1 FROM commerce.inventory_locations sl WHERE sl.store_id = l.store_id AND sl.id = l.location_id AND sl.supplier_id IS NOT NULL)\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the copy of the levels was not found'; END IF;
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('commerce.duplicate_store'::regproc);
  IF position('supplier_id IS NULL' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'    FROM commerce.inventory_locations WHERE store_id = p_source;\n',
      E'    FROM commerce.inventory_locations WHERE store_id = p_source AND supplier_id IS NULL;\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the copy of the locations was not found'; END IF;
    v_def := v_new;
    v_new := replace(v_def,
      E'   WHERE l.store_id = p_source AND m.new_id IS NOT NULL;\n',
      E'   WHERE l.store_id = p_source AND m.new_id IS NOT NULL\n     AND NOT EXISTS (SELECT 1 FROM commerce.inventory_locations sl WHERE sl.store_id = l.store_id AND sl.id = l.location_id AND sl.supplier_id IS NOT NULL);\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the copy of the levels was not found'; END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
