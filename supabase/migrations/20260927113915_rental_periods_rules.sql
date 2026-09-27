-- Renting by the day, half day or hour (D69): each rental variant says
-- which, a resource's room is counted at its busiest moment, the demo
-- e-bike rental offers all three, and new stores are copied with it.

-- The most live bookings on a resource at any one moment between two
-- instants (leaving one out, when it is being moved): counted where each
-- starts, so bookings one after another in the span do not add up (D69).
CREATE OR REPLACE FUNCTION commerce.resource_peak(
  p_store_id uuid,
  p_resource_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_except uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH live AS (
    SELECT b.blocked_from, b.blocked_to FROM commerce.bookings b
     WHERE b.store_id = p_store_id AND b.resource_id = p_resource_id
       AND b.id IS DISTINCT FROM p_except
       AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
       AND b.blocked_from < p_to AND b.blocked_to > p_from
  )
  SELECT coalesce(max((
    SELECT count(*) FROM live l2 WHERE l2.blocked_from <= pt.at AND l2.blocked_to > pt.at
  )), 0)::integer
  FROM (SELECT greatest(l.blocked_from, p_from) AS at FROM live l) pt;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.hold_booking(
  p_store_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_from timestamptz,
  p_blocked_to timestamptz,
  p_hold_until timestamptz,
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_capacity integer;
  v_taken integer;
  v_id uuid;
BEGIN
  SELECT capacity INTO v_capacity FROM commerce.booking_resources
   WHERE store_id = p_store_id AND id = p_resource_id AND active
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_taken := commerce.resource_peak(p_store_id, p_resource_id, p_blocked_from, p_blocked_to, NULL);
  IF v_taken >= v_capacity OR commerce.resource_blocked(p_store_id, p_resource_id, p_blocked_from, p_blocked_to) THEN
    RETURN NULL;
  END IF;
  INSERT INTO commerce.bookings (
    store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to,
    status, hold_expires_at, order_id
  ) VALUES (
    p_store_id, p_product_id, p_variant_id, p_resource_id, p_starts_at, p_ends_at, p_blocked_from, p_blocked_to,
    'held', p_hold_until, p_order_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.move_booking(
  p_store_id uuid,
  p_booking_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_from timestamptz,
  p_blocked_to timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_capacity integer;
  v_taken integer;
BEGIN
  SELECT capacity INTO v_capacity FROM commerce.booking_resources
   WHERE store_id = p_store_id AND id = p_resource_id AND active
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_taken := commerce.resource_peak(p_store_id, p_resource_id, p_blocked_from, p_blocked_to, p_booking_id);
  IF v_taken >= v_capacity OR commerce.resource_blocked(p_store_id, p_resource_id, p_blocked_from, p_blocked_to) THEN
    RETURN false;
  END IF;
  UPDATE commerce.bookings
     SET resource_id = p_resource_id, starts_at = p_starts_at, ends_at = p_ends_at,
         blocked_from = p_blocked_from, blocked_to = p_blocked_to,
         sequence = sequence + 1, reminded_at = NULL, updated_at = now()
   WHERE store_id = p_store_id AND id = p_booking_id AND status = 'confirmed';
  RETURN FOUND;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.order_bookings_follow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_capacity integer;
  v_taken integer;
BEGIN
  IF NEW.status = 'paid' THEN
    UPDATE commerce.bookings
       SET status = 'confirmed', hold_expires_at = NULL, cancelled_at = NULL, updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status = 'held' AND hold_expires_at > now();
    FOR v_booking IN
      SELECT b.* FROM commerce.bookings b
       WHERE b.store_id = NEW.store_id AND b.order_id = NEW.id AND b.status IN ('held', 'cancelled')
       ORDER BY b.starts_at
    LOOP
      SELECT r.capacity INTO v_capacity FROM commerce.booking_resources r
       WHERE r.store_id = NEW.store_id AND r.id = v_booking.resource_id FOR UPDATE;
      v_taken := commerce.resource_peak(NEW.store_id, v_booking.resource_id, v_booking.blocked_from, v_booking.blocked_to, v_booking.id);
      IF v_taken < coalesce(v_capacity, 0)
         AND NOT commerce.resource_blocked(NEW.store_id, v_booking.resource_id, v_booking.blocked_from, v_booking.blocked_to) THEN
        UPDATE commerce.bookings
           SET status = 'confirmed', hold_expires_at = NULL, cancelled_at = NULL, updated_at = now()
         WHERE id = v_booking.id;
      ELSE
        UPDATE commerce.bookings
           SET status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
         WHERE id = v_booking.id;
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (NEW.store_id, NEW.id, 'booking.lost',
                jsonb_build_object('booking', v_booking.id, 'starts_at', v_booking.starts_at), 'system');
      END IF;
    END LOOP;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE commerce.bookings
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status IN ('held', 'confirmed');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Gives a store's demo rental its half-day and hourly variants (and the day
-- its option), if it has the demo rental. Does nothing twice.
CREATE OR REPLACE FUNCTION commerce.add_demo_rental_periods(p_store uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_market record;
  v_kind record;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-sykkelutleie';
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE commerce.product_variants SET options = '{"rental": "day"}', rental_period = 'day'
   WHERE store_id = p_store AND product_id = v_product AND sku = 'DEMO-SYKKEL';

  FOR v_kind IN
    SELECT * FROM (VALUES
      ('DEMO-SYKKEL-HALV', 'halfDay', 'half_day', 30000, 21500),
      ('DEMO-SYKKEL-TIME', 'hour', 'hour', 12000, 8500)
    ) AS k(sku, option, period, amount, amount_dk)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM commerce.product_variants WHERE store_id = p_store AND product_id = v_product AND sku = v_kind.sku
    ) THEN
      INSERT INTO commerce.product_variants (store_id, product_id, sku, options, delivery, rental_period)
      VALUES (p_store, v_product, v_kind.sku, jsonb_build_object('rental', v_kind.option), 'service', v_kind.period)
      RETURNING id INTO v_variant;
      FOR v_market IN
        SELECT code FROM commerce.markets WHERE store_id = p_store AND code IN ('NO', 'SE', 'DK')
      LOOP
        PERFORM commerce.set_price(v_variant, v_market.code,
          CASE v_market.code WHEN 'DK' THEN v_kind.amount_dk ELSE v_kind.amount END);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE commerce.product_translations
     SET description = CASE locale
       WHEN 'nb-NO' THEN 'Elsykkel med hjelm og lås. Lei den en time, en halv dag eller hele dager; hentes fra 09:00 og leveres innen 17:00.'
       WHEN 'sv-SE' THEN 'Elcykel med hjälm och lås. Hyr den en timme, en halv dag eller hela dagar; hämtas från 09:00 och lämnas senast 17:00.'
       WHEN 'da-DK' THEN 'Elcykel med hjelm og lås. Lej den en time, en halv dag eller hele dage; hentes fra 09:00 og afleveres senest 17:00.'
       ELSE description END
   WHERE store_id = p_store AND product_id = v_product;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.add_demo_rental(p_store uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_resource uuid;
  v_location uuid;
  v_market record;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-sykkelutleie';
  IF FOUND THEN
    RETURN v_product;
  END IF;

  UPDATE commerce.stores
     SET modules = (SELECT array_agg(DISTINCT m ORDER BY m) FROM unnest(modules || array['bookings']) m)
   WHERE id = p_store;

  INSERT INTO commerce.booking_resources (store_id, kind, name, hours, capacity, position)
  VALUES (
    p_store, 'item', 'Demo: Elsykkel',
    '{"week": {"mon": {"open": "00:00", "close": "23:59"}, "tue": {"open": "00:00", "close": "23:59"}, "wed": {"open": "00:00", "close": "23:59"}, "thu": {"open": "00:00", "close": "23:59"}, "fri": {"open": "00:00", "close": "23:59"}, "sat": {"open": "00:00", "close": "23:59"}, "sun": {"open": "00:00", "close": "23:59"}}, "exceptions": []}'::jsonb,
    3, (SELECT coalesce(max(position), -1) + 1 FROM commerce.booking_resources WHERE store_id = p_store)
  )
  RETURNING id INTO v_resource;

  SELECT id INTO v_location FROM commerce.store_locations WHERE store_id = p_store ORDER BY position, created_at LIMIT 1;

  INSERT INTO commerce.products (store_id, handle, tax_code, kind, vat_category)
  VALUES (p_store, 'demo-sykkelutleie', 'txcd_20030000', 'rental', 'standard')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description) VALUES
    (p_store, v_product, 'nb-NO', 'Demo: Leie av elsykkel',
     'Elsykkel med hjelm og lås. Hentes om morgenen og leveres før stengetid siste dag; prisen er per dag.'),
    (p_store, v_product, 'sv-SE', 'Demo: Hyr en elcykel',
     'Elcykel med hjälm och lås. Hämtas på morgonen och lämnas före stängning sista dagen; priset är per dag.'),
    (p_store, v_product, 'da-DK', 'Demo: Lej en elcykel',
     'Elcykel med hjelm og lås. Hentes om morgenen og afleveres før lukketid sidste dag; prisen er pr. dag.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (p_store, v_product, '/demo/bike.svg', 0, '{"nb-NO": "Elsykkel", "sv-SE": "Elcykel", "da-DK": "Elcykel"}');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, options, delivery)
  VALUES (p_store, v_product, 'DEMO-SYKKEL', '{"rental": "day"}', 'service')
  RETURNING id INTO v_variant;

  FOR v_market IN
    SELECT code FROM commerce.markets WHERE store_id = p_store AND code IN ('NO', 'SE', 'DK')
  LOOP
    PERFORM commerce.set_price(v_variant, v_market.code,
      CASE v_market.code WHEN 'DK' THEN 32500 ELSE 45000 END);
  END LOOP;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, min_notice_minutes, max_days_ahead, location_id,
    check_in_time, check_out_time, min_nights, max_nights, payment, deposit_percent, cancel_hours
  ) VALUES (v_product, p_store, 60, 180, v_location, '09:00', '17:00', 1, 14, 'now', 30, 24);

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id) VALUES (p_store, v_product, v_resource);

  PERFORM commerce.add_demo_rental_periods(p_store);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
  RETURN v_product;
END;
$$;
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

  INSERT INTO commerce.stores (slug, name, created_by, navigation, fonts, theme, modules, time_zone, booking_reminder_hours)
  SELECT p_slug, p_name, p_owner_id, navigation, fonts, theme - 'savedId', modules, time_zone, booking_reminder_hours
    FROM commerce.stores WHERE id = p_template_id
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
    tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only,
    kind, vat_category, audience
  )
  SELECT commerce.clone_id(v_store, id), v_store, handle, 'draft',
         commerce.clone_id(v_store, manufacturer_id),
         commerce.clone_id(v_store, responsible_person_id),
         tax_code, withdrawal_exclusion, attributes, delivery, download_limit, download_days, subscription_only,
         kind, vat_category, audience
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

  -- Categories and tags (D50) come along with the products in them. Parents
  -- are set once every category exists, so the parent check finds them.
  INSERT INTO commerce.terms (id, store_id, content_type, kind, name, slug, position)
  SELECT commerce.clone_id(v_store, id), v_store, content_type, kind, name, slug, position
    FROM commerce.terms WHERE store_id = p_template_id;

  UPDATE commerce.terms n
     SET parent_id = commerce.clone_id(v_store, t.parent_id)
    FROM commerce.terms t
   WHERE t.store_id = p_template_id
     AND t.parent_id IS NOT NULL
     AND n.id = commerce.clone_id(v_store, t.id);

  INSERT INTO commerce.product_terms (store_id, product_id, term_id)
  SELECT v_store, commerce.clone_id(v_store, pt.product_id), commerce.clone_id(v_store, pt.term_id)
    FROM commerce.product_terms pt
    JOIN commerce.products p ON p.id = pt.product_id
   WHERE pt.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_variants (
    id, store_id, product_id, sku, gtin, tax_code, options, weight_grams,
    hs_code, origin_country, active, delivery, rental_period
  )
  SELECT commerce.clone_id(v_store, v.id), v_store, commerce.clone_id(v_store, v.product_id),
         v.sku, v.gtin, v.tax_code, v.options, v.weight_grams, v.hs_code, v.origin_country, v.active, v.delivery,
         v.rental_period
    FROM commerce.product_variants v
    JOIN commerce.products p ON p.id = v.product_id
   WHERE v.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.selling_plans (
    id, store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles,
    position, active
  )
  SELECT commerce.clone_id(v_store, sp.id), v_store, commerce.clone_id(v_store, sp.product_id),
         sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.signup_fee, sp.min_cycles,
         sp.position, sp.active
    FROM commerce.selling_plans sp
    JOIN commerce.products p ON p.id = sp.product_id
   WHERE sp.store_id = p_template_id AND p.status <> 'archived';

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

  -- Bookings (D65, D67): the template's staff, rooms and rental items, and how
  -- its appointments, stays and rentals are booked. Places are the store's own
  -- addresses and stay behind.
  INSERT INTO commerce.booking_resources (id, store_id, kind, name, email, hours, capacity, active, position)
  SELECT commerce.clone_id(v_store, id), v_store, kind, name, '', hours, capacity, active, position
    FROM commerce.booking_resources WHERE store_id = p_template_id;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
    min_notice_minutes, max_days_ahead, payment, deposit_percent, cancel_hours, no_show_percent,
    check_in_time, check_out_time, min_nights, max_nights
  )
  SELECT commerce.clone_id(v_store, a.product_id), v_store, a.duration_minutes, a.buffer_before_minutes,
         a.buffer_after_minutes, a.step_minutes, a.min_notice_minutes, a.max_days_ahead,
         a.payment, a.deposit_percent, a.cancel_hours, a.no_show_percent,
         a.check_in_time, a.check_out_time, a.min_nights, a.max_nights
    FROM commerce.appointment_settings a
    JOIN commerce.products p ON p.id = a.product_id
   WHERE a.store_id = p_template_id AND p.status <> 'archived';

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id)
  SELECT v_store, commerce.clone_id(v_store, pr.product_id), commerce.clone_id(v_store, pr.resource_id)
    FROM commerce.product_resources pr
    JOIN commerce.products p ON p.id = pr.product_id
   WHERE pr.store_id = p_template_id AND p.status <> 'archived';

  -- The template's published pages and articles (D53-D57), published in the copy, with
  -- the category and tag ids in them (the page's own and its grids') made the
  -- copies'; and its front page (D54).
  INSERT INTO commerce.pages (id, store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
  SELECT commerce.clone_id(v_store, p.id), v_store, p.type, p.slug,
         commerce.clone_page_content(v_store, p_template_id, p.published),
         commerce.clone_page_content(v_store, p_template_id, p.published),
         now(), now(), p_owner_id, p_owner_id
    FROM commerce.pages p
   WHERE p.store_id = p_template_id AND p.published_at IS NOT NULL;

  UPDATE commerce.stores s
     SET front_page_id = commerce.clone_id(v_store, t.front_page_id)
    FROM commerce.stores t
   WHERE s.id = v_store AND t.id = p_template_id
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.id = commerce.clone_id(v_store, t.front_page_id));

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
--> statement-breakpoint

SELECT commerce.add_demo_rental_periods(id) FROM commerce.stores;
