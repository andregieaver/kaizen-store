-- What a store does not sell in one of its countries (wave 7 unit A1, D335, docs/wave-7-storefront.md A.1).
--
-- * `market_availability` rows switch a product, or one of its variants, off in a market; the price is kept.
-- * `commerce.current_prices` leaves out a variant that is off in its market (its own row or its product's), and a bundle whose component is,
--   so every shopper-facing read treats it as not sold there, as a missing price is treated. `commerce.kept_prices` is the old view, every
--   current price, for the admin's reads that edit or report prices.
-- * `clone_store()` and `duplicate_store()` carry the rows (catalogue).

ALTER TABLE commerce.market_availability ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A variant's row names the product it belongs to.
CREATE FUNCTION commerce.market_availability_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.product_variants v
     WHERE v.id = NEW.variant_id AND v.store_id = NEW.store_id AND v.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'market_availability.variant: the variant is not one of the product''s'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'market_availability_variant';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER market_availability_rules
  BEFORE INSERT OR UPDATE ON commerce.market_availability
  FOR EACH ROW EXECUTE FUNCTION commerce.market_availability_rules();
--> statement-breakpoint

-- Every current price, also where the product or variant is off: the admin's own reads.
CREATE VIEW commerce.kept_prices
WITH (security_invoker = true)
AS
SELECT
  p.store_id,
  p.variant_id,
  p.market_code,
  p.currency,
  p.amount_minor,
  p.valid_from,
  commerce.prior_price(p.variant_id, p.market_code, p.valid_from) AS prior_30d_minor
FROM commerce.prices p
WHERE p.valid_to IS NULL;
--> statement-breakpoint

-- The prices shoppers are sold at: a variant off in that market, by its own row or its product's, is not; nor is a bundle with such a component.
CREATE OR REPLACE VIEW commerce.current_prices
WITH (security_invoker = true)
AS
SELECT
  p.store_id,
  p.variant_id,
  p.market_code,
  p.currency,
  p.amount_minor,
  p.valid_from,
  commerce.prior_price(p.variant_id, p.market_code, p.valid_from) AS prior_30d_minor
FROM commerce.prices p
WHERE p.valid_to IS NULL
  AND NOT EXISTS (
    SELECT 1
      FROM commerce.product_variants v
      JOIN commerce.market_availability a
        ON a.store_id = v.store_id AND a.product_id = v.product_id AND a.market_code = p.market_code
       AND (a.variant_id IS NULL OR a.variant_id = v.id)
     WHERE v.id = p.variant_id
  )
  AND NOT EXISTS (
    SELECT 1
      FROM commerce.bundle_components bc
      JOIN commerce.product_variants cv ON cv.id = bc.component_variant_id
      JOIN commerce.market_availability a
        ON a.store_id = cv.store_id AND a.product_id = cv.product_id AND a.market_code = p.market_code
       AND (a.variant_id IS NULL OR a.variant_id = cv.id)
     WHERE bc.bundle_variant_id = p.variant_id
  );
--> statement-breakpoint

-- `clone_store()` carries the rows, where the product, the variant and the market were copied.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('market_availability' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, commerce.clone_id(',
    E'  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n  SELECT v_store, commerce.clone_id(v_store, ma.product_id), CASE WHEN ma.variant_id IS NULL THEN NULL ELSE commerce.clone_id(v_store, ma.variant_id) END, ma.market_code\n    FROM commerce.market_availability ma\n   WHERE ma.store_id = p_template_id\n     AND EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = v_store AND p.id = commerce.clone_id(v_store, ma.product_id))\n     AND (ma.variant_id IS NULL OR EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, ma.variant_id)))\n     AND EXISTS (SELECT 1 FROM commerce.markets m WHERE m.store_id = v_store AND m.code = ma.market_code);\n\n  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, commerce.clone_id(');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the bundle components insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- `duplicate_store()` too, for the products and variants it copies.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('market_availability' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, mb.new_id',
    E'  INSERT INTO commerce.market_availability (store_id, product_id, variant_id, market_code)\n  SELECT v_store, mp.new_id, mv.new_id, ma.market_code\n    FROM commerce.market_availability ma\n    JOIN pg_temp._copy_ids mp ON mp.old_id = ma.product_id\n    LEFT JOIN pg_temp._copy_ids mv ON mv.old_id = ma.variant_id\n   WHERE ma.store_id = p_source AND mp.new_id IS NOT NULL\n     AND (ma.variant_id IS NULL OR mv.new_id IS NOT NULL)\n     AND EXISTS (SELECT 1 FROM commerce.markets m WHERE m.store_id = v_store AND m.code = ma.market_code);\n\n  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, mb.new_id');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the bundle components insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
