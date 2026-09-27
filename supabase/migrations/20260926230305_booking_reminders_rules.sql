-- A cancelled order gives up all its times (D65): held ones, and confirmed
-- ones when staff cancel a paid order. Otherwise as before.
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
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status = 'held' AND hold_expires_at > now();
    FOR v_booking IN
      SELECT b.* FROM commerce.bookings b
       WHERE b.store_id = NEW.store_id AND b.order_id = NEW.id AND b.status IN ('held', 'cancelled')
       ORDER BY b.starts_at
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
        UPDATE commerce.bookings
           SET status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
         WHERE id = v_booking.id;
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (NEW.store_id, NEW.id, 'booking.lost',
                jsonb_build_object('booking', v_booking.id, 'starts_at', v_booking.starts_at), 'system');
      END IF;
    END LOOP;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE commerce.bookings
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE store_id = NEW.store_id AND order_id = NEW.id AND status IN ('held', 'confirmed');
  END IF;
  RETURN NEW;
END;
$$;
