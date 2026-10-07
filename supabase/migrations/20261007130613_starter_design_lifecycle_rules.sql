-- Store templates and design profiles: draft, publish, unpublish, archive, delete (D177, docs/store-templates.md, docs/design-profiles.md).
-- The columns are in the migration before this one. Here:
--
-- * a store template or a design profile is deleted only while unused, else archived: `store_starters_rules()` refuses a delete when a
--   store was made from the template or an access request names it (`store_starters.used`, `store_starters.requested`);
--   `design_presets_rules()` when a store applied the profile or an access request names it (`design_presets.used`,
--   `design_presets.requested`), and clears it as any store template's recommended profile (published and draft) so nothing points at it;
-- * a store template is published by freezing its working store: `commerce.freeze_starter()` copies it with `clone_store()` into a hidden
--   copy (`starter`, `starter_copy_of`), points `published_store_id` at it and closes the copy it replaces; `starter_source()` returns the
--   published copy (or, for a template published before D177 and not since, its working store, as before);
-- * a profile's workspace is a hidden starter store that describes no store template, fixed once set;
-- * `clone_starter_setup()` names the template a store came from also when it was copied from the template's frozen copy;
-- * approving an access request whose store template is no longer offered makes the store from the Standard store (the default template)
--   and says so in the audit entry, instead of refusing;
-- * existing published rows get their `published_at`.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE but the one each rule allows.

UPDATE commerce.store_starters SET published_at = updated_at WHERE published AND published_at IS NULL;
--> statement-breakpoint
UPDATE commerce.design_presets SET published_at = snapshot_at WHERE published AND published_at IS NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_starters_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.made_from_starter = OLD.id AND s.starter_copy_of IS NULL) THEN
      RAISE EXCEPTION 'store_starters.used: stores were made from this store template; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.access_requests r WHERE r.starter_id = OLD.id) THEN
      RAISE EXCEPTION 'store_starters.requested: an access request chose this store template; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.starter AND s.starter_copy_of IS NULL)
     OR EXISTS (SELECT 1 FROM commerce.design_presets d WHERE d.workspace_store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'store_starters.not_starter: only a store marked as a store template is described as one' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.published_store_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.published_store_id IS DISTINCT FROM OLD.published_store_id)
     AND NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.published_store_id AND s.starter AND s.starter_copy_of = NEW.id) THEN
    RAISE EXCEPTION 'store_starters.not_copy: a store template publishes only its own frozen copy' USING ERRCODE = 'check_violation';
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

CREATE OR REPLACE FUNCTION commerce.design_presets_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM commerce.design_preset_uses u WHERE u.preset_id = OLD.id) THEN
      RAISE EXCEPTION 'design_presets.used: a store applied this design profile; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.access_requests r WHERE r.design_preset_id = OLD.id) THEN
      RAISE EXCEPTION 'design_presets.requested: an access request chose this design profile; archive it instead' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE commerce.store_starters SET recommended_design = NULL WHERE recommended_design = OLD.id;
    UPDATE commerce.store_starters SET draft = jsonb_set(draft, '{recommendedDesign}', 'null'::jsonb)
     WHERE draft ->> 'recommendedDesign' = OLD.id::text;
    RETURN OLD;
  END IF;
  IF NEW.workspace_store_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.workspace_store_id IS DISTINCT FROM OLD.workspace_store_id) THEN
    IF TG_OP = 'UPDATE' AND OLD.workspace_store_id IS NOT NULL THEN
      RAISE EXCEPTION 'design_presets.workspace_fixed: a design profile keeps its workspace' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.workspace_store_id AND s.starter AND s.starter_copy_of IS NULL)
       OR EXISTS (SELECT 1 FROM commerce.store_starters st WHERE st.store_id = NEW.workspace_store_id) THEN
      RAISE EXCEPTION 'design_presets.not_workspace: a design profile''s workspace is a hidden store of its own' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_store_id IS NULL AND OLD.workspace_store_id IS NOT NULL THEN
      RAISE EXCEPTION 'design_presets.workspace_fixed: a design profile keeps its workspace' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE TRIGGER design_presets_rules
