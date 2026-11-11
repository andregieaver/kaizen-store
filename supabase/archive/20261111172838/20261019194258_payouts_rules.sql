-- Payouts and reconciliation (wave 4 unit C, D290, docs/wave-4-payments.md 5): the rules the database holds. The tables and columns are in the
-- migration before this one.
--
-- * Row-level security on `payouts`, `payout_lines` and `payout_reads` (no policy: the `commerce` schema is private to the server).
-- * A payout is never deleted, and what identifies it (store, provider, reference, account, currency, mode, whether Stripe made it, when) never changes.
-- * A payout's line is never deleted or changed, except that what it settles may be tied to it later (a tie is set once, never moved): it is in its payout's
--   currency, and a payment, refund or dispute it names belongs to the order it names.
-- * A payment's fee from Stripe is set once (null to a value), never changed.
--
-- No function here contains DELETE, TRUNCATE or DROP.

ALTER TABLE commerce.payouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.payout_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.payout_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION commerce.payouts_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payouts.no_delete: a payout is the store''s money record' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
       OR NEW.provider_account IS DISTINCT FROM OLD.provider_account OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.test_mode IS DISTINCT FROM OLD.test_mode
       OR NEW.automatic IS DISTINCT FROM OLD.automatic OR NEW.provider_created_at IS DISTINCT FROM OLD.provider_created_at THEN
      RAISE EXCEPTION 'payouts.fixed: what identifies a payout never changes' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payouts_rules
  BEFORE UPDATE OR DELETE ON commerce.payouts
  FOR EACH ROW EXECUTE FUNCTION commerce.payouts_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.payout_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_currency text;
  v_order uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_lines.no_delete: a payout''s line is part of it' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT p.currency INTO v_currency FROM commerce.payouts p WHERE p.store_id = NEW.store_id AND p.id = NEW.payout_id;
    IF v_currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'payout_lines.currency: a line is in its payout''s currency' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.payout_id IS DISTINCT FROM OLD.payout_id OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
       OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.provider_type IS DISTINCT FROM OLD.provider_type OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.fee_minor IS DISTINCT FROM OLD.fee_minor OR NEW.net_minor IS DISTINCT FROM OLD.net_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.provider_created_at IS DISTINCT FROM OLD.provider_created_at THEN
      RAISE EXCEPTION 'payout_lines.fixed: a payout''s line is as Stripe gave it' USING ERRCODE = 'check_violation';
    END IF;
    IF (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
       OR (OLD.refund_id IS NOT NULL AND NEW.refund_id IS DISTINCT FROM OLD.refund_id)
       OR (OLD.dispute_id IS NOT NULL AND NEW.dispute_id IS DISTINCT FROM OLD.dispute_id)
       OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id) THEN
      RAISE EXCEPTION 'payout_lines.tied: a line''s tie is set once' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- What it is tied to belongs to the order it names.
  IF NEW.payment_id IS NOT NULL THEN
    SELECT p.order_id INTO v_order FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
    IF NEW.order_id IS DISTINCT FROM v_order THEN
      RAISE EXCEPTION 'payout_lines.other_order: the payment is not this order''s' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.refund_id IS NOT NULL THEN
    SELECT p.order_id INTO v_order FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = NEW.store_id AND r.id = NEW.refund_id;
    IF NEW.order_id IS DISTINCT FROM v_order THEN
      RAISE EXCEPTION 'payout_lines.other_order: the refund is not this order''s' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.dispute_id IS NOT NULL THEN
    SELECT d.order_id INTO v_order FROM commerce.payment_disputes d WHERE d.store_id = NEW.store_id AND d.id = NEW.dispute_id;
    IF NEW.order_id IS DISTINCT FROM v_order THEN
      RAISE EXCEPTION 'payout_lines.other_order: the dispute is not this order''s' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payout_lines_rules
  BEFORE INSERT OR UPDATE OR DELETE ON commerce.payout_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.payout_lines_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.payments_fee_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.provider_fee_minor IS NOT NULL AND (NEW.provider_fee_minor IS DISTINCT FROM OLD.provider_fee_minor
     OR NEW.application_fee_minor IS DISTINCT FROM OLD.application_fee_minor OR NEW.fee_currency IS DISTINCT FROM OLD.fee_currency) THEN
    RAISE EXCEPTION 'payments.fee_once: a payment''s fee from Stripe is kept as it was read' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER payments_fee_once
  BEFORE UPDATE OF provider_fee_minor, application_fee_minor, fee_currency ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.payments_fee_once();
