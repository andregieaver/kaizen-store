-- Shipping methods, zones and profiles, pickup and local delivery (wave 3, D237, docs/wave-3-shipping-methods.md 3.3): the rules the database itself holds.
--
-- * Row-level security on the eight new tables (no policy: the `commerce` schema is private to the server; `postal_points` is reference data).
-- * Postal-code patterns (`postal_patterns_problem()`): `^[A-Z0-9-]{1,10}\*?$`, no pattern twice in a list, at most 3,000 characters in all (the numbers of
--   src/lib/shipping-limits.ts); a pattern is in one zone of a market at most (`shipping_zones_rules()`, under a lock per store and market).
-- * Rates (`shipping_rate_group_problem()`, the deferred constraint trigger `shipping_rates_tiers` at commit): one basis per (method, zone, profile), a flat
--   group of one row, tiers from 0 that meet without a gap or an overlap, at most 10, a zone of the method's own market.
-- * Limits: 20 profiles a store, 20 zones and 10 methods a market, 20 pickup options a store, 10 local areas a place and 30 a store (under a lock each).
-- * Places: a pickup option is at a `shop` or `pickup` place in its market's country; an active radius area needs its place's position; a place keeps what
--   its options and areas need (`store_locations_shipping_rules()`).
-- * Carts: a note for the driver goes with the local area (`carts_delivery_note_follows()`).
-- * Orders: `delivery_method`, `delivery` and `pickup_location_id` are frozen once the order leaves `pending_payment` (anonymising may only take the postal
--   code out of `delivery`); `ready_for_pickup_at` is set once. `anonymise_order()` nulls `delivery_note` (patched in place).
-- * Shipments: a handover (`pickup`, `local`) is made only for an order of that delivery method, and a parcel never for a pickup order.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.shipping_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipping_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipping_zones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipping_methods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.shipping_method_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.pickup_options ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.local_delivery_areas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.postal_points ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Postal-code patterns (zones and postal-code areas)
-- ---------------------------------------------------------------------------

-- What is wrong with a list of patterns, or null: each an exact code or a prefix ending in `*` (`cleanPostalPattern()` in src/lib/postal-patterns.ts writes
-- them so), none twice, at most 3,000 characters together.
CREATE FUNCTION commerce.postal_patterns_problem(p_patterns text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN p_patterns IS NULL THEN 'postal_patterns.missing'
           WHEN EXISTS (SELECT 1 FROM unnest(p_patterns) p WHERE p IS NULL OR p !~ '^[A-Z0-9-]{1,10}\*?$') THEN 'postal_patterns.malformed'
           WHEN (SELECT count(DISTINCT p) FROM unnest(p_patterns) p) <> cardinality(p_patterns) THEN 'postal_patterns.duplicate'
           WHEN (SELECT coalesce(sum(char_length(p)), 0) FROM unnest(p_patterns) p) > 3000 THEN 'postal_patterns.too_long'
         END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Profiles, zones, methods: limits and what stays fixed
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.shipping_profiles_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'shipping_profiles.store_fixed: a profile stays with its store' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('shipping_profiles:' || NEW.store_id::text, 0));
    IF (SELECT count(*) FROM commerce.shipping_profiles p WHERE p.store_id = NEW.store_id) >= 20 THEN
      RAISE EXCEPTION 'shipping_profiles.limit: a store has at most 20 shipping profiles besides General' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipping_profiles_rules BEFORE INSERT OR UPDATE ON commerce.shipping_profiles
  FOR EACH ROW EXECUTE FUNCTION commerce.shipping_profiles_rules();
--> statement-breakpoint

