-- Units that will not be sent (wave 3, run 3, D174, docs/wave-3-fulfilment.md 3.3 point 11 and "Closing units that will not be sent"): the rules of
-- `commerce.unsent_closures`, and what is still to send learning them.
--
-- A partly sent order cannot be cancelled or changed; staff refund the units that were never sent instead. A refund's restock alone cannot say whether a unit
-- was never sent or was sent and came back, so the units staff close are an explicit record: `refundOrder()` with `notSent` writes one row per line, with the
-- refund it came with. Here:
--
-- * Row-level security on the new table (no policy: the `commerce` schema is private to the server).
-- * `closed_quantity(line)` (the units of a line closed so far), and `line_to_send()` replaced to subtract it (same signature, so every reader follows:
--   `order_fulfilment()`, the slips, the pick list, the bulk send, the backorder counts and the shipped email).
-- * `order_fulfilment()` replaced: nothing sent and nothing left is `withdrawn` only when no unit was closed; with a closed unit it is `closed`
--   (`fulfilmentState()` says the same).
-- * `shipment_lines_rules()` replaced whole with one rule more: a parcel never holds a closed unit (the line's parcels hold at most its quantity less its
--   closed units).
-- * `unsent_closures_rules()` (before insert, under the order's row lock, the lock `markSent()` takes): a physical line of the row's own order and store, a
--   paid order that is not a copy and has no change waiting for payment, never more units than are still to send at that moment, and a refund of the same
--   order when one is named. The rows are append-only (`guard_unsent_closures()`).
-- * After insert, `refresh_fulfilment()`: a partly sent order with nothing left becomes `fulfilled` in the same transaction.
-- * A change (D174 edit) is refused for an order with a closed unit (`order_edits_unsent_closed()`): its lines are no longer as sold.
--
-- No function here contains a statement that removes rows.

ALTER TABLE commerce.unsent_closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The units of a line taken off what is still to send.
CREATE FUNCTION commerce.closed_quantity(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(c.quantity), 0)::integer FROM commerce.unsent_closures c WHERE c.order_line_id = p_order_line
$$;
--> statement-breakpoint

-- The units of a physical line still to send: what was bought, less what is in parcels, less what was withdrawn (D153), less what staff closed as not to be
-- sent, never below 0. 0 for a download, a service and a line with no variant.
CREATE OR REPLACE FUNCTION commerce.line_to_send(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN ol.delivery <> 'physical' OR ol.variant_id IS NULL THEN 0
           ELSE greatest(0, ol.quantity - commerce.line_shipped(ol.id) - commerce.withdrawn_quantity(ol.id) - commerce.closed_quantity(ol.id))
         END
    FROM commerce.order_lines ol WHERE ol.id = p_order_line
$$;
--> statement-breakpoint

-- The order's fulfilment state (`fulfilmentState()`): `none` (no physical line), `unsent`, `partly_sent`, `sent`, `withdrawn` (nothing sent and nothing left
-- to send because it was withdrawn), `closed` (nothing sent and nothing left to send, and staff closed units as not to be sent).
CREATE OR REPLACE FUNCTION commerce.order_fulfilment(p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH o AS (
    SELECT o.id, o.store_id FROM commerce.orders o WHERE o.id = p_order
  ), l AS (
    SELECT count(*) AS physical, coalesce(sum(commerce.line_to_send(ol.id)), 0) AS to_send, coalesce(sum(commerce.closed_quantity(ol.id)), 0) AS closed
      FROM commerce.order_lines ol JOIN o ON ol.store_id = o.store_id AND ol.order_id = o.id
     WHERE ol.delivery = 'physical' AND ol.variant_id IS NOT NULL
  ), s AS (
    SELECT EXISTS (SELECT 1 FROM commerce.shipments sh JOIN o ON sh.store_id = o.store_id AND sh.order_id = o.id) AS shipped
  )
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM o) THEN NULL
           WHEN l.physical = 0 THEN 'none'
           WHEN NOT s.shipped AND l.to_send > 0 THEN 'unsent'
           WHEN s.shipped AND l.to_send > 0 THEN 'partly_sent'
           WHEN s.shipped THEN 'sent'
           WHEN l.closed > 0 THEN 'closed'
           ELSE 'withdrawn'
         END
    FROM l, s
$$;
--> statement-breakpoint

-- A parcel's line (`shipment_lines_rules()`, replaced whole with one rule more): the units of a line in all its parcels never exceed the line's quantity less
-- its closed units (a closed unit was never sent and is back in stock: it can never go in a parcel). Everything else is as in 20261006235336_fulfilment_rules.sql.
CREATE OR REPLACE FUNCTION commerce.shipment_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line record;
  v_ship record;
  v_sent integer;
  v_closed integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment_line.append_only: the lines of a parcel are a record and are not changed or removed' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT ol.store_id, ol.order_id, ol.quantity, ol.delivery, ol.variant_id INTO v_line
    FROM commerce.order_lines ol WHERE ol.id = NEW.order_line_id FOR NO KEY UPDATE;
  SELECT s.store_id, s.order_id INTO v_ship FROM commerce.shipments s WHERE s.id = NEW.shipment_id;
  IF v_line IS NULL OR v_ship IS NULL OR v_line.store_id <> NEW.store_id OR v_ship.store_id <> NEW.store_id OR v_line.order_id <> v_ship.order_id THEN
    RAISE EXCEPTION 'shipment_line.order: a parcel holds lines of its own order only' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.id = v_ship.order_id AND o.copied_from IS NOT NULL) THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get a row in %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF v_line.delivery <> 'physical' OR v_line.variant_id IS NULL THEN
    RAISE EXCEPTION 'shipment_line.not_physical: only goods that are shipped go in a parcel' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(sl.quantity), 0)::integer INTO v_sent FROM commerce.shipment_lines sl WHERE sl.order_line_id = NEW.order_line_id;
  IF v_sent + NEW.quantity > v_line.quantity THEN
    RAISE EXCEPTION 'shipment_line.too_many: % units of a line of % would be in parcels', v_sent + NEW.quantity, v_line.quantity USING ERRCODE = 'check_violation';
  END IF;
  v_closed := commerce.closed_quantity(NEW.order_line_id);
  IF v_sent + NEW.quantity > v_line.quantity - v_closed THEN
    RAISE EXCEPTION 'shipment_line.too_many: % units of a line of %, % of them closed as not to be sent, would be in parcels', v_sent + NEW.quantity, v_line.quantity, v_closed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- A closure is units of a physical line of a paid order, never more than are still to send, decided under the order's row lock (the lock `markSent()` takes
