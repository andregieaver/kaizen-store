-- A workspace's admin (D748 step E7 part three, docs/extensions.md 7): a workspace starts with the store feature Deals needs (sales) and
-- Work switched on, never with the online shop, so its admin offers no shop page and its extensions work as soon as the account has them
-- (dealsOn() asks for both the feature and the extension; Work for both the module and the extension). Nothing else changes: still made
-- only here, one per account, in its owner's account. Workspaces made before this are given the same.
CREATE OR REPLACE FUNCTION commerce.make_workspace(p_account uuid, p_name text, p_country text, p_currency text, p_locale text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_organisation uuid := commerce.account_organisation(p_account, p_name);
  v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM commerce.stores s WHERE s.organisation_id = v_organisation AND s.workspace;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_country IS NULL OR p_country !~ '^[A-Z]{2}$' OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' OR coalesce(btrim(p_locale), '') = '' THEN
    RAISE EXCEPTION 'workspaces.market: a workspace needs a country, a currency and a language' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('commerce.workspace_change', 'make', true);
  INSERT INTO commerce.stores (slug, name, workspace, private_mode, country, locales, created_by, features, modules)
  VALUES ('ws-' || substr(md5(gen_random_uuid()::text), 1, 12), coalesce(nullif(btrim(p_name), ''), 'Workspace'), true, true, p_country,
          ARRAY[p_locale], p_account, ARRAY['sales'], ARRAY['work'])
  RETURNING id INTO v_id;
  PERFORM set_config('commerce.workspace_change', '', true);
  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  VALUES (v_id, p_country, p_currency, p_locale, ARRAY[p_locale], true);
  INSERT INTO commerce.store_members (store_id, account_id, role) VALUES (v_id, p_account, 'owner');
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.make_workspace(uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
UPDATE commerce.stores SET features = ARRAY['sales'], modules = ARRAY['work'] WHERE workspace AND NOT ('sales' = ANY (features) AND 'work' = ANY (modules));
