-- Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1): a change to a component is never refused for its bundle's sake. A component
-- whose VAT category moves away from its bundle's, or that stops being physical goods, makes the bundle one that cannot be bought (no stock in
-- `variant_availability`, which the cart and `placeOrder()` ask) until the owner takes it out or puts it back; the bundle's editor says why.
-- Writing components (`bundle_components_rules`) and changing the bundle's own VAT category or kind are still checked.

DROP TRIGGER IF EXISTS variants_bundle_rules ON commerce.product_variants;
--> statement-breakpoint
DROP FUNCTION IF EXISTS commerce.variants_bundle_rules();
--> statement-breakpoint

-- Only the bundle itself: its own VAT category or kind that changes is checked against its components.
CREATE OR REPLACE FUNCTION commerce.products_bundle_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_variant uuid;
  v_problem text;
BEGIN
  FOR v_variant IN
    SELECT DISTINCT bc.bundle_variant_id
      FROM commerce.bundle_components bc
      JOIN commerce.product_variants v ON v.store_id = bc.store_id AND v.id = bc.bundle_variant_id
     WHERE v.store_id = NEW.store_id AND v.product_id = NEW.id
  LOOP
    v_problem := commerce.bundle_problem(v_variant);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- The one reader of stock: a bundle with a component of another VAT category is not in stock either.
CREATE OR REPLACE VIEW commerce.variant_availability WITH (security_invoker = true) AS
SELECT v.store_id,
       v.id AS variant_id,
       v.delivery::text AS delivery,
       (CASE WHEN b.components > 0 THEN b.free ELSE a.free END)::integer AS in_stock,
       (CASE WHEN b.components > 0 THEN b.free ELSE a.available END)::integer AS raw_available,
       v.stock_policy,
       v.backorder_days,
       CASE WHEN b.components > 0 THEN b.free > 0 ELSE (a.free > 0 OR v.stock_policy = 'continue') END AS can_buy
  FROM commerce.product_variants v
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(s.available), 0) AS available,
           coalesce(sum(greatest(s.available, 0)), 0) AS free
      FROM commerce.available_stock s
      JOIN commerce.inventory_locations loc ON loc.store_id = s.store_id AND loc.id = s.location_id AND loc.active
     WHERE s.store_id = v.store_id AND s.variant_id = v.id
  ) a
  CROSS JOIN LATERAL (
    SELECT count(*) AS components,
           CASE
             WHEN count(*) = 0 THEN 0
             WHEN coalesce(sum(bc.quantity), 0) < 2 THEN 0
             WHEN bool_or(NOT cv.active OR cp.status = 'archived' OR cp.kind <> 'goods' OR cv.delivery <> 'physical' OR cp.vat_category <> bp.vat_category) THEN 0
             ELSE coalesce(min(floor(cf.free / bc.quantity)), 0)
           END AS free
      FROM commerce.bundle_components bc
      JOIN commerce.products bp ON bp.store_id = v.store_id AND bp.id = v.product_id
      JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
      JOIN commerce.products cp ON cp.store_id = cv.store_id AND cp.id = cv.product_id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(greatest(s.available, 0)), 0) AS free
          FROM commerce.available_stock s
          JOIN commerce.inventory_locations loc ON loc.store_id = s.store_id AND loc.id = s.location_id AND loc.active
         WHERE s.store_id = cv.store_id AND s.variant_id = cv.id
      ) cf
     WHERE bc.store_id = v.store_id AND bc.bundle_variant_id = v.id
  ) b;
