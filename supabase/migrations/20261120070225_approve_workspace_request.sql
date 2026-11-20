-- A sign-up without a store (D748 step E7 part two, docs/extensions.md 7): approved into a workspace instead of a store. The account is made
-- (or found) as commerce.approve_access_request() makes it, refused when disabled; its workspace is made in the request's country, with that
-- country's currency and first language (commerce.make_workspace()); the request is approved with the workspace as its store. The trials of
-- the extensions it ticked are started by the code after, as an owner starts them (startExtensionTrial()).
CREATE FUNCTION commerce.approve_workspace_request(p_request_id uuid, p_decided_by uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_request commerce.access_requests%ROWTYPE;
  v_country commerce.countries%ROWTYPE;
  v_account uuid;
  v_disabled timestamptz;
  v_store uuid;
BEGIN
  SELECT * INTO v_request FROM commerce.access_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown access request %', p_request_id;
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'the access request is already %', v_request.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_request.wants_store THEN
    RAISE EXCEPTION 'access_requests.store: a request for a store is approved with its store' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_country FROM commerce.countries WHERE code = v_request.country;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_requests.country: % is not a country Kaizena Flow sells in', v_request.country USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO commerce.accounts (email, name)
  VALUES (v_request.email, v_request.name)
  ON CONFLICT ((lower(email))) DO UPDATE
    SET name = coalesce(commerce.accounts.name, excluded.name)
  RETURNING id, disabled_at INTO v_account, v_disabled;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'the account for % is disabled', v_request.email USING ERRCODE = 'check_violation';
  END IF;

  v_store := commerce.make_workspace(v_account, v_request.store_name, v_country.code, v_country.currency, v_country.default_locale);

  UPDATE commerce.access_requests
     SET status = 'approved', decided_by = p_decided_by, decided_at = now(), store_id = v_store
   WHERE id = p_request_id;

  INSERT INTO commerce.audit_log (store_id, account_id, action, details)
  VALUES (v_store, p_decided_by, 'platform.access_approved',
          jsonb_build_object('email', v_request.email, 'workspace', true, 'extensions', to_jsonb(v_request.extensions)));
  RETURN v_store;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.approve_workspace_request(uuid, uuid) FROM PUBLIC;