-- A zone's patterns are well formed and none of them is in another zone of the market (the most specific pattern decides a code's zone, so the same pattern
-- in two zones would be a tie). The lock per store and market makes two saves at once take turns.
CREATE FUNCTION commerce.shipping_zones_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_problem text;
  v_taken record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.store_id <> OLD.store_id OR NEW.market_code <> OLD.market_code) THEN
    RAISE EXCEPTION 'shipping_zones.market_fixed: a zone stays in its market' USING ERRCODE = 'check_violation';
  END IF;
  v_problem := commerce.postal_patterns_problem(NEW.patterns);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%: the zone''s postal codes are not a list of codes and prefixes (at most 10 characters each, 3,000 in all, none twice)', v_problem
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shipping_zones:' || NEW.store_id::text || ':' || NEW.market_code, 0));
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM commerce.shipping_zones z WHERE z.store_id = NEW.store_id AND z.market_code = NEW.market_code) >= 20 THEN
    RAISE EXCEPTION 'shipping_zones.limit: a country has at most 20 zones' USING ERRCODE = 'check_violation';
  END IF;
  SELECT z.name, p INTO v_taken
    FROM commerce.shipping_zones z, unnest(z.patterns) p
   WHERE z.store_id = NEW.store_id AND z.market_code = NEW.market_code AND z.id <> NEW.id AND p = ANY (NEW.patterns)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'shipping_zones.taken: % is already in the zone %', v_taken.p, v_taken.name USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipping_zones_rules BEFORE INSERT OR UPDATE ON commerce.shipping_zones
  FOR EACH ROW EXECUTE FUNCTION commerce.shipping_zones_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.shipping_methods_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.store_id <> OLD.store_id OR NEW.market_code <> OLD.market_code OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'shipping_methods.market_fixed: a method stays in its market and currency' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('shipping_methods:' || NEW.store_id::text || ':' || NEW.market_code, 0));
    IF (SELECT count(*) FROM commerce.shipping_methods m WHERE m.store_id = NEW.store_id AND m.market_code = NEW.market_code) >= 10 THEN
      RAISE EXCEPTION 'shipping_methods.limit: a country has at most 10 shipping methods' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipping_methods_rules BEFORE INSERT OR UPDATE ON commerce.shipping_methods
  FOR EACH ROW EXECUTE FUNCTION commerce.shipping_methods_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rates: tiers that meet (4.2; `tierProblems()` in src/lib/shipping-methods.ts is the same rule for the editor)
-- ---------------------------------------------------------------------------

-- What is wrong with the rates of one (method, zone, profile), or null when they are fine or there are none (*Not offered*). Tiers are read by their lower
-- bound: the first starts at 0, each next starts where the one before ends (its maximum is exclusive), and only the last may be open (no maximum).
CREATE FUNCTION commerce.shipping_rate_group_problem(p_store uuid, p_method uuid, p_zone uuid, p_profile uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_bases integer;
  v_basis text;
  v_expected bigint := 0;
  v_open boolean := false;
  r record;
BEGIN
  SELECT count(*), count(DISTINCT basis), min(basis) INTO v_count, v_bases, v_basis
    FROM commerce.shipping_method_rates
   WHERE store_id = p_store AND method_id = p_method AND zone_id IS NOT DISTINCT FROM p_zone AND profile_id IS NOT DISTINCT FROM p_profile;
  IF v_count = 0 THEN RETURN NULL; END IF;
  IF p_zone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.shipping_zones z JOIN commerce.shipping_methods m ON m.store_id = z.store_id AND m.market_code = z.market_code
     WHERE z.store_id = p_store AND z.id = p_zone AND m.id = p_method
  ) THEN
    RETURN 'shipping_rates.zone_market';
  END IF;
  IF v_count > 10 THEN RETURN 'shipping_rates.too_many'; END IF;
  IF v_bases > 1 THEN RETURN 'shipping_rates.mixed_basis'; END IF;
  IF v_basis = 'flat' THEN
    RETURN CASE WHEN v_count > 1 THEN 'shipping_rates.two_flat' END;
  END IF;
  FOR r IN
    SELECT min_value, max_value FROM commerce.shipping_method_rates
     WHERE store_id = p_store AND method_id = p_method AND zone_id IS NOT DISTINCT FROM p_zone AND profile_id IS NOT DISTINCT FROM p_profile
     ORDER BY min_value, max_value NULLS LAST, id
  LOOP
    IF v_open OR r.min_value < v_expected THEN RETURN 'shipping_rates.overlap'; END IF;
    IF r.min_value > v_expected THEN RETURN 'shipping_rates.gap'; END IF;
    IF r.max_value IS NULL THEN v_open := true; ELSE v_expected := r.max_value; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- At commit, so an editor may replace a group's rows one by one inside its transaction.
