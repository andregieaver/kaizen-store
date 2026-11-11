-- Shipping methods, zones and profiles, pickup and local delivery (wave 3, D237, docs/wave-3-shipping-methods.md 3.4) in the store copies: clone_store(),
-- duplicate_store() and copy_orders() patched in place (as store_features_rules and chat_avatar_style_copy do), so every change made to them since stays.
-- Each patch is idempotent by a marker and raises when its anchor is gone.
--
-- * clone_store() (a new store from the template or a store template): the shipping settings, profiles (and the products' profile), zones, methods and
--   their rates; and the local delivery areas by postal code that name no place. It copies no places (store_locations), so it copies no pickup option and
--   no area measured from a place.
-- * duplicate_store() (D129): the same, and the places' positions, the pickup options and every local delivery area (the places are copied there).
-- * copy_orders() (D129): an order's delivery method, its delivery as bought, its pickup place (the copy's id of it) and when it was marked ready, as
--   history. Never `delivery_mismatch_at` (an alert, not history) and never the note for the driver (the buyer's own words, as the gift message).

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('-- Shipping methods (D237)' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_new := replace(v_def, E'\n  RETURN v_store;\nEND;', $block$

  -- Shipping methods (D237): the settings, profiles (and which product is in which), zones, methods and their rates, with new ids. The template's places
  -- are not copied, so neither are its pickup options nor an area measured from a place; an area by postal codes that names no place is.
  INSERT INTO commerce.shipping_settings (store_id, default_weight_grams, updated_by)
  SELECT v_store, default_weight_grams, p_owner_id
    FROM commerce.shipping_settings WHERE store_id = p_template_id;

  INSERT INTO commerce.shipping_profiles (id, store_id, name, position)
  SELECT commerce.clone_id(v_store, id), v_store, name, position
    FROM commerce.shipping_profiles WHERE store_id = p_template_id;

  UPDATE commerce.products n
     SET shipping_profile_id = commerce.clone_id(v_store, p.shipping_profile_id)
    FROM commerce.products p
   WHERE p.store_id = p_template_id AND p.shipping_profile_id IS NOT NULL
     AND n.store_id = v_store AND n.id = commerce.clone_id(v_store, p.id);

  INSERT INTO commerce.shipping_zones (id, store_id, market_code, name, patterns, position)
  SELECT commerce.clone_id(v_store, id), v_store, market_code, name, patterns, position
    FROM commerce.shipping_zones WHERE store_id = p_template_id;

  INSERT INTO commerce.shipping_methods (
    id, store_id, market_code, currency, name, names, estimate_min_days, estimate_max_days, free_over_minor, active, position
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, currency, name, names, estimate_min_days, estimate_max_days, free_over_minor, active, position
    FROM commerce.shipping_methods WHERE store_id = p_template_id;

  INSERT INTO commerce.shipping_method_rates (store_id, method_id, zone_id, profile_id, basis, min_value, max_value, amount_minor)
  SELECT v_store, commerce.clone_id(v_store, method_id), commerce.clone_id(v_store, zone_id), commerce.clone_id(v_store, profile_id),
         basis, min_value, max_value, amount_minor
    FROM commerce.shipping_method_rates WHERE store_id = p_template_id;

  INSERT INTO commerce.local_delivery_areas (
    id, store_id, location_id, market_code, currency, name, names, kind, patterns, radius_km, amount_minor, min_basket_minor, free_over_minor,
    info, info_t, active, position
  )
  SELECT commerce.clone_id(v_store, id), v_store, NULL, market_code, currency, name, names, kind, patterns, radius_km, amount_minor, min_basket_minor,
         free_over_minor, info, info_t, active, position
    FROM commerce.local_delivery_areas WHERE store_id = p_template_id AND location_id IS NULL;

  RETURN v_store;
END;$block$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'clone_store: its end was not found, so shipping methods cannot be copied';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('-- Shipping methods (D237)' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_new := replace(v_def, E'\n  RETURN v_store;\nEND;', $block$

  -- Shipping methods (D237): the places' positions, the settings, profiles (and which copied product is in which), zones, methods and their rates, pickup
  -- options and local delivery areas, with new ids (the places were copied above under theirs).
  UPDATE commerce.store_locations n
     SET latitude = s.latitude, longitude = s.longitude
    FROM commerce.store_locations s
   WHERE s.store_id = p_source AND s.latitude IS NOT NULL
     AND n.store_id = v_store AND n.id = commerce.clone_id(v_store, s.id);

  INSERT INTO commerce.shipping_settings (store_id, default_weight_grams, updated_by)
  SELECT v_store, default_weight_grams, p_owner
    FROM commerce.shipping_settings WHERE store_id = p_source;

  INSERT INTO commerce.shipping_profiles (id, store_id, name, position, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, name, position, created_at
    FROM commerce.shipping_profiles WHERE store_id = p_source;

  UPDATE commerce.products n
     SET shipping_profile_id = commerce.clone_id(v_store, p.shipping_profile_id)
    FROM commerce.products p
   WHERE p.store_id = p_source AND p.shipping_profile_id IS NOT NULL
     AND n.store_id = v_store AND n.id = commerce.clone_id(v_store, p.id);

  INSERT INTO commerce.shipping_zones (id, store_id, market_code, name, patterns, position, created_at)
  SELECT commerce.clone_id(v_store, id), v_store, market_code, name, patterns, position, created_at
    FROM commerce.shipping_zones WHERE store_id = p_source;

  INSERT INTO commerce.shipping_methods (
    id, store_id, market_code, currency, name, names, estimate_min_days, estimate_max_days, free_over_minor, active, position, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, market_code, currency, name, names, estimate_min_days, estimate_max_days, free_over_minor, active,
         position, created_at
    FROM commerce.shipping_methods WHERE store_id = p_source;

  INSERT INTO commerce.shipping_method_rates (store_id, method_id, zone_id, profile_id, basis, min_value, max_value, amount_minor)
  SELECT v_store, commerce.clone_id(v_store, method_id), commerce.clone_id(v_store, zone_id), commerce.clone_id(v_store, profile_id),
         basis, min_value, max_value, amount_minor
    FROM commerce.shipping_method_rates WHERE store_id = p_source;

  INSERT INTO commerce.pickup_options (
    id, store_id, location_id, market_code, currency, amount_minor, ready_in_hours, instructions, instructions_t, active, position, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, commerce.clone_id(v_store, location_id), market_code, currency, amount_minor, ready_in_hours,
         instructions, instructions_t, active, position, created_at
    FROM commerce.pickup_options WHERE store_id = p_source;

  INSERT INTO commerce.local_delivery_areas (
    id, store_id, location_id, market_code, currency, name, names, kind, patterns, radius_km, amount_minor, min_basket_minor, free_over_minor,
    info, info_t, active, position, created_at
  )
  SELECT commerce.clone_id(v_store, id), v_store, commerce.clone_id(v_store, location_id), market_code, currency, name, names, kind, patterns, radius_km,
         amount_minor, min_basket_minor, free_over_minor, info, info_t, active, position, created_at
    FROM commerce.local_delivery_areas WHERE store_id = p_source;

  RETURN v_store;
END;$block$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'duplicate_store: its end was not found, so shipping methods cannot be copied';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.copy_orders(uuid, uuid, uuid, integer)'::regprocedure);
  IF position('pickup_location_id' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_new := replace(replace(v_def,
    'copied_from, vat_kind, vat_relief_minor, shipping_tax_rate',
    'copied_from, vat_kind, vat_relief_minor, shipping_tax_rate, delivery_method, delivery, pickup_location_id, ready_for_pickup_at'),
    'o.id, o.vat_kind, o.vat_relief_minor, o.shipping_tax_rate',
    'o.id, o.vat_kind, o.vat_relief_minor, o.shipping_tax_rate, o.delivery_method, o.delivery, commerce.clone_id(p_new, o.pickup_location_id), o.ready_for_pickup_at');
  IF position('delivery_method, delivery, pickup_location_id, ready_for_pickup_at' in v_new) = 0
     OR position('o.delivery_method, o.delivery, commerce.clone_id(p_new, o.pickup_location_id)' in v_new) = 0 THEN
    RAISE EXCEPTION 'copy_orders: the order columns were not found, so the delivery method cannot be copied';
  END IF;
  EXECUTE v_new;
END;
$patch$;
