-- Refund to store credit (wave 10 unit A, D364, `docs/wave-10-must-haves.md` 2): a refund of kind `store_credit` moves no money through a
-- provider; the amount is issued as one gift card of the store's (source `refund`), spent at checkout as any card, its balance the ledger's.

-- A card's refund is part of its identity, fixed as issued.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.gift_cards_rules()'::regprocedure);
  IF position('NEW.refund_id' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 'NEW.unit_index, NEW.issued_by,', 'NEW.unit_index, NEW.refund_id, NEW.issued_by,');
  v_new := replace(v_new, 'OLD.unit_index, OLD.issued_by,', 'OLD.unit_index, OLD.refund_id, OLD.issued_by,');
  IF v_new = v_def OR position('OLD.refund_id' in v_new) = 0 THEN
    RAISE EXCEPTION 'gift_cards_rules: the fixed columns were not found, so a card''s refund would not be fixed';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- A refund to store credit has no provider to refuse more than was paid, so it is capped here like money taken outside Kaizen.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.refunds_manual_cap()'::regprocedure);
  IF position('store_credit' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$AND NEW.kind <> 'transfer' AND NOT EXISTS$a$, $b$AND NEW.kind NOT IN ('transfer', 'store_credit') AND NOT EXISTS$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'refunds_manual_cap: the kind test was not found, so store credit would not be capped'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The card for a refund to store credit: one card for the refund's rows (one per payment the amount was split over), named by the first, in the
-- order's currency, for the order's customer and address, its expiry from the store's settings. Once per refund: a second call returns the card.
CREATE FUNCTION commerce.gift_card_issue_refund(p_store uuid, p_refunds uuid[], p_account uuid, p_test boolean)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_first uuid := p_refunds[1];
  v_card uuid;
  v_order uuid;
  v_orders integer;
  v_amount bigint;
  v_rows integer;
  v_currency text;
  v_customer uuid;
  v_email text;
  v_months integer;
BEGIN
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'gift_cards.refund: no refund to issue a card for' USING ERRCODE = 'check_violation';
  END IF;
  SELECT g.id INTO v_card FROM commerce.gift_cards g WHERE g.store_id = p_store AND g.refund_id = v_first;
  IF v_card IS NOT NULL THEN
    RETURN v_card;
  END IF;
  SELECT count(*), count(DISTINCT p.order_id), sum(r.amount_minor), min(p.order_id::text)::uuid
    INTO v_rows, v_orders, v_amount, v_order
    FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
   WHERE r.store_id = p_store AND r.id = ANY (p_refunds) AND r.kind = 'store_credit' AND r.status = 'succeeded';
  IF v_rows <> cardinality(p_refunds) OR v_orders <> 1 OR coalesce(v_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'gift_cards.refund: a card is issued only for succeeded store credit refunds of one order' USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.currency, o.customer_id, o.email INTO v_currency, v_customer, v_email
    FROM commerce.orders o WHERE o.store_id = p_store AND o.id = v_order;
  SELECT CASE WHEN s.store_id IS NULL THEN 36 ELSE s.expiry_months END INTO v_months
    FROM (SELECT 1) one LEFT JOIN commerce.gift_card_settings s ON s.store_id = p_store;
  PERFORM set_config('kaizen.gift_card_ledger', 'on', true);
  INSERT INTO commerce.gift_cards (store_id, currency, initial_minor, source, order_id, refund_id, issued_by, note, test_mode, customer_id, recipient_email, expires_at)
  VALUES (p_store, upper(v_currency), v_amount, 'refund', v_order, v_first, p_account, '', coalesce(p_test, false), v_customer,
          nullif(left(coalesce(v_email, ''), 254), ''),
          CASE WHEN v_months IS NULL THEN NULL ELSE now() + make_interval(months => v_months) END)
  RETURNING id INTO v_card;
  PERFORM commerce.gift_card_entry(p_store, v_card, 'issue', v_amount, v_order, p_account, '', 'issue');
  RETURN v_card;
END;
$$;