-- before it reads what is left, so a parcel and a closure recorded at once take turns and the second sees the first).
CREATE FUNCTION commerce.unsent_closures_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_line record;
  v_left integer;
BEGIN
  SELECT o.status, o.copied_from IS NOT NULL AS copied INTO v_order
    FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unsent_closure.order: the order is not this store''s' USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.copied THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get a row in %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'unsent_closure.not_paid: only units of a paid order that is not sent in full are closed (the order is %)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.order_edits e WHERE e.store_id = NEW.store_id AND e.order_id = NEW.order_id AND e.status = 'awaiting_payment') THEN
    RAISE EXCEPTION 'unsent_closure.edit_pending: a change to this order waits for the customer''s payment' USING ERRCODE = 'check_violation';
  END IF;
  SELECT ol.order_id, ol.delivery, ol.variant_id INTO v_line
    FROM commerce.order_lines ol WHERE ol.store_id = NEW.store_id AND ol.id = NEW.order_line_id;
  IF NOT FOUND OR v_line.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'unsent_closure.order: a closure names a line of its own order' USING ERRCODE = 'check_violation';
  END IF;
  IF v_line.delivery <> 'physical' OR v_line.variant_id IS NULL THEN
    RAISE EXCEPTION 'unsent_closure.not_physical: only goods that are shipped have units to send' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.refund_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = NEW.store_id AND r.id = NEW.refund_id AND p.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'unsent_closure.refund: the refund named is not a refund of this order' USING ERRCODE = 'check_violation';
  END IF;
  v_left := commerce.line_to_send(NEW.order_line_id);
  IF NEW.quantity > v_left THEN
    RAISE EXCEPTION 'unsent_closure.too_many: % units closed of a line with % still to send', NEW.quantity, v_left USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER unsent_closures_rules BEFORE INSERT ON commerce.unsent_closures
  FOR EACH ROW EXECUTE FUNCTION commerce.unsent_closures_rules();
--> statement-breakpoint

-- The record is never changed or removed (it is part of the order's bookkeeping, like its parcels' lines).
CREATE FUNCTION commerce.guard_unsent_closures()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'unsent_closure.append_only: commerce.unsent_closures is a record; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER unsent_closures_guard BEFORE UPDATE OR DELETE ON commerce.unsent_closures
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_unsent_closures();
--> statement-breakpoint

-- A partly sent order whose last units were closed is sent: `fulfilled` in the closure's own transaction (never moved back).
CREATE FUNCTION commerce.unsent_closures_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.refresh_fulfilment(NEW.store_id, NEW.order_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER unsent_closures_refresh AFTER INSERT ON commerce.unsent_closures
  FOR EACH ROW EXECUTE FUNCTION commerce.unsent_closures_refresh();
--> statement-breakpoint

-- A change is made only on an order whose lines are as sold: units closed as not to be sent were refunded or put back already.
CREATE FUNCTION commerce.order_edits_unsent_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.unsent_closures c WHERE c.store_id = NEW.store_id AND c.order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'order_edit.unsent_closed: units of this order were taken off what is still to send, so its items cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_edits_unsent_closed BEFORE INSERT ON commerce.order_edits
  FOR EACH ROW EXECUTE FUNCTION commerce.order_edits_unsent_closed();
