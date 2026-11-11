-- Pre-orders (wave 12 unit B, D396, docs/wave-12-after-the-core.md B): a variant on pre-order keeps selling at zero (`continue`) with a release
-- date; `commerce.variant_availability` gives the date while it is in the future, and store copies carry it.

ALTER TABLE commerce.product_variants ADD CONSTRAINT product_variants_preorder
  CHECK (preorder_until IS NULL OR stock_policy = 'continue');
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_fn text;
BEGIN
  -- The availability view says the release date while it is in the future (its last column, so the view keeps its columns' order).
  v_def := pg_get_viewdef('commerce.variant_availability'::regclass);
  IF position('preorder_until' in v_def) = 0 THEN
    v_new := regexp_replace(v_def, 'AS can_buy\s+FROM', 'AS can_buy,
        CASE WHEN (v.preorder_until > CURRENT_DATE) THEN v.preorder_until ELSE NULL::date END AS preorder_until
   FROM');
    IF v_new = v_def THEN RAISE EXCEPTION 'variant_availability: the last column was not found'; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW commerce.variant_availability AS ' || v_new;
  END IF;

  -- A store's copy and a store made from a template keep a variant's release date with its stock policy.
  FOREACH v_fn IN ARRAY ARRAY['commerce.duplicate_store', 'commerce.clone_store'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = v_fn::regproc;
    IF position('backorder_days, preorder_until' in v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(replace(v_def,
      'stock_policy, backorder_days, low_stock_threshold,', 'stock_policy, backorder_days, preorder_until, low_stock_threshold,'),
      'v.stock_policy, v.backorder_days, v.low_stock_threshold,', 'v.stock_policy, v.backorder_days, v.preorder_until, v.low_stock_threshold,');
    IF v_new = v_def THEN RAISE EXCEPTION '%: the variant copy was not found', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