BEFORE INSERT OR UPDATE OR DELETE ON commerce.design_presets
FOR EACH ROW EXECUTE FUNCTION commerce.design_presets_rules();
--> statement-breakpoint

-- What a published, unarchived store template's new stores are copied from: its frozen copy, or (published before D177 and not since) its
-- working store. Null when it is not offered.
CREATE FUNCTION commerce.starter_offered_source(p_starter uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT s.id
    FROM commerce.store_starters st
    JOIN commerce.stores s ON s.id = COALESCE(st.published_store_id, st.store_id)
   WHERE st.id = p_starter AND st.published AND st.archived_at IS NULL AND s.starter AND s.status = 'active'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.starter_source(p_starter uuid)
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
  v_store := commerce.starter_offered_source(p_starter);
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'store_starters.not_offered: that store template is not offered' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_store;
END;
$$;
--> statement-breakpoint

-- As D175's, but the template a store came from is also found when the source is the template's frozen copy (D177).
CREATE OR REPLACE FUNCTION commerce.clone_starter_setup(p_source uuid, p_store uuid, p_owner uuid)
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
--> statement-breakpoint

-- Publishing a store template (D177) freezes its working store: a copy made by clone_store() (which brings the starter's set-up through
-- clone_starter_setup()), marked as the template's frozen copy and as no store made from it, becomes what new stores copy and owners preview.
-- The copy it replaces is closed, never deleted. The details and the published flag are written by the caller in the same transaction.
CREATE FUNCTION commerce.freeze_starter(p_starter uuid, p_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_starter commerce.store_starters%ROWTYPE;
  v_work commerce.stores%ROWTYPE;
  v_n integer;
  v_slug text;
  v_copy uuid;
BEGIN
  SELECT * INTO v_starter FROM commerce.store_starters WHERE id = p_starter FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown store template %', p_starter;
  END IF;
  IF v_starter.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'store_starters.archived: restore the store template before publishing it' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_work FROM commerce.stores WHERE id = v_starter.store_id;
  IF NOT v_work.starter OR v_work.status <> 'active' THEN
    RAISE EXCEPTION 'store_starters.not_open: the store template''s store is not open' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) + 1 INTO v_n FROM commerce.stores WHERE starter_copy_of = p_starter;
  LOOP
    v_slug := left(v_work.slug, 30) || '-v' || v_n;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM commerce.stores WHERE slug = v_slug);
    v_n := v_n + 1;
  END LOOP;

  v_copy := commerce.clone_store(v_starter.store_id, v_slug, v_work.name, p_by);
  UPDATE commerce.stores SET starter = true, starter_copy_of = p_starter, made_from_starter = NULL WHERE id = v_copy;
  UPDATE commerce.store_starters SET published_store_id = v_copy WHERE id = p_starter;
  IF v_starter.published_store_id IS NOT NULL THEN
    UPDATE commerce.stores
       SET status = 'closed', status_reason = 'A later publish of its store template replaced this copy.', status_changed_by = p_by
     WHERE id = v_starter.published_store_id AND status <> 'closed';
  END IF;
  RETURN v_copy;
END;
$$;
--> statement-breakpoint

-- Approval copies the store template chosen on the request (D175) while it is offered; one unpublished or archived since (D177) gives way
-- to the Standard store (the default template), and the audit entry says so.
CREATE OR REPLACE FUNCTION commerce.approve_access_request(p_request_id uuid, p_slug text, p_store_name text, p_decided_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_request commerce.access_requests%ROWTYPE;
  v_template uuid;
  v_fallback boolean := false;
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

  -- The store template chosen while it is offered, else the default template.
  v_template := commerce.starter_offered_source(v_request.starter_id);
  IF v_template IS NULL THEN
    v_fallback := v_request.starter_id IS NOT NULL;
    v_template := commerce.starter_source(NULL);
  END IF;

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
          jsonb_build_object('email', v_request.email, 'slug', p_slug, 'starter', v_request.starter_id, 'starterFallback', v_fallback));

  RETURN v_store;
END;
$$;
