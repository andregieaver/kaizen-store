-- Creators (wave 11 unit G, D386): the rules of the programme, the commission ledger and its triggers.
ALTER TABLE "commerce"."creator_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."creators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."creator_attributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."creator_commissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."creator_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Whether the store's creator programme works: the online shop on (D178) and the owner's switch.
CREATE OR REPLACE FUNCTION commerce.creator_program_on(p_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT commerce.feature_on(p_store, 'shop')
     AND coalesce((SELECT s.enabled FROM commerce.creator_settings s WHERE s.store_id = p_store), false)
$$;--> statement-breakpoint

-- One creator's ledger at a time, so an earning, a reversal and a payout never cross.
CREATE OR REPLACE FUNCTION commerce.creator_lock(p_store uuid, p_creator uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(hashtext('creator:' || p_store::text || ':' || p_creator::text))
$$;--> statement-breakpoint

-- What the store owes a creator in a currency: earned less reversed less paid out. Never converted.
CREATE OR REPLACE FUNCTION commerce.creator_owed(p_store uuid, p_creator uuid, p_currency text)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((SELECT sum(CASE WHEN c.kind = 'earned' THEN c.amount_minor ELSE -c.amount_minor END)
                     FROM commerce.creator_commissions c
                    WHERE c.store_id = p_store AND c.creator_id = p_creator AND c.currency = p_currency), 0)
       - coalesce((SELECT sum(p.amount_minor) FROM commerce.creator_payouts p
                    WHERE p.store_id = p_store AND p.creator_id = p_creator AND p.currency = p_currency), 0)
$$;--> statement-breakpoint

-- The ledger and the payouts are append-only; a payout is never more than is owed in its currency.
CREATE OR REPLACE FUNCTION commerce.creator_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'commerce.% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'creator_payouts' THEN
    PERFORM commerce.creator_lock(NEW.store_id, NEW.creator_id);
    IF NEW.amount_minor > commerce.creator_owed(NEW.store_id, NEW.creator_id, NEW.currency) THEN
      RAISE EXCEPTION 'creator.payout_over' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER creator_commissions_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.creator_commissions
  FOR EACH ROW EXECUTE FUNCTION commerce.creator_ledger_guard();--> statement-breakpoint
CREATE TRIGGER creator_payouts_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce.creator_payouts
  FOR EACH ROW EXECUTE FUNCTION commerce.creator_ledger_guard();--> statement-breakpoint

-- A creator moves only as the owner may: applied to approved or declined, approved and stopped back and forth, declined to approved;
-- a code once given is kept; who applied is only ever forgotten (erasure), never changed.
CREATE OR REPLACE FUNCTION commerce.creators_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'applied' OR NEW.code IS NOT NULL THEN
      RAISE EXCEPTION 'creator.not_applied' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.store_id <> OLD.store_id OR NEW.id <> OLD.id OR NEW.consent_text <> OLD.consent_text OR NEW.consented_at <> OLD.consented_at THEN
    RAISE EXCEPTION 'creator.fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'creator.customer_fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.code IS NOT NULL AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'creator.code_fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'applied' AND NEW.status IN ('approved', 'declined'))
    OR (OLD.status = 'approved' AND NEW.status = 'stopped')
    OR (OLD.status IN ('stopped', 'declined') AND NEW.status = 'approved')
  ) THEN
    RAISE EXCEPTION 'creator.bad_status' USING ERRCODE = 'check_violation';
  END IF;
  -- A creator forgotten (erasure) never works again.
  IF NEW.customer_id IS NULL AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'creator.erased' USING ERRCODE = 'check_violation';
  END IF;
  -- A code is the store's once, across the referral program's codes too.
  IF NEW.code IS NOT NULL AND OLD.code IS NULL
     AND EXISTS (SELECT 1 FROM commerce.affiliates a WHERE a.store_id = NEW.store_id AND a.code = NEW.code) THEN
    RAISE EXCEPTION 'creator.code_taken' USING ERRCODE = 'unique_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER creators_rules BEFORE INSERT OR UPDATE ON commerce.creators
  FOR EACH ROW EXECUTE FUNCTION commerce.creators_rules();--> statement-breakpoint

-- An attribution keeps its order, creator and code; its state goes only forward.
CREATE OR REPLACE FUNCTION commerce.creator_attributions_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commerce.creator_attributions is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_o FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    -- A copied order is history (D129), a host's the host's (D71), an exchange's a returned order's (D239): none is attributed.
    IF v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL OR v_o.source = 'exchange' THEN
      RAISE EXCEPTION 'creator.not_attributable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('pending', 'rejected') THEN
      RAISE EXCEPTION 'creator.bad_status' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.creator_id <> OLD.creator_id OR NEW.code <> OLD.code OR NEW.store_id <> OLD.store_id THEN
    RAISE EXCEPTION 'creator.fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('earned', 'rejected', 'reversed'))
    OR (OLD.status = 'earned' AND NEW.status = 'reversed')
  ) THEN
    RAISE EXCEPTION 'creator.bad_status' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER creator_attributions_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.creator_attributions
  FOR EACH ROW EXECUTE FUNCTION commerce.creator_attributions_rules();--> statement-breakpoint