CREATE FUNCTION commerce.shipping_rates_tiers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_problem text;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_problem := commerce.shipping_rate_group_problem(NEW.store_id, NEW.method_id, NEW.zone_id, NEW.profile_id);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%: the rates of a method for one zone and profile are one flat price or tiers from 0 that meet without a gap (at most 10), in the method''s own country',
        v_problem USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_problem := commerce.shipping_rate_group_problem(OLD.store_id, OLD.method_id, OLD.zone_id, OLD.profile_id);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%: the rates of a method for one zone and profile are one flat price or tiers from 0 that meet without a gap (at most 10), in the method''s own country',
        v_problem USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipping_rates_tiers AFTER INSERT OR UPDATE OR DELETE ON commerce.shipping_method_rates
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.shipping_rates_tiers();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Pickup options and local delivery areas
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.pickup_options_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_place record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'pickup_options.store_fixed: a pickup option stays with its store' USING ERRCODE = 'check_violation';
  END IF;
  SELECT l.kind, l.country INTO v_place FROM commerce.store_locations l WHERE l.store_id = NEW.store_id AND l.id = NEW.location_id;
  IF v_place.kind IS NULL OR v_place.kind NOT IN ('shop', 'pickup') THEN
    RAISE EXCEPTION 'pickup_options.place_kind: customers collect at a shop or a pickup place, not at the office' USING ERRCODE = 'check_violation';
  END IF;
  IF v_place.country <> NEW.market_code THEN
    RAISE EXCEPTION 'pickup_options.place_country: the place is in %, not in the country %', v_place.country, NEW.market_code USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pickup_options:' || NEW.store_id::text, 0));
    IF (SELECT count(*) FROM commerce.pickup_options o WHERE o.store_id = NEW.store_id) >= 20 THEN
      RAISE EXCEPTION 'pickup_options.limit: a store has at most 20 pickup places' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pickup_options_rules BEFORE INSERT OR UPDATE ON commerce.pickup_options
  FOR EACH ROW EXECUTE FUNCTION commerce.pickup_options_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.local_delivery_areas_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_place record;
  v_problem text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.store_id <> OLD.store_id OR NEW.market_code <> OLD.market_code OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'local_delivery_areas.market_fixed: an area stays in its country and currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'postal' THEN
    v_problem := commerce.postal_patterns_problem(NEW.patterns);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%: the area''s postal codes are not a list of codes and prefixes (at most 10 characters each, 3,000 in all, none twice)', v_problem
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.location_id IS NOT NULL THEN
    SELECT l.country, l.latitude FROM commerce.store_locations l WHERE l.store_id = NEW.store_id AND l.id = NEW.location_id INTO v_place;
    IF v_place.country <> NEW.market_code THEN
      RAISE EXCEPTION 'local_delivery_areas.place_country: the place is in %, not in the country %', v_place.country, NEW.market_code USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'radius' AND NEW.active AND v_place.latitude IS NULL THEN
      RAISE EXCEPTION 'local_delivery_areas.no_position: a radius is measured from the place, which has no position yet' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('local_delivery_areas:' || NEW.store_id::text, 0));
    IF TG_OP = 'INSERT' AND (SELECT count(*) FROM commerce.local_delivery_areas a WHERE a.store_id = NEW.store_id) >= 30 THEN
      RAISE EXCEPTION 'local_delivery_areas.limit: a store has at most 30 local delivery areas' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.location_id IS NOT NULL
       AND (SELECT count(*) FROM commerce.local_delivery_areas a WHERE a.store_id = NEW.store_id AND a.location_id = NEW.location_id AND a.id <> NEW.id) >= 10 THEN
      RAISE EXCEPTION 'local_delivery_areas.place_limit: a place has at most 10 local delivery areas' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_delivery_areas_rules BEFORE INSERT OR UPDATE ON commerce.local_delivery_areas
  FOR EACH ROW EXECUTE FUNCTION commerce.local_delivery_areas_rules();
