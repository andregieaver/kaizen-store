-- The page builder's sandbox (D456, docs/builder-sandbox.md, step S1): the rules the database holds.
--
-- * One platform account owns every sandbox store: *Kaizena Flow sandbox*, at an address no mail reaches (`.invalid`), disabled so it can
--   never sign in (`signInAccount()` admits no disabled account). `commerce.sandbox_account()` names it.
-- * A sandbox store is never open for jobs or orders: `commerce.store_is_active()` is false for it (so every job that skips a store that is
--   not open skips it), and `commerce.orders_store_open()` refuses any order in it, a copied one too, with its own reason.
-- * Only `commerce.make_sandbox()` marks a store a sandbox, and nothing unmarks one in this step (`stores_sandbox_rules()`); while it is
--   one it stays private, serves no shopping agents, buys no domain and keeps its address.
-- * Its only member is the sandbox account (`store_members_sandbox()`); it takes no domain and no payment provider (`sandbox_doors()`).
-- * A row of `commerce.sandboxes` describes a sandbox store only, never changes store or pass, moves only open → expired or kept,
--   expired → purged, and is never deleted (`sandboxes_rules()`).
-- * `commerce.make_sandbox()` copies the source `commerce.starter_source()` decides, and `commerce.expire_sandbox()` ends one: its row
--   expired and its store closed.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE anywhere.

INSERT INTO commerce.accounts (email, name, disabled_at)
SELECT 'sandbox@kaizenaflow.invalid', 'Kaizena Flow sandbox', now()
 WHERE NOT EXISTS (SELECT 1 FROM commerce.accounts WHERE lower(email) = 'sandbox@kaizenaflow.invalid');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.sandbox_account()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT id FROM commerce.accounts WHERE lower(email) = 'sandbox@kaizenaflow.invalid'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_is_active(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.status = 'active' AND NOT s.starter AND NOT s.sandbox FROM commerce.stores s WHERE s.id = p_store), false)
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
  -- A sandbox (D456) takes no order of any kind either: it is a visitor's try of the builder.
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.sandbox) THEN
    RAISE EXCEPTION 'orders.store_sandbox: a sandbox takes no orders' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT commerce.store_is_active(NEW.store_id) THEN
    RAISE EXCEPTION 'orders.store_not_open: the store is not open for sale' USING ERRCODE = 'check_violation';
  END IF;
  -- A website (D178 step 5: the online shop off) sells nothing.
  IF NOT commerce.feature_on(NEW.store_id, 'shop') THEN
    RAISE EXCEPTION 'orders.shop_off: the store''s online shop is switched off' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.stores_sandbox_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_allowed boolean := COALESCE(current_setting('commerce.sandbox_change', true), '') = NEW.id::text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.sandbox THEN
    RAISE EXCEPTION 'stores.sandbox_fixed: only make_sandbox() makes a sandbox' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.sandbox IS DISTINCT FROM OLD.sandbox AND NOT v_allowed THEN
    RAISE EXCEPTION 'stores.sandbox_fixed: a store becomes or stops being a sandbox only through its own functions' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sandbox THEN
    IF NOT NEW.private_mode THEN
      RAISE EXCEPTION 'stores.sandbox_private: a sandbox stays private' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.shopping_agents OR NEW.domain_buying THEN
      RAISE EXCEPTION 'stores.sandbox_closed_doors: a sandbox serves no shopping agents and buys no domain' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug AND NOT v_allowed THEN
      RAISE EXCEPTION 'stores.sandbox_address: a sandbox keeps its address' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER stores_sandbox_rules
BEFORE INSERT OR UPDATE OF sandbox, private_mode, shopping_agents, domain_buying, slug ON commerce.stores
FOR EACH ROW EXECUTE FUNCTION commerce.stores_sandbox_rules();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.store_members_sandbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.sandbox)
     AND NEW.account_id IS DISTINCT FROM commerce.sandbox_account() THEN
    RAISE EXCEPTION 'store_members.sandbox: a sandbox has no member but the sandbox account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_members_sandbox
BEFORE INSERT OR UPDATE OF store_id, account_id ON commerce.store_members
FOR EACH ROW EXECUTE FUNCTION commerce.store_members_sandbox();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.sandbox_doors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.sandbox) THEN
    RAISE EXCEPTION '%.sandbox: a sandbox has no domain and takes no payment', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_domains_sandbox
