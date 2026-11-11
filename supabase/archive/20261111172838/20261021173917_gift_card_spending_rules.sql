-- Spending gift cards (wave 5 unit F step F3, D300, docs/wave-5-marketing.md 8.3).
--
-- A card pays as a payment of provider `gift_card`, never as a discount: the order's total and VAT are what they would be without it. Its row is the
-- only way an order touches a card: made pending when the order is placed (held on the card here), captured with its order when the order is paid
-- (spent), ended when the order is cancelled unpaid (released), and a refund of it goes back on the card. No provider is asked: the card's ledger is
-- the money, written only by the F1 `gift_card_*` functions.
ALTER TABLE commerce.cart_gift_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A gift card payment takes its store's mode as a venue payment does (D159), so a test card is spent only in test mode and a real one only for real,
-- and an order paid with a test card never gets an invoice number.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.payments_venue_mode()'::regprocedure);
  IF position($m$'gift_card'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$IF NEW.provider IN ('venue', 'terms') THEN$a$, $b$IF NEW.provider IN ('venue', 'terms', 'gift_card') THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'payments_venue_mode: the venue test was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The card's side of a gift card payment, as its row moves: made (held; never more than the order's total online without its gift card lines, since a
-- gift card never pays for a gift card), captured (spent), ended unpaid (released). Its card, order, amount and currency stay as made, and a captured
-- one stays captured (its refunds are refunds).
CREATE FUNCTION commerce.payments_gift_card() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_payable bigint;
  v_taken bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.provider <> 'gift_card' THEN
      RETURN NULL;
    END IF;
    IF NEW.status NOT IN ('pending', 'captured') THEN
      RAISE EXCEPTION 'payments.gift_card_status: a gift card payment starts held or captured' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.order_edit_id IS NOT NULL OR NEW.exchange_id IS NOT NULL THEN
      RAISE EXCEPTION 'payments.gift_card_purpose: a gift card pays an order at checkout, never a change or an exchange' USING ERRCODE = 'check_violation';
    END IF;
    SELECT o.total_minor - o.balance_minor
           - coalesce((SELECT sum(ol.total_minor) FROM commerce.order_lines ol
                        JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
                        JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
                       WHERE ol.store_id = o.store_id AND ol.order_id = o.id AND p.kind = 'gift_card'), 0)
      INTO v_payable
      FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    SELECT coalesce(sum(p.amount_minor), 0) INTO v_taken
      FROM commerce.payments p
     WHERE p.store_id = NEW.store_id AND p.order_id = NEW.order_id AND p.provider = 'gift_card' AND p.status NOT IN ('failed', 'cancelled');
    IF v_taken > coalesce(v_payable, 0) THEN
      RAISE EXCEPTION 'payments.gift_card_over: gift cards pay at most what the order costs online, without its gift cards' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM commerce.gift_card_hold(NEW.store_id, NEW.gift_card_id, NEW.order_id, NEW.currency, NEW.test_mode, NEW.amount_minor, 'hold:' || NEW.id);
    IF NEW.status = 'captured' THEN
      PERFORM commerce.gift_card_spend(NEW.store_id, NEW.gift_card_id, NEW.order_id, 'spend:' || NEW.id);
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.provider <> 'gift_card' AND NEW.provider <> 'gift_card' THEN
    RETURN NULL;
  END IF;
  IF (NEW.provider, NEW.gift_card_id, NEW.order_id, NEW.amount_minor, NEW.currency, NEW.test_mode)
     IS DISTINCT FROM (OLD.provider, OLD.gift_card_id, OLD.order_id, OLD.amount_minor, OLD.currency, OLD.test_mode) THEN
    RAISE EXCEPTION 'payments.gift_card_fixed: a gift card payment''s card, order and amount stay as made' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'payments.gift_card_settled: a gift card payment that was spent or ended stays so' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'captured' THEN
    PERFORM commerce.gift_card_spend(NEW.store_id, NEW.gift_card_id, NEW.order_id, 'spend:' || NEW.id);
  ELSIF NEW.status IN ('cancelled', 'failed') THEN
    PERFORM commerce.gift_card_release(NEW.store_id, NEW.gift_card_id, NEW.order_id, 'release:' || NEW.id);
  ELSE
    RAISE EXCEPTION 'payments.gift_card_status: a held gift card payment is spent or ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_gift_card AFTER INSERT OR UPDATE ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.payments_gift_card();
--> statement-breakpoint

-- A gift card is captured with its order: when the order is paid (from waiting for payment or a card held, D289), each of its held gift card payments
-- is spent; when it is cancelled unpaid, each is released. An order paid after it was cancelled (a payment that arrived late) finds its cards released:
-- they are not taken again (the money may be spent elsewhere by now), and the order says what they no longer pay, for staff to settle.
CREATE FUNCTION commerce.orders_gift_card_payments() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_unpaid bigint;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IN ('pending_payment', 'authorized') THEN
    UPDATE commerce.payments SET status = 'captured', updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND provider = 'gift_card' AND status = 'pending';
  ELSIF NEW.status = 'paid' AND OLD.status = 'cancelled' THEN
    SELECT coalesce(sum(p.amount_minor), 0) INTO v_unpaid
      FROM commerce.payments p
     WHERE p.store_id = NEW.store_id AND p.order_id = NEW.id AND p.provider = 'gift_card' AND p.status = 'cancelled';
    IF v_unpaid > 0 THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (NEW.store_id, NEW.id, 'gift_card.unpaid', jsonb_build_object('amountMinor', v_unpaid, 'currency', NEW.currency), 'system');
    END IF;
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'authorized') THEN
    UPDATE commerce.payments SET status = 'cancelled', updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND provider = 'gift_card' AND status = 'pending';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_gift_card_payments AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_card_payments();
