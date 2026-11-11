-- Physical and digital products (decision D24): rules the schema file cannot express.

-- A file for one variant must belong to that variant (a file for no variant
-- goes with every digital variant of its product).
ALTER TABLE commerce.product_files
  ADD CONSTRAINT product_files_variant_fk FOREIGN KEY (store_id, variant_id)
  REFERENCES commerce.product_variants (store_id, id);
--> statement-breakpoint

-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.product_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_downloads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Digital files live in a private Supabase Storage bucket, one folder per
-- store. Only the server reads and writes it (with the secret key); shoppers
-- get short-lived signed links from Kaizen's download route. The file size
-- limit is the project's own. Storage exists only on Supabase, so this does
-- nothing in plain Postgres (local development, CI, tests).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('digital-files', 'digital-files', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint

-- Paying draws stock for physical lines only, and gives digital lines their
-- download links, in the same transaction.
CREATE OR REPLACE FUNCTION commerce.complete_order_payment(p_order_id uuid, p_reference text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order commerce.orders%ROWTYPE;
  v_line record;
  v_hold record;
  v_level record;
  v_left integer;
  v_take integer;
  v_have integer;
  v_short integer := 0;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown order %', p_order_id;
  END IF;
  IF v_order.status NOT IN ('pending_payment', 'cancelled') THEN
    RETURN false;
  END IF;

  FOR v_line IN
    SELECT variant_id, sum(quantity)::int AS quantity
      FROM commerce.order_lines
     WHERE order_id = p_order_id AND variant_id IS NOT NULL AND delivery = 'physical'
     GROUP BY variant_id
  LOOP
    v_left := v_line.quantity;
    -- First where the items were held for this order.
    FOR v_hold IN
      SELECT r.id, r.location_id, r.quantity FROM commerce.inventory_reservations r
       WHERE r.order_id = p_order_id AND r.variant_id = v_line.variant_id AND r.released_at IS NULL
    LOOP
      SELECT on_hand INTO v_have FROM commerce.inventory_levels
       WHERE variant_id = v_line.variant_id AND location_id = v_hold.location_id
       FOR UPDATE;
      -- Only what is really there: a hold does not create stock.
      v_take := least(v_hold.quantity, v_left, coalesce(v_have, 0));
      UPDATE commerce.inventory_levels
         SET on_hand = on_hand - v_take, updated_at = now()
       WHERE variant_id = v_line.variant_id AND location_id = v_hold.location_id;
      v_left := v_left - v_take;
    END LOOP;
    -- Then anywhere stock is left (a hold that expired before payment).
    FOR v_level IN
      SELECT l.location_id, l.on_hand FROM commerce.inventory_levels l
        JOIN commerce.inventory_locations loc ON loc.id = l.location_id AND loc.active
       WHERE l.variant_id = v_line.variant_id AND l.on_hand > 0
       ORDER BY loc.created_at
       FOR UPDATE OF l
    LOOP
      EXIT WHEN v_left = 0;
      v_take := least(v_level.on_hand, v_left);
      UPDATE commerce.inventory_levels
         SET on_hand = on_hand - v_take, updated_at = now()
       WHERE variant_id = v_line.variant_id AND location_id = v_level.location_id;
      v_left := v_left - v_take;
    END LOOP;
    v_short := v_short + v_left;
  END LOOP;

  UPDATE commerce.inventory_reservations SET released_at = now()
   WHERE order_id = p_order_id AND released_at IS NULL;

  UPDATE commerce.orders SET status = 'paid' WHERE id = p_order_id;

  -- Digital lines: a download link per file, with the product's limits.
  INSERT INTO commerce.order_downloads (store_id, order_id, file_id, token, max_downloads, expires_at)
  SELECT DISTINCT ON (f.id)
         v_order.store_id, p_order_id, f.id,
         replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         p.download_limit,
         CASE WHEN p.download_days IS NULL THEN NULL
              ELSE now() + make_interval(days => p.download_days) END
    FROM commerce.order_lines ol
    JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
    JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
    JOIN commerce.product_files f
      ON f.store_id = p.store_id AND f.product_id = p.id AND f.removed_at IS NULL
     AND (f.variant_id IS NULL OR f.variant_id = v.id)
   WHERE ol.order_id = p_order_id AND ol.delivery = 'digital'
   ORDER BY f.id
  ON CONFLICT (order_id, file_id) DO NOTHING;
  UPDATE commerce.carts SET status = 'converted', updated_at = now()
   WHERE store_id = v_order.store_id AND id = v_order.cart_id;

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.paid',
          jsonb_build_object('reference', p_reference, 'was', v_order.status), 'stripe');
  IF v_short > 0 THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (v_order.store_id, p_order_id, 'stock.short',
            jsonb_build_object('missing', v_short), 'system');
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- Publishing: the product-safety requirements apply when a physical variant is for sale.
CREATE OR REPLACE FUNCTION commerce.assert_product_publishable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_manufacturer_country char(2);
  v_responsible_country char(2);
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- GPSR covers physical goods: a product sold only as downloads needs no
  -- manufacturer or EU responsible person (D24).
  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active AND delivery = 'physical'
  ) THEN
    v_manufacturer_country := NULL;
  ELSIF NEW.manufacturer_id IS NULL THEN
    RAISE EXCEPTION 'product % cannot be active without a manufacturer', NEW.handle
      USING ERRCODE = 'check_violation';
  ELSE
    SELECT country INTO v_manufacturer_country
      FROM commerce.economic_operators
     WHERE store_id = NEW.store_id AND id = NEW.manufacturer_id;
  END IF;

  IF v_manufacturer_country IS NOT NULL AND NOT commerce.is_eu_country(v_manufacturer_country) THEN
    SELECT country INTO v_responsible_country
      FROM commerce.economic_operators
     WHERE store_id = NEW.store_id AND id = NEW.responsible_person_id;
    IF v_responsible_country IS NULL
       OR NOT commerce.is_eu_country(v_responsible_country) THEN
      RAISE EXCEPTION 'product % has a non-EU manufacturer and needs an EU responsible person', NEW.handle
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM commerce.product_media WHERE product_id = NEW.id) THEN
    RAISE EXCEPTION 'product % cannot be active without a picture', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_translations
     WHERE product_id = NEW.id AND btrim(title) <> ''
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without a title', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without an active variant', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- New stores copy the template's catalogue with how each product is
-- delivered and its download limits, and the search text added with D21.
CREATE OR REPLACE FUNCTION commerce.clone_store(
  p_template_id uuid,
  p_slug text,
  p_name text,
  p_owner_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_template_id) THEN
    RAISE EXCEPTION 'unknown template store %', p_template_id;
  END IF;

  INSERT INTO commerce.stores (slug, name, created_by)
  VALUES (p_slug, p_name, p_owner_id)
  RETURNING id INTO v_store;

  INSERT INTO commerce.store_members (store_id, account_id, role)
  VALUES (v_store, p_owner_id, 'owner');

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  SELECT v_store, code, currency, default_locale, locales, active
    FROM commerce.markets WHERE store_id = p_template_id;

  INSERT INTO commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor)
  SELECT v_store, market_code, currency, amount_minor, free_over_minor
    FROM commerce.shipping_rates WHERE store_id = p_template_id;

  INSERT INTO commerce.payment_methods (store_id, market_code, method, enabled)
  SELECT v_store, market_code, method, enabled
    FROM commerce.payment_methods WHERE store_id = p_template_id;

  INSERT INTO commerce.economic_operators (id, store_id, name, postal_address, electronic_address, country)
  SELECT commerce.clone_id(v_store, id), v_store, name, postal_address, electronic_address, country
    FROM commerce.economic_operators WHERE store_id = p_template_id;

  INSERT INTO commerce.inventory_locations (id, store_id, name, country, active)
  SELECT commerce.clone_id(v_store, id), v_store, name, country, active
    FROM commerce.inventory_locations WHERE store_id = p_template_id;

  -- Products arrive as drafts and are published below, once their pictures,
  -- titles and variants exist (the publishing check needs them).
  INSERT INTO commerce.products (
    id, store_id, handle, status, manufacturer_id, responsible_person_id,
    tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days
    FROM commerce.products
   WHERE store_id = p_template_id AND status <> 'archived';

  INSERT INTO commerce.product_translations (
    store_id, product_id, locale, title, description, safety_information, seo_title, seo_description
  )
  SELECT v_store, commerce.clone_id(v_store, t.product_id), t.locale, t.title, t.description, t.safety_information,
         t.seo_title, t.seo_description
    FROM commerce.product_translations t
    JOIN commerce.products p ON p.id = t.product_id
   WHERE t.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt)
  SELECT v_store, commerce.clone_id(v_store, m.product_id), m.url, m.position, m.alt
    FROM commerce.product_media m
    JOIN commerce.products p ON p.id = m.product_id
   WHERE m.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme)
  SELECT v_store, commerce.clone_id(v_store, s.product_id), s.scheme
    FROM commerce.product_schemes s
    JOIN commerce.products p ON p.id = s.product_id
   WHERE s.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams,
    hs_code, origin_country, active, delivery
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery
    FROM commerce.product_variants v
    JOIN commerce.products p ON p.id = v.product_id
   WHERE v.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.prices (store_id, variant_id, market_code, currency, amount_minor, valid_from)
  SELECT v_store, commerce.clone_id(v_store, pr.variant_id), pr.market_code, pr.currency, pr.amount_minor, now()
    FROM commerce.prices pr
   WHERE pr.store_id = p_template_id
     AND pr.valid_to IS NULL
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, pr.variant_id)
     );

  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
  SELECT v_store, commerce.clone_id(v_store, l.variant_id), commerce.clone_id(v_store, l.location_id), l.on_hand
    FROM commerce.inventory_levels l
   WHERE l.store_id = p_template_id
     AND EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, l.variant_id)
     );

  -- Download files stay with the template (they are its own), so a product
  -- sold as a download waits as a draft for the new owner's files (D24).
  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_template_id
     AND t.status = 'active'
     AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.product_variants v
        WHERE v.product_id = p.id AND v.active AND v.delivery = 'digital'
     );

  RETURN v_store;
END;
$$;
