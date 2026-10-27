-- Producer responsibility (wave 7 unit H, D342, docs/wave-7-storefront.md section 4, H):
-- * `commerce.registration_blocks()` is the one rule: a product under a scheme is not sold in a market where the store has no
--   registration (or recorded exemption) valid on the store's own day. A registration that ends on a day still covers that day, so a
--   lapsed one blocks from the next. `commerce.missing_registrations` reads it, and `commerce.line_unregistered()` answers for a cart
--   or order line (the variant's product, and a bundle's components' products), read by the cart and `placeOrder()` alike.
-- * A registration is the company's: `duplicate_store()` no longer copies them (COPY_RULES `never`); `clone_store()` never did.
-- * The template's demo products no longer carry schemes: a demo store has no registrations, and its demo goods would not be sold.

-- The products under a scheme in a market where nothing valid covers it on `p_on` (the store's today when null). Active markets only.
CREATE FUNCTION commerce.registration_blocks(
  p_store uuid,
  p_market text DEFAULT NULL,
  p_product uuid DEFAULT NULL,
  p_on date DEFAULT NULL
)
RETURNS TABLE (product_id uuid, market_code text, scheme commerce.producer_scheme)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT ps.product_id, m.code::text, ps.scheme
    FROM commerce.product_schemes ps
    JOIN commerce.stores s ON s.id = ps.store_id
    JOIN commerce.markets m ON m.store_id = ps.store_id AND m.active
   WHERE ps.store_id = p_store
     AND (p_market IS NULL OR m.code = p_market)
     AND (p_product IS NULL OR ps.product_id = p_product)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.producer_registrations r
        WHERE r.store_id = ps.store_id
          AND r.market_code = m.code
          AND r.scheme = ps.scheme
          AND r.valid_from <= coalesce(p_on, (now() AT TIME ZONE s.time_zone)::date)
          AND (r.valid_to IS NULL OR r.valid_to >= coalesce(p_on, (now() AT TIME ZONE s.time_zone)::date))
     )
$$;
--> statement-breakpoint

-- Whether a line of this variant cannot be sold in the market for a missing registration: its own product's schemes, or a bundle's
-- components' products' (D322).
CREATE FUNCTION commerce.line_unregistered(p_store uuid, p_market text, p_variant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM commerce.product_variants v
      CROSS JOIN LATERAL commerce.registration_blocks(p_store, p_market, v.product_id) b
     WHERE v.store_id = p_store AND v.id = p_variant
  ) OR EXISTS (
    SELECT 1
      FROM commerce.bundle_components bc
      JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
      CROSS JOIN LATERAL commerce.registration_blocks(p_store, p_market, cv.product_id) b
     WHERE bc.store_id = p_store AND bc.bundle_variant_id = p_variant
  )
$$;
--> statement-breakpoint

-- The view keeps its columns, read through the rule.
CREATE OR REPLACE VIEW commerce.missing_registrations
WITH (security_invoker = true)
AS
SELECT p.store_id, p.id AS product_id, p.handle, b.market_code::character(2) AS market_code, b.scheme
  FROM commerce.products p
  CROSS JOIN LATERAL commerce.registration_blocks(p.store_id, NULL, p.id) b
 WHERE p.status = 'active';
--> statement-breakpoint

-- A copy carries no registration: they are the company's.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('commerce.producer_registrations' IN v_def) = 0 THEN RETURN; END IF;
  v_new := regexp_replace(v_def,
    E'  INSERT INTO commerce\\.producer_registrations \\(.*?FROM commerce\\.producer_registrations WHERE store_id = p_source;\\n\\n',
    '', 's');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the producer registrations insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The template's demo products (docs/platform.md, P4): no schemes, so a new store's demo goods sell until its owner tags its own.
DELETE FROM commerce.product_schemes ps
 USING commerce.stores s
 WHERE s.id = ps.store_id AND s.is_template;
