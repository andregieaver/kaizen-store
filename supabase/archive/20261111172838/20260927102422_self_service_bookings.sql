-- Shoppers move their own bookings (D66): to a new time and, if need be,
-- another resource, only while it has room then, counting every live
-- booking but this one. The resource's row is locked first, as for a hold.
-- Each move raises the booking's sequence (for calendar files) and lets a
-- reminder go again. True if moved.
CREATE OR REPLACE FUNCTION commerce.move_booking(
  p_store_id uuid,
  p_booking_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_blocked_from timestamptz,
  p_blocked_to timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_capacity integer;
  v_taken integer;
BEGIN
  SELECT capacity INTO v_capacity FROM commerce.booking_resources
   WHERE store_id = p_store_id AND id = p_resource_id AND active
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT count(*) INTO v_taken FROM commerce.bookings b
   WHERE b.store_id = p_store_id AND b.resource_id = p_resource_id AND b.id <> p_booking_id
     AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
     AND b.blocked_from < p_blocked_to AND b.blocked_to > p_blocked_from;
  IF v_taken >= v_capacity THEN
    RETURN false;
  END IF;
  UPDATE commerce.bookings
     SET resource_id = p_resource_id, starts_at = p_starts_at, ends_at = p_ends_at,
         blocked_from = p_blocked_from, blocked_to = p_blocked_to,
         sequence = sequence + 1, reminded_at = NULL, updated_at = now()
   WHERE store_id = p_store_id AND id = p_booking_id AND status = 'confirmed';
  RETURN FOUND;
END;
$$;
