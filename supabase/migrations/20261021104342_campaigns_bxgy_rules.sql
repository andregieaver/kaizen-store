-- Buy X get Y (D299 E4, docs/wave-5-marketing.md 7.4): a store's copy carries a campaign's buy measure and get set, the get set
-- remapped to the copy's own products and terms; one whose get set named things and lost them all is switched off rather than left
-- to mean "the same as the buy set". Patched in place, so the earlier patches of `duplicate_store()` stay as they are.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_cols constant text := E'per_customer_limit, markets, amounts, tier_basis, tiers\n  )';
  v_vals constant text := E'c.per_customer_limit, c.markets, c.amounts, c.tier_basis, c.tiers\n';
  v_end constant text := E'WHERE c.store_id = p_source AND (c.gift_variant_id IS NULL OR g.new_id IS NOT NULL);\n';
BEGIN
  IF position('c.buy_min_quantity' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_cols, ''))) / length(v_cols) <> 1
     OR (length(v_def) - length(replace(v_def, v_vals, ''))) / length(v_vals) <> 1
     OR (length(v_def) - length(replace(v_def, v_end, ''))) / length(v_end) <> 1 THEN
    RAISE EXCEPTION 'duplicate_store: the campaigns copy is not where it was expected';
  END IF;
  v_def := replace(v_def, v_cols, E'per_customer_limit, markets, amounts, tier_basis, tiers, buy_min_quantity, buy_min_amounts,\n    get_product_ids, get_term_ids, get_quantity, get_kind, get_percent, get_amounts, uses_per_order\n  )');
  v_def := replace(v_def, v_vals, E'c.per_customer_limit, c.markets, c.amounts, c.tier_basis, c.tiers, c.buy_min_quantity, c.buy_min_amounts,\n         commerce.copy_remap(c.get_product_ids, p_source, v_store), commerce.copy_remap(c.get_term_ids, p_source, v_store),\n         c.get_quantity, c.get_kind, c.get_percent, c.get_amounts, c.uses_per_order\n');
  v_def := replace(v_def, v_end, v_end || E'\n  UPDATE commerce.campaigns d\n     SET active = false\n    FROM commerce.campaigns t\n   WHERE t.store_id = p_source AND t.kind = ''bxgy''\n     AND jsonb_array_length(t.get_product_ids) + jsonb_array_length(t.get_term_ids) > 0\n     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id)\n     AND jsonb_array_length(d.get_product_ids) + jsonb_array_length(d.get_term_ids) = 0;\n');
  EXECUTE v_def;
END
$patch$;