--> statement-breakpoint

-- A place keeps what its pickup option and its areas need: a pickup option's place stays a shop or pickup place in the option's country, an area's place in
-- the area's country, and an active radius area's place keeps a position.
CREATE FUNCTION commerce.store_locations_shipping_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.kind NOT IN ('shop', 'pickup') OR NEW.country <> OLD.country)
     AND EXISTS (SELECT 1 FROM commerce.pickup_options o WHERE o.store_id = OLD.store_id AND o.location_id = OLD.id) THEN
    RAISE EXCEPTION 'store_locations.pickup_option: customers collect at this place; switch its pickup off before making it an office or moving it to another country'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.country <> OLD.country
     AND EXISTS (SELECT 1 FROM commerce.local_delivery_areas a WHERE a.store_id = OLD.store_id AND a.location_id = OLD.id) THEN
    RAISE EXCEPTION 'store_locations.local_area: local delivery areas are measured from this place; remove them before moving it to another country'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.latitude IS NULL AND OLD.latitude IS NOT NULL
     AND EXISTS (SELECT 1 FROM commerce.local_delivery_areas a WHERE a.store_id = OLD.store_id AND a.location_id = OLD.id AND a.kind = 'radius' AND a.active) THEN
    RAISE EXCEPTION 'store_locations.radius_area: an active radius area is measured from this place''s position' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_locations_shipping_rules BEFORE UPDATE OF kind, country, latitude, longitude ON commerce.store_locations
  FOR EACH ROW EXECUTE FUNCTION commerce.store_locations_shipping_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Carts and orders
-- ---------------------------------------------------------------------------