--> statement-breakpoint

-- A refund of a gift card payment goes back on the card, by whatever path it was made (`refundOrder()`, a return, a withdrawal, raw SQL), once, when it
-- succeeds; also after the card expired (the next daily run expires the balance again).
CREATE FUNCTION commerce.refunds_gift_card() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_payment commerce.payments%ROWTYPE;
BEGIN
  IF NEW.status <> 'succeeded' OR (TG_OP = 'UPDATE' AND OLD.status = 'succeeded') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_payment FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
  IF v_payment.provider IS DISTINCT FROM 'gift_card' THEN
    RETURN NULL;
  END IF;
  IF NEW.kind <> 'money' THEN
    RAISE EXCEPTION 'refunds.gift_card_kind: a refund of a gift card goes back on the card' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM commerce.gift_card_refund(NEW.store_id, v_payment.gift_card_id, v_payment.order_id, NEW.amount_minor, 'refund:' || NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_gift_card AFTER INSERT OR UPDATE OF status ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_gift_card();
--> statement-breakpoint

-- A gift card payment keeps its mode on the row (above), so an order paid with a test card is a test order: no invoice number.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.invoice_eligibility(uuid)'::regprocedure);
  IF position($m$'terms', 'gift_card'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$p.provider NOT IN ('venue', 'exchange', 'mollie', 'terms') AND p.provider_account$a$, $b$p.provider NOT IN ('venue', 'exchange', 'mollie', 'terms', 'gift_card') AND p.provider_account$b$);
  v_new := replace(v_new, $a$OR (p.provider IN ('venue', 'exchange', 'mollie', 'terms') AND p.test_mode))$a$, $b$OR (p.provider IN ('venue', 'exchange', 'mollie', 'terms', 'gift_card') AND p.test_mode))$b$);
  IF position($m$'terms', 'gift_card') AND p.test_mode$m$ in v_new) = 0 THEN RAISE EXCEPTION 'invoice_eligibility: the test-mode providers were not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The invoice names what gift cards paid as a payment of its own (`paid_gift_card`, with each card's last four), beside what was paid online or outside;
-- the VAT is on the goods as always (a card is never a discount).
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position('paid_gift_card' in v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_step := replace(v_new, E'  v_settled bigint := 0;\n', E'  v_settled bigint := 0;\n  v_cards bigint := 0;\n  v_cards_last4 jsonb := ''[]''::jsonb;\n');
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the declarations were not found'; END IF;
  v_new := v_step;
  v_step := replace(v_new,
    $a$  SELECT p.provider INTO v_provider FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider NOT IN ('venue', 'exchange', 'terms') AND p.status NOT IN ('failed', 'cancelled')$a$,
    $b$  -- Gift cards (D300 F3): the part they paid, named by each card's last four; the rest is paid online or outside.
  SELECT coalesce(sum(p.amount_minor), 0), coalesce(jsonb_agg(g.last4 ORDER BY p.created_at, p.id), '[]'::jsonb) INTO v_cards, v_cards_last4
    FROM commerce.payments p JOIN commerce.gift_cards g ON g.store_id = p.store_id AND g.id = p.gift_card_id
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider = 'gift_card' AND p.status NOT IN ('failed', 'cancelled');
  v_online := v_online - v_cards;
  SELECT p.provider INTO v_provider FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider NOT IN ('venue', 'exchange', 'terms', 'gift_card') AND p.status NOT IN ('failed', 'cancelled')$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the provider of what was paid was not found'; END IF;
  v_new := v_step;
  v_step := replace(v_new,
    $a$      'returnNumber', v_settled_from ->> 'returnNumber', 'orderNumber', v_settled_from ->> 'orderNumber') AS x WHERE v_settled > 0
    UNION ALL$a$,
    $b$      'returnNumber', v_settled_from ->> 'returnNumber', 'orderNumber', v_settled_from ->> 'orderNumber') AS x WHERE v_settled > 0
    UNION ALL
    SELECT 0, jsonb_build_object('kind', 'paid_gift_card', 'amountMinor', v_cards, 'provider', 'gift_card', 'cards', v_cards_last4) WHERE v_cards > 0
    UNION ALL$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the payments list was not found'; END IF;
  EXECUTE v_step;
END;
$patch$;
--> statement-breakpoint

-- A refund of a gift card payment is made here, with no provider to refuse more than was paid: the database caps it as it caps money taken outside.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.refunds_manual_cap()'::regprocedure);
  IF position($m$'gift_card'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$AND v_provider IS DISTINCT FROM 'terms' AND NEW.kind$a$, $b$AND v_provider IS DISTINCT FROM 'terms' AND v_provider IS DISTINCT FROM 'gift_card' AND NEW.kind$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'refunds_manual_cap: the providers were not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- What an order was paid with, for how much bonus or referral credit a refund takes back: a gift card's part is paid too, so a refund of it takes back
-- only its share.
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['commerce.bonus_refund_applied(uuid)', 'commerce.affiliate_refund_applied(uuid)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position($m$'exchange', 'gift_card'$m$ in v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(v_def, $a$p.provider IN ('stripe', 'exchange') /* D239 exchange base */$a$, $b$p.provider IN ('stripe', 'exchange', 'gift_card') /* D239 exchange base, D300 gift cards */$b$);
    IF v_new = v_def THEN RAISE EXCEPTION '%: the paid base was not found', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch$;
