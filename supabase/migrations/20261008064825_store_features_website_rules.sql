-- Store features, step 5 (D178, docs/store-features.md 4e): the online shop's master switch. With `shop` off the store is a website:
-- * nothing is offered to shoppers (the application's `OFFERED` asks `feature_on(store, 'shop')` with every shopper-facing product read, so
--   the cart marks its lines unavailable and `placeOrder()` refuses), and
-- * the database takes no new order in it, whoever asks (`orders_store_open()`, reason `orders.shop_off`): a checkout from a stale page, a
--   draft order sent, a renewal. Switching the shop off waits while subscriptions, subscription box lists or bookings run (its blockers),
--   so no renewal or box is due. A copied order (D129) is history and still copies; orders already placed keep being paid, refunded,
--   withdrawn from and returned.
-- Nothing is deleted. No DELETE anywhere.

CREATE OR REPLACE FUNCTION commerce.orders_store_open()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A store template (D175) takes no order of any kind, not even a copied one: it is a preview.
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.starter) THEN
    RAISE EXCEPTION 'orders.store_starter: a store template takes no orders' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT commerce.store_is_active(NEW.store_id) THEN
    RAISE EXCEPTION 'orders.store_not_open: the store is not open for sale' USING ERRCODE = 'check_violation';
  END IF;
  -- A website (D178 step 5: the online shop off) sells nothing.
  IF NOT commerce.feature_on(NEW.store_id, 'shop') THEN
    RAISE EXCEPTION 'orders.shop_off: the store''s online shop is switched off' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
