-- Store templates (D175, docs/store-templates.md): the rules that live in the database. The columns and the table are in the migration
-- before this one.
--
-- * a starter is never open for sale: `commerce.store_is_active()` is false for it (so every job that skips a store that is not open skips
--   it), and `commerce.orders_store_open()` refuses an order in it with its own reason, `orders.store_starter`, whoever asks;
-- * once a starter, always a starter, and only a store that never sold and has no customers becomes one (`stores_starter_rules()`);
-- * a row of `store_starters` describes a starter store only, never changes store, and is never deleted (`store_starters_rules()`);
-- * `commerce.starter_source(starter)` is the one place that decides what a new store is copied from: a published starter's store, or the
--   default template when none is chosen; anything else is refused;
-- * `commerce.clone_starter_setup()` copies a starter's operational set-up that `clone_store()` leaves out, called by `clone_store()`
--   (patched on its live definition) when the source is a starter;
-- * `commerce.approve_access_request()` copies the starter chosen on the request.
--
-- No DELETE anywhere.

ALTER TABLE commerce.store_starters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_is_active(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.status = 'active' AND NOT s.starter FROM commerce.stores s WHERE s.id = p_store), false)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.orders_store_open()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A store template (D175) takes no order of any kind, not even a copied one: it is a preview.
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.starter) THEN
    RAISE EXCEPTION 'orders.store_starter: a store template takes no orders' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT commerce.store_is_active(NEW.store_id) THEN
    RAISE EXCEPTION 'orders.store_not_open: the store is not open for sale' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.stores_starter_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.starter AND NOT NEW.starter THEN
    RAISE EXCEPTION 'stores.starter_fixed: a store template stays a store template' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.starter AND (TG_OP = 'INSERT' OR NOT OLD.starter) THEN
    IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.store_id = NEW.id)
       OR EXISTS (SELECT 1 FROM commerce.customers c WHERE c.store_id = NEW.id) THEN
      RAISE EXCEPTION 'stores.starter_has_sales: a store that has orders or customers cannot become a store template'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_starter_rules
BEFORE INSERT OR UPDATE OF starter ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.stores_starter_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.store_starters_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'store_starters.kept: a store template is unpublished, never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.starter) THEN
    RAISE EXCEPTION 'store_starters.not_starter: only a store marked as a store template is described as one' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'store_starters.store_fixed: a store template keeps its store' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_starters_rules
BEFORE INSERT OR UPDATE OR DELETE ON commerce.store_starters
FOR EACH ROW EXECUTE FUNCTION commerce.store_starters_rules();
--> statement-breakpoint

-- What a new store is copied from: the published starter chosen, else the default template. The one place this is decided.
CREATE FUNCTION commerce.starter_source(p_starter uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  IF p_starter IS NULL THEN
    SELECT id INTO v_store FROM commerce.stores WHERE is_template;
    IF v_store IS NULL THEN
      RAISE EXCEPTION 'there is no template store';
    END IF;
    RETURN v_store;
  END IF;
  SELECT st.store_id INTO v_store
    FROM commerce.store_starters st
    JOIN commerce.stores s ON s.id = st.store_id
   WHERE st.id = p_starter AND st.published AND s.starter AND s.status = 'active';
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'store_starters.not_offered: that store template is not offered' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_store;
END;
$$;
--> statement-breakpoint

-- The operational set-up of a store template that clone_store() does not copy (docs/store-templates.md, section 6). Never orders,
-- customers, payments, Stripe accounts, credentials, domains, integrations, carrier agreements, AI keys, series, documents, the audit
-- log, analytics, tests, campaigns, codes, the tax profile, business details, tracking or members.
CREATE FUNCTION commerce.clone_starter_setup(p_source uuid, p_store uuid, p_owner uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_source AND starter) THEN
    RAISE EXCEPTION 'store_starters.not_starter: % is not a store template', p_source USING ERRCODE = 'check_violation';
  END IF;

  -- Who it sells to, how the cart and checkout behave, its languages and the CSS its pages rely on; and where it came from.
  UPDATE commerce.stores n
     SET audience = t.audience,
         business_popup = t.business_popup,
         open_cart_on_add = t.open_cart_on_add,
         terms_at_checkout = t.terms_at_checkout,
         locales = t.locales,
         rates_auto = t.rates_auto,
         rates_updated_at = t.rates_updated_at,
         custom_css = t.custom_css,
         made_from_starter = (SELECT st.id FROM commerce.store_starters st WHERE st.store_id = p_source)
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
--> statement-breakpoint

-- clone_store() calls it at its end when the source is a starter (patched on its live definition, as 20261006081019_inventory_rules.sql).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  v_new := replace(v_def,
    E'  RETURN v_store;\nEND;',
    E'  -- A store template (D175) brings the rest of its operational set-up.\n  IF EXISTS (SELECT 1 FROM commerce.stores WHERE id = p_template_id AND starter) THEN\n    PERFORM commerce.clone_starter_setup(p_template_id, v_store, p_owner_id);\n  END IF;\n\n  RETURN v_store;\nEND;');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: its last statement was not found, so a store template''s set-up is not copied'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- Approval copies the store template chosen on the request (D175), or the default template; otherwise as before.
CREATE OR REPLACE FUNCTION commerce.approve_access_request(p_request_id uuid, p_slug text, p_store_name text, p_decided_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_request commerce.access_requests%ROWTYPE;
  v_template uuid;
  v_account uuid;
  v_disabled timestamptz;
  v_store uuid;
BEGIN
  SELECT * INTO v_request FROM commerce.access_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown access request %', p_request_id;
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'the access request is already %', v_request.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- The published store template chosen, else the default template; anything else is refused (store_starters.not_offered).
  v_template := commerce.starter_source(v_request.starter_id);

  INSERT INTO commerce.accounts (email, name)
  VALUES (v_request.email, v_request.name)
  ON CONFLICT ((lower(email))) DO UPDATE
    SET name = coalesce(commerce.accounts.name, excluded.name)
  RETURNING id, disabled_at INTO v_account, v_disabled;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'the account for % is disabled', v_request.email
      USING ERRCODE = 'check_violation';
  END IF;

  v_store := commerce.clone_store(v_template, p_slug, p_store_name, v_account);

  UPDATE commerce.access_requests
     SET status = 'approved', decided_by = p_decided_by, decided_at = now(), store_id = v_store
   WHERE id = p_request_id;

  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (v_store, p_decided_by, 'platform.access_approved',
          jsonb_build_object('email', v_request.email, 'slug', p_slug, 'starter', v_request.starter_id));

  RETURN v_store;
END;
$$;
