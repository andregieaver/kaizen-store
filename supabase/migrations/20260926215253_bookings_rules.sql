-- Bookings (D65). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.booking_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.appointment_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.product_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Books a time with a resource, if it has room then: fewer overlapping live
-- bookings (confirmed, or held and not expired) than its capacity, counting
-- each booking's buffers. The resource's row is locked first, so two
-- shoppers cannot both take its last place. Returns the booking, or null.
CREATE OR REPLACE FUNCTION commerce.hold_booking(
  p_store_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_from timestamptz,
  p_blocked_to timestamptz,
  p_hold_until timestamptz,
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_capacity integer;
  v_taken integer;
  v_id uuid;
BEGIN
  SELECT capacity INTO v_capacity FROM commerce.booking_resources
   WHERE store_id = p_store_id AND id = p_resource_id AND active
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_taken FROM commerce.bookings b
   WHERE b.store_id = p_store_id AND b.resource_id = p_resource_id
     AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
     AND b.blocked_from < p_blocked_to AND b.blocked_to > p_blocked_from;
  IF v_taken >= v_capacity THEN
    RETURN NULL;
  END IF;
  INSERT INTO commerce.bookings (
    store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to,
    status, hold_expires_at, order_id
  ) VALUES (
    p_store_id, p_product_id, p_variant_id, p_resource_id, p_starts_at, p_ends_at, p_blocked_from, p_blocked_to,
    'held', p_hold_until, p_order_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- An order's bookings follow it: paid confirms them, cancelled releases them.
CREATE OR REPLACE FUNCTION commerce.order_bookings_follow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_capacity integer;
  v_taken integer;
BEGIN
  IF NEW.status = 'paid' THEN
    UPDATE commerce.bookings
       SET status = 'confirmed', hold_expires_at = NULL, cancelled_at = NULL, updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status = 'held';
    -- Paid after the order was given up: each time comes back if it is still free.
    FOR v_booking IN
      SELECT b.* FROM commerce.bookings b
       WHERE b.store_id = NEW.store_id AND b.order_id = NEW.id AND b.status = 'cancelled'
    LOOP
      SELECT r.capacity INTO v_capacity FROM commerce.booking_resources r
       WHERE r.store_id = NEW.store_id AND r.id = v_booking.resource_id FOR UPDATE;
      SELECT count(*) INTO v_taken FROM commerce.bookings b
       WHERE b.store_id = NEW.store_id AND b.resource_id = v_booking.resource_id AND b.id <> v_booking.id
         AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
         AND b.blocked_from < v_booking.blocked_to AND b.blocked_to > v_booking.blocked_from;
      IF v_taken < coalesce(v_capacity, 0) THEN
        UPDATE commerce.bookings
           SET status = 'confirmed', hold_expires_at = NULL, cancelled_at = NULL, updated_at = now()
         WHERE id = v_booking.id;
      ELSE
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (NEW.store_id, NEW.id, 'booking.lost',
                jsonb_build_object('booking', v_booking.id, 'starts_at', v_booking.starts_at), 'system');
      END IF;
    END LOOP;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE commerce.bookings
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status = 'held';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_bookings_follow
  AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION commerce.order_bookings_follow();
