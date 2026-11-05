-- *Keep this store* (D457 step S2, docs/builder-sandbox.md 4.7): approving a request made from a sandbox takes that store over.
--
-- `commerce.adopt_sandbox(request, slug, name, decided_by)` does in one statement what `approve_access_request()` does for a copy: the
-- request must be pending and name a sandbox that is still open; the account is made or found for its address (a disabled one refused),
-- the store leaves the sandbox at its new address and name, the new account takes the sandbox account's place as its owner, the sandbox is
-- kept, the request approved with its store, and the approval written to the audit log as an approval is. The store stays private until
-- its owner opens it (D339), as every new store does. Only this function stops a store being a sandbox (`stores_sandbox_rules()`).
--
-- Whole functions are replaced (CREATE OR REPLACE); none is patched in place. No DELETE anywhere.

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