-- The note for the driver goes when the local area does (another choice, or the area deleted, whose foreign key clears the cart's column): the check
-- `carts_delivery_note` refuses a note without an area, and this keeps an area's removal from being refused by it.
CREATE FUNCTION commerce.carts_delivery_note_follows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.local_area_id IS NOT NULL AND NEW.local_area_id IS NULL THEN
    NEW.delivery_note := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER carts_delivery_note_follows BEFORE UPDATE OF local_area_id ON commerce.carts
  FOR EACH ROW EXECUTE FUNCTION commerce.carts_delivery_note_follows();
--> statement-breakpoint

-- How the goods reach the buyer is part of what was bought: once the order leaves `pending_payment` its method, the delivery it kept and the pickup place
-- stay (an order edit never changes them). Anonymising (D162) may only take the postal code out of `delivery`. *Ready for pickup* is recorded once.
CREATE FUNCTION commerce.orders_delivery_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'pending_payment'
     AND (NEW.delivery_method IS DISTINCT FROM OLD.delivery_method OR NEW.pickup_location_id IS DISTINCT FROM OLD.pickup_location_id
          OR NEW.delivery IS DISTINCT FROM OLD.delivery) THEN
    IF coalesce(current_setting('commerce.anonymising', true), '') = 'on'
       AND NEW.delivery_method IS NOT DISTINCT FROM OLD.delivery_method AND NEW.pickup_location_id IS NOT DISTINCT FROM OLD.pickup_location_id
       AND NEW.delivery IS NOT DISTINCT FROM (OLD.delivery - 'postalCode') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'order_delivery.frozen: how order % is delivered was chosen when it was bought and cannot be changed', OLD.number USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.ready_for_pickup_at IS NOT NULL AND NEW.ready_for_pickup_at IS DISTINCT FROM OLD.ready_for_pickup_at THEN
    RAISE EXCEPTION 'order_delivery.ready_once: order % was marked ready for pickup at %', OLD.number, OLD.ready_for_pickup_at USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_delivery_frozen BEFORE UPDATE OF delivery_method, delivery, pickup_location_id, ready_for_pickup_at ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_delivery_frozen();
--> statement-breakpoint

-- A handover is made only for an order delivered that way, and a pickup order is never sent as a parcel (4.4: `markSent()` says the same in words).
CREATE FUNCTION commerce.shipments_method_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_method text;
BEGIN
  SELECT o.delivery_method INTO v_method FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
  IF NEW.method = 'parcel' AND v_method = 'pickup' THEN
    RAISE EXCEPTION 'shipment.pickup_order: the customer collects this order; mark it collected instead of sending it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.method IN ('pickup', 'local') AND v_method IS DISTINCT FROM NEW.method THEN
    RAISE EXCEPTION 'shipment.method: a % handover is only for an order delivered so (this one is %)', NEW.method, v_method USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipments_method_rules BEFORE INSERT ON commerce.shipments
  FOR EACH ROW EXECUTE FUNCTION commerce.shipments_method_rules();
--> statement-breakpoint

-- The append-only guard of order_events lets anonymising take out the two postal codes of a `order.delivery_mismatch` event too (below), and nothing
-- else of any event. Patched in place like anonymise_order().
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_extra text := ' - (CASE WHEN to_jsonb(OLD) ->> ''type'' = ''order.delivery_mismatch'' THEN ARRAY[''priced'', ''address''] ELSE ARRAY[]::text[] END)';
BEGIN
  v_def := pg_get_functiondef('commerce.forbid_change()'::regprocedure);
  IF position('order.delivery_mismatch' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_new := replace(v_def,
    'AND ((to_jsonb(NEW) -> ''data'') - ARRAY[''reason'', ''note'']) IS NOT DISTINCT FROM ((to_jsonb(OLD) -> ''data'') - ARRAY[''reason'', ''note''])',
    'AND ((to_jsonb(NEW) -> ''data'') - ARRAY[''reason'', ''note'']' || v_extra || ') IS NOT DISTINCT FROM ((to_jsonb(OLD) -> ''data'') - ARRAY[''reason'', ''note'']' || v_extra || ')');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'forbid_change: the anonymising rule of order_events was not found';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- Anonymising an order (D162) also clears the note for the driver (the check `orders_anonymised` holds it) and the two postal codes of a
-- `order.delivery_mismatch` event (the one the shopper typed and the one of the address Stripe collected, 2.7). Patched in place, as every change to
-- anonymise_order() since gdpr_rules was, so the rest stays as it is.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  v_new := v_def;
  IF position('delivery_note = NULL' in v_new) = 0 THEN
    v_new := replace(v_new,
      'delivery = CASE WHEN delivery IS NULL THEN NULL ELSE delivery - ''postalCode'' END,',
      'delivery = CASE WHEN delivery IS NULL THEN NULL ELSE delivery - ''postalCode'' END,
    -- The note for the driver of a local delivery (D237) is the buyer''s own words.
    delivery_note = NULL,');
    IF position('delivery_note = NULL' in v_new) = 0 THEN
      RAISE EXCEPTION 'anonymise_order: the delivery line was not found, so the note for the driver cannot be cleared';
    END IF;
  END IF;
  IF position('order.delivery_mismatch' in v_new) = 0 THEN
    v_new := replace(v_new,
      'WHERE e.store_id = p_store AND e.order_id = p_order AND (e.data ? ''reason'' OR e.data ? ''note'');',
      'WHERE e.store_id = p_store AND e.order_id = p_order AND (e.data ? ''reason'' OR e.data ? ''note'');
  -- The postal codes a delivery price was set for and of the address (D237 2.7) are the buyer''s.
  UPDATE commerce.order_events e SET data = e.data - ARRAY[''priced'', ''address'']
   WHERE e.store_id = p_store AND e.order_id = p_order AND e.type = ''order.delivery_mismatch'' AND (e.data ? ''priced'' OR e.data ? ''address'');');
    IF position('order.delivery_mismatch' in v_new) = 0 THEN
      RAISE EXCEPTION 'anonymise_order: the event scrub was not found, so the postal codes of a delivery mismatch cannot be cleared';
    END IF;
  END IF;
  IF v_new <> v_def THEN
    EXECUTE v_new;
  END IF;
END;
$patch$;
