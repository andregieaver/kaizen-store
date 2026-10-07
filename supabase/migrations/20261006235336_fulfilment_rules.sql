-- Sending in parts, changing an order after purchase, and the documents of a change (wave 3, run 3, D174, docs/wave-3-fulfilment.md 3.3): the rules the
-- database itself holds.
--
-- * Row-level security on the three new tables (no policy: the `commerce` schema is private to the server).
-- * Parcels name their lines (3.3 points 1 and 2): `shipment_lines_rules()` (a physical line of the shipment's own order, never more units in all its parcels
--   than the line holds, under the line's lock; a copied order refuses them); the rows are append-only; every shipment that exists is marked `legacy` and its
--   order's physical lines are written into its first parcel (one INSERT … SELECT, so "shipped" has one reading everywhere). The check that a non-legacy
--   shipment has lines is NOT here: the code still running while this deploys records shipments without lines (docs/wave-3-fulfilment.md 9.1, a follow-up).
-- * What is left to send (3.3 point 3): `line_shipped()`, `line_to_send()`, `order_fulfilment()`, `refresh_fulfilment()`. A change waiting for payment stops
--   a parcel (point 4).
-- * A settled order's lines and money change only inside a change (point 5): `order_lines_settled_guard()` and `orders_settled_guard()`, which let them change
--   while the order waits for payment, for a copy (`commerce.copying`) and under the edit context (`kaizen.order_edit` = the order's id).
-- * The frozen triggers learn the edit context (point 6): a staff discount and a backorder may only go down inside a change.
-- * Changes (point 7): `order_edits_rules()` (the lifecycle, the per-order number and its limit, the order it may be made on, what is frozen) and, at commit,
--   `order_edits_settled()` (the payment or refund an applied change moved); `order_edit_lines_rules()` (written with their change, never changed after but an
--   added line's order line, once).
-- * Stock (point 8): `draw_order_stock()` ignores a change's holds; `draw_edit_stock()` draws a change's added units; a movement may come from `order_edit`.
-- * Documents (point 9): an order's invoices are one original (`kind = 'order'`) and one additional invoice per change (`order_edit`); credit notes are one pool
--   over all of them (`order_buckets_left()`); a change's documents are made only by `make_edit_documents()` (`issue_edit_documents()` catches everything);
--   the refund of a change's lower total gets no credit note of its own; a payment of a change belongs to the change's invoice.
--
-- No function here contains DELETE, TRUNCATE or DROP: a change deletes a removed order line in application code (`applyOrderEdit()`). Functions that were
-- defined once (in 20261004125337_order_invoices_rules.sql) and never patched since are replaced whole; functions that were patched later are patched again
-- by one anchored replacement each, idempotent by a marker, raising when the anchor is gone.

ALTER TABLE commerce.shipment_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_edits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.order_edit_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Parcels and their lines (3.3 points 1, 2 and 4)
-- ---------------------------------------------------------------------------

-- A parcel's line is a physical line (goods with a variant) of the parcel's own order and store, and the units of a line in all its parcels never exceed the
-- line's quantity. The order line is locked first, so two parcels recorded at once take turns and the second sees the first. A copied order (D129) has no
-- parcels. The rows are never changed or removed.
CREATE FUNCTION commerce.shipment_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line record;
  v_ship record;
  v_sent integer;
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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipment_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.shipment_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.shipment_lines_rules();
--> statement-breakpoint

-- Every parcel that exists was recorded before parcels named their lines: it counts as everything sent. Its order's physical lines go into its first parcel
-- with their whole quantity (the later parcels of such an order have no lines and are allowed, being legacy).
UPDATE commerce.shipments SET legacy = true WHERE NOT legacy;
--> statement-breakpoint
INSERT INTO commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity, created_at)
SELECT ol.store_id, f.id, ol.id, ol.quantity, f.created_at
  FROM (
    SELECT DISTINCT ON (s.store_id, s.order_id) s.id, s.store_id, s.order_id, s.created_at
      FROM commerce.shipments s
     ORDER BY s.store_id, s.order_id, s.created_at, s.id
  ) f
  JOIN commerce.order_lines ol ON ol.store_id = f.store_id AND ol.order_id = f.order_id
 WHERE ol.delivery = 'physical' AND ol.variant_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM commerce.shipment_lines x WHERE x.shipment_id = f.id AND x.order_line_id = ol.id);
--> statement-breakpoint

-- A change waiting for the customer's payment keeps the order as it was sold until it is paid, cancelled or expired: no parcel meanwhile.
CREATE FUNCTION commerce.shipments_edit_pending()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.order_edits e WHERE e.store_id = NEW.store_id AND e.order_id = NEW.order_id AND e.status = 'awaiting_payment') THEN
    RAISE EXCEPTION 'shipment.edit_pending: a change to this order waits for the customer''s payment; nothing is sent until it is paid, cancelled or expired'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipments_edit_pending BEFORE INSERT ON commerce.shipments
  FOR EACH ROW EXECUTE FUNCTION commerce.shipments_edit_pending();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What is left to send (3.3 point 3; `src/lib/fulfilment.ts` is the same rule, held equal by a test)
-- ---------------------------------------------------------------------------

