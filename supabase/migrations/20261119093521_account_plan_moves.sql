-- Paid extensions, step E4 part two (D748, docs/extensions.md 13): an account's plan moves and plan events, as a store's. A change of an
-- account's plan (commerce.organisation_billing) is kept in commerce.plan_moves and sent as the platform's plan events like a store's,
-- under the account's first store: the store whose Stripe account the subscription bills, so Kaizena Flow's sales name the same store. The
-- store's own triggers now call the same two functions, unchanged in what they do. An account with no store yet (step E7) records none.

-- The account's first open store (its oldest), never a store template, demo store or Kaizena Flow's own.
CREATE FUNCTION commerce.organisation_first_store(p_organisation uuid) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT s.id FROM commerce.stores s
   WHERE s.organisation_id = p_organisation AND s.status <> 'closed' AND NOT (s.is_template OR s.starter OR s.sandbox OR s.house)
   ORDER BY s.created_at, s.id
   LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.organisation_first_store(p_organisation uuid) FROM PUBLIC;
--> statement-breakpoint

-- One plan move (what commerce.plan_moves_track() did inline): the monthly revenue before and after, in its kind.
CREATE FUNCTION commerce.plan_move_record(
  p_store uuid, p_update boolean,
  p_old_status text, p_old_price uuid, p_old_plan uuid, p_old_mode text,
  p_new_status text, p_new_price uuid, p_new_plan uuid, p_new_mode text
) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_before_currency char(3);
  v_before bigint := 0;
  v_after_currency char(3);
  v_after bigint := 0;
