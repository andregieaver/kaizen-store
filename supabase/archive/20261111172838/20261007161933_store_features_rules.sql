-- Store features (D178, docs/store-features.md, src/lib/store-features.ts): what a store keeps switched on is `stores.features`; what is on
-- is a feature kept on whose needs are kept on too.
-- * `commerce.feature_needs()` is the registry's needs (transitively complete), `features_effective()` and `feature_on()` the rule.
-- * Existing stores: the features they use stay on, the rest start off (the column's default gave every store `shop`).
-- * `stores.modules`' `bookings` and `deliveries` follow the features (bookings: appointments or stays and rentals on; deliveries: boxes on),
--   so code that reads the modules keeps working; code from before D178 that writes a module moves its features (`stores_features_sync()`).
-- * New stores: `clone_store()` no longer copies the template's `bookings`/`deliveries` modules, so a store made from the template starts
--   with the shop alone; a store template brings its features (`clone_starter_setup()`), and a duplicate keeps the original's (`duplicate_store()`).

CREATE FUNCTION commerce.feature_needs(p_feature text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_feature
    WHEN 'shop' THEN '{}'::text[]
    WHEN 'countries' THEN '{}'::text[]
    WHEN 'languages' THEN '{}'::text[]
    WHEN 'referrals' THEN array['shop', 'bonus']
    ELSE array['shop']
  END
$$;
--> statement-breakpoint

-- The features that are on, of those kept on: each with everything it needs (the needs are transitively complete, so one level is enough).
CREATE FUNCTION commerce.features_effective(p_features text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(f ORDER BY f), '{}'::text[])
    FROM unnest(p_features) f
   WHERE commerce.feature_needs(f) <@ p_features
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.feature_on(p_store uuid, p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT p_feature = ANY (s.features) AND commerce.feature_needs(p_feature) <@ s.features
                     FROM commerce.stores s WHERE s.id = p_store), false)
$$;
--> statement-breakpoint

-- Keeps `features` tidy (known ids, sorted, once each) and the modules of code from before D178 in step with it, both ways.
CREATE FUNCTION commerce.stores_features_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_on text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A store inserted with a module (tests, older code) has its features.
    IF 'bookings' = ANY (NEW.modules) AND NOT (NEW.features && array['appointments', 'bookings']) THEN
      NEW.features := NEW.features || array['appointments', 'bookings'];
    END IF;
    IF 'deliveries' = ANY (NEW.modules) AND NOT ('boxes' = ANY (NEW.features)) THEN
      NEW.features := NEW.features || array['boxes'];
    END IF;
  ELSIF NEW.features IS NOT DISTINCT FROM OLD.features THEN
    -- Only the modules were written: a module switched on or off moves its features.
    IF ('bookings' = ANY (NEW.modules)) IS DISTINCT FROM ('bookings' = ANY (OLD.modules)) THEN
      IF 'bookings' = ANY (NEW.modules) THEN
        NEW.features := NEW.features || array['appointments', 'bookings'];
      ELSE
        NEW.features := array_remove(array_remove(NEW.features, 'appointments'), 'bookings');
      END IF;
    END IF;
    IF ('deliveries' = ANY (NEW.modules)) IS DISTINCT FROM ('deliveries' = ANY (OLD.modules)) THEN
      IF 'deliveries' = ANY (NEW.modules) THEN
        NEW.features := NEW.features || array['boxes'];
      ELSE
        NEW.features := array_remove(NEW.features, 'boxes');
      END IF;
    END IF;
  END IF;

  NEW.features := (SELECT coalesce(array_agg(DISTINCT f ORDER BY f), '{}'::text[]) FROM unnest(NEW.features) f);
  v_on := commerce.features_effective(NEW.features);

  -- The modules follow what is on (the shop's switch included); `work` is not a feature and is left as it is.
  IF v_on && array['appointments', 'bookings'] THEN
    IF NOT ('bookings' = ANY (NEW.modules)) THEN NEW.modules := NEW.modules || array['bookings']; END IF;
  ELSE
    NEW.modules := array_remove(NEW.modules, 'bookings');
  END IF;
  IF 'boxes' = ANY (v_on) THEN
    IF NOT ('deliveries' = ANY (NEW.modules)) THEN NEW.modules := NEW.modules || array['deliveries']; END IF;
  ELSE
    NEW.modules := array_remove(NEW.modules, 'deliveries');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The backfill: every store has the shop (the column's default); the features a store uses stay on.
WITH used AS (
  SELECT s.id,
    'bookings' = ANY (s.modules) AS bookings_module,
    'deliveries' = ANY (s.modules) AS deliveries_module,
    (EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = s.id AND p.kind = 'appointment')
      OR EXISTS (SELECT 1 FROM commerce.booking_resources r WHERE r.store_id = s.id AND r.kind = 'staff')) AS has_appointments,
    (EXISTS (SELECT 1 FROM commerce.products p WHERE p.store_id = s.id AND p.kind IN ('stay', 'rental'))
      OR EXISTS (SELECT 1 FROM commerce.booking_resources r WHERE r.store_id = s.id AND r.kind IN ('unit', 'item'))
      OR EXISTS (SELECT 1 FROM commerce.hosts h WHERE h.store_id = s.id)) AS has_stays,
    (EXISTS (SELECT 1 FROM commerce.selling_plans sp WHERE sp.store_id = s.id)
      OR EXISTS (SELECT 1 FROM commerce.subscriptions su WHERE su.store_id = s.id)) AS has_subscriptions,
    coalesce((SELECT b.enabled FROM commerce.bonus_settings b WHERE b.store_id = s.id), false) AS bonus_on,
    coalesce((SELECT a.enabled FROM commerce.affiliate_settings a WHERE a.store_id = s.id), false) AS referrals_on,
    s.audience <> 'consumers' AS sells_to_businesses,
    (SELECT count(*) FROM commerce.markets m WHERE m.store_id = s.id AND m.active) > 1 AS several_countries,
    EXISTS (SELECT 1 FROM commerce.store_currencies c WHERE c.store_id = s.id) AS several_currencies,
    ((SELECT count(DISTINCT split_part(l, '-', 1)) FROM unnest(s.locales) l) > 1
      OR EXISTS (SELECT 1 FROM commerce.markets m WHERE m.store_id = s.id AND cardinality(m.locales) > 1)) AS several_languages
  FROM commerce.stores s
)
UPDATE commerce.stores s
   SET features = (
     SELECT coalesce(array_agg(DISTINCT f ORDER BY f), '{}'::text[]) FROM unnest(
       array['shop']
       || CASE WHEN u.bookings_module AND (u.has_appointments OR NOT u.has_stays) THEN array['appointments'] ELSE '{}'::text[] END
       || CASE WHEN u.bookings_module AND (u.has_stays OR NOT u.has_appointments) THEN array['bookings'] ELSE '{}'::text[] END
       || CASE WHEN u.deliveries_module THEN array['boxes'] ELSE '{}'::text[] END
       || CASE WHEN u.has_subscriptions THEN array['subscriptions'] ELSE '{}'::text[] END
       || CASE WHEN u.bonus_on THEN array['bonus'] ELSE '{}'::text[] END
       || CASE WHEN u.referrals_on THEN array['referrals'] ELSE '{}'::text[] END
       || CASE WHEN u.sells_to_businesses THEN array['business'] ELSE '{}'::text[] END
       || CASE WHEN u.several_countries THEN array['countries'] ELSE '{}'::text[] END
       || CASE WHEN u.several_currencies THEN array['currencies'] ELSE '{}'::text[] END
       || CASE WHEN u.several_languages THEN array['languages'] ELSE '{}'::text[] END
     ) f
   )
  FROM used u
 WHERE u.id = s.id;
--> statement-breakpoint

CREATE TRIGGER stores_features_sync
BEFORE INSERT OR UPDATE OF features, modules ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.stores_features_sync();
--> statement-breakpoint

-- A store made from the template starts with the shop alone (D178): the template's bookings and deliveries modules are not copied, so the
-- trigger gives it no feature of theirs (patched on its live definition, as 20261007094055_store_starters_rules.sql).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'theme - \'savedId\', modules, time_zone, booking_reminder_hours',
    E'theme - \'savedId\', array_remove(array_remove(modules, \'bookings\'), \'deliveries\'), time_zone, booking_reminder_hours');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the copy of the template''s modules was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- A duplicate keeps the original's features (D178), as it keeps its modules.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_new := replace(replace(v_def,
    'business_popup, open_cart_on_add, modules,',
    'business_popup, open_cart_on_add, modules, features,'),
    E'array_remove(s.modules, \'work\'), s.time_zone,',
    E'array_remove(s.modules, \'work\'), s.features, s.time_zone,');
  IF v_new = v_def OR position('s.features, s.time_zone' in v_new) = 0 OR position('modules, features,' in v_new) = 0 THEN
    RAISE EXCEPTION 'duplicate_store: the copy of the store''s modules was not found';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.clone_starter_setup(p_source uuid, p_store uuid, p_owner uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_source AND starter) THEN
    RAISE EXCEPTION 'store_starters.not_starter: % is not a store template', p_source USING ERRCODE = 'check_violation';
  END IF;

  -- Its features (D178), who it sells to, how the cart and checkout behave, its languages and the CSS its pages rely on; and where it came from.
  UPDATE commerce.stores n
     SET features = t.features,
         audience = t.audience,
         business_popup = t.business_popup,
         open_cart_on_add = t.open_cart_on_add,
         terms_at_checkout = t.terms_at_checkout,
         locales = t.locales,
         rates_auto = t.rates_auto,
         rates_updated_at = t.rates_updated_at,
         custom_css = t.custom_css,
         made_from_starter = COALESCE(
           (SELECT st.id FROM commerce.store_starters st WHERE st.store_id = p_source),
           t.starter_copy_of
         )
    FROM commerce.stores t
   WHERE n.id = p_store AND t.id = p_source;

  INSERT INTO commerce.store_currencies (store_id, currency, rate, round_to, position)
  SELECT p_store, currency, rate, round_to, position
    FROM commerce.store_currencies WHERE store_id = p_source
  ON CONFLICT DO NOTHING;

  -- Pages and articles not published yet (the legal page drafts among them), as drafts: never published for the new owner.
  INSERT INTO commerce.pages (id, store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
  SELECT commerce.clone_id(p_store, p.id), p_store, p.type, p.slug,
         commerce.clone_page_content(p_store, p_source, p.draft), NULL, NULL, NULL, p_owner, p_owner
    FROM commerce.pages p
   WHERE p.store_id = p_source AND p.published_at IS NULL AND p.type <> 'variant'
  ON CONFLICT DO NOTHING;

  INSERT INTO commerce.field_values (store_id, entity, entity_id, locale, values)
  SELECT p_store, fv.entity, commerce.clone_id(p_store, fv.entity_id), fv.locale, fv.values
    FROM commerce.field_values fv
    JOIN commerce.pages p ON p.store_id = fv.store_id AND p.id = fv.entity_id
   WHERE fv.store_id = p_source AND fv.entity IN ('page', 'article') AND p.published_at IS NULL
     AND EXISTS (SELECT 1 FROM commerce.pages c WHERE c.id = commerce.clone_id(p_store, fv.entity_id))
  ON CONFLICT DO NOTHING;

  -- The places (D112, D113, D158) given to those drafts: a legal page keeps its place, still a draft.
  INSERT INTO commerce.page_roles (store_id, role, page_id)
  SELECT p_store, r.role, commerce.clone_id(p_store, r.page_id)
    FROM commerce.page_roles r
   WHERE r.store_id = p_source
     AND EXISTS (SELECT 1 FROM commerce.pages p WHERE p.store_id = p_store AND p.id = commerce.clone_id(p_store, r.page_id))
  ON CONFLICT DO NOTHING;

  -- Order handling (D173): gift messages, archiving and how long a draft's pay link lasts; never the power to record payments.
  INSERT INTO commerce.order_settings (store_id, gift_messages, auto_archive_days, draft_valid_days)
  SELECT p_store, gift_messages, auto_archive_days, draft_valid_days
    FROM commerce.order_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO UPDATE
    SET gift_messages = excluded.gift_messages, auto_archive_days = excluded.auto_archive_days, draft_valid_days = excluded.draft_valid_days;

  -- Invoices (D159): the note and the confirmation switch, as duplicate_store() copies them; the series start in the new store.
  INSERT INTO commerce.invoice_settings (store_id, enabled, footer_note, email_with_confirmation, updated_by)
  SELECT p_store, true, footer_note, email_with_confirmation, p_owner
    FROM commerce.invoice_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;

  -- Subscription boxes' delivery days (D102); never a shopper's list.
  INSERT INTO commerce.delivery_schedules (id, store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active)
  SELECT commerce.clone_id(p_store, id), p_store, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active
    FROM commerce.delivery_schedules WHERE store_id = p_source;

  -- Customer groups (D108); never a company, which is a customer.
  INSERT INTO commerce.customer_tiers (id, store_id, name, percent, note, active)
  SELECT commerce.clone_id(p_store, id), p_store, name, percent, note, active
    FROM commerce.customer_tiers WHERE store_id = p_source;

  -- The bonus and referral programs' rules (D130, D131); never a balance, a code or an earning.
  INSERT INTO commerce.bonus_settings (
    store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, updated_by
  )
  SELECT p_store, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, p_owner
    FROM commerce.bonus_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO commerce.affiliate_settings (
    store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, updated_by
  )
  SELECT p_store, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days, p_owner
    FROM commerce.affiliate_settings WHERE store_id = p_source
  ON CONFLICT (store_id) DO NOTHING;
END;
$$;