-- The units of a line in parcels: all of a physical line when its order has a legacy parcel, else the sum of its parcels' lines (never above the line).
CREATE FUNCTION commerce.line_shipped(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN ol.delivery <> 'physical' OR ol.variant_id IS NULL THEN 0
           WHEN EXISTS (SELECT 1 FROM commerce.shipments s WHERE s.store_id = ol.store_id AND s.order_id = ol.order_id AND s.legacy) THEN ol.quantity
           ELSE least(ol.quantity, coalesce((SELECT sum(sl.quantity) FROM commerce.shipment_lines sl WHERE sl.order_line_id = ol.id), 0))::integer
         END
    FROM commerce.order_lines ol WHERE ol.id = p_order_line
$$;
--> statement-breakpoint

-- The units of a line the consumer withdrew from (D153): accepted units on WITHDRAWAL returns that are not declined or cancelled. A return of kind `return`
-- (a voluntary or business return, D153) is of goods the customer received: it never cancels a unit still to send.
CREATE FUNCTION commerce.withdrawn_quantity(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(sum(rl.quantity), 0)::integer
    FROM commerce.return_lines rl
    JOIN commerce.returns r ON r.store_id = rl.store_id AND r.id = rl.return_id
   WHERE rl.order_line_id = p_order_line
     AND rl.decision = 'accept'
     AND r.kind = 'withdrawal'
     AND r.status NOT IN ('declined', 'cancelled')
$$;
--> statement-breakpoint

-- The units of a physical line still to send: what was bought, less what is in parcels, less what was withdrawn (D153), never below 0. Withdrawn units are
-- taken from the unsent ones first; returned units (a return of goods received) are not: they were sent. 0 for a download, a service and a line with no variant.
CREATE FUNCTION commerce.line_to_send(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN ol.delivery <> 'physical' OR ol.variant_id IS NULL THEN 0
           ELSE greatest(0, ol.quantity - commerce.line_shipped(ol.id) - commerce.withdrawn_quantity(ol.id))
         END
    FROM commerce.order_lines ol WHERE ol.id = p_order_line
$$;
--> statement-breakpoint

-- The order's fulfilment state (`fulfilmentState()`): `none` (no physical line), `unsent`, `partly_sent`, `sent`, `withdrawn` (nothing sent and nothing left
-- to send because it was withdrawn).
CREATE FUNCTION commerce.order_fulfilment(p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH o AS (
    SELECT o.id, o.store_id FROM commerce.orders o WHERE o.id = p_order
  ), l AS (
    SELECT count(*) AS physical, coalesce(sum(commerce.line_to_send(ol.id)), 0) AS to_send
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
           ELSE 'withdrawn'
         END
    FROM l, s
$$;
--> statement-breakpoint

-- An order is `fulfilled` when it is paid, has a parcel and nothing is left to send; it never moves back. Called after a parcel and after a confirmed
-- withdrawal. Returns whether it moved.
CREATE FUNCTION commerce.refresh_fulfilment(p_store uuid, p_order uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE commerce.orders o SET status = 'fulfilled'
   WHERE o.store_id = p_store AND o.id = p_order AND o.status = 'paid'
     AND commerce.order_fulfilment(o.id) = 'sent';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A settled order's lines and money change only inside a change (3.3 point 5)
-- ---------------------------------------------------------------------------

-- Whether the order's lines and money columns are settled: the order was paid (it has an `order.paid` event, which every path that pays writes) and is no
-- longer waiting for payment. A copy (D129) has its own guard, and an order row written straight into another status without a payment (a test's fixture) is
-- not one the application makes.
CREATE FUNCTION commerce.order_settled(p_order uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT o.status <> 'pending_payment' AND o.copied_from IS NULL
           AND EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid')
      FROM commerce.orders o WHERE o.id = p_order), false)
$$;
--> statement-breakpoint

-- The edit context names this order (set only by `applyOrderEdit()`, local to its transaction).
CREATE FUNCTION commerce.in_order_edit(p_order uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(current_setting('kaizen.order_edit', true), '') = p_order::text
$$;
--> statement-breakpoint

-- Lines of a settled order: no insert, no delete, and no change of what was sold or what it cost, but inside a change of that order. The change that added a
-- line is written with it and never changes; a line added inside a change names a change of its own order.
CREATE FUNCTION commerce.order_lines_settled_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_edit_id IS DISTINCT FROM OLD.order_edit_id THEN
    RAISE EXCEPTION 'order_line.edit_fixed: the change that added an order line is written with it' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.order_edit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.order_edits e
     WHERE e.store_id = NEW.store_id AND e.id = NEW.order_edit_id AND e.order_id = NEW.order_id AND e.status IN ('awaiting_payment', 'applied')
  ) THEN
    RAISE EXCEPTION 'order_line.edit: a line is added by a change of its own order' USING ERRCODE = 'check_violation';
  END IF;
  IF current_setting('commerce.copying', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id IS NOT DISTINCT FROM OLD.order_id AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
       AND NEW.unit_price_minor IS NOT DISTINCT FROM OLD.unit_price_minor AND NEW.total_minor IS NOT DISTINCT FROM OLD.total_minor
       AND NEW.tax_minor IS NOT DISTINCT FROM OLD.tax_minor AND NEW.tax_rate IS NOT DISTINCT FROM OLD.tax_rate
       AND NEW.discount_minor IS NOT DISTINCT FROM OLD.discount_minor AND NEW.member_discount_minor IS NOT DISTINCT FROM OLD.member_discount_minor
       AND NEW.campaign_discount_minor IS NOT DISTINCT FROM OLD.campaign_discount_minor AND NEW.bonus_discount_minor IS NOT DISTINCT FROM OLD.bonus_discount_minor
       AND NEW.referral_discount_minor IS NOT DISTINCT FROM OLD.referral_discount_minor AND NEW.staff_discount_minor IS NOT DISTINCT FROM OLD.staff_discount_minor
       AND NEW.vat_relief_minor IS NOT DISTINCT FROM OLD.vat_relief_minor AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
       AND NEW.sku IS NOT DISTINCT FROM OLD.sku AND NEW.delivery IS NOT DISTINCT FROM OLD.delivery THEN
      RETURN NEW;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id AND commerce.order_settled(OLD.order_id) THEN
      RAISE EXCEPTION 'order_line.settled: a line of a paid order does not move to another order' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NOT commerce.order_settled(v_order) OR commerce.in_order_edit(v_order) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'order_line.settled: the lines of a paid order change only through an order change (applyOrderEdit)' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_lines_settled_guard
  BEFORE INSERT OR DELETE OR UPDATE OF order_id, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, discount_minor, member_discount_minor,
    campaign_discount_minor, bonus_discount_minor, referral_discount_minor, staff_discount_minor, vat_relief_minor, variant_id, sku, delivery, order_edit_id
  ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_settled_guard();
--> statement-breakpoint

-- The money of a settled order: subtotal, shipping, the discount and its parts, VAT, total and when it was last changed move only inside a change of it.
-- (The venue's balance, the status, the addresses and the other columns their own code writes are not guarded here; the VAT relief is frozen after payment by
-- `orders_vat_frozen()` already, and an order with relief is never changed.)
CREATE FUNCTION commerce.orders_settled_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.subtotal_minor IS NOT DISTINCT FROM OLD.subtotal_minor AND NEW.shipping_minor IS NOT DISTINCT FROM OLD.shipping_minor
     AND NEW.discount_minor IS NOT DISTINCT FROM OLD.discount_minor AND NEW.member_discount_minor IS NOT DISTINCT FROM OLD.member_discount_minor
     AND NEW.campaign_discount_minor IS NOT DISTINCT FROM OLD.campaign_discount_minor AND NEW.credit_minor IS NOT DISTINCT FROM OLD.credit_minor
     AND NEW.referral_discount_minor IS NOT DISTINCT FROM OLD.referral_discount_minor AND NEW.staff_discount_minor IS NOT DISTINCT FROM OLD.staff_discount_minor
     AND NEW.tax_minor IS NOT DISTINCT FROM OLD.tax_minor
     AND NEW.total_minor IS NOT DISTINCT FROM OLD.total_minor AND NEW.edited_at IS NOT DISTINCT FROM OLD.edited_at THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending_payment' OR OLD.copied_from IS NOT NULL OR commerce.in_order_edit(OLD.id) OR NOT commerce.order_settled(OLD.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order.settled: the amounts of paid order % change only through an order change (applyOrderEdit)', OLD.number USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_settled_guard
  BEFORE UPDATE OF subtotal_minor, shipping_minor, discount_minor, member_discount_minor, campaign_discount_minor, credit_minor, referral_discount_minor,
    staff_discount_minor, tax_minor, total_minor, edited_at
  ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.orders_settled_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The frozen triggers learn the edit context (3.3 point 6)
-- ---------------------------------------------------------------------------

-- A draft's staff discount may go DOWN inside a change of its order (the units it was given on were taken off); its name never changes, but goes when nothing
-- of the discount is left (the order's check wants no name without a discount). Nothing else about where an order came from changes.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.orders_origin_frozen()'::regprocedure);
  IF position('kaizen.order_edit' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'     OR NEW.staff_discount_minor IS DISTINCT FROM OLD.staff_discount_minor OR NEW.staff_discount_label IS DISTINCT FROM OLD.staff_discount_label THEN',
    E'     OR (NEW.staff_discount_minor IS DISTINCT FROM OLD.staff_discount_minor\n'
    || E'         AND NOT (coalesce(current_setting(''kaizen.order_edit'', true), '''') = OLD.id::text AND NEW.staff_discount_minor < OLD.staff_discount_minor))\n'
    || E'     OR (NEW.staff_discount_label IS DISTINCT FROM OLD.staff_discount_label\n'
    || E'         AND NOT (coalesce(current_setting(''kaizen.order_edit'', true), '''') = OLD.id::text AND NEW.staff_discount_label IS NULL AND NEW.staff_discount_minor = 0)) THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'orders_origin_frozen: the staff discount test was not found, so a change cannot lower it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A line's backorder may go DOWN inside a change of its order (fewer units kept); the delivery time stated never changes and nothing goes up.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.order_lines_backorder_frozen()'::regprocedure);
  IF position('kaizen.order_edit' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  IF NEW.backorder_quantity IS DISTINCT FROM OLD.backorder_quantity OR NEW.backorder_days IS DISTINCT FROM OLD.backorder_days THEN\n'
    || E'    RAISE EXCEPTION ''order_line.backorder_fixed: the backorder of an order line is set when the order is placed and settled when it is paid''',
    E'  -- Inside a change of the order (D174) the units on backorder may go down with the units kept; the days stated stay.\n'
    || E'  IF coalesce(current_setting(''kaizen.order_edit'', true), '''') = OLD.order_id::text\n'
    || E'     AND NEW.backorder_quantity <= OLD.backorder_quantity AND NEW.backorder_days IS NOT DISTINCT FROM OLD.backorder_days THEN\n'
    || E'    RETURN NEW;\n'
    || E'  END IF;\n'
    || E'  IF NEW.backorder_quantity IS DISTINCT FROM OLD.backorder_quantity OR NEW.backorder_days IS DISTINCT FROM OLD.backorder_days THEN\n'
    || E'    RAISE EXCEPTION ''order_line.backorder_fixed: the backorder of an order line is set when the order is placed and settled when it is paid'''
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'order_lines_backorder_frozen: the backorder test was not found, so a change cannot lower it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Changes and their lines (3.3 point 7; `src/lib/order-edit-status.ts` is the same table)
-- ---------------------------------------------------------------------------

-- A change is made on a paid order of a store that is open, with standard VAT, that is not a copy or a host's and has nothing sent (the screen says why in
-- words, `editBlock()`; the database holds the part it can see). Its number is the next of the order's, given here under the order's lock, and an order has
-- at most 20. It is written `applied` (a lower or equal total, or paid outside Kaizen) or `awaiting_payment`; from there it goes to `applied`, `cancelled` or
-- `expired`, and those are final. What it is (order, number, reason, money before and after, the order as previewed, who made it) never changes. While it
-- waits, its link and its end may be replaced (sent again); its payment and refund are named once; its documents move forward only. Never deleted.
CREATE FUNCTION commerce.order_edits_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_next integer;
  v_fixed text[] := ARRAY['id', 'store_id', 'order_id', 'seq', 'reason', 'notify', 'restock', 'currency', 'base', 'total_before', 'total_after',
                          'subtotal_delta', 'shipping_before', 'shipping_after', 'discount_delta', 'tax_delta', 'difference_minor', 'made_by', 'created_at'];
  v_k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_edit.append_only: a change to an order is a record and is never deleted' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('awaiting_payment', 'applied') THEN
      RAISE EXCEPTION 'order_edit.start: a change is made applied or waiting for payment' USING ERRCODE = 'check_violation';
    END IF;
    SELECT o.store_id, o.status, o.copied_from, o.host_id, o.vat_kind, o.currency, o.number INTO v_order
      FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_edit.order: no such order in this store' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_order.copied_from IS NOT NULL THEN
      RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get a row in %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    IF v_order.status <> 'paid' THEN
      RAISE EXCEPTION 'order_edit.not_paid: only a paid order that is not sent can be changed (order % is %)', v_order.number, v_order.status USING ERRCODE = 'check_violation';
    END IF;
    IF v_order.host_id IS NOT NULL THEN
      RAISE EXCEPTION 'order_edit.host: a host''s order is not changed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_order.vat_kind <> 'standard' THEN
      RAISE EXCEPTION 'order_edit.vat_kind: an order with reverse charge or IOSS is not changed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency IS DISTINCT FROM v_order.currency THEN
      RAISE EXCEPTION 'order_edit.currency: a change is in the order''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.shipments s WHERE s.store_id = NEW.store_id AND s.order_id = NEW.order_id) THEN
      RAISE EXCEPTION 'order_edit.sent: something of this order is sent, so it is not changed' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT commerce.store_is_active(NEW.store_id) THEN
      RAISE EXCEPTION 'order_edit.store_closed: a store that is not open does not change orders' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(e.seq), 0) + 1 INTO v_next FROM commerce.order_edits e WHERE e.store_id = NEW.store_id AND e.order_id = NEW.order_id;
    IF v_next > 20 THEN
      RAISE EXCEPTION 'order_edit.limit: an order is changed at most 20 times' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.seq IS NULL THEN
      NEW.seq := v_next;
    ELSIF NEW.seq <> v_next THEN
      RAISE EXCEPTION 'order_edit.seq: the next change of this order is E%', v_next USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'applied' AND NEW.applied_at IS NULL THEN NEW.applied_at := now(); END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  FOREACH v_k IN ARRAY v_fixed LOOP
    IF (to_jsonb(NEW) -> v_k) IS DISTINCT FROM (to_jsonb(OLD) -> v_k) THEN
      RAISE EXCEPTION 'order_edit.fixed: % of a change is written when it is made', v_k USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'awaiting_payment' AND NEW.status IN ('applied', 'cancelled', 'expired')) THEN
    RAISE EXCEPTION 'order_edit.move: a change cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'applied' AND OLD.status = 'awaiting_payment' AND NEW.applied_at IS NULL THEN NEW.applied_at := now(); END IF;
  IF NEW.status IN ('cancelled', 'expired') AND OLD.status = 'awaiting_payment' AND NEW.ended_at IS NULL THEN NEW.ended_at := now(); END IF;
  -- The link and its end change only while it waits; after that they stay so the page can say what became of it.
  IF OLD.status <> 'awaiting_payment' AND (NEW.pay_token_hash IS DISTINCT FROM OLD.pay_token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
    RAISE EXCEPTION 'order_edit.link_fixed: the link of a change that is not waiting does not change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status IN ('applied', 'cancelled', 'expired')
     AND (NEW.pay_token_hash IS DISTINCT FROM OLD.pay_token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
    RAISE EXCEPTION 'order_edit.link_fixed: the link of a change is not replaced when it ends' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.applied_at IS NOT NULL AND NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN
    RAISE EXCEPTION 'order_edit.fixed: when a change was applied is written once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'order_edit.fixed: when a change ended is written once' USING ERRCODE = 'restrict_violation';
  END IF;
  -- The payment and the refund are named once, by an applied change.
  IF (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id) OR (OLD.refund_id IS NOT NULL AND NEW.refund_id IS DISTINCT FROM OLD.refund_id) THEN
    RAISE EXCEPTION 'order_edit.fixed: the payment and the refund of a change are named once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.documents IS DISTINCT FROM OLD.documents AND NOT (
       (OLD.documents = 'none' AND NEW.documents IN ('issued', 'waiting', 'not_invoiced', 'in_original'))
    OR (OLD.documents = 'waiting' AND NEW.documents IN ('issued', 'not_invoiced', 'in_original'))
  ) THEN
    RAISE EXCEPTION 'order_edit.documents: the documents of a change cannot go from % to %', OLD.documents, NEW.documents USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.documents IS DISTINCT FROM OLD.documents AND NEW.status <> 'applied' THEN
    RAISE EXCEPTION 'order_edit.documents: only an applied change has documents' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_edits_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.order_edits
  FOR EACH ROW EXECUTE FUNCTION commerce.order_edits_rules();
--> statement-breakpoint
CREATE TRIGGER order_edits_refuse_copied_order BEFORE INSERT ON commerce.order_edits
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint

-- At commit, an applied change has moved its money: a higher total was paid by a payment of the same order that names the change and is captured (Stripe's
-- or one recorded outside Kaizen); a lower total was refunded by a refund of a payment of the same order that names the change and did not fail. Deferred,
-- because the payment and the refund name the change, so the change is written first.
CREATE FUNCTION commerce.order_edits_settled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.order_edits%ROWTYPE;
BEGIN
  SELECT * INTO e FROM commerce.order_edits WHERE id = NEW.id;
  IF NOT FOUND OR e.status <> 'applied' THEN RETURN NULL; END IF;
  IF e.difference_minor > 0 AND NOT EXISTS (
    SELECT 1 FROM commerce.payments p
     WHERE p.store_id = e.store_id AND p.id = e.payment_id AND p.order_id = e.order_id AND p.order_edit_id = e.id
       AND p.status = 'captured' AND p.amount_minor = e.difference_minor
  ) THEN
    RAISE EXCEPTION 'order_edit.unpaid: change E% of the order has a higher total and is applied only with its payment of the difference', e.seq
      USING ERRCODE = 'check_violation';
  END IF;
  -- The refunds of the difference may be more than one (split over the order's payments, each capped at what it took): they all name the change, the change
  -- names one of them, and together they are exactly the difference.
  IF e.difference_minor < 0 AND (NOT EXISTS (
    SELECT 1 FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = e.store_id AND r.id = e.refund_id AND p.order_id = e.order_id AND r.order_edit_id = e.id AND r.status <> 'failed'
  ) OR (
    SELECT coalesce(sum(r.amount_minor), 0) FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = e.store_id AND r.order_edit_id = e.id AND p.order_id = e.order_id AND r.status <> 'failed'
  ) <> -e.difference_minor) THEN
    RAISE EXCEPTION 'order_edit.unrefunded: change E% of the order has a lower total and is applied only with its refund of the difference', e.seq
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER order_edits_settled AFTER INSERT OR UPDATE ON commerce.order_edits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'applied')
  EXECUTE FUNCTION commerce.order_edits_settled();
--> statement-breakpoint

-- A payment or a refund that names a change is of the change's own order.
CREATE FUNCTION commerce.order_edit_money_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order uuid;
BEGIN
  IF NEW.order_edit_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'payments' THEN
    v_order := NEW.order_id;
  ELSE
    SELECT p.order_id INTO v_order FROM commerce.payments p WHERE p.store_id = NEW.store_id AND p.id = NEW.payment_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce.order_edits e WHERE e.store_id = NEW.store_id AND e.id = NEW.order_edit_id AND e.order_id = v_order) THEN
    RAISE EXCEPTION 'order_edit.money: a % names a change of its own order only', left(TG_TABLE_NAME, -1) USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.order_edit_id IS NOT NULL AND NEW.order_edit_id IS DISTINCT FROM OLD.order_edit_id THEN
    RAISE EXCEPTION 'order_edit.money: the change a % is for is written with it', left(TG_TABLE_NAME, -1) USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_order_edit_ref BEFORE INSERT OR UPDATE OF order_edit_id ON commerce.payments
  FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_money_ref();
--> statement-breakpoint
CREATE TRIGGER refunds_order_edit_ref BEFORE INSERT OR UPDATE OF order_edit_id ON commerce.refunds
  FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_money_ref();
--> statement-breakpoint

-- A change's lines are written in the transaction that made the change (its `created_at` is that transaction's moment) and never change after, but an added
-- line's order line, written once when the change is applied (a change waiting for payment adds nothing to the order yet). Never deleted.
CREATE FUNCTION commerce.order_edit_lines_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_edit.append_only: the lines of a change are a record and are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT x.created_at, x.status INTO e FROM commerce.order_edits x WHERE x.store_id = NEW.store_id AND x.id = NEW.order_edit_id;
    IF e IS NULL OR e.created_at <> now() THEN
      RAISE EXCEPTION 'order_edit.lines_fixed: the lines of a change are written with it' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind = 'add' AND OLD.order_line_id IS NULL AND NEW.order_line_id IS NOT NULL
     AND (to_jsonb(NEW) - 'order_line_id') = (to_jsonb(OLD) - 'order_line_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.order_lines ol JOIN commerce.order_edits x ON x.store_id = ol.store_id AND x.id = NEW.order_edit_id AND x.order_id = ol.order_id
       WHERE ol.store_id = NEW.store_id AND ol.id = NEW.order_line_id AND ol.order_edit_id = NEW.order_edit_id
    ) THEN
      RAISE EXCEPTION 'order_edit.line: an added line names the order line its change added' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_edit.lines_fixed: the lines of a change are not changed after it is made' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_edit_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.order_edit_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_lines_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Stock (3.3 point 8)
-- ---------------------------------------------------------------------------

-- A movement may come from a change to an order (`order_edit`); the recorder's own list learns it, so the source is not replaced by `system`.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.record_inventory_movement()'::regprocedure);
  IF position('''order_edit''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'''ai_manager'', ''copy'', ''system'') THEN',
    E'''ai_manager'', ''copy'', ''system'', ''order_edit'') THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'record_inventory_movement: the list of sources was not found, so a change''s movements would read system'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- The payment of an order draws its own holds; a change's holds (`order_edit_id`) are the change's, drawn by draw_edit_stock(). A change's hold on another
-- order, or on this one, is a live claim like any other checkout's.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.draw_order_stock(uuid)'::regprocedure);
  IF position('order_edit_id' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'       WHERE r.order_id = p_order_id AND r.variant_id = v_var.variant_id AND r.released_at IS NULL\n       GROUP BY loc.id, loc.priority, loc.created_at',
    E'       WHERE r.order_id = p_order_id AND r.order_edit_id IS NULL AND r.variant_id = v_var.variant_id AND r.released_at IS NULL\n       GROUP BY loc.id, loc.priority, loc.created_at'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'draw_order_stock: the own holds were not found, so a change''s holds could be drawn as the order''s'; END IF;
  v_def := v_new;
  v_new := replace(v_def, E'AND r.order_id IS DISTINCT FROM p_order_id AND r.released_at IS NULL',
                          E'AND (r.order_id IS DISTINCT FROM p_order_id OR r.order_edit_id IS NOT NULL) AND r.released_at IS NULL');
  IF v_new = v_def THEN RAISE EXCEPTION 'draw_order_stock: the other claims were not found, so a change''s holds would not count'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- Draws the units a change added, when it is applied: from the change's own holds first (where they were held, as far as the stock less the other live claims
-- reaches), then from stock no live hold claims, in rank order; the rest is backordered at the first location that stocks a variant that keeps selling, or
-- short for one that stops at zero. The units beyond stock are written to the added lines' backorder (the draw may: `kaizen.drawing`), the change's holds are
-- released, and the movements are sales from `order_edit` for the order. Returns the units short (the caller refuses the change when it is above 0).
CREATE FUNCTION commerce.draw_edit_stock(p_edit uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.order_edits%ROWTYPE;
  v_var record;
  v_hold record;
  v_level record;
  v_line record;
  v_prev_stock text;
  v_prev_drawing text;
  v_left integer;
  v_take integer;
  v_before integer;
  v_claimed integer;
  v_back integer;
  v_alloc integer;
  v_home uuid;
  v_short integer := 0;
BEGIN
  SELECT * INTO e FROM commerce.order_edits WHERE id = p_edit;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown order change %', p_edit; END IF;

  v_prev_stock := current_setting('kaizen.stock', true);
  v_prev_drawing := current_setting('kaizen.drawing', true);
  PERFORM commerce.stock_context('sale', 'order_edit', e.made_by, e.order_id, NULL, NULL, NULL);
  PERFORM set_config('kaizen.drawing', 'on', true);

  FOR v_var IN
    SELECT ol.variant_id, sum(ol.quantity)::integer AS quantity, v.stock_policy, v.backorder_days
      FROM commerce.order_lines ol
      JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
     WHERE ol.store_id = e.store_id AND ol.order_id = e.order_id AND ol.order_edit_id = p_edit AND ol.variant_id IS NOT NULL AND ol.delivery = 'physical'
     GROUP BY ol.variant_id, v.stock_policy, v.backorder_days
     ORDER BY ol.variant_id
  LOOP
    PERFORM 1 FROM commerce.inventory_levels l
     WHERE l.store_id = e.store_id AND l.variant_id = v_var.variant_id
     ORDER BY l.location_id FOR UPDATE;
    v_left := v_var.quantity;
    v_back := 0;

    -- (1) The change's own holds.
    FOR v_hold IN
      SELECT loc.id AS location_id, sum(r.quantity)::integer AS quantity
        FROM commerce.inventory_reservations r
        JOIN commerce.inventory_locations loc ON loc.store_id = r.store_id AND loc.id = r.location_id
       WHERE r.store_id = e.store_id AND r.order_edit_id = p_edit AND r.variant_id = v_var.variant_id AND r.released_at IS NULL
       GROUP BY loc.id, loc.priority, loc.created_at
       ORDER BY loc.priority, loc.created_at, loc.id
    LOOP
      EXIT WHEN v_left = 0;
      SELECT l.on_hand INTO v_before FROM commerce.inventory_levels l
       WHERE l.store_id = e.store_id AND l.variant_id = v_var.variant_id AND l.location_id = v_hold.location_id;
      CONTINUE WHEN NOT FOUND;
      v_take := least(v_hold.quantity, v_left);
      IF v_var.stock_policy <> 'continue' THEN
        v_take := least(v_take, greatest(v_before, 0));
      END IF;
      IF v_take > 0 THEN
        UPDATE commerce.inventory_levels SET on_hand = on_hand - v_take, updated_at = now()
         WHERE store_id = e.store_id AND variant_id = v_var.variant_id AND location_id = v_hold.location_id;
        -- A unit beyond what the shelf held is a unit on backorder.
        v_back := v_back + greatest(0, v_take - greatest(v_before, 0));
        v_left := v_left - v_take;
      END IF;
    END LOOP;

    -- (2) Stock no other live hold claims, in rank order.
    FOR v_level IN
      SELECT l.location_id, l.on_hand
        FROM commerce.inventory_levels l
        JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active
       WHERE l.store_id = e.store_id AND l.variant_id = v_var.variant_id AND l.on_hand > 0
       ORDER BY loc.priority, loc.created_at, loc.id
    LOOP
      EXIT WHEN v_left = 0;
      SELECT coalesce(sum(r.quantity), 0)::integer INTO v_claimed
        FROM commerce.inventory_reservations r
       WHERE r.store_id = e.store_id AND r.variant_id = v_var.variant_id AND r.location_id = v_level.location_id
         AND r.order_edit_id IS DISTINCT FROM p_edit AND r.released_at IS NULL AND r.expires_at > now();
      v_take := least(greatest(v_level.on_hand - v_claimed, 0), v_left);
      CONTINUE WHEN v_take = 0;
      UPDATE commerce.inventory_levels SET on_hand = on_hand - v_take, updated_at = now()
       WHERE store_id = e.store_id AND variant_id = v_var.variant_id AND location_id = v_level.location_id;
      v_left := v_left - v_take;
    END LOOP;

    -- (3) The remainder: backordered at the first location that stocks the variant, or short.
    IF v_left > 0 THEN
      IF v_var.stock_policy = 'continue' THEN
        SELECT loc.id INTO v_home
          FROM commerce.inventory_locations loc
          JOIN commerce.inventory_levels l ON l.store_id = loc.store_id AND l.location_id = loc.id AND l.variant_id = v_var.variant_id
         WHERE loc.store_id = e.store_id AND loc.active
         ORDER BY loc.priority, loc.created_at, loc.id LIMIT 1;
        IF v_home IS NULL THEN
          SELECT loc.id INTO v_home FROM commerce.inventory_locations loc
           WHERE loc.store_id = e.store_id AND loc.active
           ORDER BY loc.priority, loc.created_at, loc.id LIMIT 1;
          IF v_home IS NOT NULL THEN
            INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
            VALUES (e.store_id, v_var.variant_id, v_home, 0)
            ON CONFLICT (variant_id, location_id) DO NOTHING;
          END IF;
        END IF;
        IF v_home IS NULL THEN
          v_short := v_short + v_left;
        ELSE
          PERFORM 1 FROM commerce.inventory_levels l
           WHERE l.store_id = e.store_id AND l.variant_id = v_var.variant_id AND l.location_id = v_home FOR UPDATE;
          UPDATE commerce.inventory_levels SET on_hand = on_hand - v_left, updated_at = now()
           WHERE store_id = e.store_id AND variant_id = v_var.variant_id AND location_id = v_home;
          v_back := v_back + v_left;
        END IF;
      ELSE
        v_short := v_short + v_left;
      END IF;
    END IF;

    -- The backordered units go to the change's added lines of the variant, in id order (each line no more than its units).
    FOR v_line IN
      SELECT ol.id, ol.quantity FROM commerce.order_lines ol
       WHERE ol.store_id = e.store_id AND ol.order_id = e.order_id AND ol.order_edit_id = p_edit AND ol.variant_id = v_var.variant_id AND ol.delivery = 'physical'
       ORDER BY ol.id
    LOOP
      v_alloc := least(v_line.quantity, v_back);
      UPDATE commerce.order_lines
         SET backorder_quantity = v_alloc, backorder_days = CASE WHEN v_alloc > 0 THEN coalesce(backorder_days, v_var.backorder_days) ELSE backorder_days END
       WHERE id = v_line.id AND (backorder_quantity <> v_alloc OR (v_alloc > 0 AND backorder_days IS NULL));
      v_back := v_back - v_alloc;
    END LOOP;
  END LOOP;

  UPDATE commerce.inventory_reservations SET released_at = now()
   WHERE store_id = e.store_id AND order_edit_id = p_edit AND released_at IS NULL;

  PERFORM set_config('kaizen.stock', coalesce(v_prev_stock, ''), true);
  PERFORM set_config('kaizen.drawing', coalesce(v_prev_drawing, ''), true);
  RETURN v_short;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Documents (3.3 point 9; `src/lib/invoice-snapshot.ts` `buildEditInvoiceSnapshot()` and `src/lib/credit-allocation.ts` `editCreditNote()` are the oracle,
-- held by src/db/invoice-parity.test.ts)
-- ---------------------------------------------------------------------------

-- What each VAT bucket of an order's documents has left: the sum over all its invoices (the original and every change's additional invoice) less the sum
-- over all their credit notes, never below 0; one row per rate and basis, highest rate first (the order an invoice lists its own buckets in), numbered from 1.
-- For an order with one invoice this is that invoice's buckets less its credit notes, as before.
CREATE FUNCTION commerce.order_buckets_left(p_store uuid, p_order uuid)
RETURNS TABLE (ord integer, rate numeric, basis text, net_invoiced bigint, vat_invoiced bigint, gross_invoiced bigint, net_left bigint, vat_left bigint, gross_left bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH inv AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, sum((b ->> 'netMinor')::bigint) AS net,
           sum((b ->> 'vatMinor')::bigint) AS vat, sum((b ->> 'grossMinor')::bigint) AS gross
      FROM commerce.invoices i, jsonb_array_elements(i.snapshot -> 'buckets') AS b
     WHERE i.store_id = p_store AND i.order_id = p_order
     GROUP BY 1, 2
  ), cr AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, sum((b ->> 'netMinor')::bigint) AS net,
           sum((b ->> 'vatMinor')::bigint) AS vat, sum((b ->> 'grossMinor')::bigint) AS gross
      FROM commerce.credit_notes c
      JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id,
           jsonb_array_elements(c.snapshot -> 'buckets') AS b
     WHERE c.store_id = p_store AND i.order_id = p_order
     GROUP BY 1, 2
  )
  SELECT (row_number() OVER (ORDER BY inv.rate DESC, inv.basis))::integer, inv.rate, inv.basis, inv.net::bigint, inv.vat::bigint, inv.gross::bigint,
         greatest(0, inv.net - coalesce(cr.net, 0))::bigint, greatest(0, inv.vat - coalesce(cr.vat, 0))::bigint, greatest(0, inv.gross - coalesce(cr.gross, 0))::bigint
    FROM inv LEFT JOIN cr ON cr.rate = inv.rate AND cr.basis = inv.basis
   ORDER BY inv.rate DESC, inv.basis
$$;
--> statement-breakpoint

-- Whether a payment is one the order's invoices cover. A payment of a change belongs to that change's additional invoice, or to the order's own invoice when it
-- was issued after the change and states the order as changed; a change that was never applied (its payment came too late and is refunded) is on no invoice.
-- Any other payment: made no later than the invoice, and not a fee charged on its own (a no-show fee, which `booking.no_show` names).
CREATE OR REPLACE FUNCTION commerce.payment_on_invoice(p_store uuid, p_payment uuid, p_issued_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((
    SELECT CASE
             WHEN p.order_edit_id IS NOT NULL THEN EXISTS (
               SELECT 1 FROM commerce.order_edits e
                WHERE e.store_id = p.store_id AND e.id = p.order_edit_id AND e.status = 'applied'
                  AND (e.documents = 'in_original'
                       OR EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = e.store_id AND i.order_edit_id = e.id AND i.kind = 'order_edit')))
             ELSE p.created_at <= p_issued_at
                  AND NOT EXISTS (SELECT 1 FROM commerce.order_events e
                                   WHERE e.store_id = p.store_id AND e.order_id = p.order_id AND e.type = 'booking.no_show' AND e.data ->> 'payment' = p.id::text)
           END
      FROM commerce.payments p WHERE p.store_id = p_store AND p.id = p_payment), true)
$$;
--> statement-breakpoint

-- An insert is refused unless the issuing function made it (it names the order, the change, the refund or the return in a transaction-local setting), and the
-- row is what its snapshot says: its totals are the buckets'. An order's invoice is for the order's total; a change's additional invoice is for what the change
-- added (its new lines and a higher shipping charge), on an applied change of an order that has its own invoice. A credit note refers to an invoice of its
-- own order (a refund or return of that order, or the change it credits) and is never above what the order's invoices together left uncredited, per rate bucket.
CREATE OR REPLACE FUNCTION commerce.document_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_by text := current_setting('commerce.issuing_document', true);
  v_order uuid;
  v_order_row commerce.orders%ROWTYPE;
  v_edit commerce.order_edits%ROWTYPE;
  v_sum record;
  v_prefix text;
  v_over integer;
  v_expect bigint;
BEGIN
  SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = NEW.store_id AND s.series = NEW.series;
  IF NEW.document_number IS DISTINCT FROM v_prefix || NEW.number::text THEN
    RAISE EXCEPTION 'document.number_format: % is not the series prefix and number', NEW.document_number USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum((b ->> 'netMinor')::bigint), 0) AS net, coalesce(sum((b ->> 'vatMinor')::bigint), 0) AS vat,
         coalesce(sum((b ->> 'grossMinor')::bigint), 0) AS gross
    INTO v_sum FROM jsonb_array_elements(NEW.snapshot -> 'buckets') AS b;
  IF v_sum.net <> NEW.net_minor OR v_sum.vat <> NEW.tax_minor OR v_sum.gross <> NEW.total_minor THEN
    RAISE EXCEPTION 'document.totals_mismatch: the totals are not the snapshot''s buckets' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.kind = 'order_edit' THEN
      IF v_by IS DISTINCT FROM NEW.order_edit_id::text THEN
        RAISE EXCEPTION 'document.issuing_only: an additional invoice is made by commerce.issue_edit_documents()' USING ERRCODE = 'restrict_violation';
      END IF;
      SELECT * INTO v_edit FROM commerce.order_edits e WHERE e.store_id = NEW.store_id AND e.id = NEW.order_edit_id;
      IF NOT FOUND OR v_edit.order_id <> NEW.order_id OR v_edit.status <> 'applied' THEN
        RAISE EXCEPTION 'invoice.edit: an additional invoice is for an applied change of its own order' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = NEW.store_id AND i.order_id = NEW.order_id AND i.kind = 'order') THEN
        RAISE EXCEPTION 'invoice.edit_original: an additional invoice refers to the order''s own invoice, which is not issued yet' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF v_by IS DISTINCT FROM NEW.order_id::text THEN
      RAISE EXCEPTION 'document.issuing_only: an invoice is made by commerce.issue_order_invoice()' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT * INTO v_order_row FROM commerce.orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id;
    IF NOT FOUND OR v_order_row.copied_from IS NOT NULL OR v_order_row.host_id IS NOT NULL THEN
      RAISE EXCEPTION 'document.order: a copied or host order, or one that does not exist, is not invoiced' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'order_edit' THEN
      SELECT coalesce(sum(ol.total_minor), 0) + greatest(0, v_edit.shipping_after - v_edit.shipping_before) INTO v_expect
        FROM commerce.order_lines ol WHERE ol.store_id = NEW.store_id AND ol.order_id = NEW.order_id AND ol.order_edit_id = NEW.order_edit_id;
      IF NEW.total_minor <> v_expect OR NEW.currency <> v_order_row.currency THEN
        RAISE EXCEPTION 'invoice.total_not_edit: the additional invoice is not for what the change added' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.total_minor <> v_order_row.total_minor OR NEW.currency <> v_order_row.currency THEN
      RAISE EXCEPTION 'invoice.total_not_order: the invoice is not for the order''s total' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Credit notes.
  SELECT i.order_id INTO v_order FROM commerce.invoices i WHERE i.store_id = NEW.store_id AND i.id = NEW.invoice_id;
  IF NEW.source = 'order_edit' THEN
    IF v_by IS DISTINCT FROM NEW.order_edit_id::text THEN
      RAISE EXCEPTION 'document.issuing_only: a change''s credit note is made by commerce.issue_edit_documents()' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM commerce.order_edits e JOIN commerce.invoices i ON i.store_id = e.store_id AND i.order_id = e.order_id AND i.kind = 'order'
       WHERE e.store_id = NEW.store_id AND e.id = NEW.order_edit_id AND e.status = 'applied' AND i.id = NEW.invoice_id
    ) THEN
      RAISE EXCEPTION 'credit_note.edit: a change''s credit note is for an applied change and refers to its order''s own invoice' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_by IS DISTINCT FROM coalesce(NEW.refund_id, NEW.return_id)::text THEN
    RAISE EXCEPTION 'document.issuing_only: a credit note is made by commerce.issue_credit_note()' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.refund_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.refunds r JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id
     WHERE r.store_id = NEW.store_id AND r.id = NEW.refund_id AND p.order_id = v_order AND r.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'credit_note.refund: the refund is not a succeeded refund of the invoice''s order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.returns r WHERE r.store_id = NEW.store_id AND r.id = NEW.return_id AND r.order_id = v_order AND r.refund_outside
  ) THEN
    RAISE EXCEPTION 'credit_note.return: the return is not one refunded outside for the invoice''s order' USING ERRCODE = 'check_violation';
  END IF;
  -- Never above the order's invoices together, per rate bucket: net, VAT and gross, with what its earlier credit notes took.
  WITH pool AS (
    SELECT * FROM commerce.order_buckets_left(NEW.store_id, v_order)
  ), mine AS (
    SELECT (b ->> 'rate')::numeric AS rate, b ->> 'basis' AS basis, (b ->> 'netMinor')::bigint AS net, (b ->> 'vatMinor')::bigint AS vat, (b ->> 'grossMinor')::bigint AS gross
      FROM jsonb_array_elements(NEW.snapshot -> 'buckets') AS b
  )
  SELECT count(*) INTO v_over
    FROM mine m
    LEFT JOIN pool p ON p.rate = m.rate AND p.basis = m.basis
   WHERE p.rate IS NULL
      OR m.net < 0 OR m.vat < 0 OR m.gross <= 0
      OR m.net > p.net_left
      OR m.vat > p.vat_left
      OR m.gross > p.gross_left;
  IF v_over > 0 THEN
    RAISE EXCEPTION 'credit_note.over_invoice: a credit note cannot credit more than the order''s invoices left uncredited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The order's own invoice is the one of kind `order` (a change's additional invoices are others of the same order).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.make_order_invoice(uuid, uuid)'::regprocedure);
  IF position('i.kind = ''order''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'SELECT i.id INTO v_id FROM commerce.invoices i WHERE i.store_id = p_store AND i.order_id = p_order;',
    E'SELECT i.id INTO v_id FROM commerce.invoices i WHERE i.store_id = p_store AND i.order_id = p_order AND i.kind = ''order'';'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'make_order_invoice: the look-up of the order''s invoice was not found, so a change''s invoice could be taken for it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- Eligible orders that have no invoice of their own, with the reason in the closed list of invoiceReadiness (or invoice_failed when nothing is in the way).
CREATE OR REPLACE FUNCTION commerce.waiting_invoices(p_store uuid)
RETURNS TABLE (order_id uuid, order_number text, paid_at timestamptz, reason text, vat_kind text, total_minor bigint, currency text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.number, pe.paid_at,
         CASE WHEN commerce.invoice_readiness(o.id) = 'ready' THEN 'invoice_failed' ELSE commerce.invoice_readiness(o.id) END,
         o.vat_kind, o.total_minor, o.currency::text
    FROM commerce.orders o
    CROSS JOIN LATERAL (
      SELECT min(e.created_at) AS paid_at FROM commerce.order_events e WHERE e.store_id = o.store_id AND e.order_id = o.id AND e.type = 'order.paid'
    ) pe
   WHERE o.store_id = p_store AND o.copied_from IS NULL AND o.host_id IS NULL AND pe.paid_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM commerce.invoices i WHERE i.store_id = o.store_id AND i.order_id = o.id AND i.kind = 'order')
     AND commerce.invoice_eligibility(o.id) = 'ok'
   ORDER BY pe.paid_at, o.id;
END;
$$;
--> statement-breakpoint

-- Credit notes for refunds that succeeded before their invoice existed (or whose note failed), in the order the refunds were made. A refund a change's credit
-- note covers is not one of them.
CREATE OR REPLACE FUNCTION commerce.issue_missing_credit_notes(p_store uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT x.refund_id, x.return_id FROM (
      SELECT rf.id AS refund_id, NULL::uuid AS return_id, rf.created_at AS at
        FROM commerce.refunds rf
        JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id
        JOIN commerce.invoices i ON i.store_id = rf.store_id AND i.order_id = p.order_id AND i.kind = 'order'
       WHERE rf.store_id = p_store AND rf.status = 'succeeded'
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rf.store_id AND c.refund_id = rf.id)
         AND NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = rf.store_id AND e.order_id = p.order_id
                          AND e.type IN ('credit_note.short', 'credit_note.not_invoiced', 'credit_note.covered_by_edit') AND e.data ->> 'key' = rf.id::text)
      UNION ALL
      SELECT NULL::uuid, rt.id, coalesce(rt.refunded_at, rt.created_at)
        FROM commerce.returns rt
        JOIN commerce.invoices i ON i.store_id = rt.store_id AND i.order_id = rt.order_id AND i.kind = 'order'
       WHERE rt.store_id = p_store AND rt.refund_outside AND rt.refund_id IS NULL AND coalesce(rt.refund_minor, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM commerce.credit_notes c WHERE c.store_id = rt.store_id AND c.return_id = rt.id AND c.source = 'return_outside')
         AND NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = rt.store_id AND e.order_id = rt.order_id AND e.type = 'credit_note.short' AND e.data ->> 'key' = rt.id::text)
    ) x ORDER BY x.at, x.refund_id, x.return_id
  LOOP
    IF commerce.issue_credit_note(p_store, r.refund_id, r.return_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
--> statement-breakpoint

-- A credit note for a refund that succeeded (p_refund), or for a return refunded outside Kaizen (p_return): D159's function, now crediting the order's invoices
-- as one pool (D174: the original and every change's additional invoice), and issuing nothing for the refund of a change's lower total (the change's own
-- credit note covers it). Raises on any problem; returns null when there is nothing to credit.
CREATE OR REPLACE FUNCTION commerce.make_credit_note(p_store uuid, p_refund uuid, p_return uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_refund commerce.refunds%ROWTYPE;
  v_ret commerce.returns%ROWTYPE;
  v_have_ret boolean := false;
  v_order commerce.orders%ROWTYPE;
  v_order_id uuid;
  v_inv commerce.invoices%ROWTYPE;
  v_source text;
  v_key uuid;
  v_amount bigint;
  v_working jsonb := NULL;
  v_return_number text := NULL;
  v_id uuid;
  v_n integer;
  v_k integer;
  v_rate numeric[];
  v_basis text[];
  v_net_left bigint[];
  v_vat_left bigint[];
  v_gross_left bigint[];
  v_room bigint;
  v_target bigint;
  v_short bigint;
  v_sums bigint[];
  v_clamp bigint[];
  v_final bigint[];
  v_head bigint[];
  v_inw bigint[];
  v_weights bigint[];
  v_shares bigint[];
  v_d bigint;
  v_rows jsonb := '[]'::jsonb;
  v_used boolean := false;
  v_ok boolean;
  v_w jsonb;
  v_line jsonb;
  v_ship jsonb;
  v_vat bigint[];
  v_buckets jsonb := '[]'::jsonb;
  v_net bigint := 0;
  v_vat_sum bigint := 0;
  v_gross bigint := 0;
  v_before bigint;
  v_number bigint;
  v_prefix text;
  v_docno text;
  v_today date;
  v_notes jsonb;
  v_vh jsonb;
  v_vm jsonb;
  v_vat_home jsonb := NULL;
  v_vat_main jsonb := NULL;
  v_snap jsonb;
  v_event_key text;
  v_is_return boolean;
  v_fx numeric;
  v_pool jsonb;
  v_pool_total bigint;
BEGIN
  IF p_refund IS NOT NULL THEN
    SELECT * INTO v_refund FROM commerce.refunds WHERE store_id = p_store AND id = p_refund;
    IF NOT FOUND OR v_refund.status <> 'succeeded' THEN RETURN NULL; END IF;
    SELECT p.order_id INTO v_order_id FROM commerce.payments p WHERE p.store_id = p_store AND p.id = v_refund.payment_id;
    SELECT * INTO v_ret FROM commerce.returns WHERE store_id = p_store AND refund_id = p_refund;
    v_have_ret := FOUND;
    v_source := 'refund';
    v_key := p_refund;
    v_amount := v_refund.amount_minor;
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.refund_id = p_refund;
  ELSE
    SELECT * INTO v_ret FROM commerce.returns WHERE store_id = p_store AND id = p_return;
    IF NOT FOUND OR NOT v_ret.refund_outside OR coalesce(v_ret.refund_minor, 0) <= 0 OR v_ret.refund_id IS NOT NULL THEN RETURN NULL; END IF;
    v_have_ret := true;
    v_order_id := v_ret.order_id;
    v_source := 'return_outside';
    v_key := p_return;
    v_amount := v_ret.refund_minor;
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = 'return_outside';
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF v_have_ret THEN
    v_working := v_ret.refund_working;
    v_return_number := v_ret.number;
  END IF;
  v_is_return := v_have_ret;
  v_event_key := v_key::text;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_order FROM commerce.orders WHERE store_id = p_store AND id = v_order_id;
  IF NOT FOUND OR v_order.copied_from IS NOT NULL OR v_order.host_id IS NOT NULL THEN RETURN NULL; END IF;
  -- One at a time per order: the order's own invoice is locked (a change's documents lock it too), so two refunds that succeed together cannot both take
  -- what is left.
  SELECT * INTO v_inv FROM commerce.invoices WHERE store_id = p_store AND order_id = v_order_id AND kind = 'order' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_refund IS NOT NULL THEN
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.refund_id = p_refund;
  ELSE
    SELECT c.id INTO v_id FROM commerce.credit_notes c WHERE c.store_id = p_store AND c.return_id = p_return AND c.source = 'return_outside';
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- The refund of a change's lower total (D174) is credited by the change's own credit note: none of its own, and the order says so once. Every refund naming an
  -- applied change with a lower total is such a refund (one, or several when it was split over the order's payments); a refund naming a change that was never
  -- applied gave back a payment that came too late, which the next test handles.
  IF p_refund IS NOT NULL AND v_refund.order_edit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.order_edits e WHERE e.store_id = p_store AND e.id = v_refund.order_edit_id AND e.status = 'applied' AND e.difference_minor < 0
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.covered_by_edit' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.covered_by_edit', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'edit', v_refund.order_edit_id), 'system');
    END IF;
    RETURN NULL;
  END IF;
  -- A refund of a payment that is not on the invoice (a no-show fee charged afterwards, D65) reverses no sale: no credit note, and the order says so.
  IF p_refund IS NOT NULL AND NOT commerce.payment_on_invoice(p_store, v_refund.payment_id, v_inv.issued_at) THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.not_invoiced' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.not_invoiced', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'paymentId', v_refund.payment_id), 'system');
    END IF;
    RETURN NULL;
  END IF;

  -- What each bucket of the order's invoices (its own and every change's, D174) has left after all their credit notes so far: one pool.
  SELECT array_agg(p.rate ORDER BY p.ord), array_agg(p.basis ORDER BY p.ord), array_agg(p.net_left ORDER BY p.ord),
         array_agg(p.vat_left ORDER BY p.ord), array_agg(p.gross_left ORDER BY p.ord),
         jsonb_agg(jsonb_build_object('rate', p.rate, 'basis', p.basis, 'vatMinor', p.vat_invoiced) ORDER BY p.ord), coalesce(sum(p.gross_invoiced), 0)
    INTO v_rate, v_basis, v_net_left, v_vat_left, v_gross_left, v_pool, v_pool_total
    FROM commerce.order_buckets_left(p_store, v_order_id) p;
  v_n := coalesce(array_length(v_rate, 1), 0);
  v_room := coalesce((SELECT sum(g) FROM unnest(v_gross_left) AS t(g)), 0);
  v_target := least(v_amount, v_room);
  v_short := v_amount - v_target;
  IF v_n = 0 OR v_target <= 0 THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.order_events e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.type = 'credit_note.short' AND e.data ->> 'key' = v_event_key) THEN
      INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
      VALUES (p_store, v_order_id, 'credit_note.short', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'creditedMinor', 0, 'shortMinor', v_amount), 'system');
    END IF;
    RETURN NULL;
  END IF;

  -- A return's working is used when it fits the invoice and the amount refunded; else the amount is shared as a plain refund.
  v_ok := v_working IS NOT NULL AND jsonb_typeof(v_working) = 'object' AND jsonb_typeof(v_working -> 'lines') = 'array'
          AND (v_working ->> 'amountMinor')::bigint IS NOT DISTINCT FROM v_amount;
  IF v_ok THEN
    v_sums := array_fill(0::bigint, ARRAY[v_n]);
    v_rows := '[]'::jsonb;
    FOR v_w IN SELECT x FROM jsonb_array_elements(v_working -> 'lines') AS x LOOP
      SELECT l INTO v_line FROM commerce.invoices i, jsonb_array_elements(i.snapshot -> 'lines') AS l
       WHERE i.store_id = p_store AND i.order_id = v_order_id AND l ->> 'lineId' = v_w ->> 'lineId'
       ORDER BY i.issued_at, i.number LIMIT 1;
      IF v_line IS NULL THEN v_ok := false; EXIT; END IF;
      v_k := commerce.bucket_index(v_rate, v_basis, (v_line ->> 'vatRate')::numeric, v_line ->> 'basis');
      IF v_k = 0 THEN v_ok := false; EXIT; END IF;
      IF (v_w ->> 'valueMinor')::bigint > 0 THEN
        v_sums[v_k] := v_sums[v_k] + (v_w ->> 'valueMinor')::bigint;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'goods', 'lineId', v_line ->> 'lineId', 'sku', v_line ->> 'sku', 'title', v_line ->> 'title', 'quantity', (v_w ->> 'quantity')::int,
          'vatRate', (v_line ->> 'vatRate')::numeric, 'basis', v_line ->> 'basis', 'grossMinor', (v_w ->> 'valueMinor')::bigint,
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
      IF (v_w ->> 'deductionMinor')::bigint > 0 THEN
        v_sums[v_k] := v_sums[v_k] - (v_w ->> 'deductionMinor')::bigint;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'deduction', 'lineId', v_line ->> 'lineId', 'sku', v_line ->> 'sku', 'title', v_line ->> 'title', 'quantity', NULL::int,
          'vatRate', (v_line ->> 'vatRate')::numeric, 'basis', v_line ->> 'basis', 'grossMinor', -(v_w ->> 'deductionMinor')::bigint,
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
    END LOOP;
    IF v_ok AND ((v_working ->> 'deliveryMinor')::bigint > 0 OR (v_working ->> 'returnShippingMinor')::bigint > 0) THEN
      v_ship := v_inv.snapshot -> 'shipping';
      IF v_ship IS NULL OR jsonb_typeof(v_ship) <> 'object' THEN
        v_ok := false;
      ELSE
        v_k := commerce.bucket_index(v_rate, v_basis, (v_ship ->> 'vatRate')::numeric, v_ship ->> 'basis');
        IF v_k = 0 THEN
          v_ok := false;
        ELSE
          IF (v_working ->> 'deliveryMinor')::bigint > 0 THEN
            v_sums[v_k] := v_sums[v_k] + (v_working ->> 'deliveryMinor')::bigint;
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'kind', 'delivery', 'lineId', NULL::text, 'sku', NULL::text, 'title', v_ship ->> 'label', 'quantity', NULL::int,
              'vatRate', (v_ship ->> 'vatRate')::numeric, 'basis', v_ship ->> 'basis', 'grossMinor', (v_working ->> 'deliveryMinor')::bigint,
              'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
          END IF;
          IF (v_working ->> 'returnShippingMinor')::bigint > 0 THEN
            v_sums[v_k] := v_sums[v_k] - (v_working ->> 'returnShippingMinor')::bigint;
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'kind', 'return_shipping', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
              'vatRate', (v_ship ->> 'vatRate')::numeric, 'basis', v_ship ->> 'basis', 'grossMinor', -(v_working ->> 'returnShippingMinor')::bigint,
              'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ok THEN
    v_used := true;
    v_clamp := ARRAY(SELECT greatest(0, least(v_sums[i], v_gross_left[i])) FROM generate_subscripts(v_sums, 1) AS i ORDER BY i);
    v_d := v_target - (SELECT sum(c) FROM unnest(v_clamp) AS t(c));
    v_final := v_clamp;
    IF v_d > 0 THEN
      v_head := ARRAY(SELECT v_gross_left[i] - v_clamp[i] FROM generate_subscripts(v_clamp, 1) AS i ORDER BY i);
      v_inw := ARRAY(SELECT CASE WHEN v_clamp[i] > 0 THEN v_head[i] ELSE 0 END FROM generate_subscripts(v_clamp, 1) AS i ORDER BY i);
      v_weights := CASE WHEN (SELECT sum(w) FROM unnest(v_inw) AS t(w)) >= v_d THEN v_inw ELSE v_head END;
      v_shares := commerce.distribute_minor(v_d, v_weights, v_rate);
      v_final := ARRAY(SELECT v_final[i] + v_shares[i] FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
    ELSIF v_d < 0 THEN
      v_shares := commerce.distribute_minor(-v_d, v_clamp, v_rate);
      v_final := ARRAY(SELECT v_final[i] - v_shares[i] FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
    END IF;
  ELSE
    v_used := false;
    v_final := commerce.distribute_minor(v_target, v_gross_left, v_rate);
  END IF;

  -- Net, VAT and gross per bucket.
  v_vat := ARRAY(SELECT commerce.credit_vat(v_final[i], v_rate[i], v_gross_left[i], v_net_left[i], v_vat_left[i]) FROM generate_subscripts(v_final, 1) AS i ORDER BY i);
  IF NOT v_used THEN
    v_rows := '[]'::jsonb;
    FOR v_k IN 1..v_n LOOP
      IF v_final[v_k] > 0 THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'refund', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
          'vatRate', v_rate[v_k], 'basis', v_basis[v_k], 'grossMinor', v_final[v_k],
          'netMinor', v_final[v_k] - v_vat[v_k], 'vatMinor', v_vat[v_k]));
      END IF;
    END LOOP;
  ELSE
    -- What the working did not fit into the buckets (a staff adjustment, a return shipping larger than the delivery given back) is shown as adjustment rows.
    FOR v_k IN 1..v_n LOOP
      IF v_final[v_k] - v_sums[v_k] <> 0 THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'adjustment', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
          'vatRate', v_rate[v_k], 'basis', v_basis[v_k], 'grossMinor', v_final[v_k] - v_sums[v_k],
          'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
    END LOOP;
  END IF;
  FOR v_k IN 1..v_n LOOP
    IF v_final[v_k] > 0 THEN
      v_buckets := v_buckets || jsonb_build_array(jsonb_build_object(
        'rate', v_rate[v_k], 'basis', v_basis[v_k], 'netMinor', v_final[v_k] - v_vat[v_k], 'vatMinor', v_vat[v_k], 'grossMinor', v_final[v_k]));
      v_net := v_net + v_final[v_k] - v_vat[v_k];
      v_vat_sum := v_vat_sum + v_vat[v_k];
      v_gross := v_gross + v_final[v_k];
    END IF;
  END LOOP;
  IF v_gross <= 0 THEN RETURN NULL; END IF;

  SELECT coalesce(sum(c.total_minor), 0) INTO v_before FROM commerce.credit_notes c JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id
   WHERE c.store_id = p_store AND i.order_id = v_order_id;
  SELECT coalesce(jsonb_agg(n ORDER BY ord), '[]'::jsonb) INTO v_notes FROM (VALUES
    (1, 'credit_capped', v_short > 0),
    (2, 'working_not_used', v_working IS NOT NULL AND NOT v_used)
  ) AS t(ord, n, cond) WHERE cond;

  -- The VAT in the seller's currency and in the main currency, at the invoice's rate (a credit note reduces the VAT of the same supply), as
  -- the difference of the cumulative conversions per bucket, so the credit notes of an invoice add up to the invoice's own converted VAT.
  v_vh := v_inv.snapshot -> 'vatHome';
  IF v_vh IS NOT NULL AND jsonb_typeof(v_vh) = 'object' THEN
    v_fx := (v_vh ->> 'fxRate')::numeric;
    v_vat_home := v_vh || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_pool, v_vat_left, v_vat, v_fx));
  END IF;
  v_vm := v_inv.snapshot -> 'vatMain';
  IF v_vm IS NOT NULL AND jsonb_typeof(v_vm) = 'object' THEN
    IF jsonb_typeof(v_vm -> 'fxRate') = 'number' THEN
      v_fx := (v_vm ->> 'fxRate')::numeric;
      v_vat_main := v_vm || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_pool, v_vat_left, v_vat, v_fx));
    ELSE
      v_vat_main := v_vm || jsonb_build_object('vatMinor', v_vat_sum);
    END IF;
  END IF;

  v_today := commerce.store_day(p_store, now());
  -- The number last: the series' row lock is held from here to the end of the transaction.
  v_number := commerce.next_document_number(p_store, 'credit_note');
  SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'credit_note';
  v_docno := v_prefix || v_number::text;

  v_snap := jsonb_build_object(
    'version', 1, 'documentType', 'credit_note', 'number', v_docno, 'issuedOn', to_char(v_today, 'YYYY-MM-DD'),
    'locale', v_inv.snapshot -> 'locale', 'language', v_inv.snapshot -> 'language', 'currency', v_inv.snapshot -> 'currency',
    'seller', v_inv.snapshot -> 'seller', 'buyer', v_inv.snapshot -> 'buyer', 'order', v_inv.snapshot -> 'order',
    'refersTo', jsonb_build_object('invoiceId', v_inv.id, 'invoiceNumber', v_inv.snapshot ->> 'number', 'invoiceIssuedOn', v_inv.snapshot ->> 'issuedOn'),
    'reason', jsonb_build_object('kind', CASE WHEN v_is_return THEN 'return' ELSE 'refund' END, 'returnNumber', v_return_number),
    'source', v_source, 'lines', v_rows, 'buckets', v_buckets,
    'totals', jsonb_build_object('netMinor', v_net, 'vatMinor', v_vat_sum, 'grossMinor', v_gross),
    'vatHome', v_vat_home, 'vatMain', v_vat_main, 'treatment', v_inv.snapshot -> 'treatment',
    'position', jsonb_build_object(
      'invoiceTotalMinor', v_pool_total, 'creditedBeforeMinor', v_before,
      'creditedNowMinor', v_gross, 'leftOnInvoiceMinor', v_pool_total - v_before - v_gross),
    'notes', v_notes);

  PERFORM set_config('commerce.issuing_document', v_key::text, true);
  INSERT INTO commerce.credit_notes (
    store_id, invoice_id, refund_id, return_id, series, number, document_number, currency, total_minor, tax_minor, net_minor,
    source, issued_on, locale, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token
  ) VALUES (
    p_store, v_inv.id, p_refund, CASE WHEN p_refund IS NULL THEN p_return END, 'credit_note', v_number, v_docno, v_inv.currency, v_gross, v_vat_sum, v_net,
    v_source, v_today, v_inv.locale,
    v_vat_home ->> 'currency', (v_vat_home ->> 'vatMinor')::bigint, v_inv.fx_rate, v_inv.fx_as_of, v_inv.fx_source,
    v_snap, commerce.new_document_token('crn_')
  ) RETURNING id INTO v_id;
  PERFORM set_config('commerce.issuing_document', '', true);

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (p_store, v_order_id, 'credit_note.issued',
          jsonb_build_object('creditNoteId', v_id, 'number', v_docno, 'key', v_event_key, 'amountMinor', v_gross), 'system');
  IF v_short > 0 THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, v_order_id, 'credit_note.short', jsonb_build_object('key', v_event_key, 'amountMinor', v_amount, 'creditedMinor', v_gross, 'shortMinor', v_short), 'system');
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- The documents of an applied change (4.6): an edit credit note for what it took off (the removed units, each at the rate and basis its invoice line had, and a
-- lower shipping charge) and an additional invoice for what it added (the new lines and a higher shipping charge), each referring to the order's own invoice,
-- each numbered from its own gap-free series, each issued only when it is above 0. The credit note never takes more from a bucket than the order's documents
-- left (what it could not credit is an adjustment row and the note `credit_capped`); its VAT in other currencies is at the original invoice's rates. The
-- additional invoice carries the seller, buyer, order and treatment of the original, its VAT at its own day's rates, and says how it was paid: the change's
-- payment (online or recorded outside Kaizen) and, for the rest, settled against what was paid for the original. Its supply day is the day the change was
-- applied (a payment recorded outside Kaizen: the day the money was received). An order with no invoice of its own: `not_invoiced` when it gets none,
-- `waiting` when it waits for one; an invoice of its own issued after the change already states the order as changed (`in_original`). Raises on any problem;
-- returns the documents state.
CREATE FUNCTION commerce.make_edit_documents(p_store uuid, p_edit uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  e commerce.order_edits%ROWTYPE;
  o commerce.orders%ROWTYPE;
  st commerce.stores%ROWTYPE;
  v_inv commerce.invoices%ROWTYPE;
  v_tz text;
  v_today date;
  v_supply date;
  v_ship_rate numeric;
  v_ship_gross bigint;
  v_ship_vat bigint;
  v_label text;
  -- The credit side.
  v_rate numeric[];
  v_basis text[];
  v_net_left bigint[];
  v_vat_left bigint[];
  v_gross_left bigint[];
  v_pool jsonb;
  v_pool_total bigint;
  v_before bigint;
  v_n integer;
  v_k integer;
  v_want_g bigint[];
  v_want_v bigint[];
  v_final bigint[];
  v_vat bigint[];
  v_rows jsonb := '[]'::jsonb;
  v_r record;
  v_line jsonb;
  v_lrate numeric;
  v_lbasis text;
  v_buckets jsonb := '[]'::jsonb;
  v_net bigint := 0;
  v_vsum bigint := 0;
  v_gross bigint := 0;
  v_short bigint := 0;
  v_vh jsonb;
  v_vm jsonb;
  v_vat_home jsonb;
  v_vat_main jsonb;
  v_fx numeric;
  v_number bigint;
  v_prefix text;
  v_docno text;
  v_snap jsonb;
  v_id uuid;
  v_notes jsonb;
  -- The invoice side.
  v_lines jsonb;
  v_rounded boolean;
  v_ship jsonb;
  v_ibuckets jsonb;
  v_inet bigint;
  v_ivat bigint;
  v_igross bigint;
  v_exempt boolean;
  v_statements jsonb;
  v_home text;
  v_main text;
  v_paid_now bigint := 0;
  v_provider text;
  v_method text;
  v_received date;
  v_payments jsonb;
  v_inv_notes jsonb;
BEGIN
  SELECT * INTO e FROM commerce.order_edits WHERE store_id = p_store AND id = p_edit FOR UPDATE;
  IF NOT FOUND OR e.status <> 'applied' THEN RETURN NULL; END IF;
  IF e.documents IN ('issued', 'not_invoiced', 'in_original') THEN RETURN e.documents; END IF;
  SELECT * INTO o FROM commerce.orders WHERE store_id = p_store AND id = e.order_id;
  IF o.copied_from IS NOT NULL OR o.host_id IS NOT NULL THEN
    UPDATE commerce.order_edits SET documents = 'not_invoiced' WHERE id = p_edit;
    RETURN 'not_invoiced';
  END IF;
  -- One at a time per order: the same lock as a refund's credit note.
  SELECT * INTO v_inv FROM commerce.invoices WHERE store_id = p_store AND order_id = e.order_id AND kind = 'order' FOR UPDATE;
  IF NOT FOUND THEN
    IF commerce.invoice_eligibility(o.id) <> 'ok' THEN
      UPDATE commerce.order_edits SET documents = 'not_invoiced' WHERE id = p_edit;
      RETURN 'not_invoiced';
    END IF;
    IF e.documents <> 'waiting' THEN UPDATE commerce.order_edits SET documents = 'waiting' WHERE id = p_edit; END IF;
    RETURN 'waiting';
  END IF;
  IF v_inv.issued_at > e.applied_at THEN
    UPDATE commerce.order_edits SET documents = 'in_original' WHERE id = p_edit;
    RETURN 'in_original';
  END IF;

  SELECT * INTO st FROM commerce.stores WHERE id = p_store;
  v_tz := coalesce(st.time_zone, 'UTC');
  v_today := commerce.store_day(p_store, now());
  v_label := commerce.nz(o.delivery ->> 'label');
  -- The shipping's VAT moved by what the change's VAT moved beyond its lines (the order keeps one shipping rate, frozen when it was placed).
  v_ship_rate := coalesce(o.shipping_tax_rate, (v_inv.snapshot -> 'shipping' ->> 'vatRate')::numeric, commerce.vat_rate(o.market_code, 'standard', o.placed_at), 0);
  v_ship_gross := e.shipping_after - e.shipping_before;
  v_ship_vat := e.tax_delta
    - coalesce((SELECT sum(ol.tax_minor) FROM commerce.order_lines ol WHERE ol.store_id = p_store AND ol.order_id = e.order_id AND ol.order_edit_id = p_edit), 0)
    + coalesce((SELECT sum(l.tax_minor) FROM commerce.order_edit_lines l WHERE l.store_id = p_store AND l.order_edit_id = p_edit AND l.kind IN ('remove', 'reduce')), 0);
  v_ship_vat := CASE WHEN v_ship_gross > 0 THEN greatest(0, least(v_ship_vat, v_ship_gross))
                     WHEN v_ship_gross < 0 THEN greatest(0, least(-v_ship_vat, -v_ship_gross))
                     ELSE 0 END;

  -- ---- The credit note: what the change took off ----
  SELECT array_agg(p.rate ORDER BY p.ord), array_agg(p.basis ORDER BY p.ord), array_agg(p.net_left ORDER BY p.ord),
         array_agg(p.vat_left ORDER BY p.ord), array_agg(p.gross_left ORDER BY p.ord),
         jsonb_agg(jsonb_build_object('rate', p.rate, 'basis', p.basis, 'vatMinor', p.vat_invoiced) ORDER BY p.ord), coalesce(sum(p.gross_invoiced), 0)
    INTO v_rate, v_basis, v_net_left, v_vat_left, v_gross_left, v_pool, v_pool_total
    FROM commerce.order_buckets_left(p_store, e.order_id) p;
  v_n := coalesce(array_length(v_rate, 1), 0);
  v_want_g := array_fill(0::bigint, ARRAY[greatest(v_n, 1)]);
  v_want_v := array_fill(0::bigint, ARRAY[greatest(v_n, 1)]);
  FOR v_r IN
    SELECT l.n, l.order_line_id, l.sku, l.title, l.quantity, l.total_minor, l.tax_minor, l.tax_rate
      FROM commerce.order_edit_lines l WHERE l.store_id = p_store AND l.order_edit_id = p_edit AND l.kind IN ('remove', 'reduce') AND l.total_minor > 0
     ORDER BY l.n
  LOOP
    -- The rate and basis the line had on its invoice (the order's own, or an earlier change's).
    SELECT x INTO v_line FROM commerce.invoices i, jsonb_array_elements(i.snapshot -> 'lines') AS x
     WHERE i.store_id = p_store AND i.order_id = e.order_id AND x ->> 'lineId' = v_r.order_line_id::text
     ORDER BY i.issued_at, i.number LIMIT 1;
    v_lrate := coalesce((v_line ->> 'vatRate')::numeric, v_r.tax_rate);
    v_lbasis := coalesce(v_line ->> 'basis', 'standard');
    v_k := commerce.bucket_index(v_rate, v_basis, v_lrate, v_lbasis);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'kind', 'goods', 'lineId', v_r.order_line_id, 'sku', v_r.sku, 'title', v_r.title, 'quantity', v_r.quantity,
      'vatRate', v_lrate, 'basis', v_lbasis, 'grossMinor', v_r.total_minor, 'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
    IF v_k > 0 THEN
      v_want_g[v_k] := v_want_g[v_k] + v_r.total_minor;
      v_want_v[v_k] := v_want_v[v_k] + v_r.tax_minor;
    ELSE
      v_short := v_short + v_r.total_minor;
    END IF;
  END LOOP;
  IF v_ship_gross < 0 THEN
    v_lrate := coalesce((v_inv.snapshot -> 'shipping' ->> 'vatRate')::numeric, v_ship_rate);
    v_lbasis := coalesce(v_inv.snapshot -> 'shipping' ->> 'basis', 'standard');
    v_k := commerce.bucket_index(v_rate, v_basis, v_lrate, v_lbasis);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'kind', 'delivery', 'lineId', NULL::text, 'sku', NULL::text, 'title', v_label, 'quantity', NULL::int,
      'vatRate', v_lrate, 'basis', v_lbasis, 'grossMinor', -v_ship_gross, 'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
    IF v_k > 0 THEN
      v_want_g[v_k] := v_want_g[v_k] - v_ship_gross;
      v_want_v[v_k] := v_want_v[v_k] + v_ship_vat;
    ELSE
      v_short := v_short - v_ship_gross;
    END IF;
  END IF;
  IF v_n > 0 THEN
    v_final := ARRAY(SELECT greatest(0, least(v_want_g[i], v_gross_left[i])) FROM generate_series(1, v_n) AS i ORDER BY i);
    v_short := v_short + (SELECT coalesce(sum(v_want_g[i] - v_final[i]), 0) FROM generate_series(1, v_n) AS i);
    -- The VAT the units carried when the whole of it fits; otherwise the VAT in what fits (credit_vat()), never more than is left or so little the net exceeds it.
    v_vat := ARRAY(SELECT CASE WHEN v_final[i] = 0 THEN 0::bigint
                               WHEN v_final[i] = v_want_g[i] THEN greatest(least(v_want_v[i], v_vat_left[i], v_final[i]), v_final[i] - v_net_left[i])
                               ELSE commerce.credit_vat(v_final[i], v_rate[i], v_gross_left[i], v_net_left[i], v_vat_left[i]) END
                     FROM generate_series(1, v_n) AS i ORDER BY i);
    FOR v_k IN 1..v_n LOOP
      IF v_final[v_k] - v_want_g[v_k] <> 0 THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'adjustment', 'lineId', NULL::text, 'sku', NULL::text, 'title', NULL::text, 'quantity', NULL::int,
          'vatRate', v_rate[v_k], 'basis', v_basis[v_k], 'grossMinor', v_final[v_k] - v_want_g[v_k], 'netMinor', NULL::bigint, 'vatMinor', NULL::bigint));
      END IF;
      IF v_final[v_k] > 0 THEN
        v_buckets := v_buckets || jsonb_build_array(jsonb_build_object(
          'rate', v_rate[v_k], 'basis', v_basis[v_k], 'netMinor', v_final[v_k] - v_vat[v_k], 'vatMinor', v_vat[v_k], 'grossMinor', v_final[v_k]));
        v_net := v_net + v_final[v_k] - v_vat[v_k];
        v_vsum := v_vsum + v_vat[v_k];
        v_gross := v_gross + v_final[v_k];
      END IF;
    END LOOP;
  END IF;

  IF v_gross > 0 THEN
    SELECT coalesce(sum(c.total_minor), 0) INTO v_before FROM commerce.credit_notes c JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id
     WHERE c.store_id = p_store AND i.order_id = e.order_id;
    v_vh := v_inv.snapshot -> 'vatHome';
    v_vat_home := NULL;
    IF v_vh IS NOT NULL AND jsonb_typeof(v_vh) = 'object' THEN
      v_vat_home := v_vh || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_pool, v_vat_left, v_vat, (v_vh ->> 'fxRate')::numeric));
    END IF;
    v_vm := v_inv.snapshot -> 'vatMain';
    v_vat_main := NULL;
    IF v_vm IS NOT NULL AND jsonb_typeof(v_vm) = 'object' THEN
      IF jsonb_typeof(v_vm -> 'fxRate') = 'number' THEN
        v_vat_main := v_vm || jsonb_build_object('vatMinor', commerce.credit_vat_converted(v_pool, v_vat_left, v_vat, (v_vm ->> 'fxRate')::numeric));
      ELSE
        v_vat_main := v_vm || jsonb_build_object('vatMinor', v_vsum);
      END IF;
    END IF;
    SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO v_notes FROM (VALUES (1, 'credit_capped', v_short > 0)) AS t(ord, x, cond) WHERE cond;
    v_number := commerce.next_document_number(p_store, 'credit_note');
    SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'credit_note';
    v_docno := v_prefix || v_number::text;
    v_snap := jsonb_build_object(
      'version', 1, 'documentType', 'credit_note', 'number', v_docno, 'issuedOn', to_char(v_today, 'YYYY-MM-DD'),
      'locale', v_inv.snapshot -> 'locale', 'language', v_inv.snapshot -> 'language', 'currency', v_inv.snapshot -> 'currency',
      'seller', v_inv.snapshot -> 'seller', 'buyer', v_inv.snapshot -> 'buyer', 'order', v_inv.snapshot -> 'order',
      'refersTo', jsonb_build_object('invoiceId', v_inv.id, 'invoiceNumber', v_inv.snapshot ->> 'number', 'invoiceIssuedOn', v_inv.snapshot ->> 'issuedOn'),
      'reason', jsonb_build_object('kind', 'order_edit', 'returnNumber', NULL::text, 'editSeq', e.seq),
      'source', 'order_edit', 'lines', v_rows, 'buckets', v_buckets,
      'totals', jsonb_build_object('netMinor', v_net, 'vatMinor', v_vsum, 'grossMinor', v_gross),
      'vatHome', v_vat_home, 'vatMain', v_vat_main, 'treatment', v_inv.snapshot -> 'treatment',
      'position', jsonb_build_object('invoiceTotalMinor', v_pool_total, 'creditedBeforeMinor', v_before, 'creditedNowMinor', v_gross,
                                     'leftOnInvoiceMinor', v_pool_total - v_before - v_gross),
      'notes', v_notes);
    PERFORM set_config('commerce.issuing_document', p_edit::text, true);
    INSERT INTO commerce.credit_notes (
      store_id, invoice_id, refund_id, return_id, order_edit_id, series, number, document_number, currency, total_minor, tax_minor, net_minor,
      source, issued_on, locale, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token
    ) VALUES (
      p_store, v_inv.id, NULL, NULL, p_edit, 'credit_note', v_number, v_docno, v_inv.currency, v_gross, v_vsum, v_net,
      'order_edit', v_today, v_inv.locale,
      v_vat_home ->> 'currency', (v_vat_home ->> 'vatMinor')::bigint, v_inv.fx_rate, v_inv.fx_as_of, v_inv.fx_source,
      v_snap, commerce.new_document_token('crn_')
    ) RETURNING id INTO v_id;
    PERFORM set_config('commerce.issuing_document', '', true);
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, e.order_id, 'credit_note.issued', jsonb_build_object('creditNoteId', v_id, 'number', v_docno, 'key', p_edit, 'amountMinor', v_gross, 'edit', e.seq), 'system');
  END IF;

  -- ---- The additional invoice: what the change added ----
  WITH base AS (
    SELECT ol.ctid AS ord, ol.id, ol.sku, ol.title, ol.quantity, ol.unit_price_minor, ol.total_minor, ol.tax_minor, ol.tax_rate, ol.delivery, ol.gift, p.vat_category
      FROM commerce.order_lines ol
      LEFT JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
      LEFT JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
     WHERE ol.store_id = p_store AND ol.order_id = e.order_id AND ol.order_edit_id = p_edit
  ), c2 AS (
    SELECT base.*, total_minor - tax_minor AS net,
           greatest(unit_price_minor * quantity - commerce.vat_incl(unit_price_minor * quantity, tax_rate), total_minor - tax_minor) AS list_net
      FROM base
  ), c3 AS (
    SELECT c2.*, (2 * list_net + quantity) / (2 * quantity::bigint) AS unit_net FROM c2
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', id, 'sku', sku, 'title', title,
      'kind', CASE WHEN gift THEN 'gift' WHEN delivery = 'digital' THEN 'download' WHEN delivery = 'service' THEN 'service' ELSE 'goods' END,
      'quantity', quantity, 'listNetMinor', list_net, 'discountNetMinor', list_net - net, 'netMinor', net,
      'vatRate', tax_rate, 'basis', CASE WHEN vat_category = 'exempt' THEN 'exempt' ELSE 'standard' END,
      'vatMinor', tax_minor, 'grossMinor', total_minor, 'unitNetMinor', unit_net,
      'serviceDate', NULL::text, 'service', NULL::jsonb, 'wouldHaveRate', NULL::numeric
    ) ORDER BY ord), '[]'::jsonb),
    coalesce(bool_or(unit_net * quantity <> list_net), false)
    INTO v_lines, v_rounded
    FROM c3;
  v_ship := NULL;
  IF v_ship_gross > 0 THEN
    v_ship := jsonb_build_object(
      'label', v_label, 'netBeforeMinor', v_ship_gross - v_ship_vat, 'discountNetMinor', 0, 'netMinor', v_ship_gross - v_ship_vat,
      'vatRate', v_ship_rate, 'basis', 'standard', 'vatMinor', v_ship_vat, 'grossMinor', v_ship_gross, 'wouldHaveRate', NULL::numeric);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'basis', basis, 'netMinor', n, 'vatMinor', v, 'grossMinor', g) ORDER BY rate DESC, basis), '[]'::jsonb)
    INTO v_ibuckets
    FROM (
      SELECT rate, basis, sum(n)::bigint AS n, sum(v)::bigint AS v, sum(g)::bigint AS g FROM (
        SELECT (l ->> 'vatRate')::numeric AS rate, l ->> 'basis' AS basis, (l ->> 'netMinor')::bigint AS n, (l ->> 'vatMinor')::bigint AS v, (l ->> 'grossMinor')::bigint AS g
          FROM jsonb_array_elements(v_lines) AS l
        UNION ALL
        SELECT (v_ship ->> 'vatRate')::numeric, v_ship ->> 'basis', (v_ship ->> 'netMinor')::bigint, (v_ship ->> 'vatMinor')::bigint, (v_ship ->> 'grossMinor')::bigint
         WHERE v_ship IS NOT NULL
      ) x GROUP BY rate, basis HAVING sum(n) <> 0 OR sum(v) <> 0 OR sum(g) <> 0
    ) y;
  SELECT coalesce(sum((b ->> 'netMinor')::bigint), 0), coalesce(sum((b ->> 'vatMinor')::bigint), 0), coalesce(sum((b ->> 'grossMinor')::bigint), 0),
         coalesce(bool_or(b ->> 'basis' = 'exempt'), false)
    INTO v_inet, v_ivat, v_igross, v_exempt FROM jsonb_array_elements(v_ibuckets) AS b;

  IF v_igross > 0 THEN
    -- The treatment is the original's; its statements are the original's but for `exempt`, which is this invoice's own.
    SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY ord), '[]'::jsonb) INTO v_statements
      FROM (VALUES
        (1, 'reverse_charge', (v_inv.snapshot -> 'treatment' -> 'statements') ? 'reverse_charge'),
        (2, 'ioss', (v_inv.snapshot -> 'treatment' -> 'statements') ? 'ioss'),
        (3, 'not_registered', (v_inv.snapshot -> 'treatment' -> 'statements') ? 'not_registered'),
        (4, 'exempt', v_exempt)
      ) AS t(ord, s, cond) WHERE cond;
    -- The VAT in the seller's currency (Art. 230) at the rates of the day it is issued (a supply of its own), and in the store's main currency.
    v_vat_home := NULL;
    SELECT c.currency::text INTO v_home FROM commerce.countries c WHERE c.code = st.country;
    IF v_ivat > 0 AND commerce.home_vat_required(st.country::text, o.currency::text, v_home) THEN
      v_fx := commerce.fx_factor(o.store_id, o.currency::text, v_home);
      IF v_fx IS NULL THEN
        RAISE EXCEPTION 'invoice.no_exchange_rate: the VAT of the change cannot be stated in % without a rate', v_home USING ERRCODE = 'check_violation';
      END IF;
      v_vat_home := jsonb_build_object(
        'currency', v_home,
        'vatMinor', (SELECT coalesce(sum(commerce.convert_with((b ->> 'vatMinor')::bigint, v_fx)), 0) FROM jsonb_array_elements(v_ibuckets) AS b),
        'fxRate', v_fx, 'asOf', to_char(commerce.fx_as_of(o.store_id, o.currency::text, v_home), 'YYYY-MM-DD'),
        'source', CASE WHEN st.rates_auto THEN 'ecb_auto' ELSE 'owner' END);
    END IF;
    v_main := commerce.main_currency(o.store_id);
    v_vat_main := NULL;
    IF o.currency::text = v_main THEN
      v_vat_main := jsonb_build_object('currency', v_main, 'vatMinor', v_ivat, 'fxRate', NULL::numeric);
    ELSE
      v_fx := commerce.fx_factor(o.store_id, o.currency::text, v_main);
      IF v_fx IS NOT NULL THEN
        v_vat_main := jsonb_build_object(
          'currency', v_main,
          'vatMinor', (SELECT coalesce(sum(commerce.convert_with((b ->> 'vatMinor')::bigint, v_fx)), 0) FROM jsonb_array_elements(v_ibuckets) AS b),
          'fxRate', v_fx);
      END IF;
    END IF;
    -- How it was paid: the change's own payment, and the rest settled against what was paid for the original invoice.
    IF e.payment_id IS NOT NULL THEN
      SELECT p.provider, p.method, p.received_on INTO v_provider, v_method, v_received FROM commerce.payments p WHERE p.store_id = p_store AND p.id = e.payment_id;
      v_paid_now := least(greatest(e.difference_minor, 0), v_igross);
    END IF;
    SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb) INTO v_payments FROM (
      SELECT 1 AS ord, CASE WHEN v_provider = 'manual'
               THEN jsonb_build_object('kind', 'paid_outside', 'amountMinor', v_paid_now, 'provider', 'manual', 'method', v_method)
               ELSE jsonb_build_object('kind', 'paid_online', 'amountMinor', v_paid_now, 'provider', coalesce(v_provider, 'stripe')) END AS x
       WHERE v_paid_now > 0
      UNION ALL
      SELECT 2, jsonb_build_object('kind', 'settled_by_order', 'amountMinor', v_igross - v_paid_now, 'provider', 'order', 'invoiceNumber', v_inv.snapshot ->> 'number')
       WHERE v_igross - v_paid_now > 0
    ) pp;
    v_supply := CASE WHEN v_provider = 'manual' AND v_received IS NOT NULL THEN least(v_received, v_today) ELSE commerce.store_day(p_store, e.applied_at) END;
    SELECT coalesce(jsonb_agg(n ORDER BY ord), '[]'::jsonb) INTO v_inv_notes FROM (VALUES
      (1, 'buyer_incomplete', NOT coalesce((v_inv.snapshot -> 'buyer' ->> 'complete')::boolean, true)),
      (2, 'unit_price_rounded', v_rounded)
    ) AS t(ord, n, cond) WHERE cond;

    v_number := commerce.next_document_number(p_store, 'invoice');
    SELECT s.prefix INTO v_prefix FROM commerce.document_series s WHERE s.store_id = p_store AND s.series = 'invoice';
    v_docno := v_prefix || v_number::text;
    v_snap := jsonb_build_object(
      'version', 1, 'documentType', 'invoice', 'invoiceKind', 'order_edit', 'number', v_docno,
      'issuedOn', to_char(v_today, 'YYYY-MM-DD'), 'supplyDate', to_char(v_supply, 'YYYY-MM-DD'),
      'locale', v_inv.snapshot -> 'locale', 'language', v_inv.snapshot -> 'language', 'currency', v_inv.snapshot -> 'currency',
      'seller', v_inv.snapshot -> 'seller', 'buyer', v_inv.snapshot -> 'buyer', 'order', v_inv.snapshot -> 'order',
      'refersTo', jsonb_build_object('invoiceId', v_inv.id, 'invoiceNumber', v_inv.snapshot ->> 'number', 'invoiceIssuedOn', v_inv.snapshot ->> 'issuedOn'),
      'edit', jsonb_build_object('seq', e.seq),
      'lines', v_lines, 'shipping', v_ship, 'discounts', '[]'::jsonb, 'buckets', v_ibuckets,
      'totals', jsonb_build_object('netMinor', v_inet, 'vatMinor', v_ivat, 'grossMinor', v_igross),
      'vatHome', v_vat_home, 'vatMain', v_vat_main,
      'treatment', (v_inv.snapshot -> 'treatment') || jsonb_build_object('statements', v_statements),
      'payments', v_payments, 'deferred', '[]'::jsonb, 'notes', v_inv_notes);
    PERFORM set_config('commerce.issuing_document', p_edit::text, true);
    INSERT INTO commerce.invoices (
      store_id, order_id, order_edit_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, kind, issued_on, supply_date,
      locale, vat_kind, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token
    ) VALUES (
      p_store, e.order_id, p_edit, 'invoice', v_number, v_docno, o.currency, v_igross, v_ivat, v_inet, 'order_edit', v_today, v_supply,
      v_inv.locale, o.vat_kind,
      (v_vat_home ->> 'currency'), (v_vat_home ->> 'vatMinor')::bigint, (v_vat_home ->> 'fxRate')::numeric, (v_vat_home ->> 'asOf')::date, (v_vat_home ->> 'source'),
      v_snap, commerce.new_document_token('inv_')
    ) RETURNING id INTO v_id;
    PERFORM set_config('commerce.issuing_document', '', true);
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, e.order_id, 'invoice.issued', jsonb_build_object('invoiceId', v_id, 'number', v_docno, 'edit', e.seq), 'system');
  END IF;

  UPDATE commerce.order_edits SET documents = 'issued' WHERE id = p_edit;
  RETURN 'issued';
END;
$$;
--> statement-breakpoint

-- What applying a change and the five-minute job call: everything is caught, so the documents never stop the change or its money. A failure undoes everything
-- the block wrote (its numbers come back, the series stay gap-free), leaves the change `waiting` and writes the error down at most once an hour.
CREATE FUNCTION commerce.issue_edit_documents(p_store uuid, p_edit uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_state text;
  v_order uuid;
BEGIN
  BEGIN
    v_state := commerce.make_edit_documents(p_store, p_edit);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      SELECT e.order_id INTO v_order FROM commerce.order_edits e WHERE e.store_id = p_store AND e.id = p_edit;
      UPDATE commerce.order_edits SET documents = 'waiting' WHERE store_id = p_store AND id = p_edit AND status = 'applied' AND documents = 'none';
      IF v_order IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM commerce.order_events x
         WHERE x.store_id = p_store AND x.order_id = v_order AND x.type = 'invoice.failed' AND x.data ->> 'edit' = p_edit::text AND x.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
        VALUES (p_store, v_order, 'invoice.failed', jsonb_build_object('edit', p_edit, 'error', left(SQLERRM, 300)), 'system');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN 'waiting';
  END;
  RETURN v_state;
END;
$$;
--> statement-breakpoint

-- The job: issue the orders' own invoices that were waiting (up to p_limit), then the documents of changes that were waiting for them (in the order they were
-- applied, so each credits what the earlier ones left), then the credit notes of refunds that were waiting for an invoice. Returns the orders' invoices issued.
CREATE OR REPLACE FUNCTION commerce.issue_waiting_invoices(p_store uuid, p_limit integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT w.order_id FROM commerce.waiting_invoices(p_store) w WHERE w.reason = 'invoice_failed' LIMIT greatest(p_limit, 0)
  LOOP
    IF commerce.issue_order_invoice(p_store, r.order_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
  END LOOP;
  FOR r IN
    SELECT e.id FROM commerce.order_edits e
     WHERE e.store_id = p_store AND e.status = 'applied' AND e.documents IN ('none', 'waiting')
     ORDER BY e.applied_at, e.order_id, e.seq
     LIMIT greatest(p_limit, 0)
  LOOP
    PERFORM commerce.issue_edit_documents(p_store, r.id);
  END LOOP;
  PERFORM commerce.issue_missing_credit_notes(p_store);
  RETURN v_n;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Review fixes (wave 3 run 3): a change's payment that was never applied is not the order's money
-- ---------------------------------------------------------------------------

-- Whether a payment is the order's money: any payment that is not a change's, and a change's payment only when the change was applied with it. A payment for a
-- change that could no longer be applied (it came too late and is given back in full, docs/wave-3-fulfilment.md 2.7) is not: the order did not change.
CREATE FUNCTION commerce.payment_of_order(p_store uuid, p_payment uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT p.order_edit_id IS NULL OR EXISTS (
             SELECT 1 FROM commerce.order_edits e
              WHERE e.store_id = p.store_id AND e.id = p.order_edit_id AND e.status = 'applied' AND e.payment_id = p.id)
      FROM commerce.payments p WHERE p.store_id = p_store AND p.id = p_payment
  ), true)
$$;
--> statement-breakpoint

-- The bonus program (D130) and the store's affiliate program (D131) take back the refunded share of credits an order earned (and give back the share of credits
-- it used) by what was refunded of what was paid. The refund of a change's payment that was never applied moves nothing (the order is as it was paid), and
-- neither that payment nor its refunds count in the share. One anchored replacement per function, idempotent by its marker, raising when the anchor is gone.
DO $patch$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
  v_anchor text := E'  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM commerce.payments p\n'
    || E'   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND p.status = ''captured'' AND p.provider = ''stripe'';\n'
    || E'  SELECT coalesce(sum(r.amount_minor), 0) INTO v_refunded FROM commerce.refunds r\n'
    || E'    JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id\n'
    || E'   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND r.status <> ''failed'';';
  v_with text := E'  -- A change''s payment that was never applied with it (D174: it came too late and is given back in full) is not the order''s money.\n'
    || E'  IF NOT commerce.payment_of_order(v_r.store_id, v_r.payment_id) THEN\n'
    || E'    RETURN;\n'
    || E'  END IF;\n'
    || E'  SELECT coalesce(sum(p.amount_minor), 0) INTO v_paid FROM commerce.payments p\n'
    || E'   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND p.status = ''captured'' AND p.provider = ''stripe''\n'
    || E'     AND commerce.payment_of_order(p.store_id, p.id);\n'
    || E'  SELECT coalesce(sum(r.amount_minor), 0) INTO v_refunded FROM commerce.refunds r\n'
    || E'    JOIN commerce.payments p ON p.store_id = r.store_id AND p.id = r.payment_id\n'
    || E'   WHERE p.store_id = v_o.store_id AND p.order_id = v_o.id AND r.status <> ''failed''\n'
    || E'     AND commerce.payment_of_order(p.store_id, p.id);';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['commerce.bonus_refund_applied(uuid)', 'commerce.affiliate_refund_applied(uuid)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('payment_of_order' IN v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(v_def, v_anchor, v_with);
    IF v_new = v_def THEN RAISE EXCEPTION '%: the paid and refunded sums were not found, so a late change payment would move credits', v_fn; END IF;
    EXECUTE v_new;
  END LOOP;
END
$patch$;
--> statement-breakpoint
