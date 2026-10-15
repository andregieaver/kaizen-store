-- Exchanges and return labels (wave 3, D239, docs/wave-3-exchanges.md 3.3): the rules the database itself holds.
--
-- * Row-level security on the two new tables (no policy: the `commerce` schema is private to the server).
-- * A pasted label is `label_source = 'pasted'` (3.1): a trigger completes what the code running during the deploy writes (`label_url` alone), the rows that
--   exist are back-filled, and only then is the pairing a check (`returns_label_pasted`).
-- * Returns learn exchanges (3.3 points 1, 4, 9): `returns_rules()` patched in place (anchored) so a return can end `exchanged` (its refund is the credit C,
--   of which the remainder's refund is a part), a refund is not recorded while an exchange of the return is processed except by that exchange, the label's
--   carrier columns change only while the return is approved or in transit, the customer's wish is kept once made, and the anonymising may blank the wish.
-- * Exchanges (point 1): `exchange_block()` (point 2), `return_exchanges_rules()` (the lifecycle of `src/lib/exchange-status.ts`, the per-return number and
--   its limit, what is frozen, staff may not confirm a withdrawal's exchange) and, at commit, `return_exchanges_settled()` (a proposal has lines; a settled
--   exchange's order is paid, its return `exchanged` and its refunds add up; an ended one left no live order); `return_exchange_lines_rules()`.
-- * The exchange order (point 3): `orders_exchange_rules()` (made only under the exchange context, of the original order's store, currency and market, its
--   exchange frozen) and `order_lines_exchange_rules()` (its lines are the exchange's replacements).
-- * The transfer (point 4): `refunds_exchange_rules()`, `payments_exchange_rules()` and, at commit, `exchange_transfers_paired()`; the refunds of a payment that
--   carries a transfer, and of an `exchange` payment, never exceed it (`refunds_manual_cap()` patched).
-- * Documents (point 6): `make_credit_note()` issues nothing for an exchange's own refunds (`credit_note.covered_by_exchange`) and one `return_exchange` credit
--   note for an exchanged return (a deferred trigger on `returns`); `issue_missing_credit_notes()` learns both; `build_invoice_snapshot()` names the transfer as a
--   `settled_by_return` payment; `invoice_eligibility()` treats an `exchange` payment of a test order as a test.
-- * Completing the exchange order (point 7): `complete_exchange_order()`.
-- * Copied orders (point 8): the new table refuses them; `copy_orders()` already copies an order without `source`, `exchange_id` or payments (nothing to patch).
-- * Store copies: `clone_store()` and `duplicate_store()` copy `return_settings.exchanges` (never the label carrier or service, so never `label_auto`, which needs
--   one); `anonymise_order()` blanks the wish and the exchange's delivery address; `affiliate_attribute_order()` never attributes an exchange order.
--
-- No function here contains DELETE, TRUNCATE or DROP: token pruning and the wish's retention are application code (`runRetention()`). Functions patched
-- before are patched again by one anchored replacement each, idempotent by a marker, raising when the anchor is gone.

ALTER TABLE commerce.return_exchanges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.return_exchange_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A pasted label (3.1)
-- ---------------------------------------------------------------------------

-- `label_url` is D153's pasted address; whoever writes it (the code running during the deploy included) gets `label_source = 'pasted'` with it, and taking
-- it away takes the pasted source with it. A carrier's booking is written with `label_url` null.
CREATE FUNCTION commerce.returns_label_pasted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.label_url IS NOT NULL AND NEW.label_source IS NULL THEN
    NEW.label_source := 'pasted';
  ELSIF NEW.label_url IS NULL AND NEW.label_source = 'pasted' THEN
    NEW.label_source := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER returns_label_pasted BEFORE INSERT OR UPDATE OF label_url, label_source ON commerce.returns
  FOR EACH ROW EXECUTE FUNCTION commerce.returns_label_pasted();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Which returns can be exchanged (3.3 point 2; `exchangeBlock()` in src/lib/exchange.ts is the same rule for these reasons, held equal by a test)
-- ---------------------------------------------------------------------------

-- The reason an exchange of the return cannot be made, or null. `p_claimed_ok` is true when processing asks (it holds the refund's claim itself).
CREATE FUNCTION commerce.exchange_block(p_return uuid, p_claimed_ok boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  r commerce.returns%ROWTYPE;
  o commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO r FROM commerce.returns WHERE id = p_return;
  IF NOT FOUND THEN RETURN 'ended'; END IF;
  SELECT * INTO o FROM commerce.orders WHERE store_id = r.store_id AND id = r.order_id;
  IF o.copied_from IS NOT NULL THEN RETURN 'copied'; END IF;
  IF o.host_id IS NOT NULL THEN RETURN 'host'; END IF;
  IF o.vat_kind <> 'standard' THEN RETURN 'vat_kind'; END IF;
  IF o.restricted_at IS NOT NULL OR o.anonymised_at IS NOT NULL THEN RETURN 'restricted'; END IF;
  IF o.subscription_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM commerce.order_lines ol WHERE ol.store_id = o.store_id AND ol.order_id = o.id AND ol.selling_plan_id IS NOT NULL
  ) THEN RETURN 'subscription'; END IF;
  IF EXISTS (SELECT 1 FROM commerce.standing_deliveries sd WHERE sd.store_id = o.store_id AND sd.order_id = o.id) THEN RETURN 'weekly_box'; END IF;
  IF EXISTS (SELECT 1 FROM commerce.bookings b WHERE b.store_id = o.store_id AND b.order_id = o.id) THEN RETURN 'booking'; END IF;
  IF NOT commerce.store_is_active(o.store_id) THEN RETURN 'store_closed'; END IF;
  IF NOT commerce.feature_on(o.store_id, 'shop') THEN RETURN 'shop_off'; END IF;
  IF EXISTS (SELECT 1 FROM commerce.return_settings rs WHERE rs.store_id = o.store_id AND NOT rs.exchanges) THEN RETURN 'off'; END IF;
  IF r.status IN ('closed', 'declined', 'cancelled') THEN RETURN 'ended'; END IF;
  IF r.status = 'requested' THEN RETURN 'requested'; END IF;
  IF r.refund_minor IS NOT NULL OR r.refunded_at IS NOT NULL OR (r.refund_claimed_at IS NOT NULL AND NOT p_claimed_ok) THEN RETURN 'refunded'; END IF;
  IF EXISTS (
    SELECT 1 FROM commerce.return_lines rl JOIN commerce.order_lines ol ON ol.store_id = rl.store_id AND ol.id = rl.order_line_id
     WHERE rl.return_id = r.id AND rl.decision = 'accept' AND (ol.delivery <> 'physical' OR ol.variant_id IS NULL)
  ) THEN RETURN 'not_goods'; END IF;
  IF EXISTS (SELECT 1 FROM commerce.order_edits e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.status = 'awaiting_payment') THEN
    RETURN 'edit_pending';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Exchanges (3.3 point 1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.return_exchanges_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  r commerce.returns%ROWTYPE;
  o commerce.orders%ROWTYPE;
  v_block text;
  v_old text;
  v_new text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'exchange.kept: an exchange is a record and is never deleted (cancel it)' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The return's row is locked, so two proposals at once get two numbers and only one stays open (the partial unique index).
    SELECT * INTO r FROM commerce.returns WHERE store_id = NEW.store_id AND id = NEW.return_id FOR NO KEY UPDATE;
    IF NOT FOUND OR r.order_id <> NEW.order_id THEN
      RAISE EXCEPTION 'exchange.return: an exchange belongs to a return of its own order' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO o FROM commerce.orders WHERE store_id = NEW.store_id AND id = NEW.order_id;
    IF NEW.status NOT IN ('draft', 'proposed') THEN
      RAISE EXCEPTION 'exchange.lifecycle: an exchange starts as a draft or a proposal' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> o.currency THEN
      RAISE EXCEPTION 'exchange.currency: an exchange is in its order''s currency (%)', o.currency USING ERRCODE = 'check_violation';
    END IF;
    v_block := commerce.exchange_block(NEW.return_id, false);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'exchange.%: this return cannot be exchanged', v_block USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(e.seq), 0) + 1 INTO NEW.seq FROM commerce.return_exchanges e WHERE e.store_id = NEW.store_id AND e.return_id = NEW.return_id;
    IF NEW.seq > 5 THEN
      RAISE EXCEPTION 'exchange.limit: a return has at most 5 exchange proposals' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at IS NOT NULL OR NEW.exchange_order_id IS NOT NULL OR NEW.refund_id IS NOT NULL OR NEW.transfer_refund_id IS NOT NULL
       OR NEW.credit_at_processing IS NOT NULL OR NEW.processed_at IS NOT NULL OR NEW.settled_at IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'exchange.lifecycle: a new exchange is not confirmed, processed, settled or ended' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE ------------------------------------------------------------------------------------------------------
  IF current_setting('commerce.anonymising', true) = 'on' THEN
    IF (to_jsonb(NEW) - ARRAY['delivery_address', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['delivery_address', 'updated_at']) THEN
      RAISE EXCEPTION 'exchange.fixed: only the delivery address of an exchange is anonymised' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.return_id <> OLD.return_id OR NEW.order_id <> OLD.order_id OR NEW.seq <> OLD.seq
     OR NEW.currency <> OLD.currency OR NEW.market_slug <> OLD.market_slug OR NEW.made_by <> OLD.made_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'exchange.fixed: an exchange keeps its return, order, number, currency, market and maker' USING ERRCODE = 'restrict_violation';
  END IF;
  v_old := OLD.status;
  v_new := NEW.status;
  NEW.updated_at := now();

  -- An exchange that has ended (settled included) only loses its token hash, 90 days after (application code).
  IF v_old IN ('settled', 'declined_by_customer', 'cancelled', 'expired', 'superseded') THEN
    IF (to_jsonb(NEW) - ARRAY['token_hash', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['token_hash', 'updated_at'])
       OR (NEW.token_hash IS DISTINCT FROM OLD.token_hash AND NEW.token_hash IS NOT NULL) THEN
      RAISE EXCEPTION 'exchange.ended: an exchange that has ended is a record and does not change' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- What was proposed (and confirmed) is frozen once it leaves the draft: the prices as shown, the shipping, the address, the credit.
  IF v_old <> 'draft' AND (
       NEW.shipping_kind <> OLD.shipping_kind OR NEW.shipping_minor <> OLD.shipping_minor OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
       OR NEW.credit_minor <> OLD.credit_minor OR NEW.total_minor <> OLD.total_minor OR NEW.difference_minor <> OLD.difference_minor) THEN
    RAISE EXCEPTION 'exchange.frozen: a proposal is not changed; propose again' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.terms IS DISTINCT FROM OLD.terms AND v_old NOT IN ('draft', 'proposed') THEN
    RAISE EXCEPTION 'exchange.frozen: the terms are kept as the customer confirmed them' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.confirmed_at IS NOT NULL AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
                                         OR NEW.confirmed_channel IS DISTINCT FROM OLD.confirmed_channel))
     OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at)
     OR (OLD.exchange_order_id IS NOT NULL AND NEW.exchange_order_id IS DISTINCT FROM OLD.exchange_order_id)
     OR (OLD.credit_at_processing IS NOT NULL AND (NEW.credit_at_processing IS DISTINCT FROM OLD.credit_at_processing
                                                  OR NEW.difference_at_processing IS DISTINCT FROM OLD.difference_at_processing))
     OR (OLD.refund_id IS NOT NULL AND NEW.refund_id IS DISTINCT FROM OLD.refund_id)
     OR (OLD.transfer_refund_id IS NOT NULL AND NEW.transfer_refund_id IS DISTINCT FROM OLD.transfer_refund_id) THEN
    RAISE EXCEPTION 'exchange.times: a step and what it recorded are kept once set' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_new <> v_old THEN
    IF NOT (
      (v_old = 'draft' AND v_new IN ('proposed', 'cancelled'))
      OR (v_old = 'proposed' AND v_new IN ('confirmed', 'declined_by_customer', 'cancelled', 'expired', 'superseded'))
      OR (v_old = 'confirmed' AND v_new IN ('processed', 'cancelled', 'expired', 'superseded'))
      OR (v_old = 'processed' AND v_new IN ('settled', 'cancelled', 'expired'))
    ) THEN
      RAISE EXCEPTION 'exchange.lifecycle: an exchange cannot go from % to %', v_old, v_new USING ERRCODE = 'check_violation';
    END IF;
    IF v_new = 'confirmed' THEN
      NEW.confirmed_at := coalesce(NEW.confirmed_at, now());
      IF NEW.confirmed_by = 'staff' AND EXISTS (SELECT 1 FROM commerce.returns rt WHERE rt.id = NEW.return_id AND rt.kind = 'withdrawal') THEN
        RAISE EXCEPTION 'exchange.withdrawal_needs_customer: a withdrawal''s refund goes another way only on the customer''s own confirmation (CRD Art. 13(1))'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF v_new = 'processed' THEN
      NEW.processed_at := coalesce(NEW.processed_at, now());
      v_block := commerce.exchange_block(NEW.return_id, true);
      IF v_block IS NOT NULL THEN
        RAISE EXCEPTION 'exchange.%: this return can no longer be exchanged', v_block USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM commerce.orders x WHERE x.store_id = NEW.store_id AND x.id = NEW.exchange_order_id AND x.exchange_id = NEW.id) THEN
        RAISE EXCEPTION 'exchange.order: a processed exchange names the order made for it' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF v_new = 'settled' THEN NEW.settled_at := coalesce(NEW.settled_at, now()); END IF;
    IF v_new IN ('declined_by_customer', 'cancelled', 'expired', 'superseded') THEN NEW.ended_at := coalesce(NEW.ended_at, now()); END IF;
  ELSE
    IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.processed_at IS DISTINCT FROM OLD.processed_at
       OR NEW.settled_at IS DISTINCT FROM OLD.settled_at OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
       OR NEW.exchange_order_id IS DISTINCT FROM OLD.exchange_order_id OR NEW.credit_at_processing IS DISTINCT FROM OLD.credit_at_processing THEN
      RAISE EXCEPTION 'exchange.times: a step''s record is written with the step' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_exchanges_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.return_exchanges
  FOR EACH ROW EXECUTE FUNCTION commerce.return_exchanges_rules();
--> statement-breakpoint
CREATE TRIGGER return_exchanges_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.return_exchanges
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint

-- What the exchange's refunds of the return add up to: the transfers to the exchange order and the remainder refunded through the provider (not failed).
CREATE FUNCTION commerce.exchange_refunds_of(p_exchange uuid)
RETURNS TABLE (transfer_minor bigint, remainder_minor bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(rf.amount_minor) FILTER (WHERE rf.kind = 'transfer'), 0)::bigint,
         coalesce(sum(rf.amount_minor) FILTER (WHERE rf.kind = 'money' AND rf.status <> 'failed'), 0)::bigint
    FROM commerce.return_exchanges e
    JOIN commerce.refunds rf ON rf.store_id = e.store_id AND rf.exchange_id = e.id
    JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id AND p.order_id = e.order_id
   WHERE e.id = p_exchange
$$;
--> statement-breakpoint

-- What has moved to exchange orders from a return's credit (the transfers of its exchanges).
CREATE FUNCTION commerce.return_transferred(p_store uuid, p_return uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(rf.amount_minor), 0)::bigint
    FROM commerce.return_exchanges e
    JOIN commerce.refunds rf ON rf.store_id = e.store_id AND rf.exchange_id = e.id AND rf.kind = 'transfer'
   WHERE e.store_id = p_store AND e.return_id = p_return
$$;
--> statement-breakpoint

-- At commit, what an exchange's status says must hold: a proposal has replacements, and the exchange order's lines are exactly them; a settled exchange's
-- order is paid, its return ended `exchanged` with the credit as its refund, the transfer is min(C, T) and the transfer and the remainder add up to the
-- return's refund; an exchange that ended after it was processed left no live order.
CREATE FUNCTION commerce.return_exchanges_settled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  r commerce.returns%ROWTYPE;
  o commerce.orders%ROWTYPE;
  v_transfer bigint;
  v_remainder bigint;
BEGIN
  SELECT * INTO e FROM commerce.return_exchanges WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF e.status <> 'draft' AND e.status NOT IN ('declined_by_customer', 'cancelled', 'expired', 'superseded')
     AND NOT EXISTS (SELECT 1 FROM commerce.return_exchange_lines l WHERE l.exchange_id = e.id) THEN
    RAISE EXCEPTION 'exchange.no_lines: a proposal has at least one replacement' USING ERRCODE = 'check_violation';
  END IF;
  IF e.exchange_order_id IS NOT NULL THEN
    SELECT * INTO o FROM commerce.orders WHERE store_id = e.store_id AND id = e.exchange_order_id;
    -- The order's goods are the replacements, line for line (variant, units, price charged), as it was made.
    IF e.status IN ('processed', 'settled') AND EXISTS (
      (SELECT l.variant_id, l.quantity, l.unit_price_minor FROM commerce.return_exchange_lines l WHERE l.exchange_id = e.id
       EXCEPT ALL
       SELECT ol.variant_id, ol.quantity, ol.unit_price_minor FROM commerce.order_lines ol WHERE ol.store_id = o.store_id AND ol.order_id = o.id)
      UNION ALL
      (SELECT ol.variant_id, ol.quantity, ol.unit_price_minor FROM commerce.order_lines ol WHERE ol.store_id = o.store_id AND ol.order_id = o.id
       EXCEPT ALL
       SELECT l.variant_id, l.quantity, l.unit_price_minor FROM commerce.return_exchange_lines l WHERE l.exchange_id = e.id)
    ) AND o.edited_at IS NULL THEN
      RAISE EXCEPTION 'exchange.order_lines: the exchange order holds exactly the replacements' USING ERRCODE = 'check_violation';
    END IF;
    IF e.status IN ('declined_by_customer', 'cancelled', 'expired', 'superseded') AND o.status <> 'cancelled' THEN
      RAISE EXCEPTION 'exchange.order_live: an exchange that ended leaves its order cancelled' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF e.status = 'settled' THEN
    SELECT * INTO r FROM commerce.returns WHERE store_id = e.store_id AND id = e.return_id;
    IF o.status IN ('pending_payment', 'cancelled') THEN
      RAISE EXCEPTION 'exchange.not_paid: a settled exchange''s order is paid' USING ERRCODE = 'check_violation';
    END IF;
    IF r.outcome IS DISTINCT FROM 'exchanged' OR r.refund_minor IS DISTINCT FROM e.credit_at_processing THEN
      RAISE EXCEPTION 'exchange.return: a settled exchange''s return ends exchanged, with the credit as its refund' USING ERRCODE = 'check_violation';
    END IF;
    SELECT x.transfer_minor, x.remainder_minor INTO v_transfer, v_remainder FROM commerce.exchange_refunds_of(e.id) x;
    IF v_transfer <> least(e.credit_at_processing, o.total_minor) THEN
      RAISE EXCEPTION 'exchange.transfer: the credit moved to the order is the lesser of the credit and the order''s total (% is not %)', v_transfer,
        least(e.credit_at_processing, o.total_minor) USING ERRCODE = 'check_violation';
    END IF;
    IF v_transfer + v_remainder <> r.refund_minor THEN
      RAISE EXCEPTION 'exchange.refunds: the transfer and the remainder add up to the return''s refund (% + % is not %)', v_transfer, v_remainder, r.refund_minor
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER return_exchanges_settled AFTER INSERT OR UPDATE ON commerce.return_exchanges
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.return_exchanges_settled();
--> statement-breakpoint

-- A replacement is a physical goods variant of the exchange's own store, written while its exchange is a draft or in the transaction that proposes it, and
-- changed or removed only while the exchange is a draft.
CREATE FUNCTION commerce.return_exchange_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  v_delivery text;
BEGIN
  SELECT * INTO e FROM commerce.return_exchanges x WHERE x.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.exchange_id ELSE NEW.exchange_id END FOR NO KEY UPDATE;
  IF TG_OP = 'DELETE' THEN
    IF e.status <> 'draft' THEN
      RAISE EXCEPTION 'exchange_line.frozen: the replacements of a proposal are a record' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT FOUND OR e.store_id <> NEW.store_id THEN
    RAISE EXCEPTION 'exchange_line.exchange: a replacement belongs to an exchange of its own store' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (e.status <> 'draft' OR NEW.exchange_id <> OLD.exchange_id) THEN
    RAISE EXCEPTION 'exchange_line.frozen: the replacements of a proposal are a record' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT (e.status = 'draft' OR (e.status = 'proposed' AND e.created_at = now())) THEN
    RAISE EXCEPTION 'exchange_line.frozen: replacements are added to a draft, or with the proposal itself' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT v.delivery INTO v_delivery FROM commerce.product_variants v WHERE v.store_id = NEW.store_id AND v.id = NEW.variant_id;
  IF v_delivery IS DISTINCT FROM 'physical' THEN
    RAISE EXCEPTION 'exchange.not_goods: a replacement is goods that are shipped' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER return_exchange_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.return_exchange_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.return_exchange_lines_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The exchange order (3.3 point 3)
-- ---------------------------------------------------------------------------

-- An order made for an exchange is inserted by `insertOrder()` under the exchange context (`kaizen.exchange` = the exchange's id), while its exchange is
-- confirmed, in the original order's store, currency and market, waiting for payment; afterwards it keeps its exchange.
CREATE FUNCTION commerce.orders_exchange_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  o commerce.orders%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.exchange_id IS DISTINCT FROM OLD.exchange_id THEN
      RAISE EXCEPTION 'order_exchange.frozen: the exchange an order was made for is written with the order' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.exchange_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(current_setting('kaizen.exchange', true), '') <> NEW.exchange_id::text THEN
    RAISE EXCEPTION 'order_exchange.context: an exchange''s order is made only by processing that exchange' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO e FROM commerce.return_exchanges x WHERE x.store_id = NEW.store_id AND x.id = NEW.exchange_id;
  IF NOT FOUND OR e.status <> 'confirmed' THEN
    RAISE EXCEPTION 'order_exchange.state: an exchange''s order is made from a confirmed exchange' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO o FROM commerce.orders x WHERE x.store_id = e.store_id AND x.id = e.order_id;
  IF NEW.currency <> o.currency OR NEW.market_code <> o.market_code OR NEW.currency <> e.currency THEN
    RAISE EXCEPTION 'order_exchange.market: an exchange''s order is in the original order''s market and currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'pending_payment' OR NEW.host_id IS NOT NULL OR NEW.subscription_id IS NOT NULL OR NEW.copied_from IS NOT NULL THEN
    RAISE EXCEPTION 'order_exchange.kind: an exchange''s order is an ordinary order of the store''s own, waiting for payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_exchange_rules BEFORE INSERT OR UPDATE OF exchange_id ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_exchange_rules();
--> statement-breakpoint

-- While an exchange's order waits for payment and was never changed, a line added to it is one of the exchange's replacements (physical goods, the variant,
-- the units and the price charged); at commit the lines are exactly the replacements (`return_exchanges_settled()`).
CREATE FUNCTION commerce.order_lines_exchange_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  o commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM commerce.orders x WHERE x.store_id = NEW.store_id AND x.id = NEW.order_id;
  IF o.exchange_id IS NULL OR o.status <> 'pending_payment' OR o.edited_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.delivery <> 'physical' OR NEW.variant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM commerce.return_exchange_lines l
     WHERE l.store_id = NEW.store_id AND l.exchange_id = o.exchange_id AND l.variant_id = NEW.variant_id AND l.quantity = NEW.quantity
       AND l.unit_price_minor = NEW.unit_price_minor
  ) THEN
    RAISE EXCEPTION 'order_exchange.line: an exchange''s order holds its replacements only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_exchange_rules BEFORE INSERT ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_exchange_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The transfer (3.3 points 4 and 5)
-- ---------------------------------------------------------------------------

-- A refund of an exchange is of the original order's payment (the transfer, the remainder) or of the exchange order's (a payment that came too late). A
-- transfer is written under the exchange context, of a payment that is not itself a transfer's, and never changes afterwards; a refund keeps its exchange.
CREATE FUNCTION commerce.refunds_exchange_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  p commerce.payments%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.exchange_id IS DISTINCT FROM OLD.exchange_id OR NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'refund_exchange.frozen: a refund keeps its kind and its exchange' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.kind = 'transfer' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) AND current_setting('commerce.anonymising', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'refund_exchange.transfer_final: a transfer to an exchange order is a record' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.exchange_id IS NULL THEN
    IF NEW.kind = 'transfer' THEN
      RAISE EXCEPTION 'refund_exchange.transfer: a transfer names its exchange' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO e FROM commerce.return_exchanges x WHERE x.store_id = NEW.store_id AND x.id = NEW.exchange_id;
  SELECT * INTO p FROM commerce.payments x WHERE x.store_id = NEW.store_id AND x.id = NEW.payment_id;
  IF NOT FOUND OR (p.order_id <> e.order_id AND p.order_id IS DISTINCT FROM e.exchange_order_id) THEN
    RAISE EXCEPTION 'refund_exchange.order: an exchange''s refund is of its original order''s payment, or of its own order''s' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'transfer' THEN
    IF coalesce(current_setting('kaizen.exchange', true), '') <> NEW.exchange_id::text THEN
      RAISE EXCEPTION 'refund_exchange.context: a transfer is made only by settling its exchange' USING ERRCODE = 'restrict_violation';
    END IF;
    IF p.order_id <> e.order_id OR p.provider = 'exchange' OR p.status <> 'captured' THEN
      RAISE EXCEPTION 'refund_exchange.transfer: a transfer is of a captured payment of the original order' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_exchange_rules BEFORE INSERT OR UPDATE ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.refunds_exchange_rules();
--> statement-breakpoint

-- A payment of an exchange is on the exchange's order and keeps its exchange. An `exchange` payment (the transfer's other side) is written under the
-- exchange context, captured, in the currency and the test mode of the payment its transfer came from, and is a record afterwards.
CREATE FUNCTION commerce.payments_exchange_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  src commerce.payments%ROWTYPE;
  rf commerce.refunds%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.exchange_id IS DISTINCT FROM OLD.exchange_id OR NEW.transfer_refund_id IS DISTINCT FROM OLD.transfer_refund_id THEN
      RAISE EXCEPTION 'payment_exchange.frozen: a payment keeps its exchange and its transfer' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.provider = 'exchange' AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'payment_exchange.final: the credit moved to an exchange order is a record' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.exchange_id IS NULL THEN
    IF NEW.provider = 'exchange' THEN
      RAISE EXCEPTION 'payment_exchange.transfer: an exchange payment names its exchange' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO e FROM commerce.return_exchanges x WHERE x.store_id = NEW.store_id AND x.id = NEW.exchange_id;
  IF NOT FOUND OR e.exchange_order_id IS DISTINCT FROM NEW.order_id THEN
    RAISE EXCEPTION 'payment_exchange.order: an exchange''s payment is on the order made for it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.provider = 'exchange' THEN
    IF coalesce(current_setting('kaizen.exchange', true), '') <> NEW.exchange_id::text THEN
      RAISE EXCEPTION 'payment_exchange.context: an exchange payment is made only by settling its exchange' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO rf FROM commerce.refunds x WHERE x.store_id = NEW.store_id AND x.id = NEW.transfer_refund_id;
    IF NOT FOUND OR rf.kind <> 'transfer' OR rf.exchange_id <> NEW.exchange_id THEN
      RAISE EXCEPTION 'payment_exchange.transfer: an exchange payment is paid from a transfer of the same exchange' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO src FROM commerce.payments x WHERE x.store_id = NEW.store_id AND x.id = rf.payment_id;
    IF NEW.status <> 'captured' OR NEW.currency <> src.currency OR NEW.amount_minor <> rf.amount_minor THEN
      RAISE EXCEPTION 'payment_exchange.transfer: an exchange payment is captured, in the transfer''s currency and amount' USING ERRCODE = 'check_violation';
    END IF;
    NEW.provider_account := NULL;
    NEW.kaizen_fee_minor := 0;
    -- A test order's credit stays a test: its exchange order gets no legal invoice number either.
    NEW.test_mode := src.test_mode OR (src.provider_account IS NOT NULL AND EXISTS (
      SELECT 1 FROM commerce.connected_accounts a WHERE a.store_id = src.store_id AND a.account_id = src.provider_account AND a.mode = 'test'));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_exchange_rules BEFORE INSERT OR UPDATE ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.payments_exchange_rules();
--> statement-breakpoint

-- At commit: every transfer has exactly one `exchange` payment of the same amount on the exchange's order, and every such payment its transfer.
CREATE FUNCTION commerce.exchange_transfers_paired()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_refund uuid;
  v_n integer;
BEGIN
  IF TG_TABLE_NAME = 'refunds' THEN
    v_refund := NEW.id;
  ELSE
    v_refund := NEW.transfer_refund_id;
  END IF;
  IF v_refund IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n
    FROM commerce.refunds rf
    JOIN commerce.return_exchanges e ON e.store_id = rf.store_id AND e.id = rf.exchange_id
    JOIN commerce.payments p ON p.store_id = rf.store_id AND p.transfer_refund_id = rf.id
   WHERE rf.id = v_refund AND rf.kind = 'transfer' AND p.provider = 'exchange' AND p.exchange_id = rf.exchange_id
     AND p.order_id = e.exchange_order_id AND p.amount_minor = rf.amount_minor;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'exchange.transfer_unpaired: a transfer and its exchange payment are written together, equal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refunds_transfer_paired AFTER INSERT ON commerce.refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind = 'transfer') EXECUTE FUNCTION commerce.exchange_transfers_paired();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_transfer_paired AFTER INSERT ON commerce.payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.provider = 'exchange') EXECUTE FUNCTION commerce.exchange_transfers_paired();
--> statement-breakpoint

-- The refunds of a payment taken outside Kaizen, of an `exchange` payment, and of a payment part of which was moved to an exchange order never exceed it
-- (a later goodwill refund of the original cannot take the money the exchange order rests on).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.refunds_manual_cap()'::regprocedure);
  IF position('-- Exchanges (D239)' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, E'  IF v_provider IS DISTINCT FROM ''manual'' THEN RETURN NEW; END IF;', $block$  -- Exchanges (D239): an exchange payment, and a payment that carries a transfer, are capped as well.
  IF v_provider IS DISTINCT FROM 'manual' AND v_provider IS DISTINCT FROM 'exchange' AND NEW.kind <> 'transfer' AND NOT EXISTS (
    SELECT 1 FROM commerce.refunds t WHERE t.store_id = NEW.store_id AND t.payment_id = NEW.payment_id AND t.kind = 'transfer'
  ) THEN RETURN NEW; END IF;$block$);
  IF v_new = v_def THEN RAISE EXCEPTION 'refunds_manual_cap: the provider test was not found, so exchange refunds would not be capped'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Returns learn exchanges and labels (3.3 points 1, 4, 9)
-- ---------------------------------------------------------------------------

DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.returns_rules()'::regprocedure);
  IF position('-- Exchanges (D239)' in v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  -- The anonymising blanks the wish too (and a pasted label's source goes with its address).
  v_step := replace(v_new,
    $a$ARRAY['reason_note', 'decision_note', 'staff_note', 'refund_note', 'label_url', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reason_note', 'decision_note', 'staff_note', 'refund_note', 'label_url', 'updated_at'])$a$,
    $b$ARRAY['reason_note', 'decision_note', 'staff_note', 'refund_note', 'label_url', 'label_source', 'exchange_wish_note', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reason_note', 'decision_note', 'staff_note', 'refund_note', 'label_url', 'label_source', 'exchange_wish_note', 'updated_at'])$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'returns_rules: the anonymising list was not found'; END IF;
  v_new := v_step;

  -- A closed return may be exchanged (its refund is the credit, which may be 0).
  v_step := replace(v_new,
    $a$      IF NEW.outcome NOT IN ('refunded', 'no_refund') OR (NEW.outcome = 'refunded') <> (coalesce(NEW.refund_minor, 0) > 0) THEN$a$,
    $b$      IF NEW.outcome NOT IN ('refunded', 'no_refund', 'exchanged') OR (NEW.outcome = 'exchanged' AND NEW.refund_minor IS NULL)
         OR (NEW.outcome = 'refunded') <> (coalesce(NEW.refund_minor, 0) > 0 AND NEW.outcome <> 'exchanged') THEN$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'returns_rules: the closing outcome test was not found'; END IF;
  v_new := v_step;

  -- An exchange settles a return that has not ended: the outcome is written with its refund, under that exchange's context.
  v_step := replace(v_new,
    $a$  ELSIF NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'return_outcome: the outcome is set when the return ends' USING ERRCODE = 'check_violation';
  END IF;$a$,
    $b$  ELSIF NEW.outcome IS DISTINCT FROM OLD.outcome AND NOT (OLD.outcome IS NULL AND NEW.outcome = 'exchanged') THEN
    RAISE EXCEPTION 'return_outcome: the outcome is set when the return ends' USING ERRCODE = 'check_violation';
  END IF;
  -- Exchanges (D239): a return ends exchanged only by settling one of its exchanges, with its refund recorded in the same step.
  IF NEW.outcome = 'exchanged' AND OLD.outcome IS DISTINCT FROM 'exchanged' AND (
       NEW.refund_minor IS NULL OR NOT EXISTS (
         SELECT 1 FROM commerce.return_exchanges x
          WHERE x.store_id = NEW.store_id AND x.return_id = NEW.id AND x.id::text = coalesce(current_setting('kaizen.exchange', true), '')
            AND x.status IN ('processed', 'settled'))) THEN
    RAISE EXCEPTION 'return_outcome: a return is exchanged only by settling its exchange' USING ERRCODE = 'check_violation';
  END IF;
  -- While an exchange of the return is processed (its order made, its stock held), the return's refund is recorded only by that exchange.
  IF NEW.refund_minor IS DISTINCT FROM OLD.refund_minor AND EXISTS (
       SELECT 1 FROM commerce.return_exchanges x
        WHERE x.store_id = NEW.store_id AND x.return_id = NEW.id AND x.status = 'processed'
          AND x.id::text IS DISTINCT FROM coalesce(current_setting('kaizen.exchange', true), '')) THEN
    RAISE EXCEPTION 'return_exchange_pending: an exchange of this return is being processed; settle or cancel it first' USING ERRCODE = 'check_violation';
  END IF;
  -- A booked label is written while the return is approved or in transit (the job's tries are counted any time it is open).
  IF (NEW.label_carrier_id IS DISTINCT FROM OLD.label_carrier_id OR NEW.label_service IS DISTINCT FROM OLD.label_service
      OR NEW.label_consignment_number IS DISTINCT FROM OLD.label_consignment_number OR NEW.label_tracking_number IS DISTINCT FROM OLD.label_tracking_number
      OR NEW.label_tracking_url IS DISTINCT FROM OLD.label_tracking_url OR NEW.label_carrier_url IS DISTINCT FROM OLD.label_carrier_url
      OR NEW.label_cost_minor IS DISTINCT FROM OLD.label_cost_minor OR NEW.label_cost_carrier IS DISTINCT FROM OLD.label_cost_carrier
      OR NEW.label_test IS DISTINCT FROM OLD.label_test OR NEW.label_booked_at IS DISTINCT FROM OLD.label_booked_at
      OR ((NEW.label_source IS NOT DISTINCT FROM 'carrier') <> (OLD.label_source IS NOT DISTINCT FROM 'carrier')))
     AND v_new NOT IN ('approved', 'in_transit') THEN
    RAISE EXCEPTION 'return_label_state: a return label is booked while the return is approved or on its way' USING ERRCODE = 'check_violation';
  END IF;
  -- The customer's exchange wish is kept as it was made.
  IF OLD.exchange_wish_at IS NOT NULL AND (NEW.exchange_wish_at IS DISTINCT FROM OLD.exchange_wish_at OR NEW.exchange_wish_note IS DISTINCT FROM OLD.exchange_wish_note) THEN
    RAISE EXCEPTION 'return_exchange_wish: the customer''s wish is kept as it was made' USING ERRCODE = 'restrict_violation';
  END IF;$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'returns_rules: the outcome guard was not found'; END IF;
  v_new := v_step;

  -- The remainder's refund of an exchange is the return's refund less what moved to the exchange order.
  v_step := replace(v_new,
    $a$      IF NOT FOUND OR v_refund.amount_minor <> NEW.refund_minor THEN$a$,
    $b$      IF NOT FOUND OR v_refund.amount_minor <> NEW.refund_minor - commerce.return_transferred(NEW.store_id, NEW.id) THEN$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'returns_rules: the refund match was not found'; END IF;
  v_new := v_step;

  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The labels pasted before this (after the return rules learnt that the anonymising may set a pasted label's source).
-- The back-fill runs with the anonymising flag on, so the return rules let a return that has ended take the source its label already had.
DO $backfill$
BEGIN
  PERFORM set_config('commerce.anonymising', 'on', true);
  UPDATE commerce.returns SET label_source = 'pasted' WHERE label_url IS NOT NULL AND label_source IS NULL;
  PERFORM set_config('commerce.anonymising', '', true);
END;
$backfill$;
--> statement-breakpoint
ALTER TABLE commerce.returns ADD CONSTRAINT returns_label_pasted CHECK ((label_source IS NOT DISTINCT FROM 'pasted') = (label_url IS NOT NULL));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Documents (3.3 point 6)
-- ---------------------------------------------------------------------------

-- (a) An exchange's own refunds of the original order (the transfer, the remainder) get no credit note: the return's `return_exchange` note covers them, and
-- the order says so once. (b) An exchanged return gets one credit note for its whole credit, from its working, as a return refunded outside does.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.make_credit_note(uuid, uuid, uuid)'::regprocedure);
  IF position('-- Exchanges (D239)' in v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;

  v_step := replace(v_new,
    $a$    IF NOT FOUND OR NOT v_ret.refund_outside OR coalesce(v_ret.refund_minor, 0) <= 0 OR v_ret.refund_id IS NOT NULL THEN RETURN NULL; END IF;
    v_have_ret := true;
    v_order_id := v_ret.order_id;
    v_source := 'return_outside';$a$,
    $b$    -- Exchanges (D239): an exchanged return is credited in full by a note of its own (its refunds get none).
    IF NOT FOUND OR coalesce(v_ret.refund_minor, 0) <= 0
       OR NOT (v_ret.outcome = 'exchanged' OR (v_ret.refund_outside AND v_ret.refund_id IS NULL)) THEN RETURN NULL; END IF;
    v_have_ret := true;
    v_order_id := v_ret.order_id;
    v_source := CASE WHEN v_ret.outcome = 'exchanged' THEN 'return_exchange' ELSE 'return_outside' END;$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'make_credit_note: the return branch was not found'; END IF;
  v_new := v_step;

  v_step := replace(v_new,
    $a$SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = 'return_outside';$a$,
    $b$SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = v_source;$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'make_credit_note: the return note lookup was not found'; END IF;
  v_new := v_step;

  v_step := replace(v_new,
    $a$  -- A refund of a payment that is not on the invoice (a no-show fee charged afterwards, D65) reverses no sale: no credit note, and the order says so.$a$,
    $b$  -- An exchange's own refund of the original order (the transfer to the exchange order, or the remainder through the provider, D239) is credited by the
  -- return's `return_exchange` note: none of its own, and the order says so once. A refund of the exchange order's payment is an ordinary refund of that order.
  IF p_refund IS NOT NULL AND v_refund.exchange_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.return_exchanges x WHERE x.store_id = p_store AND x.id = v_refund.exchange_id AND x.order_id = v_order_id
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.covered_by_exchange' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.covered_by_exchange', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'exchange', v_refund.exchange_id), 'system');
    END IF;
    RETURN NULL;
  END IF;
  -- A refund of a payment that is not on the invoice (a no-show fee charged afterwards, D65) reverses no sale: no credit note, and the order says so.$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'make_credit_note: the no-show anchor was not found'; END IF;
  v_new := v_step;

  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
-- The documents' insert guard lets the return's own credit note of an exchanged return in (it was refunded neither outside nor by one refund of its own).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.document_insert_guard()'::regprocedure);
  IF position('return_exchange' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$SELECT 1 FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.id = NEW.return_id AND r.order_id = v_order AND r.refund_outside
  ) THEN$a$,
    $b$SELECT 1 FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.id = NEW.return_id AND r.order_id = v_order
       AND ((NEW.source <> 'return_exchange' AND r.refund_outside) OR (NEW.source = 'return_exchange' AND r.outcome = 'exchanged'))
  ) THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'document_insert_guard: the return test was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER returns_exchange_credit_note AFTER UPDATE OF outcome ON commerce.returns
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.outcome = 'exchanged' AND OLD.outcome IS DISTINCT FROM 'exchanged')
  EXECUTE FUNCTION commerce.returns_issue_credit_note();
--> statement-breakpoint

-- The job that issues missing credit notes knows both (an exchanged return's note; an exchange's refunds covered by it).
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.issue_missing_credit_notes(uuid)'::regprocedure);
  IF position('credit_note.covered_by_exchange' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$'credit_note.covered_by_edit')$a$, $b$'credit_note.covered_by_edit', 'credit_note.covered_by_exchange')$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'issue_missing_credit_notes: the covered list was not found'; END IF;
  v_step := replace(v_new,
    $a$       WHERE rt.store_id = p_store AND rt.refund_outside AND rt.refund_id IS NULL AND coalesce(rt.refund_minor, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rt.store_id AND c.return_id = rt.id AND c.source = 'return_outside')$a$,
    $b$       WHERE rt.store_id = p_store AND ((rt.refund_outside AND rt.refund_id IS NULL) OR rt.outcome = 'exchanged') AND coalesce(rt.refund_minor, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rt.store_id AND c.return_id = rt.id AND c.source IN ('return_outside', 'return_exchange'))$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'issue_missing_credit_notes: the returns part was not found'; END IF;
  EXECUTE v_step;
END;
$patch$;
--> statement-breakpoint

-- (d) The exchange order's invoice names the credit of the return as a payment of its own (`settled_by_return`), beside what was paid online or outside.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_step text;
BEGIN
  v_def := pg_get_functiondef('commerce.build_invoice_snapshot(uuid, date, date)'::regprocedure);
  IF position('settled_by_return' in v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_step := replace(v_new, E'  v_payments jsonb;\n', E'  v_payments jsonb;\n  v_settled bigint := 0;\n  v_settled_from jsonb := NULL;\n');
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the declarations were not found'; END IF;
  v_new := v_step;

  v_step := replace(v_new,
    $a$  v_online := o.total_minor - o.balance_minor;
  SELECT p.provider INTO v_provider FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider <> 'venue' AND p.status NOT IN ('failed', 'cancelled')$a$,
    $b$  v_online := o.total_minor - o.balance_minor;
  -- Exchanges (D239): the part paid with the credit of a return, named by the return and its order; the rest is paid online or outside.
  SELECT coalesce(sum(p.amount_minor), 0) INTO v_settled FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider = 'exchange' AND p.status NOT IN ('failed', 'cancelled');
  IF v_settled > 0 THEN
    SELECT jsonb_build_object('returnNumber', rt.number, 'orderNumber', oo.number) INTO v_settled_from
      FROM commerce.return_exchanges x
      JOIN commerce.returns rt ON rt.store_id = x.store_id AND rt.id = x.return_id
      JOIN commerce.orders oo ON oo.store_id = x.store_id AND oo.id = x.order_id
     WHERE x.store_id = o.store_id AND x.id = o.exchange_id;
    v_online := v_online - v_settled;
  END IF;
  SELECT p.provider INTO v_provider FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.provider NOT IN ('venue', 'exchange') AND p.status NOT IN ('failed', 'cancelled')$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the payment section was not found'; END IF;
  v_new := v_step;

  v_step := replace(v_new,
    $a$  SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO v_payments FROM ($a$,
    $b$  SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO v_payments FROM (
    SELECT 0 AS ord, jsonb_build_object('kind', 'settled_by_return', 'amountMinor', v_settled, 'provider', 'exchange',
      'returnNumber', v_settled_from ->> 'returnNumber', 'orderNumber', v_settled_from ->> 'orderNumber') AS x WHERE v_settled > 0
    UNION ALL$b$);
  IF v_step = v_new THEN RAISE EXCEPTION 'build_invoice_snapshot: the payments list was not found'; END IF;
  v_new := v_step;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- An exchange payment of an order paid in Stripe's test mode is a test too (its mode is frozen on the row by `payments_exchange_rules()`).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.invoice_eligibility(uuid)'::regprocedure);
  IF position($m$p.provider IN ('venue', 'exchange')$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$OR (p.provider = 'venue' AND p.test_mode))$a$, $b$OR (p.provider IN ('venue', 'exchange') AND p.test_mode))$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'invoice_eligibility: the venue test was not found'; END IF;
  v_new := replace(v_new, $a$AND ((p.provider <> 'venue' AND p.provider_account$a$, $b$AND ((p.provider NOT IN ('venue', 'exchange') AND p.provider_account$b$);
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Completing the exchange order (3.3 point 7)
-- ---------------------------------------------------------------------------

-- Pays the exchange order as any order is paid (`complete_order_payment()`: its stock drawn from its holds, the invoice issued) once its captured payments
-- (the transfer, and the difference paid online or outside) add up to its total, and settles the exchange. Settling twice does nothing (false).
CREATE FUNCTION commerce.complete_exchange_order(p_exchange uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.return_exchanges%ROWTYPE;
  o commerce.orders%ROWTYPE;
  v_paid bigint;
BEGIN
  SELECT * INTO e FROM commerce.return_exchanges WHERE id = p_exchange FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exchange.unknown: no exchange %', p_exchange USING ERRCODE = 'no_data_found'; END IF;
  IF e.status = 'settled' THEN RETURN false; END IF;
  IF e.status <> 'processed' THEN
    RAISE EXCEPTION 'exchange.lifecycle: only a processed exchange is settled (it is %)', e.status USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(current_setting('kaizen.exchange', true), '') <> e.id::text THEN
    RAISE EXCEPTION 'exchange.context: an exchange is settled under its own context' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO o FROM commerce.orders WHERE store_id = e.store_id AND id = e.exchange_order_id FOR UPDATE;
  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM commerce.payments p
   WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.status = 'captured';
  IF v_paid <> o.total_minor THEN
    RAISE EXCEPTION 'exchange.underpaid: the exchange order''s payments (%) are not its total (%)', v_paid, o.total_minor USING ERRCODE = 'check_violation';
  END IF;
  PERFORM commerce.complete_order_payment(o.id, 'exchange:' || e.id::text);
  UPDATE commerce.return_exchanges SET status = 'settled' WHERE id = e.id;
  RETURN true;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Store copies, the anonymising and referrals
-- ---------------------------------------------------------------------------

-- A new store and a copy keep the choice to offer exchanges; never the label carrier or service (a carrier agreement is not copied), so never `label_auto`.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('b2b_returns, exchanges, updated_by' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$    b2b_returns, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, instructions_translations, return_address,
         b2b_returns, p_owner_id$a$,
    $b$    b2b_returns, exchanges, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, instructions_translations, return_address,
         b2b_returns, exchanges, p_owner_id$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the return settings copy was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('b2b_returns, exchanges, updated_by' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$    b2b_returns, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, instructions_translations, return_address,
         b2b_returns, p_owner$a$,
    $b$    b2b_returns, exchanges, updated_by
  )
  SELECT v_store, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, instructions_translations, return_address,
         b2b_returns, exchanges, p_owner$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the return settings copy was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The anonymising blanks the customer's exchange wish and replaces an exchange's delivery address with the marker the order's own address gets.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  IF position('exchange_wish_note' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$    label_url = NULL
   WHERE store_id = p_store AND order_id = p_order;$a$,
    $b$    label_url = NULL,
    exchange_wish_note = CASE WHEN coalesce(exchange_wish_note, '') = '' THEN exchange_wish_note ELSE '[removed]' END
   WHERE store_id = p_store AND order_id = p_order;
  -- Exchanges (D239): the new order's delivery address, kept on the exchange of either order.
  UPDATE commerce.return_exchanges SET delivery_address = '{}'::jsonb
   WHERE store_id = p_store AND (order_id = p_order OR exchange_order_id = p_order) AND delivery_address <> '{}'::jsonb;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'anonymise_order: the returns step was not found, so the exchange wish would be kept'; END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- An exchange order is never a referred friend's order (it is a purchase made with a return's credit, not a new customer's first order).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.affiliate_attribute_order(uuid, text, bigint)'::regprocedure);
  IF position($m$v_o.source = 'exchange'$m$ in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, $a$OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL THEN$a$,
                          $b$OR v_o.copied_from IS NOT NULL OR v_o.host_id IS NOT NULL OR v_o.source = 'exchange' THEN$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'affiliate_attribute_order: the guard was not found'; END IF;
  EXECUTE v_new;
END;
$patch$;