BEFORE INSERT OR UPDATE OF store_id ON commerce.store_domains
FOR EACH ROW EXECUTE FUNCTION commerce.sandbox_doors();
--> statement-breakpoint

CREATE TRIGGER payment_providers_sandbox
BEFORE INSERT OR UPDATE OF store_id ON commerce.payment_providers
FOR EACH ROW EXECUTE FUNCTION commerce.sandbox_doors();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.sandboxes_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sandboxes.no_delete: a sandbox''s row is kept' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.sandbox) THEN
      RAISE EXCEPTION 'sandboxes.not_sandbox: the store is not a sandbox' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state <> 'open' THEN
      RAISE EXCEPTION 'sandboxes.state_step: a sandbox starts open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.source_store_id IS DISTINCT FROM OLD.source_store_id
     OR NEW.pass_hash IS DISTINCT FROM OLD.pass_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.first_change_at IS NOT NULL AND NEW.first_change_at IS DISTINCT FROM OLD.first_change_at)
     OR (OLD.first_publish_at IS NOT NULL AND NEW.first_publish_at IS DISTINCT FROM OLD.first_publish_at) THEN
    RAISE EXCEPTION 'sandboxes.fixed: a sandbox keeps its store, source, pass and first times' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state = 'open' AND NEW.state IN ('expired', 'kept'))
    OR (OLD.state = 'expired' AND NEW.state = 'purged')
  ) THEN
    RAISE EXCEPTION 'sandboxes.state_step: a sandbox cannot go from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sandboxes_rules
BEFORE INSERT OR UPDATE OR DELETE ON commerce.sandboxes
FOR EACH ROW EXECUTE FUNCTION commerce.sandboxes_rules();
--> statement-breakpoint

-- Makes a sandbox: a copy of the source `starter_source()` decides (`p_starter` null: the Standard store) at `p_slug`, owned by the sandbox
-- account, marked a sandbox and private, and its row with the pass's hash and its time. Returns the sandbox's id.
CREATE OR REPLACE FUNCTION commerce.make_sandbox(p_starter uuid, p_slug text, p_pass_hash text, p_days integer)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := commerce.sandbox_account();
  v_source uuid;
  v_store uuid;
  v_sandbox uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'sandboxes.no_account: the sandbox account is missing' USING ERRCODE = 'check_violation';
  END IF;
  IF p_slug !~ '^try-[a-z0-9]{8}$' THEN
    RAISE EXCEPTION 'sandboxes.address: a sandbox''s address is try- and eight letters or digits' USING ERRCODE = 'check_violation';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'sandboxes.time: a sandbox lasts 1 to 30 days' USING ERRCODE = 'check_violation';
  END IF;
  v_source := commerce.starter_source(p_starter);
  v_store := commerce.clone_store(v_source, p_slug, (SELECT s.name FROM commerce.stores s WHERE s.id = v_source), v_owner);
  PERFORM set_config('commerce.sandbox_change', v_store::text, true);
  UPDATE commerce.stores
     SET sandbox = true, private_mode = true, shopping_agents = false, domain_buying = false, setup_completed_at = NULL
   WHERE id = v_store;
  PERFORM set_config('commerce.sandbox_change', '', true);
  INSERT INTO commerce.sandboxes (store_id, source_store_id, pass_hash, expires_at)
  VALUES (v_store, v_source, p_pass_hash, now() + make_interval(days => p_days))
  RETURNING id INTO v_sandbox;
  RETURN v_sandbox;
END;
$$;
--> statement-breakpoint

-- Ends an open sandbox: its row expired (its pass stops working) and its store closed with the reason. False when it was not open.
CREATE OR REPLACE FUNCTION commerce.expire_sandbox(p_sandbox uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
BEGIN
  UPDATE commerce.sandboxes SET state = 'expired', ended_at = now()
   WHERE id = p_sandbox AND state = 'open'
  RETURNING store_id INTO v_store;
  IF v_store IS NULL THEN
    RETURN false;
  END IF;
  UPDATE commerce.stores SET status = 'closed', status_reason = 'Sandbox ended'
   WHERE id = v_store AND status <> 'closed';
  RETURN true;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commerce.make_sandbox(uuid, text, text, integer), commerce.expire_sandbox(uuid) FROM PUBLIC;
