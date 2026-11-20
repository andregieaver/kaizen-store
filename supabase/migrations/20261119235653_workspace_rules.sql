-- A standalone account's workspace (D748 step E7 part one, docs/extensions.md 7): the store row that holds the data of an account that buys
-- extensions without a store, so every extension's table, guard and owned() filter keeps working. No website and no shop (the code never
-- lists it as a store nor serves it as a storefront, and leaves it out of stores_owned); its jobs run and its emails send as any store's.
-- Made only here, one per account (stores_one_workspace_idx), in its owner's account (commerce.place_store() at commit), with one market for
-- the currency its invoices and deals are in; never marked or unmarked after (stores_workspace_fixed).
CREATE FUNCTION commerce.make_workspace(p_account uuid, p_name text, p_country text, p_currency text, p_locale text) RETURNS uuid
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
  INSERT INTO commerce.stores (slug, name, workspace, private_mode, country, locales, created_by)
  VALUES ('ws-' || substr(md5(gen_random_uuid()::text), 1, 12), coalesce(nullif(btrim(p_name), ''), 'Workspace'), true, true, p_country,
          ARRAY[p_locale], p_account)
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
CREATE FUNCTION commerce.stores_workspace_fixed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workspace AND coalesce(current_setting('commerce.workspace_change', true), '') <> 'make' THEN
      RAISE EXCEPTION 'stores.workspace: a workspace is made only by commerce.make_workspace()' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.workspace IS DISTINCT FROM OLD.workspace THEN
    RAISE EXCEPTION 'stores.workspace: a store never becomes or stops being a workspace' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.stores_workspace_fixed() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER stores_workspace_fixed BEFORE INSERT OR UPDATE OF workspace ON commerce.stores
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_workspace_fixed();
