-- Paid extensions, step E3 (D748): commerce.extension_on() answers as before (src/db/extension-gates.test.ts holds it to extensionOn()), but
-- stops at the first answer instead of gathering the account's whole facts. The query budget (D746) caught that each call read the billing of
-- every store of the account: twenty stores' jobs read over a thousand rows more. Now, until extensions are sold, a call reads one row.
CREATE OR REPLACE FUNCTION commerce.extension_on(p_store uuid, p_extension text) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_launched timestamptz;
  v_organisation uuid;
BEGIN
  SELECT ps.extensions_launched_at INTO v_launched FROM commerce.platform_settings ps;
  -- Until extensions are sold, every account has every extension.
  IF v_launched IS NULL OR v_launched > now() THEN
    RETURN true;
  END IF;
  SELECT s.organisation_id INTO v_organisation FROM commerce.stores s WHERE s.id = p_store;
  -- A store nobody owns yet has none.
  IF v_organisation IS NULL THEN
    RETURN false;
  END IF;
  -- Kaizena Flow's own account has every one.
  IF EXISTS (SELECT 1 FROM commerce.organisations o WHERE o.id = v_organisation AND o.platform) THEN
    RETURN true;
  END IF;
  -- The plan of one of the account's stores includes it.
  IF EXISTS (
    SELECT 1
      FROM commerce.stores s
      JOIN commerce.store_billing b ON b.store_id = s.id AND b.status IN ('trialing', 'active', 'past_due')
      JOIN commerce.plan_extension_grants g ON g.plan_id = b.plan_id AND g.extension_id = p_extension
     WHERE s.organisation_id = v_organisation
  ) THEN
    RETURN true;
  END IF;
  -- Its own row: a trial that has not ended or is in its grace period, or a purchase still paid for or in its grace period.
  RETURN EXISTS (
    SELECT 1 FROM commerce.organisation_extensions e
     WHERE e.organisation_id = v_organisation AND e.extension_id = p_extension
       AND ((e.source = 'trial' AND (now() < e.trial_ends_at OR now() < e.grace_ends_at))
         OR (e.source <> 'trial' AND (e.ended_at IS NULL OR now() < e.ended_at OR now() < e.grace_ends_at)))
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.extension_on(p_store uuid, p_extension text) FROM PUBLIC;
