-- Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1 and D.2):
-- * a bundle's components are goods variants delivered physically, of the bundle's store and VAT category, never a bundle's own, at most 20
--   a bundle (`bundle_components_rules()`, at commit); a VAT category change that would break a bundle is refused too;
-- * a bundle's variant holds no stock of its own: its stock is the lowest whole number of bundles its components' free stock allows, worked
--   out inside `variant_availability` (never on backorder; none with an inactive or archived component, or fewer than two units in all);
-- * a computed bundle's price is the components' current prices times their quantities, less its percentage, half up, written through
--   `set_price()` at commit by `refresh_bundle_prices()` when its components, its pricing or a component's price change;
-- * `order_line_components` are frozen; payment's `draw_order_stock()` draws a bundle line's components and never the bundle's own variant;
-- * `clone_store()` and `duplicate_store()` carry the pricing columns and the components (where both variants are copied).

ALTER TABLE commerce.bundle_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_line_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- What is wrong with a bundle's components, or null: the per-component rules, read at commit.
CREATE FUNCTION commerce.bundle_problem(p_bundle_variant uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bundle record;
  v_bad record;
  v_count integer;
BEGIN
  SELECT v.store_id, p.kind, p.vat_category INTO v_bundle
    FROM commerce.product_variants v JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
   WHERE v.id = p_bundle_variant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_count FROM commerce.bundle_components WHERE bundle_variant_id = p_bundle_variant;
  IF v_count = 0 THEN RETURN NULL; END IF;
  IF v_bundle.kind <> 'bundle' THEN
    RETURN 'bundle_components.bundle: only a bundle has components';
  END IF;
  IF v_count > 20 THEN
    RETURN 'bundle_components.max: a bundle has at most 20 components';
  END IF;
  SELECT cp.kind, cv.delivery::text AS delivery, cp.vat_category INTO v_bad
    FROM commerce.bundle_components bc
    JOIN commerce.product_variants cv ON cv.store_id = bc.store_id AND cv.id = bc.component_variant_id
    JOIN commerce.products cp ON cp.store_id = cv.store_id AND cp.id = cv.product_id
   WHERE bc.bundle_variant_id = p_bundle_variant
     AND (cp.kind <> 'goods' OR cv.delivery <> 'physical' OR cp.vat_category <> v_bundle.vat_category)
   LIMIT 1;
  IF FOUND THEN
    IF v_bad.kind <> 'goods' OR v_bad.delivery <> 'physical' THEN
      RETURN 'bundle_components.goods: a component is goods sent by post';
    END IF;
    RETURN 'bundle_components.vat_category: a bundle and its components take one VAT category';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.bundle_components_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_problem text;
BEGIN
  v_problem := commerce.bundle_problem(NEW.bundle_variant_id);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER bundle_components_rules
  AFTER INSERT OR UPDATE ON commerce.bundle_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_rules();
--> statement-breakpoint

-- A product's VAT category or kind that changes is checked against every bundle it is in or is.
CREATE FUNCTION commerce.products_bundle_rules()
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
      JOIN commerce.product_variants v ON v.store_id = bc.store_id AND (v.id = bc.bundle_variant_id OR v.id = bc.component_variant_id)
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

CREATE CONSTRAINT TRIGGER products_bundle_rules
  AFTER UPDATE OF vat_category, kind ON commerce.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.products_bundle_rules();
--> statement-breakpoint

-- A component variant that stops being physical breaks its bundles too.
CREATE FUNCTION commerce.variants_bundle_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_variant uuid;
  v_problem text;
BEGIN
  FOR v_variant IN
    SELECT bc.bundle_variant_id FROM commerce.bundle_components bc
     WHERE bc.store_id = NEW.store_id AND bc.component_variant_id = NEW.id
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

CREATE CONSTRAINT TRIGGER variants_bundle_rules
  AFTER UPDATE OF delivery ON commerce.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.variants_bundle_rules();
--> statement-breakpoint

-- A bundle's variant holds no stock of its own: its stock comes from its components.
CREATE FUNCTION commerce.inventory_levels_not_bundle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM commerce.product_variants v JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
     WHERE v.store_id = NEW.store_id AND v.id = NEW.variant_id AND p.kind = 'bundle'
  ) THEN
    RAISE EXCEPTION 'inventory_levels.bundle: a bundle holds no stock of its own; its components do' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_levels_not_bundle
  BEFORE INSERT ON commerce.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION commerce.inventory_levels_not_bundle();
