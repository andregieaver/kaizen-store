-- Payment methods per country (wave 4 unit D, D291, docs/wave-4-payments.md 6).
--
-- A bank method whose money arrives days later (SEPA Direct Debit): the shopper finished at Stripe, the payment is processing, and the order waits
-- for the bank. It stays `pending_payment` (nothing is a sale before the money arrives), and its stock and booked times are held until the bank
-- can answer, so what was bought is not sold to another meanwhile. `checkout.session.async_payment_succeeded` completes it as any paid order;
-- `async_payment_failed` cancels it and lets the stock go (`cancel_unpaid_order()`).
CREATE FUNCTION commerce.await_bank_payment(p_order_id uuid, p_reference text, p_until timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown order %', p_order_id;
  END IF;
  -- Paid or cancelled meanwhile, or already waiting (the webhook and the shopper's return both apply it): nothing more.
  IF v_order.status <> 'pending_payment' OR v_order.awaiting_bank_since IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_order.copied_from IS NOT NULL THEN
    RAISE EXCEPTION 'orders.copied: a copied order is history and is never paid' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.orders SET awaiting_bank_since = now() WHERE id = p_order_id;
  UPDATE commerce.inventory_reservations SET expires_at = greatest(expires_at, p_until)
   WHERE order_id = p_order_id AND released_at IS NULL;
  UPDATE commerce.bookings SET hold_expires_at = greatest(hold_expires_at, p_until)
   WHERE store_id = v_order.store_id AND order_id = p_order_id AND status = 'held' AND hold_expires_at IS NOT NULL;
  UPDATE commerce.carts SET status = 'converted', updated_at = now()
   WHERE store_id = v_order.store_id AND id = v_order.cart_id;
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.awaiting_bank', jsonb_build_object('reference', p_reference, 'until', p_until), 'stripe');
  RETURN true;
END;
$$;
