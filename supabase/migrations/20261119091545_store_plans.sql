-- Paid extensions, step E4 part one (D748, docs/extensions.md 13): accounts billed through their account. An account with a row in
-- commerce.organisation_billing has one plan for all its stores; one without is billed store by store (commerce.store_billing), as every
-- account is until the move at launch. Nothing changes while no account has a row.

-- A price always belongs to the plan it is billed under (as on store_billing).
ALTER TABLE commerce.organisation_billing
  ADD CONSTRAINT organisation_billing_price_plan_fk FOREIGN KEY (price_id, plan_id) REFERENCES commerce.plan_prices(id, plan_id);
--> statement-breakpoint
ALTER TABLE commerce.organisation_billing ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Kaizena Flow's own account is never billed (as its own store never is: store_billing_house).
CREATE FUNCTION commerce.organisation_billing_platform() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.organisations o WHERE o.id = NEW.organisation_id AND o.platform) THEN
    RAISE EXCEPTION 'organisation_billing.platform: Kaizena Flow''s own account is never billed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.organisation_billing_platform() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER organisation_billing_platform BEFORE INSERT OR UPDATE OF organisation_id ON commerce.organisation_billing
  FOR EACH ROW EXECUTE FUNCTION commerce.organisation_billing_platform();
--> statement-breakpoint

-- What counts for each store: its account's plan, price, subscription and trial when the account is billed through its account
-- (by_account), else its own. Kaizena Flow's fee: the store's own override wins, then the account's. trial_paused_at stays the store's
-- (which store the trial's end made private). Every reader of a store's plan reads this, never one of the two tables alone.
CREATE VIEW commerce.store_plans WITH (security_invoker = true) AS
SELECT s.id AS store_id,
       s.organisation_id,
       (o.organisation_id IS NOT NULL) AS by_account,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.plan_id ELSE b.plan_id END AS plan_id,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.price_id ELSE b.price_id END AS price_id,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.mode ELSE b.mode END AS mode,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.subscription_id ELSE b.subscription_id END AS subscription_id,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.status ELSE b.status END AS status,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.current_period_end ELSE b.current_period_end END AS current_period_end,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.cancel_at_period_end ELSE coalesce(b.cancel_at_period_end, false) END AS cancel_at_period_end,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.platform_discount_id ELSE b.platform_discount_id END AS platform_discount_id,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.discount_applied_at ELSE b.discount_applied_at END AS discount_applied_at,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.trial_ends_at ELSE b.trial_ends_at END AS trial_ends_at,
       coalesce(b.sale_fee_bps_override, o.sale_fee_bps_override) AS sale_fee_bps_override,
       b.trial_paused_at,
       CASE WHEN o.organisation_id IS NOT NULL THEN o.updated_at ELSE b.updated_at END AS updated_at
  FROM commerce.stores s
  LEFT JOIN commerce.organisation_billing o ON o.organisation_id = s.organisation_id
  LEFT JOIN commerce.store_billing b ON b.store_id = s.id;
--> statement-breakpoint
REVOKE ALL ON commerce.store_plans FROM PUBLIC;
--> statement-breakpoint

-- An account's facts (step E3): what its plan includes is now its own plan's grants when it is billed through its account (a workspace
-- with no store has a plan too), else those of its stores' plans.
CREATE OR REPLACE FUNCTION commerce.organisation_extension_facts(p_organisation uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'platform', coalesce((SELECT o.platform FROM commerce.organisations o WHERE o.id = p_organisation), false),
    'launchedAt', (SELECT ps.extensions_launched_at FROM commerce.platform_settings ps),
    'included', coalesce((
      SELECT jsonb_agg(DISTINCT x.extension_id) FROM (
        SELECT g.extension_id
          FROM commerce.organisation_billing ob
          JOIN commerce.plan_extension_grants g ON g.plan_id = ob.plan_id
         WHERE ob.organisation_id = p_organisation AND ob.status IN ('trialing', 'active', 'past_due')
        UNION ALL
        SELECT g.extension_id
          FROM commerce.stores s
          JOIN commerce.store_billing b ON b.store_id = s.id
          JOIN commerce.plan_extension_grants g ON g.plan_id = b.plan_id
         WHERE s.organisation_id = p_organisation AND b.status IN ('trialing', 'active', 'past_due')
           AND NOT EXISTS (SELECT 1 FROM commerce.organisation_billing ob WHERE ob.organisation_id = p_organisation)
      ) x
    ), '[]'::jsonb),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'extensionId', e.extension_id, 'source', e.source,
               'trialEndsAt', e.trial_ends_at, 'endedAt', e.ended_at, 'graceEndsAt', e.grace_ends_at))
        FROM commerce.organisation_extensions e
       WHERE e.organisation_id = p_organisation
    ), '[]'::jsonb)
  );
$$;
--> statement-breakpoint

-- commerce.extension_on() as before, with the plan read the same way.
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
  -- The account's plan includes it (billed through its account), or else the plan of one of its stores.
  IF EXISTS (SELECT 1 FROM commerce.organisation_billing ob WHERE ob.organisation_id = v_organisation) THEN
    IF EXISTS (
      SELECT 1 FROM commerce.organisation_billing ob
        JOIN commerce.plan_extension_grants g ON g.plan_id = ob.plan_id AND g.extension_id = p_extension
       WHERE ob.organisation_id = v_organisation AND ob.status IN ('trialing', 'active', 'past_due')
    ) THEN
      RETURN true;
    END IF;
  ELSIF EXISTS (
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
