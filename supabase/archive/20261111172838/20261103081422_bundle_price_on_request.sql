-- A product priced on request in bundles (D433): it may be a component of a bundle with a price of its own (`bundle_pricing = 'fixed'`), never
-- of one priced from its components (`computed`), whose price `refresh_bundle_prices()` works out from the components' list prices and would
-- so sell the product at the price its owner keeps for quotes. Cart and checkout read only a line's own product (`not p.price_on_request`),
-- so a fixed bundle holding such a part sells as before.
--
-- * `bundle_on_request_problem()`: what is wrong with one bundle, or null; at commit, as the other bundle rules (D322).
-- * `bundle_components_on_request`: a component written into a computed bundle whose product is priced on request is refused (a, and the
--   components half of c).
-- * `products_bundle_on_request`: a bundle switched to `computed` while it holds such a part (c), and a product priced on request while one of
--   its variants is in a computed bundle (b), are refused. Read from the tables at commit, so a save that changes the pricing and the components
--   together is judged on what it leaves.
-- * A computed bundle that already holds such a part (possible since D431 for a day) is given a price of its own here, keeping the price it has,
--   so no row breaks the rule and no copy of a store trips on one.
--
-- Add only: nothing that runs today is dropped or renamed. Store copies (`clone_store()`, `duplicate_store()`) insert the products with their
-- pricing and flag, then the variants, then the components, all of a source that obeys the rule; the checks run at their commit and pass.

-- What is wrong with a bundle priced from its components that holds a product priced on request, or null.
CREATE FUNCTION commerce.bundle_on_request_problem(p_bundle_variant uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'bundle_components.price_on_request: a bundle priced from its components cannot hold a product priced on request; give the bundle a price of its own, or show the product''s price'
    FROM commerce.bundle_components bc
    JOIN commerce.product_variants bv ON bv.store_id = bc.store_id AND bv.id = bc.bundle_variant_id
    JOIN commerce.products bp ON bp.store_id = bv.store_id AND bp.id = bv.product_id
    JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
    JOIN commerce.products cp ON cp.store_id = cv.store_id AND cp.id = cv.product_id
   WHERE bc.bundle_variant_id = p_bundle_variant
     AND bp.bundle_pricing = 'computed'
     AND cp.price_on_request
   LIMIT 1
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.bundle_components_on_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_problem text;
BEGIN
  v_problem := commerce.bundle_on_request_problem(NEW.bundle_variant_id);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER bundle_components_on_request
  AFTER INSERT OR UPDATE ON commerce.bundle_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_on_request();
--> statement-breakpoint

-- A bundle's pricing or a product's flag that changes: the bundle against its parts, the product against the bundles it is in. The handles of
-- those bundles go in the detail (store data, never a shopper's).
CREATE FUNCTION commerce.products_bundle_on_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_variant uuid;
  v_problem text;
  v_bundles text;
BEGIN
  FOR v_variant IN
    SELECT v.id FROM commerce.product_variants v
     WHERE v.store_id = NEW.store_id AND v.product_id = NEW.id
       AND EXISTS (SELECT 1 FROM commerce.bundle_components bc WHERE bc.store_id = v.store_id AND bc.bundle_variant_id = v.id)
  LOOP
    v_problem := commerce.bundle_on_request_problem(v_variant);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  SELECT string_agg(DISTINCT bp.handle, ', ' ORDER BY bp.handle) INTO v_bundles
    FROM commerce.products cp
    JOIN commerce.product_variants cv ON cv.store_id = cp.store_id AND cv.product_id = cp.id
    JOIN commerce.bundle_components bc ON bc.store_id = cv.store_id AND bc.component_variant_id = cv.id
    JOIN commerce.product_variants bv ON bv.store_id = bc.store_id AND bv.id = bc.bundle_variant_id
    JOIN commerce.products bp ON bp.store_id = bv.store_id AND bp.id = bv.product_id
   WHERE cp.store_id = NEW.store_id AND cp.id = NEW.id
     AND cp.price_on_request
     AND bp.bundle_pricing = 'computed';
  IF v_bundles IS NOT NULL THEN
    RAISE EXCEPTION 'products.price_on_request_bundle: a product in a bundle priced from its components cannot be priced on request; give the bundle a price of its own first'
      USING ERRCODE = 'check_violation', DETAIL = v_bundles;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER products_bundle_on_request
  AFTER UPDATE OF bundle_pricing, price_on_request ON commerce.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.products_bundle_on_request();
--> statement-breakpoint

-- A computed bundle that already holds a part priced on request keeps the price it has, now as its own.
UPDATE commerce.products bp
   SET bundle_pricing = 'fixed', bundle_percent_off = NULL, updated_at = now()
 WHERE bp.kind = 'bundle'
   AND bp.bundle_pricing = 'computed'
   AND EXISTS (
     SELECT 1
       FROM commerce.product_variants bv
       JOIN commerce.bundle_components bc ON bc.store_id = bv.store_id AND bc.bundle_variant_id = bv.id
       JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
       JOIN commerce.products cp ON cp.store_id = cv.store_id AND cp.id = cv.product_id
      WHERE bv.store_id = bp.store_id AND bv.product_id = bp.id AND cp.price_on_request
   );
