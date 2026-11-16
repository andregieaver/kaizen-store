-- Bookings and subscription boxes are switched in stores.features alone (bloat review step 0.37). stores.modules held a mirror of them for
-- code from before D178; that code is gone. modules now holds only work.

CREATE OR REPLACE FUNCTION commerce.add_demo_appointment(p_store uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_staff uuid;
  v_location uuid;
  v_market record;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-massasje';
  IF FOUND THEN
    RETURN v_product;
  END IF;

  UPDATE commerce.stores
     SET features = features || array['appointments', 'bookings']
   WHERE id = p_store;

  INSERT INTO commerce.booking_resources (store_id, kind, name, hours, capacity, position)
  VALUES (
    p_store, 'staff', 'Demo: Kari',
    '{"week": {"mon": {"open": "09:00", "close": "17:00"}, "tue": {"open": "09:00", "close": "17:00"}, "wed": {"open": "09:00", "close": "17:00"}, "thu": {"open": "09:00", "close": "17:00"}, "fri": {"open": "09:00", "close": "17:00"}, "sat": {"open": "10:00", "close": "14:00"}, "sun": null}, "exceptions": []}'::jsonb,
    1, 0
  )
  RETURNING id INTO v_staff;

  SELECT id INTO v_location FROM commerce.store_locations WHERE store_id = p_store ORDER BY position, created_at LIMIT 1;

  INSERT INTO commerce.products (store_id, handle, tax_code, kind, vat_category)
  VALUES (p_store, 'demo-massasje', 'txcd_20030000', 'appointment', 'standard')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description) VALUES
    (p_store, v_product, 'nb-NO', 'Demo: Massasje, 60 minutter',
     'En time med avslappende massasje. Velg dag og tid, så står timen klar når du kommer.'),
    (p_store, v_product, 'sv-SE', 'Demo: Massage, 60 minuter',
     'En timme avslappnande massage. Välj dag och tid, så är tiden bokad när du kommer.'),
    (p_store, v_product, 'da-DK', 'Demo: Massage, 60 minutter',
     'En time med afslappende massage. Vælg dag og tid, så er tiden klar, når du kommer.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (p_store, v_product, '/demo/massage.svg', 0,
     '{"nb-NO": "Massasjesteiner", "sv-SE": "Massagestenar", "da-DK": "Massagesten"}');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, options, delivery)
  VALUES (p_store, v_product, 'DEMO-MASSAGE-60', '{}', 'service')
  RETURNING id INTO v_variant;

  FOR v_market IN
    SELECT code FROM commerce.markets WHERE store_id = p_store AND code IN ('NO', 'SE', 'DK')
  LOOP
    PERFORM commerce.set_price(v_variant, v_market.code,
      CASE v_market.code WHEN 'DK' THEN 64900 ELSE 89000 END);
  END LOOP;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
    min_notice_minutes, max_days_ahead, location_id
  ) VALUES (v_product, p_store, 60, 0, 15, 30, 120, 60, v_location);

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id) VALUES (p_store, v_product, v_staff);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
  RETURN v_product;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.add_demo_rental(p_store uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
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
     SET features = features || array['appointments', 'bookings']
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

CREATE OR REPLACE FUNCTION commerce.add_demo_stay(p_store uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_resource uuid;
  v_location uuid;
  v_market record;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-hytte';
  IF FOUND THEN
    RETURN v_product;
  END IF;

  UPDATE commerce.stores
     SET features = features || array['appointments', 'bookings']
   WHERE id = p_store;

  INSERT INTO commerce.booking_resources (store_id, kind, name, hours, capacity, position)
  VALUES (
    p_store, 'unit', 'Demo: Hytta',
    '{"week": {"mon": {"open": "00:00", "close": "23:59"}, "tue": {"open": "00:00", "close": "23:59"}, "wed": {"open": "00:00", "close": "23:59"}, "thu": {"open": "00:00", "close": "23:59"}, "fri": {"open": "00:00", "close": "23:59"}, "sat": {"open": "00:00", "close": "23:59"}, "sun": {"open": "00:00", "close": "23:59"}}, "exceptions": []}'::jsonb,
    1, (SELECT coalesce(max(position), -1) + 1 FROM commerce.booking_resources WHERE store_id = p_store)
  )
  RETURNING id INTO v_resource;

  SELECT id INTO v_location FROM commerce.store_locations WHERE store_id = p_store ORDER BY position, created_at LIMIT 1;

  INSERT INTO commerce.products (store_id, handle, tax_code, kind, vat_category)
  VALUES (p_store, 'demo-hytte', 'txcd_20030000', 'stay', 'accommodation')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description) VALUES
    (p_store, v_product, 'nb-NO', 'Demo: Hytte ved vannet',
     'En liten hytte for fire ved vannet, med vedovn og båt. Velg ankomst og avreise; prisen er per natt.'),
    (p_store, v_product, 'sv-SE', 'Demo: Stuga vid sjön',
     'En liten stuga för fyra vid sjön, med vedspis och båt. Välj ankomst och avresa; priset är per natt.'),
    (p_store, v_product, 'da-DK', 'Demo: Hytte ved søen',
     'En lille hytte til fire ved søen, med brændeovn og båd. Vælg ankomst og afrejse; prisen er pr. nat.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (p_store, v_product, '/demo/cabin.svg', 0, '{"nb-NO": "Hytte ved vannet", "sv-SE": "Stuga vid sjön", "da-DK": "Hytte ved søen"}');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, options, delivery)
  VALUES (p_store, v_product, 'DEMO-HYTTE', '{}', 'service')
  RETURNING id INTO v_variant;

  FOR v_market IN
    SELECT code FROM commerce.markets WHERE store_id = p_store AND code IN ('NO', 'SE', 'DK')
  LOOP
    PERFORM commerce.set_price(v_variant, v_market.code,
      CASE v_market.code WHEN 'DK' THEN 105000 ELSE 145000 END);
  END LOOP;

  INSERT INTO commerce.appointment_settings (
    product_id, store_id, min_notice_minutes, max_days_ahead, location_id,
    check_in_time, check_out_time, min_nights, max_nights, payment, deposit_percent, cancel_hours
  ) VALUES (v_product, p_store, 0, 365, v_location, '15:00', '11:00', 2, 14, 'deposit', 30, 72);

  INSERT INTO commerce.product_resources (store_id, product_id, resource_id) VALUES (p_store, v_product, v_resource);

  PERFORM commerce.add_demo_stay_pricing(p_store);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
  RETURN v_product;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.stores_features_sync() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  -- The features kept, each once, in order. What is on is commerce.features_effective(); nothing is mirrored into modules any more.
  NEW.features := (SELECT coalesce(array_agg(DISTINCT f ORDER BY f), '{}'::text[]) FROM unnest(NEW.features) f);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER stores_features_sync ON commerce.stores;
--> statement-breakpoint
CREATE TRIGGER stores_features_sync BEFORE INSERT OR UPDATE OF features ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_features_sync();
--> statement-breakpoint
UPDATE commerce.stores SET modules = array_remove(array_remove(modules, 'bookings'), 'deliveries') WHERE modules && array['bookings', 'deliveries'];
