-- Kaizena Flow's plans as they moved (C2 of docs/platform-parity-plan.md, D470): the rules the database holds.
--
-- * `plan_moves` has row-level security on, as every commerce table.
-- * `plan_moves_track()` keeps a move each time a store's billing changes what it pays every month: its price (a yearly one as a twelfth)
--   while the subscription is active or past due counts; a trial counts as nothing yet. Nothing before to something is `started` (or
--   `resumed` after an unpaid stop), something to nothing `cancelled` (or `paused` while it is unpaid), more `upgraded`, less `downgraded`.
--   A change of currency is the old one cancelled and the new one started. Moves are never changed or deleted but with their store.
-- * The stores' current plans are kept as `started` on the day this ran, so the history begins whole.

ALTER TABLE "commerce"."plan_moves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.plan_mrr(p_status text, p_price uuid)
RETURNS TABLE (currency char(3), minor bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pp.currency::char(3), CASE WHEN pp.interval = 'year' THEN round(pp.amount_minor / 12.0)::bigint ELSE pp.amount_minor::bigint END
    FROM commerce.plan_prices pp
   WHERE pp.id = p_price AND p_status IN ('active', 'past_due')
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.plan_moves_track()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_before_currency char(3);
  v_before bigint := 0;
  v_after_currency char(3);
  v_after bigint := 0;
  v_mode text := NEW.mode::text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT m.currency, m.minor INTO v_before_currency, v_before FROM commerce.plan_mrr(OLD.status, OLD.price_id) m;
  END IF;
  SELECT m.currency, m.minor INTO v_after_currency, v_after FROM commerce.plan_mrr(NEW.status, NEW.price_id) m;
  v_before := COALESCE(v_before, 0);
  v_after := COALESCE(v_after, 0);
  IF v_before = v_after AND v_before_currency IS NOT DISTINCT FROM v_after_currency THEN
    RETURN NULL;
  END IF;
  IF v_before > 0 AND v_after > 0 AND v_before_currency IS DISTINCT FROM v_after_currency THEN
    INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
    VALUES (NEW.store_id, 'cancelled', OLD.plan_id, COALESCE(OLD.mode::text, v_mode), v_before_currency, v_before, 0);
    INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
    VALUES (NEW.store_id, 'started', NEW.plan_id, v_mode, v_after_currency, 0, v_after);
    RETURN NULL;
  END IF;
  INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
  VALUES (
    NEW.store_id,
    CASE
      WHEN v_before = 0 AND TG_OP = 'UPDATE' AND OLD.status = 'unpaid' THEN 'resumed'
      WHEN v_before = 0 THEN 'started'
      WHEN v_after = 0 AND NEW.status = 'unpaid' THEN 'paused'
      WHEN v_after = 0 THEN 'cancelled'
      WHEN v_after > v_before THEN 'upgraded'
      ELSE 'downgraded'
    END,
    COALESCE(NEW.plan_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.plan_id END),
    COALESCE(v_mode, CASE WHEN TG_OP = 'UPDATE' THEN OLD.mode::text END),
    COALESCE(v_after_currency, v_before_currency),
    v_before,
    v_after
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER store_billing_plan_moves AFTER INSERT OR UPDATE OF status, price_id ON commerce.store_billing
  FOR EACH ROW EXECUTE FUNCTION commerce.plan_moves_track();
--> statement-breakpoint

INSERT INTO commerce.plan_moves (store_id, kind, plan_id, mode, currency, mrr_before_minor, mrr_after_minor)
SELECT b.store_id, 'started', b.plan_id, b.mode::text, m.currency, 0, m.minor
  FROM commerce.store_billing b
  CROSS JOIN LATERAL commerce.plan_mrr(b.status, b.price_id) m
 WHERE m.minor > 0;
