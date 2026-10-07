-- A parcel names its lines (wave 3, run 3, D174, docs/wave-3-fulfilment.md 3.3 point 1 and 9.1): the follow-up rule pushed after D174's deploy finished.
--
-- Since D174 a parcel says which lines and how many units it holds (`commerce.shipment_lines`), and what is still to send is read from them
-- (`line_to_send()`). A shipment that is not legacy and names no line would count as sending nothing while telling the shopper it was sent. `markSent()`
-- is the only writer and already refuses an empty parcel (`shipmentProblems()`, code `empty`), writing the shipment and its lines in one transaction; this
-- makes the database hold it too. It could not ship with D174 itself: the code still running while that deployed recorded shipments without lines, and a
-- migration must keep running code working until the deploy ends (CLAUDE.md). Here:
--
-- * A shipment the old code recorded during that deploy's window has no lines and is not legacy: like every parcel from before D174 it counts as everything
--   sent, so it is marked legacy, and when it is its order's only kind of parcel (the order has no lines in any parcel) its order's physical lines go into
--   its first such parcel with the units not closed as never to be sent (the back-fill of 3.3 point 2, run again for those few). Nothing is written when
--   there are none.
-- * `shipment_has_lines()` and the deferred constraint trigger `shipments_have_lines`: at commit, a shipment that is (still) not legacy must have at least
--   one row of `shipment_lines`. Deferred, so the shipment and its lines are written in either order within one transaction; the row is read again at
--   commit, so a shipment removed or marked legacy in the same transaction passes.
--
-- No function here contains a statement that removes rows.

UPDATE commerce.shipments s SET legacy = true
 WHERE NOT s.legacy
   AND NOT EXISTS (SELECT 1 FROM commerce.shipment_lines sl WHERE sl.shipment_id = s.id);
--> statement-breakpoint
INSERT INTO commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity, created_at)
SELECT ol.store_id, f.id, ol.id, ol.quantity - commerce.closed_quantity(ol.id), f.created_at
  FROM (
    SELECT DISTINCT ON (s.store_id, s.order_id) s.id, s.store_id, s.order_id, s.created_at
      FROM commerce.shipments s
     WHERE s.legacy
       AND NOT EXISTS (
         SELECT 1 FROM commerce.shipment_lines sl JOIN commerce.shipments x ON x.id = sl.shipment_id
          WHERE x.store_id = s.store_id AND x.order_id = s.order_id
       )
     ORDER BY s.store_id, s.order_id, s.created_at, s.id
  ) f
  JOIN commerce.order_lines ol ON ol.store_id = f.store_id AND ol.order_id = f.order_id
 WHERE ol.delivery = 'physical' AND ol.variant_id IS NOT NULL
   AND ol.quantity - commerce.closed_quantity(ol.id) > 0;
--> statement-breakpoint

-- At commit: a parcel that is not legacy names at least one line.
CREATE FUNCTION commerce.shipment_has_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.shipments s WHERE s.id = NEW.id AND NOT s.legacy)
     AND NOT EXISTS (SELECT 1 FROM commerce.shipment_lines sl WHERE sl.shipment_id = NEW.id) THEN
    RAISE EXCEPTION 'shipment.no_lines: a parcel names the lines and units in it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipments_have_lines AFTER INSERT ON commerce.shipments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.shipment_has_lines();
