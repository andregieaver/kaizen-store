-- The page builder's sandbox, step S4 (D457, docs/builder-sandbox.md 4.9 and 8.4): premium themes (D286) and sandboxes.
--
-- A sandbox shows a premium theme and never switches to one (*Try another look*), and *Try it with this theme* starts from free themes only;
-- the database holds the same line underneath:
--
-- * `theme_installs_charge()` makes no purchase for a sandbox's store, as for a store template: a sandbox owes nothing, so its purge never
--   meets a purchase it may not delete.
-- * `adopt_sandbox()`, when a sandbox becomes someone's store, makes the purchase its live theme would have made on a store that has not
--   opened: `owed` at the theme's price, due when the store opens. A premium theme cannot reach a kept store for nothing, however it went live.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place.

CREATE OR REPLACE FUNCTION commerce.theme_installs_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store record;
  v_price record;
  v_charge text := nullif(current_setting('kaizen.theme_charge', true), '');
  v_actor uuid := nullif(current_setting('kaizen.theme_actor', true), '')::uuid;
BEGIN
  IF NOT NEW.live OR (TG_OP = 'UPDATE' AND OLD.live) THEN
    RETURN NULL;
  END IF;
  -- Before the store opens only the theme live when it opens is owed.
  UPDATE commerce.theme_purchases p SET status = 'cancelled', ended_at = now(), updated_at = now()
   WHERE p.store_id = NEW.store_id AND p.status = 'owed' AND p.preset_id IS DISTINCT FROM NEW.preset_id;
  IF NEW.preset_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.status, s.starter, s.is_template, s.sandbox, s.setup_completed_at INTO v_store FROM commerce.stores s WHERE s.id = NEW.store_id;
  -- A sandbox (D457) owes nothing: it is a try, purged when it ends; keeping it owes its live theme then (`adopt_sandbox()`).
  IF v_store.starter OR v_store.is_template OR v_store.sandbox OR v_store.status <> 'active' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM commerce.theme_purchases p
     WHERE p.store_id = NEW.store_id AND p.preset_id = NEW.preset_id AND p.status IN ('owed', 'due', 'invoiced', 'paid', 'granted')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_price FROM commerce.theme_price_for(NEW.store_id, NEW.preset_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_charge = 'grant' THEN
    INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
    VALUES (NEW.store_id, NEW.preset_id, 'granted', v_price.currency, 0, coalesce(v_actor, NEW.installed_by));
    RETURN NULL;
  END IF;
  IF v_store.setup_completed_at IS NULL THEN
    INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
    VALUES (NEW.store_id, NEW.preset_id, 'owed', v_price.currency, v_price.amount_minor, coalesce(v_actor, NEW.installed_by));
    RETURN NULL;
  END IF;
  IF v_charge IS DISTINCT FROM v_price.currency || ':' || v_price.amount_minor THEN
    RAISE EXCEPTION 'theme_purchases.confirm: this theme costs % % and the price was not agreed to', v_price.currency, v_price.amount_minor
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by, due_at)
  VALUES (NEW.store_id, NEW.preset_id, 'due', v_price.currency, v_price.amount_minor, coalesce(v_actor, NEW.installed_by), now());
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.adopt_sandbox(p_request_id uuid, p_slug text, p_store_name text, p_decided_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_request commerce.access_requests%ROWTYPE;
  v_sandbox commerce.sandboxes%ROWTYPE;
  v_account uuid;
  v_disabled timestamptz;
BEGIN
  SELECT * INTO v_request FROM commerce.access_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown access request %', p_request_id;
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'the access request is already %', v_request.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_request.sandbox_id IS NULL THEN
    RAISE EXCEPTION 'sandboxes.not_named: the request names no sandbox' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_sandbox FROM commerce.sandboxes WHERE id = v_request.sandbox_id FOR UPDATE;
  IF v_sandbox.state <> 'open' OR v_sandbox.expires_at <= now() THEN
    RAISE EXCEPTION 'sandboxes.not_open: the sandbox has ended' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO commerce.accounts (email, name)
  VALUES (v_request.email, v_request.name)
  ON CONFLICT ((lower(email))) DO UPDATE
    SET name = coalesce(commerce.accounts.name, excluded.name)
  RETURNING id, disabled_at INTO v_account, v_disabled;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'the account for % is disabled', v_request.email USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('commerce.sandbox_change', v_sandbox.store_id::text, true);
  UPDATE commerce.stores
     SET sandbox = false, slug = p_slug, name = p_store_name, created_by = v_account
   WHERE id = v_sandbox.store_id AND sandbox;
  PERFORM set_config('commerce.sandbox_change', '', true);

  UPDATE commerce.store_members
     SET account_id = v_account
   WHERE store_id = v_sandbox.store_id AND account_id = commerce.sandbox_account();

  DELETE FROM commerce.limit_overrides
   WHERE store_id = v_sandbox.store_id AND reason = 'Sandbox allowance (D457)';

  -- A priced theme live in it is owed, as on any store that has not opened (D286): a sandbox itself never owes one
  -- (`theme_installs_charge()`), so keeping it cannot give a premium theme away.
  INSERT INTO commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
  SELECT i.store_id, i.preset_id, 'owed', pr.currency, pr.amount_minor, v_account
    FROM commerce.store_theme_installs i
   CROSS JOIN LATERAL commerce.theme_price_for(i.store_id, i.preset_id) pr
   WHERE i.store_id = v_sandbox.store_id AND i.live AND i.preset_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM commerce.theme_purchases p
        WHERE p.store_id = i.store_id AND p.preset_id = i.preset_id AND p.status IN ('owed', 'due', 'invoiced', 'paid', 'granted')
     );

  UPDATE commerce.sandboxes SET state = 'kept', ended_at = now() WHERE id = v_sandbox.id;

  UPDATE commerce.access_requests
     SET status = 'approved', decided_by = p_decided_by, decided_at = now(), store_id = v_sandbox.store_id
   WHERE id = p_request_id;

  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (v_sandbox.store_id, p_decided_by, 'platform.access_approved',
          jsonb_build_object('email', v_request.email, 'slug', p_slug, 'sandbox', v_sandbox.id));

  RETURN v_sandbox.store_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commerce.adopt_sandbox(uuid, text, text, uuid) FROM PUBLIC;
