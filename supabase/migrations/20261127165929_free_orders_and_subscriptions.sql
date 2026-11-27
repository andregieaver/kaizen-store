-- Free orders and subscriptions (D913): nothing reaches a payment provider.
--
-- 1. A free order's payment record (provider `free`, the order page's key, amount 0) is marked test or live as a venue's or a gift card's is.
-- 2. A free subscription (provider `none`, written so by placeOrder()) is switched on when its order is paid, however it was paid: by nothing (the
--    order cost nothing), or through Stripe or Mollie when the cart held goods beside it. Stripe never hears of it, so no webhook does this.
CREATE OR REPLACE FUNCTION commerce.payments_venue_mode() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.provider IN ('venue', 'terms', 'gift_card', 'free') THEN
    NEW.test_mode := EXISTS (
      SELECT 1 FROM commerce.payment_providers pp WHERE pp.store_id = NEW.store_id AND pp.provider = 'stripe' AND pp.active_mode = 'test');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION commerce.activate_free_subscription() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE commerce.subscriptions s
     SET status = 'active', email = NEW.email, shipping_address = NEW.shipping_address, customer_id = coalesce(s.customer_id, NEW.customer_id),
         updated_at = now()
   WHERE s.store_id = NEW.store_id AND s.id = NEW.subscription_id AND s.provider = 'none' AND s.status = 'pending';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_free_subscription AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.subscription_id IS NOT NULL)
  EXECUTE FUNCTION commerce.activate_free_subscription();
