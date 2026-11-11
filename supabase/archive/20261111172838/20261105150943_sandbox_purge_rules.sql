-- The page builder's sandbox, step S3 (D457, docs/builder-sandbox.md 4.5 and 4.8): its allowances, and the purge.
--
-- * `make_sandbox()` gives each new sandbox its allowances as limit overrides, from the platform's settings: what its AI may cost on
--   Kaizena Flow's key (`ai_cost_month_micros`) and what it may keep of uploads (`storage_bytes`). `adopt_sandbox()` removes them when the
--   sandbox becomes someone's store, which then has its plan's limits like any other.
-- * `purge_sandbox()` deletes everything of an expired sandbox's store: every row of every table in `commerce` with a `store_id`, read
--   from the catalogue so a table added later is covered too, and its audit entries (an anonymous try holds nobody to account, and
--   keeping a page's title would keep what the visitor typed); only its `sandboxes` row (the record that it existed, and its times) and
--   its AI usage (the platform's cost, counts and no words) stay. Its `stores` row stays as a bare tombstone, its CSS and look blanked,
--   because the `sandboxes` row points at it. Its library's files are removed by the server before it is called.
-- * The guards that keep rows for ever (prices, inventory movements, the audit log, the last owner, the live theme, a preset's use) let
--   the purge through for that one store only: `commerce.sandbox_purging()` is true while `purge_sandbox()` names the store in
--   `commerce.sandbox_purge` and the store is a closed sandbox whose row is expired. Each guard's trigger is made again with that
--   condition; the guard functions themselves are unchanged.
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place.

CREATE OR REPLACE FUNCTION commerce.sandbox_purging(p_store uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_store IS NULL OR COALESCE(current_setting('commerce.sandbox_purge', true), '') <> p_store::text THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM commerce.sandboxes x JOIN commerce.stores s ON s.id = x.store_id
     WHERE x.store_id = p_store AND x.state = 'expired' AND s.sandbox AND s.status = 'closed'
  );
END;
$$;
--> statement-breakpoint

DROP TRIGGER audit_log_guard ON commerce.audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON commerce.audit_log
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.guard_audit_log();
--> statement-breakpoint

DROP TRIGGER prices_guard_history ON commerce.prices;
--> statement-breakpoint
CREATE TRIGGER prices_guard_history
  BEFORE UPDATE OR DELETE ON commerce.prices
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.guard_price_history();
--> statement-breakpoint

DROP TRIGGER inventory_movements_guard ON commerce.inventory_movements;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_guard
  BEFORE UPDATE OR DELETE ON commerce.inventory_movements
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.guard_inventory_movements();
--> statement-breakpoint

DROP TRIGGER store_members_keep_an_owner ON commerce.store_members;
--> statement-breakpoint
CREATE TRIGGER store_members_keep_an_owner
  BEFORE UPDATE OR DELETE ON commerce.store_members
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.keep_an_owner();
--> statement-breakpoint

DROP TRIGGER store_theme_installs_rules ON commerce.store_theme_installs;
--> statement-breakpoint
CREATE TRIGGER store_theme_installs_rules
  BEFORE UPDATE OR DELETE ON commerce.store_theme_installs
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.store_theme_installs_rules();
--> statement-breakpoint

DROP TRIGGER design_preset_uses_rules ON commerce.design_preset_uses;
--> statement-breakpoint
CREATE TRIGGER design_preset_uses_rules
  BEFORE UPDATE OR DELETE ON commerce.design_preset_uses
  FOR EACH ROW WHEN (NOT commerce.sandbox_purging(OLD.store_id)) EXECUTE FUNCTION commerce.design_preset_uses_rules();
--> statement-breakpoint

-- Makes a sandbox: a copy of the source `starter_source()` decides (`p_starter` null: the Standard store) at `p_slug`, owned by the sandbox
-- account, marked a sandbox and private, with its allowances (the platform's settings, as limit overrides), and its row with the pass's
-- hash and its time. Returns the sandbox's id.
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
  INSERT INTO commerce.limit_overrides (store_id, key, value, reason)
  SELECT v_store, k.key, k.value, 'Sandbox allowance (D457)'
    FROM commerce.platform_settings p
   CROSS JOIN LATERAL (VALUES ('ai_cost_month_micros', p.sandbox_ai_micros), ('storage_bytes', p.sandbox_storage_bytes)) AS k(key, value);
  INSERT INTO commerce.sandboxes (store_id, source_store_id, pass_hash, expires_at)
  VALUES (v_store, v_source, p_pass_hash, now() + make_interval(days => p_days))
  RETURNING id INTO v_sandbox;
  RETURN v_sandbox;
END;
$$;
--> statement-breakpoint

-- Approving a request made from a sandbox takes that store over (step S2), and now leaves the sandbox's allowances behind: the store has
-- its plan's limits from then on. Otherwise as before.
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

-- Deletes everything of an expired sandbox's store (see the head of this file) and marks the sandbox purged. Refuses any other store, and a
-- sandbox that is open, kept or already purged. A table whose rows another still points at is tried again after the others, until a
-- round deletes nothing; a row that cannot go at all stops the purge with the tables left named, and nothing is deleted.
-- Returns the number of rows deleted.
CREATE OR REPLACE FUNCTION commerce.purge_sandbox(p_sandbox uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
  v_table text;
  v_left text[];
  v_count integer;
  v_round_count integer;
  v_total integer := 0;
  v_round integer := 0;
BEGIN
  SELECT x.store_id INTO v_store
    FROM commerce.sandboxes x JOIN commerce.stores s ON s.id = x.store_id
   WHERE x.id = p_sandbox AND x.state = 'expired' AND s.sandbox AND s.status = 'closed'
     FOR UPDATE OF x;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'sandboxes.not_expired: only an expired sandbox is purged' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('commerce.sandbox_purge', v_store::text, true);
  LOOP
    v_round := v_round + 1;
    v_round_count := 0;
    v_left := '{}';
    FOR v_table IN
      SELECT c.relname::text
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'commerce'
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'store_id' AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname NOT IN ('sandboxes', 'ai_usage')
       ORDER BY c.relname
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM commerce.%I WHERE store_id = $1', v_table) USING v_store;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_round_count := v_round_count + v_count;
      EXCEPTION WHEN foreign_key_violation THEN
        v_left := v_left || v_table;
      END;
    END LOOP;
    v_total := v_total + v_round_count;
    EXIT WHEN cardinality(v_left) = 0 AND v_round_count = 0;
    IF v_round_count = 0 OR v_round >= 20 THEN
      RAISE EXCEPTION 'sandboxes.purge_stuck: rows of % are still pointed at', array_to_string(v_left, ', ') USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;
  UPDATE commerce.stores
     SET custom_css = '', theme = '{}'::jsonb, front_page_id = NULL, products_page_id = NULL, header_menu_id = NULL, footer_menu_id = NULL
   WHERE id = v_store;
  PERFORM set_config('commerce.sandbox_purge', '', true);
  UPDATE commerce.sandboxes SET state = 'purged', purged_at = now() WHERE id = p_sandbox;
  RETURN v_total;
END;
$$;
--> statement-breakpoint

-- `sandbox_purging()` stays callable by every role: it only reads, and the six guards' triggers call it in their WHEN for whoever changes
-- those tables. The purge itself is the server's alone.
REVOKE ALL ON FUNCTION commerce.purge_sandbox(uuid) FROM PUBLIC;
--> statement-breakpoint

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('sandboxes', NULL, 7, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-11-05', '2000-01-01', 'runRetention: sandboxes',
   'The page builder''s sandbox (D457): a sandbox nobody has visited for this long is ended and everything in it deleted (its pages, words, pictures, styles and the record of what was done in it); only the bare record that it existed, its times and its AI''s cost stay. One ended sooner (Start over, its 30 days) goes at once. SANDBOX_DAYS, a test holds them equal.');
