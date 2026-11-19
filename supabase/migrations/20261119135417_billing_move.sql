-- Paid extensions, step E4 part four (D748, docs/extensions.md 13): the move of an account to one plan. While the move runs (it sets
-- commerce.billing_move for its own transaction), a store's subscription becoming its account's is not a plan move nor a plan event: the
-- money and the plan stay as they were. Every other change records as before.
CREATE OR REPLACE FUNCTION commerce.plan_move_record(
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
  -- The move from store-by-store billing to the account's (D748 E4 part four) hands a running subscription from a store to its account:
  -- the revenue and the plan do not change, so no move and no event is recorded for it.
  IF current_setting('commerce.billing_move', true) = 'on' THEN
    RETURN;
  END IF;
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
CREATE OR REPLACE FUNCTION commerce.plan_events_queue(
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
  -- The move from store-by-store billing to the account's (D748 E4 part four) hands a running subscription from a store to its account:
  -- the revenue and the plan do not change, so no move and no event is recorded for it.
  IF current_setting('commerce.billing_move', true) = 'on' THEN
    RETURN;
  END IF;
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