--> statement-breakpoint

-- What a bundle's components sold with an order are: never changed or deleted.
CREATE FUNCTION commerce.order_line_components_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'order_line_components.frozen: a bundle''s components on an order are kept as sold' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER order_line_components_frozen
  BEFORE UPDATE OR DELETE ON commerce.order_line_components
  FOR EACH ROW EXECUTE FUNCTION commerce.order_line_components_frozen();
--> statement-breakpoint

-- The one reader of stock, with a bundle's stock worked out from its components (same columns as before).
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
             WHEN bool_or(NOT cv.active OR cp.status = 'archived' OR cp.kind <> 'goods' OR cv.delivery <> 'physical') THEN 0
             ELSE coalesce(min(floor(cf.free / bc.quantity)), 0)
           END AS free
      FROM commerce.bundle_components bc
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
--> statement-breakpoint

-- A computed bundle's price in a market (or every market): the components' current prices times their quantities, less its percentage,
-- half up. Written through `set_price()` only when it changes and only where every component has a price.
CREATE FUNCTION commerce.refresh_bundle_prices(p_bundle_variant uuid, p_market char(2) DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bundle record;
  v_market record;
  v_count integer;
  v_priced integer;
  v_total bigint;
  v_amount bigint;
  v_current record;
BEGIN
  SELECT v.store_id, p.bundle_pricing, p.bundle_percent_off INTO v_bundle
    FROM commerce.product_variants v JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
   WHERE v.id = p_bundle_variant;
  IF NOT FOUND OR v_bundle.bundle_pricing IS DISTINCT FROM 'computed' THEN RETURN; END IF;
  FOR v_market IN
    SELECT m.code FROM commerce.markets m
     WHERE m.store_id = v_bundle.store_id AND (p_market IS NULL OR m.code = p_market)
     ORDER BY m.code
  LOOP
    SELECT count(*), count(pr.amount_minor), sum(pr.amount_minor * bc.quantity)
      INTO v_count, v_priced, v_total
      FROM commerce.bundle_components bc
      LEFT JOIN commerce.prices pr ON pr.variant_id = bc.component_variant_id AND pr.market_code = v_market.code AND pr.valid_to IS NULL
     WHERE bc.store_id = v_bundle.store_id AND bc.bundle_variant_id = p_bundle_variant;
    CONTINUE WHEN v_count = 0 OR v_priced < v_count;
    v_amount := (v_total * (100 - v_bundle.bundle_percent_off) + 50) / 100;
    SELECT amount_minor, valid_from INTO v_current FROM commerce.prices
     WHERE variant_id = p_bundle_variant AND market_code = v_market.code AND valid_to IS NULL;
    CONTINUE WHEN FOUND AND v_current.amount_minor = v_amount;
    PERFORM commerce.set_price(
      p_bundle_variant, v_market.code, v_amount,
      CASE WHEN v_current.valid_from IS NOT NULL AND v_current.valid_from >= now() THEN v_current.valid_from + interval '1 microsecond' ELSE now() END
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.bundle_components_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.refresh_bundle_prices(CASE WHEN TG_OP = 'DELETE' THEN OLD.bundle_variant_id ELSE NEW.bundle_variant_id END);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- At commit, so a save that writes several components sets the price once, from the final components.
CREATE CONSTRAINT TRIGGER bundle_components_refresh
  AFTER INSERT OR UPDATE OR DELETE ON commerce.bundle_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_refresh();
--> statement-breakpoint

CREATE FUNCTION commerce.products_bundle_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_variant uuid;
BEGIN
  FOR v_variant IN SELECT id FROM commerce.product_variants WHERE store_id = NEW.store_id AND product_id = NEW.id LOOP
    PERFORM commerce.refresh_bundle_prices(v_variant);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER products_bundle_refresh
  AFTER UPDATE OF bundle_pricing, bundle_percent_off ON commerce.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION commerce.products_bundle_refresh();
--> statement-breakpoint

-- A component's new price moves every computed bundle it is in, in that market.
CREATE FUNCTION commerce.prices_bundle_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bundle uuid;
BEGIN
  FOR v_bundle IN
    SELECT bc.bundle_variant_id FROM commerce.bundle_components bc
     WHERE bc.store_id = NEW.store_id AND bc.component_variant_id = NEW.variant_id
  LOOP
    PERFORM commerce.refresh_bundle_prices(v_bundle, NEW.market_code);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER prices_bundle_refresh
  AFTER INSERT ON commerce.prices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.prices_bundle_refresh();
--> statement-breakpoint

-- Payment draws a bundle line's components (its quantity times each component's) and never the bundle's own variant.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.draw_order_stock(uuid)'::regprocedure);
  IF position('order_line_components' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    SELECT ol.variant_id, sum(ol.quantity)::integer AS quantity, v.stock_policy, v.backorder_days\n      FROM commerce.order_lines ol\n      JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id\n     WHERE ol.order_id = p_order_id AND ol.variant_id IS NOT NULL AND ol.delivery = ''physical''\n     GROUP BY ol.variant_id, v.stock_policy, v.backorder_days\n     ORDER BY ol.variant_id\n',
    E'    SELECT x.variant_id, sum(x.quantity)::integer AS quantity, v.stock_policy, v.backorder_days\n      FROM (\n        SELECT ol.store_id, ol.variant_id, ol.quantity\n          FROM commerce.order_lines ol\n         WHERE ol.order_id = p_order_id AND ol.variant_id IS NOT NULL AND ol.delivery = ''physical''\n           AND NOT EXISTS (SELECT 1 FROM commerce.order_line_components c WHERE c.store_id = ol.store_id AND c.order_line_id = ol.id)\n        UNION ALL\n        SELECT ol.store_id, c.variant_id, c.quantity * ol.quantity\n          FROM commerce.order_lines ol\n          JOIN commerce.order_line_components c ON c.store_id = ol.store_id AND c.order_line_id = ol.id\n         WHERE ol.order_id = p_order_id\n      ) x\n      JOIN commerce.product_variants v ON v.store_id = x.store_id AND v.id = x.variant_id\n     GROUP BY x.variant_id, v.stock_policy, v.backorder_days\n     ORDER BY x.variant_id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'draw_order_stock: the lines it draws were not found, so bundles are not drawn'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- `clone_store()` carries the pricing columns and the components.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('bundle_components' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'    kind, vat_category, audience, sold_by_measure\n  )\n  SELECT commerce.clone_id(v_store, id), v_store, handle, ''draft'',\n',
    E'    kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off\n  )\n  SELECT commerce.clone_id(v_store, id), v_store, handle, ''draft'',\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         kind, vat_category, audience, sold_by_measure\n    FROM commerce.products\n   WHERE store_id = p_template_id AND status <> ''archived'';\n',
    E'         kind, vat_category, audience, sold_by_measure, bundle_pricing, bundle_percent_off\n    FROM commerce.products\n   WHERE store_id = p_template_id AND status <> ''archived'';\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the product select was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)\n  SELECT v_store, commerce.clone_id(v_store, pr.variant_id),',
    E'  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, commerce.clone_id(v_store, bc.bundle_variant_id), commerce.clone_id(v_store, bc.component_variant_id), bc.quantity, bc.position\n    FROM commerce.bundle_components bc\n   WHERE bc.store_id = p_template_id\n     AND EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, bc.bundle_variant_id))\n     AND EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, bc.component_variant_id));\n\n  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)\n  SELECT v_store, commerce.clone_id(v_store, pr.variant_id),');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the price insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- `duplicate_store()` too, for the products it copies.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('bundle_components' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at, sold_by_measure\n  )',
    E'download_limit, download_days, subscription_only, kind, vat_category, audience, created_at, updated_at, sold_by_measure, bundle_pricing, bundle_percent_off\n  )');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product insert was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'         p.updated_at, p.sold_by_measure\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n',
    E'         p.updated_at, p.sold_by_measure, p.bundle_pricing, p.bundle_percent_off\n    FROM commerce.products p JOIN pg_temp._copy_ids m ON m.old_id = p.id\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the product select was not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n',
    E'  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)\n  SELECT v_store, mb.new_id, mc.new_id, bc.quantity, bc.position\n    FROM commerce.bundle_components bc\n    JOIN pg_temp._copy_ids mb ON mb.old_id = bc.bundle_variant_id\n    JOIN pg_temp._copy_ids mc ON mc.old_id = bc.component_variant_id\n   WHERE bc.store_id = p_source AND mb.new_id IS NOT NULL AND mc.new_id IS NOT NULL;\n\n  -- The current price of each variant, as a new price: the copy shows no reduction it never made.\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the price insert was not found'; END IF;
  EXECUTE v_new;
END
$patch$;
