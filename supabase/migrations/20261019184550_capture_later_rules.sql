-- Authorise now, capture later (wave 4 unit B, D289, docs/wave-4-payments.md 4): the rules the database holds. The columns, the setting and the
-- new order status `authorized` are in the migration before this one (an enum value cannot be used in the transaction that adds it).
--
-- * `authorized` is between `pending_payment` and `paid`: the card is held, nothing is a sale. Only `authorize_order_payment()` puts an order there
--   (an order checked out under a later capture, `capture_mode`, with the deadline Stripe gave): its stock stays held until the deadline and a day,
--   its cart is converted, and its Stripe payment is `authorized`.
-- * `complete_order_payment()` (the capture) and `cancel_unpaid_order()` (a void, an expiry, a cancel) take an authorized order as they take one
--   waiting for payment; everything that follows a payment (the bonus program, referrals, staff alerts and rules, integrations) follows it from
--   `authorized` too, and a cancelled authorisation gives back what an unpaid order gives back.
--
-- No function here contains DELETE, TRUNCATE or DROP.

CREATE INDEX "orders_authorized_idx" ON "commerce"."orders" USING btree ("capture_before") WHERE "commerce"."orders"."status" = 'authorized';
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_capture_before" CHECK ("commerce"."orders"."status" <> 'authorized' or ("commerce"."orders"."capture_mode" is not null and "commerce"."orders"."capture_before" is not null));
--> statement-breakpoint

CREATE FUNCTION commerce.authorize_order_payment(p_order_id uuid, p_reference text, p_capture_before timestamptz)
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
  -- Applied twice (the webhook and the shopper's return), or cancelled meanwhile: nothing more. The caller voids a hold on a cancelled order.
  IF v_order.status <> 'pending_payment' THEN
    RETURN false;
  END IF;
  IF v_order.capture_mode IS NULL OR v_order.copied_from IS NOT NULL THEN
    RAISE EXCEPTION 'orders.not_capture_later: order % was not checked out to be captured later', p_order_id USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.orders SET status = 'authorized', capture_before = p_capture_before WHERE id = p_order_id;
  -- The stock stays held until Stripe lets the hold go, and a day for the job to see it.
  UPDATE commerce.inventory_reservations SET expires_at = greatest(expires_at, p_capture_before + interval '1 day')
   WHERE order_id = p_order_id AND released_at IS NULL;
  UPDATE commerce.payments SET status = 'authorized', updated_at = now()
   WHERE store_id = v_order.store_id AND order_id = p_order_id AND provider = 'stripe' AND provider_reference = p_reference AND status = 'pending';
  UPDATE commerce.carts SET status = 'converted', updated_at = now()
   WHERE store_id = v_order.store_id AND id = v_order.cart_id;
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.authorized',
          jsonb_build_object('reference', p_reference, 'capture_before', p_capture_before, 'mode', v_order.capture_mode), 'stripe');
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.complete_order_payment(p_order_id uuid, p_reference text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order commerce.orders%ROWTYPE;
  v_line record;
  v_hold record;
  v_level record;
  v_left integer;
  v_take integer;
  v_have integer;
  v_short integer := 0;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown order %', p_order_id;
  END IF;
  IF v_order.status NOT IN ('pending_payment', 'authorized', 'cancelled') THEN
    RETURN false;
  END IF;

  v_short := commerce.draw_order_stock(p_order_id);

  UPDATE commerce.inventory_reservations SET released_at = now()
   WHERE order_id = p_order_id AND released_at IS NULL;

  UPDATE commerce.orders SET status = 'paid' WHERE id = p_order_id;

  -- Digital lines: a download link per file, with the product's limits.
  INSERT INTO commerce.order_downloads (store_id, order_id, file_id, token, max_downloads, expires_at)
  SELECT DISTINCT ON (f.id)
         v_order.store_id, p_order_id, f.id,
         replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         p.download_limit,
         CASE WHEN p.download_days IS NULL THEN NULL
              ELSE now() + make_interval(days => p.download_days) END
    FROM commerce.order_lines ol
    JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
    JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
    JOIN commerce.product_files f
      ON f.store_id = p.store_id AND f.product_id = p.id AND f.removed_at IS NULL
     AND (f.variant_id IS NULL OR f.variant_id = v.id)
   WHERE ol.order_id = p_order_id AND ol.delivery = 'digital'
   ORDER BY f.id
  ON CONFLICT (order_id, file_id) DO NOTHING;
  UPDATE commerce.carts SET status = 'converted', updated_at = now()
   WHERE store_id = v_order.store_id AND id = v_order.cart_id;

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.paid',
          jsonb_build_object('reference', p_reference, 'was', v_order.status), 'stripe');
  IF v_short > 0 THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (v_order.store_id, p_order_id, 'stock.short',
            jsonb_build_object('missing', v_short), 'system');
  END IF;
  -- The invoice (D159): numbered and frozen in this transaction; an invoice that cannot be made yet waits, and never stops the payment.
  PERFORM commerce.issue_order_invoice(v_order.store_id, p_order_id);
  RETURN true;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.cancel_unpaid_order(p_order_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('pending_payment', 'authorized') THEN
    RETURN false;
  END IF;
  UPDATE commerce.inventory_reservations SET released_at = now()
   WHERE order_id = p_order_id AND released_at IS NULL;
  UPDATE commerce.orders SET status = 'cancelled' WHERE id = p_order_id;
  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (v_order.store_id, p_order_id, 'order.cancelled', jsonb_build_object('reason', p_reason), 'system');
  RETURN true;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.integration_order_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Paid: at checkout (from waiting for payment), or a subscription's renewal made paid.
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IN ('pending_payment', 'authorized')) THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.paid', NEW.id);
  -- Cancelled after it was paid (an unpaid checkout that lapses is no news).
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'order.cancelled', NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.orders_affiliate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IN ('pending_payment', 'authorized', 'cancelled') THEN
    PERFORM commerce.affiliate_order_paid(NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.affiliate_order_paid_cancelled(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.orders_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'paid' AND OLD.status IN ('pending_payment', 'authorized', 'cancelled') THEN
    PERFORM commerce.bonus_order_paid(NEW.id, OLD.status::text);
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('pending_payment', 'authorized') THEN
    PERFORM commerce.bonus_order_unpaid_cancelled(NEW.id);
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('paid', 'fulfilled') THEN
    PERFORM commerce.bonus_order_paid_cancelled(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.store_event_order_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.copied_from IS NOT NULL OR NEW.status <> 'paid' THEN
    RETURN NULL;
  END IF;
  -- From either state complete_order_payment() accepts: waiting for payment, or cancelled for want of it (a hold that ran out before the
  -- shopper's session completed). The once key keeps a second payment from queuing it again.
  IF TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status NOT IN ('pending_payment', 'authorized', 'cancelled')) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND (s.is_template OR s.starter)) THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.queue_store_event(NEW.store_id, 'order.paid', NEW.id);
  RETURN NULL;
END;
$function$;