-- Whether a customer or an address is the creator's own (a creator buying for themselves earns nothing).
CREATE OR REPLACE FUNCTION commerce.creator_is_self(p_store uuid, p_creator uuid, p_customer uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM commerce.creators cr
      LEFT JOIN commerce.customers c ON c.store_id = cr.store_id AND c.id = cr.customer_id
     WHERE cr.store_id = p_store AND cr.id = p_creator
       AND (cr.customer_id = p_customer OR (c.email <> '' AND lower(c.email) = lower(coalesce(p_email, ''))))
  )
$$;--> statement-breakpoint

-- The order placed with a creator's code in play (placeOrder()): pending until paid, rejected when it is the creator's own order.
-- Guests count too: the code, not the buyer, is what a creator brings.
CREATE OR REPLACE FUNCTION commerce.creator_attribute_order(p_order uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_c commerce.creators%ROWTYPE;
  v_self boolean;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND OR p_code IS NULL OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL OR v_o.source = 'exchange' THEN
    RETURN 'none';
  END IF;
  IF NOT commerce.creator_program_on(v_o.store_id) THEN
    RETURN 'off';
  END IF;
  SELECT * INTO v_c FROM commerce.creators c WHERE c.store_id = v_o.store_id AND c.code = p_code AND c.status = 'approved';
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  v_self := commerce.creator_is_self(v_o.store_id, v_c.id, v_o.customer_id, v_o.email);
  INSERT INTO commerce.creator_attributions (store_id, order_id, creator_id, code, status, reject_reason)
  VALUES (v_o.store_id, p_order, v_c.id, v_c.code, CASE WHEN v_self THEN 'rejected' ELSE 'pending' END, CASE WHEN v_self THEN 'self' END)
  ON CONFLICT (store_id, order_id) DO NOTHING;
  RETURN CASE WHEN v_self THEN 'self' ELSE 'ok' END;
END;
$$;--> statement-breakpoint

-- A line's rate in basis points: the creator's own, else the highest of the product's categories the owner gave a rate (placed by
-- hand or filled by rules, the one evaluator), else the programme's.
CREATE OR REPLACE FUNCTION commerce.creator_line_bps(p_store uuid, p_creator uuid, p_product uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT cr.commission_bps FROM commerce.creators cr WHERE cr.store_id = p_store AND cr.id = p_creator),
    (SELECT max((s.category_bps ->> t.id::text)::int)
       FROM commerce.creator_settings s
       JOIN commerce.terms t ON t.store_id = s.store_id AND s.category_bps ? t.id::text
      WHERE s.store_id = p_store AND t.content_type = 'product'
        AND (EXISTS (SELECT 1 FROM commerce.product_terms pt
                      WHERE pt.store_id = t.store_id AND pt.term_id = t.id AND pt.product_id = p_product)
             OR (t.rules IS NOT NULL AND commerce.product_matches_rules(p_store, p_product, t.rules)))),
    (SELECT s.commission_bps FROM commerce.creator_settings s WHERE s.store_id = p_store),
    0
  )
$$;--> statement-breakpoint

