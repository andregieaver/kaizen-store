-- Checkout: VAT rates for the order summary, order numbers, copying
-- shipping rates to new stores, and the two ways a checkout ends (paid or
-- cancelled), each as one atomic step.

-- Standard VAT rates (September 2026). To verify with an accountant before
-- launch; reduced rates (food, books, ...) are not applied yet.
UPDATE commerce.countries AS c SET standard_vat_rate = v.rate
FROM (VALUES
  ('AT', 0.20), ('BE', 0.21), ('BG', 0.20), ('HR', 0.25), ('CY', 0.19),
  ('CZ', 0.21), ('DK', 0.25), ('EE', 0.24), ('FI', 0.255), ('FR', 0.20),
  ('DE', 0.19), ('GR', 0.24), ('HU', 0.27), ('IE', 0.23), ('IT', 0.22),
  ('LV', 0.21), ('LT', 0.21), ('LU', 0.17), ('MT', 0.18), ('NL', 0.21),
  ('PL', 0.23), ('PT', 0.23), ('RO', 0.21), ('SK', 0.23), ('SI', 0.22),
  ('ES', 0.21), ('SE', 0.25), ('NO', 0.25)
) AS v(code, rate)
WHERE c.code = v.code;
--> statement-breakpoint

-- Orders are numbered per store from 1001, without gaps, like invoices.
CREATE OR REPLACE FUNCTION commerce.initialise_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO commerce.document_series (store_id, series, prefix, next_number) VALUES
    (NEW.id, 'invoice', 'INV-', 1),
    (NEW.id, 'credit_note', 'CN-', 1),
    (NEW.id, 'order', '', 1001);
  INSERT INTO commerce.payment_providers (store_id, provider) VALUES (NEW.id, 'stripe');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

INSERT INTO commerce.document_series (store_id, series, prefix, next_number)
SELECT id, 'order', '', 1001 FROM commerce.stores
ON CONFLICT (store_id, series) DO NOTHING;
--> statement-breakpoint

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
    tax_code, withdrawal_exclusion, attributes
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes
    FROM commerce.products
   WHERE store_id = p_template_id AND status <> 'archived';

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information)
  SELECT v_store, commerce.clone_id(v_store, t.product_id), t.locale, t.title, t.description, t.safety_information
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
    hs_code, origin_country, active
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active
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

  UPDATE commerce.products p
     SET status = 'active'
    FROM commerce.products t
   WHERE t.store_id = p_template_id
     AND t.status = 'active'
     AND p.store_id = v_store
     AND p.id = commerce.clone_id(v_store, t.id);

  RETURN v_store;
END;
$$;
--> statement-breakpoint

-- Marks an order paid: draws its items from stock (from the locations where
-- they were held, then wherever stock is left), releases the holds, closes
-- the cart and records the event. Safe to call twice: the second call does
-- nothing. Returns false if the order was already paid.
CREATE FUNCTION commerce.complete_order_payment(p_order_id uuid, p_reference text)
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
     WHERE order_id = p_order_id AND variant_id IS NOT NULL
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

-- Cancels an unpaid order and gives its held stock back. Returns false if
-- the order was not waiting for payment.
CREATE FUNCTION commerce.cancel_unpaid_order(p_order_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending_payment' THEN
    RETURN false;
  END IF;
  UPDATE commerce.inventory_reservations SET released_at = now()
   WHERE order_id = p_order_id AND released_at IS NULL;
  UPDATE commerce.orders SET status = 'cancelled' WHERE id = p_order_id;
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.cancelled', jsonb_build_object('reason', p_reason), 'system');
  RETURN true;
END;
$$;
--> statement-breakpoint

ALTER TABLE commerce.shipping_rates ENABLE ROW LEVEL SECURITY;