BEGIN
  IF p_update THEN
    SELECT m.currency, m.minor INTO v_before_currency, v_before FROM commerce.plan_mrr(p_old_status, p_old_price) m;
  END IF;
  SELECT m.currency, m.minor INTO v_after_currency, v_after FROM commerce.plan_mrr(p_new_status, p_new_price) m;
  v_before := COALESCE(v_before, 0);
  v_after := COALESCE(v_after, 0);
  IF v_before = v_after AND v_before_currency IS NOT DISTINCT FROM v_after_currency THEN
    RETURN;
  END IF;
  IF v_before > 0 AND v_after > 0 AND v_before_currency IS DISTINCT FROM v_after_currency THEN
    INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
    VALUES (p_store, 'cancelled', p_old_plan, COALESCE(p_old_mode, p_new_mode), v_before_currency, v_before, 0);
    INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
    VALUES (p_store, 'started', p_new_plan, p_new_mode, v_after_currency, 0, v_after);
    RETURN;
  END IF;
  INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
  VALUES (
    p_store,
    CASE
      WHEN v_before = 0 AND p_update AND p_old_status = 'unpaid' THEN 'resumed'
      WHEN v_before = 0 THEN 'started'
      WHEN v_after = 0 AND p_new_status = 'unpaid' THEN 'paused'
      WHEN v_after = 0 THEN 'cancelled'
      WHEN v_after > v_before THEN 'upgraded'
      ELSE 'downgraded'
    END,
    COALESCE(p_new_plan, CASE WHEN p_update THEN p_old_plan END),
    COALESCE(p_new_mode, CASE WHEN p_update THEN p_old_mode END),
    COALESCE(v_after_currency, v_before_currency),
    v_before,
    v_after
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.plan_move_record(uuid, boolean, text, uuid, uuid, text, text, uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- The platform's plan events for one change (what commerce.platform_plan_events() did inline).
CREATE FUNCTION commerce.plan_events_queue(
  p_store uuid, p_update boolean,
  p_was_status text, p_was_plan uuid, p_was_subscription text, p_was_cancelling boolean,
  p_status text, p_plan uuid, p_subscription text, p_cancelling boolean
) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  was_status text := CASE WHEN p_update THEN p_was_status END;
  was_plan uuid := CASE WHEN p_update THEN p_was_plan END;
  was_subscription text := CASE WHEN p_update THEN p_was_subscription END;
  was_cancelling boolean := CASE WHEN p_update THEN p_was_cancelling ELSE false END;
  was_on boolean := coalesce(was_status IN ('active', 'trialing', 'past_due'), false);
BEGIN
  IF p_status IN ('active', 'trialing')
     AND (NOT was_on OR was_subscription IS DISTINCT FROM p_subscription) THEN
    PERFORM commerce.queue_platform_event('plan.started', p_store);
  ELSIF p_status IN ('active', 'trialing', 'past_due') AND was_on
     AND was_subscription IS NOT DISTINCT FROM p_subscription
     AND was_plan IS DISTINCT FROM p_plan THEN
    PERFORM commerce.queue_platform_event('plan.changed', p_store);
  END IF;
  IF (p_cancelling AND NOT was_cancelling AND p_status IN ('active', 'trialing', 'past_due'))
     OR (p_status = 'canceled' AND was_status IS DISTINCT FROM 'canceled' AND was_on AND NOT was_cancelling) THEN
    PERFORM commerce.queue_platform_event('plan.cancelled', p_store);
  END IF;
  IF p_status IN ('past_due', 'unpaid') AND coalesce(was_status NOT IN ('past_due', 'unpaid'), true) THEN
    PERFORM commerce.queue_platform_event('plan.payment_failed', p_store);
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.plan_events_queue(uuid, boolean, text, uuid, text, boolean, text, uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint

-- A store's own triggers, through the shared functions.
CREATE OR REPLACE FUNCTION commerce.plan_moves_track() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM commerce.plan_move_record(NEW.store_id, true, OLD.status, OLD.price_id, OLD.plan_id, OLD.mode::text,
                                      NEW.status, NEW.price_id, NEW.plan_id, NEW.mode::text);
  ELSE
    PERFORM commerce.plan_move_record(NEW.store_id, false, NULL, NULL, NULL, NULL, NEW.status, NEW.price_id, NEW.plan_id, NEW.mode::text);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.platform_plan_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM commerce.plan_events_queue(NEW.store_id, true, OLD.status, OLD.plan_id, OLD.subscription_id, OLD.cancel_at_period_end,
                                       NEW.status, NEW.plan_id, NEW.subscription_id, NEW.cancel_at_period_end);
  ELSE
    PERFORM commerce.plan_events_queue(NEW.store_id, false, NULL, NULL, NULL, false, NEW.status, NEW.plan_id, NEW.subscription_id, NEW.cancel_at_period_end);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- An account's: the same, under its first store.
CREATE FUNCTION commerce.organisation_plan_moves_track() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_store uuid := commerce.organisation_first_store(NEW.organisation_id);
BEGIN
  IF v_store IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM commerce.plan_move_record(v_store, true, OLD.status, OLD.price_id, OLD.plan_id, OLD.mode::text,
                                      NEW.status, NEW.price_id, NEW.plan_id, NEW.mode::text);
  ELSE
    PERFORM commerce.plan_move_record(v_store, false, NULL, NULL, NULL, NULL, NEW.status, NEW.price_id, NEW.plan_id, NEW.mode::text);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.organisation_plan_moves_track() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER organisation_billing_plan_moves AFTER INSERT OR UPDATE OF status, price_id ON commerce.organisation_billing
  FOR EACH ROW EXECUTE FUNCTION commerce.organisation_plan_moves_track();
--> statement-breakpoint

CREATE FUNCTION commerce.organisation_plan_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_store uuid := commerce.organisation_first_store(NEW.organisation_id);
BEGIN
  IF v_store IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM commerce.plan_events_queue(v_store, true, OLD.status, OLD.plan_id, OLD.subscription_id, OLD.cancel_at_period_end,
                                       NEW.status, NEW.plan_id, NEW.subscription_id, NEW.cancel_at_period_end);
  ELSE
    PERFORM commerce.plan_events_queue(v_store, false, NULL, NULL, NULL, false, NEW.status, NEW.plan_id, NEW.subscription_id, NEW.cancel_at_period_end);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.organisation_plan_events() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER organisation_billing_plan_events AFTER INSERT OR UPDATE OF status, plan_id, subscription_id, cancel_at_period_end ON commerce.organisation_billing
  FOR EACH ROW EXECUTE FUNCTION commerce.organisation_plan_events();