-- What the order's captured payments came to and what was refunded of them (a release or a void moves no money), the order's own money.
CREATE OR REPLACE FUNCTION commerce.creator_paid_refunded(p_store uuid, p_order uuid, OUT paid bigint, OUT refunded bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    coalesce((SELECT sum(p.amount_minor) FROM commerce.payments p
               WHERE p.store_id = p_store AND p.order_id = p_order AND p.status = 'captured'
                 AND commerce.payment_of_order(p.store_id, p.id)), 0),
    coalesce((SELECT sum(r.amount_minor) FROM commerce.refunds r
                JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
               WHERE p.store_id = p_store AND p.order_id = p_order AND r.status <> 'failed' AND r.kind NOT IN ('release', 'void')
                 AND commerce.payment_of_order(p.store_id, p.id)), 0)
$$;--> statement-breakpoint

-- Takes back what refunds call for: the commission in proportion to what was refunded of what was paid, all of it once all is refunded.
CREATE OR REPLACE FUNCTION commerce.creator_settle_refunds(p_store uuid, p_order uuid, p_key text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_a commerce.creator_attributions%ROWTYPE;
  v_earned commerce.creator_commissions%ROWTYPE;
  v_paid bigint;
  v_refunded bigint;
  v_target bigint;
  v_done bigint;
BEGIN
  SELECT * INTO v_a FROM commerce.creator_attributions a WHERE a.store_id = p_store AND a.order_id = p_order;
  IF NOT FOUND OR v_a.status <> 'earned' THEN
    RETURN;
  END IF;
  SELECT * INTO v_earned FROM commerce.creator_commissions c
   WHERE c.store_id = p_store AND c.idempotency_key = 'creator:' || p_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT x.paid, x.refunded INTO v_paid, v_refunded FROM commerce.creator_paid_refunded(p_store, p_order) x;
  IF v_paid <= 0 OR v_refunded <= 0 THEN
    RETURN;
  END IF;
  v_target := CASE WHEN v_refunded >= v_paid THEN v_earned.amount_minor
                   ELSE floor(v_earned.amount_minor::numeric * v_refunded / v_paid)::bigint END;
  SELECT coalesce(sum(c.amount_minor), 0) INTO v_done FROM commerce.creator_commissions c
   WHERE c.store_id = p_store AND c.order_id = p_order AND c.kind = 'reversed';
  IF v_target > v_done THEN
    INSERT INTO commerce.creator_commissions (store_id, creator_id, order_id, kind, currency, amount_minor, idempotency_key)
    VALUES (p_store, v_a.creator_id, p_order, 'reversed', v_earned.currency, v_target - v_done, p_key)
    ON CONFLICT (store_id, idempotency_key) DO NOTHING;
  END IF;
  IF v_refunded >= v_paid THEN
    UPDATE commerce.creator_attributions SET status = 'reversed' WHERE id = v_a.id;
  END IF;
END;
$$;--> statement-breakpoint

-- A paid order (D152's PAID: a captured payment, never copied or a host's) earns its creator the rate of each line of goods without VAT,
-- in the order's own currency. Gift cards, services and bookings earn nothing.
CREATE OR REPLACE FUNCTION commerce.creator_order_paid(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_a commerce.creator_attributions%ROWTYPE;
  v_amount bigint;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL OR v_o.status NOT IN ('paid', 'fulfilled', 'closed') THEN
    RETURN;
  END IF;
  SELECT * INTO v_a FROM commerce.creator_attributions a WHERE a.store_id = v_o.store_id AND a.order_id = p_order;
  IF NOT FOUND OR v_a.status <> 'pending' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.payments p WHERE p.store_id = v_o.store_id AND p.order_id = p_order AND p.status = 'captured') THEN
    RETURN;
  END IF;
  PERFORM commerce.creator_lock(v_o.store_id, v_a.creator_id);
  SELECT * INTO v_a FROM commerce.creator_attributions a WHERE a.id = v_a.id FOR UPDATE;
  IF v_a.status <> 'pending' THEN
    RETURN;
  END IF;
  -- The creator bought for themselves under another account's address, or as a guest with their own.
  IF commerce.creator_is_self(v_o.store_id, v_a.creator_id, v_o.customer_id, v_o.email) THEN
    UPDATE commerce.creator_attributions SET status = 'rejected', reject_reason = 'self' WHERE id = v_a.id;
    RETURN;
  END IF;
  SELECT floor(coalesce(sum((ol.total_minor - ol.tax_minor)::numeric * commerce.creator_line_bps(v_o.store_id, v_a.creator_id, v.product_id)), 0) / 10000)::bigint
    INTO v_amount
    FROM commerce.order_lines ol
    JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
    JOIN commerce.products pr ON pr.store_id = v.store_id AND pr.id = v.product_id
   WHERE ol.store_id = v_o.store_id AND ol.order_id = p_order
     AND ol.delivery IN ('physical', 'digital') AND pr.kind <> 'gift_card' AND ol.total_minor > ol.tax_minor;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    UPDATE commerce.creator_attributions SET status = 'rejected', reject_reason = 'zero' WHERE id = v_a.id;
    RETURN;
  END IF;
  INSERT INTO commerce.creator_commissions (store_id, creator_id, order_id, kind, currency, amount_minor, idempotency_key)
  VALUES (v_o.store_id, v_a.creator_id, p_order, 'earned', v_o.currency, v_amount, 'creator:' || p_order)
  ON CONFLICT (store_id, idempotency_key) DO NOTHING;
  UPDATE commerce.creator_attributions SET status = 'earned' WHERE id = v_a.id;
  -- A refund made before the payment was read is taken into account at once.
  PERFORM commerce.creator_settle_refunds(v_o.store_id, p_order, 'creator-reverse-paid:' || p_order);
END;
$$;--> statement-breakpoint

-- A paid order cancelled: its commission is all taken back. An unpaid one cancelled is only no longer waiting.
CREATE OR REPLACE FUNCTION commerce.creator_order_cancelled(p_order uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_o commerce.orders%ROWTYPE;
  v_a commerce.creator_attributions%ROWTYPE;
  v_earned commerce.creator_commissions%ROWTYPE;
  v_done bigint;
BEGIN
  SELECT * INTO v_o FROM commerce.orders o WHERE o.id = p_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_a FROM commerce.creator_attributions a WHERE a.store_id = v_o.store_id AND a.order_id = p_order;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM commerce.creator_lock(v_o.store_id, v_a.creator_id);
  SELECT * INTO v_a FROM commerce.creator_attributions a WHERE a.id = v_a.id FOR UPDATE;
  IF v_a.status = 'pending' THEN
    UPDATE commerce.creator_attributions SET status = 'reversed' WHERE id = v_a.id;
    RETURN;
  END IF;
  IF v_a.status <> 'earned' THEN
    RETURN;
  END IF;
  SELECT * INTO v_earned FROM commerce.creator_commissions c
   WHERE c.store_id = v_o.store_id AND c.idempotency_key = 'creator:' || p_order;
  SELECT coalesce(sum(c.amount_minor), 0) INTO v_done FROM commerce.creator_commissions c
   WHERE c.store_id = v_o.store_id AND c.order_id = p_order AND c.kind = 'reversed';
  IF v_earned.id IS NOT NULL AND v_earned.amount_minor > v_done THEN
    INSERT INTO commerce.creator_commissions (store_id, creator_id, order_id, kind, currency, amount_minor, idempotency_key)
    VALUES (v_o.store_id, v_a.creator_id, p_order, 'reversed', v_earned.currency, v_earned.amount_minor - v_done,
            'creator-reverse-cancel:' || p_order)
    ON CONFLICT (store_id, idempotency_key) DO NOTHING;
  END IF;
  UPDATE commerce.creator_attributions SET status = 'reversed' WHERE id = v_a.id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.orders_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status IN ('paid', 'fulfilled') AND OLD.status IN ('pending_payment', 'authorized', 'cancelled') THEN
    PERFORM commerce.creator_order_paid(NEW.id);
  ELSIF NEW.status = 'cancelled' THEN
    PERFORM commerce.creator_order_cancelled(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER orders_creator AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION commerce.orders_creator();--> statement-breakpoint

-- A payment captured after its order became paid (an order on terms settled, D293; a card captured later, D289) earns then.
CREATE OR REPLACE FUNCTION commerce.payments_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    PERFORM commerce.creator_order_paid(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payments_creator_insert AFTER INSERT ON commerce.payments
  FOR EACH ROW WHEN (NEW.status = 'captured') EXECUTE FUNCTION commerce.payments_creator();--> statement-breakpoint
CREATE TRIGGER payments_creator_status AFTER UPDATE OF status ON commerce.payments
  FOR EACH ROW WHEN (NEW.status = 'captured' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION commerce.payments_creator();--> statement-breakpoint

-- Every refund, by any path (refundOrder(), Stripe's own, a return, store credit, an exchange's transfer), takes its share back.
CREATE OR REPLACE FUNCTION commerce.refunds_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order uuid;
  v_creator uuid;
BEGIN
  IF NEW.status = 'failed' OR NEW.kind IN ('release', 'void') THEN
    RETURN NULL;
  END IF;
  SELECT p.order_id INTO v_order FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
  SELECT a.creator_id INTO v_creator FROM commerce.creator_attributions a WHERE a.store_id = NEW.store_id AND a.order_id = v_order;
  IF v_creator IS NULL OR NOT commerce.payment_of_order(NEW.store_id, NEW.payment_id) THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.creator_lock(NEW.store_id, v_creator);
  PERFORM commerce.creator_settle_refunds(NEW.store_id, v_order, 'creator-reverse:' || NEW.id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER refunds_creator AFTER INSERT ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_creator();--> statement-breakpoint

-- A visit to a creator's link is counted as the referral program's are (a number per code and day, nothing about the visitor).
CREATE OR REPLACE FUNCTION commerce.affiliate_count_visit(p_store uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT (
       (commerce.affiliate_program_on(p_store)
        AND EXISTS (SELECT 1 FROM commerce.affiliates a WHERE a.store_id = p_store AND a.code = p_code AND a.blocked_at IS NULL))
    OR (commerce.creator_program_on(p_store)
        AND EXISTS (SELECT 1 FROM commerce.creators c WHERE c.store_id = p_store AND c.code = p_code AND c.status = 'approved'))
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO commerce.referral_visits (store_id, code, day, visits)
  VALUES (p_store, p_code, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), code, day)
  DO UPDATE SET visits = commerce.referral_visits.visits + 1
    -- A ceiling for the day, so a code opened by a script cannot grow a counter without end (the row is one per day and code).
    WHERE commerce.referral_visits.visits < 100000;
  RETURN true;
END;
$$;
