-- Campaigns in depth (D299 E3, docs/wave-5-marketing.md 7.3): a store's copy carries an amount campaign's amounts and a tiered
-- campaign's basis and steps. Patched in place, so the earlier patches of `duplicate_store()` stay as they are.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_cols constant text := E'per_customer_limit, markets\n  )';
  v_vals constant text := E'c.per_customer_limit, c.markets\n';
BEGIN
  IF position('c.amounts, c.tier_basis, c.tiers' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_cols, ''))) / length(v_cols) <> 1
     OR (length(v_def) - length(replace(v_def, v_vals, ''))) / length(v_vals) <> 1 THEN
    RAISE EXCEPTION 'duplicate_store: the campaigns copy is not where it was expected';
  END IF;
  v_def := replace(v_def, v_cols, E'per_customer_limit, markets, amounts, tier_basis, tiers\n  )');
  v_def := replace(v_def, v_vals, E'c.per_customer_limit, c.markets, c.amounts, c.tier_basis, c.tiers\n');
  EXECUTE v_def;
END
$patch$;
