-- Payment facts and disputes (wave 4 unit A, D288, docs/wave-4-payments.md 3): the rules the database holds. The columns and the table are in the
-- migration before this one.
--
-- * Row-level security on `payment_disputes` (no policy: the `commerce` schema is private to the server).
-- * A dispute belongs to its payment's order and is in its payment's currency; what identifies it (store, order, payment, provider, reference,
--   currency, opening time) never changes, and a closed dispute stays closed. A dispute is never deleted: it is part of the order's history (D141).
-- * Staff alerts gain `dispute` (D288). Owners already get it by default; stores that saved their choices give it to each owner who receives any
--   alert today, so nobody misses a dispute for having saved the page before it existed.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.payment_disputes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.payment_disputes_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_payment record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_disputes.no_delete: a dispute is part of its order''s history' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT p.order_id, p.currency, p.provider INTO v_payment FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
    IF v_payment.order_id IS DISTINCT FROM NEW.order_id THEN
      RAISE EXCEPTION 'payment_disputes.other_order: the payment is not this order''s' USING ERRCODE = 'check_violation';
    END IF;
    IF v_payment.currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'payment_disputes.currency: a dispute is in its payment''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF v_payment.provider IS DISTINCT FROM NEW.provider THEN
      RAISE EXCEPTION 'payment_disputes.provider: a dispute is its payment''s provider''s' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'payment_disputes.fixed: what identifies a dispute never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.outcome IS DISTINCT FROM OLD.outcome) THEN
    RAISE EXCEPTION 'payment_disputes.closed: a closed dispute stays as it closed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.reminded_at IS NOT NULL AND NEW.reminded_at IS DISTINCT FROM OLD.reminded_at THEN
    RAISE EXCEPTION 'payment_disputes.reminded: a reminder is sent once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payment_disputes_rules
  BEFORE INSERT OR UPDATE OR DELETE ON commerce.payment_disputes
  FOR EACH ROW EXECUTE FUNCTION commerce.payment_disputes_rules();
--> statement-breakpoint

UPDATE commerce.staff_alert_recipients r
   SET events = r.events || ARRAY['dispute']::text[]
 WHERE NOT ('dispute' = ANY (r.events))
   AND EXISTS (
     SELECT 1 FROM commerce.store_members m
      WHERE m.store_id = r.store_id AND m.account_id = r.account_id AND m.role = 'owner' AND m.disabled_at IS NULL
   );
