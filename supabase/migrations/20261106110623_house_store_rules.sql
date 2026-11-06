-- Kaizena Flow's own store (D466, docs/platform-parity-plan.md step 1): the rules the database holds, and the store itself.
--
-- * Kaizena Flow's own store (`stores.house`) is its site and its customers: a store like any other, with the online shop off, that is not
--   a customer. One at most (`stores_one_house_idx`), never a template, a store template or a sandbox (`stores_house_real`).
-- * Only `commerce.make_house_store()` marks a store as Kaizena Flow's own, and nothing unmarks it; it is never closed or suspended
--   (`stores_house_rules()`).
-- * It has no plan, no subscription and no trial (`store_billing_house()`): the platform is what bills.
-- * Its members are the platform admins, and only they (`store_members_house()`): from the switch (step 5) its pages are served on
--   Kaizena Flow's own site beside the admin, so whatever code they hold must come from a platform admin. An account made a platform
--   admin becomes an owner of it, and one that stops being one, or is disabled, stops being a member (`house_members_sync()`); it may be
--   left with no owner while the platform has no admin (`keep_an_owner()`).
-- * It is never news to Kaizena Flow's own integrations (D465): neither made nor opened (`platform_store_created()`,
--   `platform_store_opened()`).
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE anywhere.

CREATE OR REPLACE FUNCTION commerce.house_store()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT id FROM commerce.stores WHERE house
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.stores_house_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.house AND COALESCE(current_setting('commerce.house_change', true), '') <> 'make' THEN
    RAISE EXCEPTION 'stores.house_fixed: only make_house_store() makes Kaizena Flow''s own store' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.house IS DISTINCT FROM NEW.house THEN
    RAISE EXCEPTION 'stores.house_fixed: Kaizena Flow''s own store stays its own, and no other store becomes it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.house AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'stores.house_open: Kaizena Flow''s own store is never closed or suspended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_house_rules BEFORE INSERT OR UPDATE OF house, status ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_house_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_billing_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.plan_id IS NOT NULL OR NEW.subscription_id IS NOT NULL OR NEW.trial_ends_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.house) THEN
    RAISE EXCEPTION 'store_billing.house: Kaizena Flow''s own store has no plan and no trial' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_billing_house BEFORE INSERT OR UPDATE ON commerce.store_billing
  FOR EACH ROW EXECUTE FUNCTION commerce.store_billing_house();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_members_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.disabled_at IS NULL
     AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.house)
     AND NOT EXISTS (SELECT 1 FROM commerce.accounts a WHERE a.id = NEW.account_id AND a.platform_admin AND a.disabled_at IS NULL) THEN
    RAISE EXCEPTION 'store_members.house: only platform admins work in Kaizena Flow''s own store' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_members_house BEFORE INSERT OR UPDATE OF store_id, account_id, disabled_at ON commerce.store_members
  FOR EACH ROW EXECUTE FUNCTION commerce.store_members_house();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.house_members_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid := commerce.house_store();
BEGIN
  IF v_store IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.platform_admin AND NEW.disabled_at IS NULL THEN
    INSERT INTO commerce.store_members (store_id, account_id, role)
    VALUES (v_store, NEW.id, 'owner')
    ON CONFLICT (store_id, account_id) DO UPDATE SET role = 'owner', disabled_at = NULL, expires_at = NULL, role_id = NULL, kind = 'staff'
      WHERE commerce.store_members.disabled_at IS NOT NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- The last platform admin may stop being one: the store is then left without an owner until the next one (`keep_an_owner()`).
    UPDATE commerce.store_members SET disabled_at = now()
     WHERE store_id = v_store AND account_id = NEW.id AND disabled_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Every store keeps an active owner, except Kaizena Flow's own: its owners are the platform admins, and it may be left with none while
-- the platform has none (the next platform admin becomes its owner).
CREATE OR REPLACE FUNCTION commerce.keep_an_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.disabled_at IS NOT NULL)
     AND OLD.role = 'owner' AND OLD.disabled_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id AND s.house)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.store_members
        WHERE store_id = OLD.store_id
          AND role = 'owner'
          AND disabled_at IS NULL
          AND account_id <> OLD.account_id
     ) THEN
    RAISE EXCEPTION 'the store must keep at least one active owner'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint

CREATE TRIGGER accounts_house_members AFTER INSERT OR UPDATE OF platform_admin, disabled_at ON commerce.accounts
  FOR EACH ROW EXECUTE FUNCTION commerce.house_members_sync();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.platform_store_created()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.sandbox AND NOT NEW.sandbox) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM commerce.stores s
    WHERE s.id = NEW.id AND NOT s.starter AND NOT s.sandbox AND NOT s.is_template AND NOT s.house
  ) THEN
    PERFORM commerce.queue_platform_event('store.created', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.platform_store_opened()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.starter AND NOT NEW.sandbox AND NOT NEW.is_template AND NOT NEW.house THEN
    PERFORM commerce.queue_platform_event('store.opened', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Makes Kaizena Flow's own store once, and returns it: `kaizenaflow`, named Kaizena Flow, a website (the shop off) with Deals, in Kaizena
-- Flow's own site languages (English first), selling to nobody from Norway, the business details Kaizena Flow's site shows, two-step
-- required, private until its site is served from it (step 5); its owners the platform admins.
CREATE OR REPLACE FUNCTION commerce.make_house_store()
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id uuid := commerce.house_store();
  v_business jsonb;
  v_locales text[];
BEGIN
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT COALESCE(p.business, '{}'::jsonb), p.locales INTO v_business, v_locales FROM commerce.platform_settings p LIMIT 1;
  v_business := COALESCE(v_business, '{}'::jsonb);
  v_locales := ARRAY['en-GB'] || ARRAY(SELECT l FROM unnest(COALESCE(v_locales, '{}'::text[])) AS l WHERE l <> 'en-GB');

  PERFORM set_config('commerce.house_change', 'make', true);
  INSERT INTO commerce.stores (
    slug, name, house, features, sales_pilot, private_mode, locales, country, time_zone, require_two_step, setup_completed_at,
    legal_name, organisation_number, contact_email, postal_address
  ) VALUES (
    'kaizenaflow', 'Kaizena Flow', true, ARRAY['languages', 'sales'], true, true, v_locales, 'NO', 'Europe/Oslo', true, now(),
    NULLIF(btrim(v_business->>'legalName'), ''), NULLIF(btrim(v_business->>'organisationNumber'), ''),
    NULLIF(btrim(v_business->>'contactEmail'), ''), NULLIF(btrim(v_business->>'postalAddress'), '')
  )
  RETURNING id INTO v_id;
  PERFORM set_config('commerce.house_change', '', true);

  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  VALUES (v_id, 'NO', 'NOK', 'en-GB', v_locales, true);

  INSERT INTO commerce.store_members (store_id, account_id, role)
  SELECT v_id, a.id, 'owner' FROM commerce.accounts a WHERE a.platform_admin AND a.disabled_at IS NULL;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

SELECT commerce.make_house_store();
