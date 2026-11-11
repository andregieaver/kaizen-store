-- Undoing a parcel (wave 3, run 3, D174 follow-up, docs/wave-3-fulfilment.md "Undoing a parcel"): staff take "sent" back.
--
-- A parcel is a record (`commerce.shipments` and its `shipment_lines`), so it is undone, never deleted: `undone_at`, `undone_by` and `undo_reason` (added by
-- 20261007082927_shipment_undo.sql) are set once by `commerce.undo_shipment()`, and an undone parcel counts nowhere. Here:
--
-- * `shipments_guard()` (before update or delete): a parcel is never removed; its details never change; the only changes are `legacy` going from false to
--   true (the back-fills of 20261006235336 and 20261007070948, which the tests run again), the undo columns set once from null by `undo_shipment()` (it names
--   the parcel in the transaction-local setting `kaizen.shipment_undo`), and an undo reason replaced by the marker while the order is anonymised. An undone
--   parcel is never un-undone.
-- * `line_shipped()`, `order_fulfilment()` and `shipment_lines_rules()` replaced (same signatures) to read only parcels that are not undone; `line_to_send()`,
--   `refresh_fulfilment()` and everything built on them follow. `shipment_lines_rules()` also refuses a line added to an undone parcel.
-- * `order_edits_rules()` patched (anchored): a change is refused for an order with a parcel that is not undone (an undone parcel is not a sent one).
-- * `order_bookings_follow()` patched (anchored): an order moving back from `fulfilled` to `paid` (an undone parcel) is not a payment, so its bookings are not
--   confirmed again (a booking staff cancelled stays cancelled).
-- * `anonymise_order()` patched (anchored): an undo reason is staff's own words (it can hold a name, D162) and is replaced by the marker with the order.
-- * `undo_shipment(store, shipment, account, reason)`: under the order's row lock (the lock `markSent()` takes), refuses with `shipment_undo.<reason>` (not
--   found or another store's, a copy, undone already, an order that is not paid or sent, a change waiting for payment, a return or withdrawal made after the
--   parcel, a reason over 200 characters); otherwise marks the parcel undone, moves a `fulfilled` order back to `paid` when it has units to send again, clears
--   the recorded receipt (`delivered_at`: goods that were not sent were not received, CRD Art. 9(2)(b)) and writes the order events.
--
-- No function here contains a statement that removes rows.

-- ---------------------------------------------------------------------------
-- A parcel is a record: undone, never deleted
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.shipments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shipment.append_only: a parcel is a record; it is undone, never removed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['legacy', 'undone_at', 'undone_by', 'undo_reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['legacy', 'undone_at', 'undone_by', 'undo_reason']) THEN
    RAISE EXCEPTION 'shipment.frozen: a parcel''s carrier, tracking, label and order are a record and are not changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.legacy IS DISTINCT FROM OLD.legacy AND NOT (NEW.legacy AND NOT OLD.legacy) THEN
    RAISE EXCEPTION 'shipment.legacy: a parcel recorded before parcels named their lines stays so' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL THEN
    IF NEW.undone_at IS DISTINCT FROM OLD.undone_at OR NEW.undone_by IS DISTINCT FROM OLD.undone_by
       OR (NEW.undo_reason IS DISTINCT FROM OLD.undo_reason
           AND NOT (NEW.undo_reason = '[removed]' AND coalesce(current_setting('commerce.anonymising', true), '') = 'on')) THEN
      RAISE EXCEPTION 'shipment.undone_final: an undone parcel stays undone, as it was recorded' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.undone_at IS NOT NULL OR NEW.undone_by IS NOT NULL OR NEW.undo_reason IS NOT NULL THEN
    IF coalesce(current_setting('kaizen.shipment_undo', true), '') <> OLD.id::text THEN
      RAISE EXCEPTION 'shipment.undo_function: a parcel is undone only by commerce.undo_shipment()' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipments_guard BEFORE UPDATE OR DELETE ON commerce.shipments
  FOR EACH ROW EXECUTE FUNCTION commerce.shipments_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- An undone parcel counts nowhere
-- ---------------------------------------------------------------------------

-- The units of a line in parcels that are not undone: all of a physical line when its order has a legacy parcel that is not undone, else the sum of its live
-- parcels' lines (never above the line).
CREATE OR REPLACE FUNCTION commerce.line_shipped(p_order_line uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN ol.delivery <> 'physical' OR ol.variant_id IS NULL THEN 0
           WHEN EXISTS (
             SELECT 1 FROM commerce.shipments s
              WHERE s.store_id = ol.store_id AND s.order_id = ol.order_id AND s.legacy AND s.undone_at IS NULL
           ) THEN ol.quantity
           ELSE least(ol.quantity, coalesce((
             SELECT sum(sl.quantity) FROM commerce.shipment_lines sl
               JOIN commerce.shipments s ON s.store_id = sl.store_id AND s.id = sl.shipment_id
              WHERE sl.order_line_id = ol.id AND s.undone_at IS NULL
           ), 0))::integer
         END
    FROM commerce.order_lines ol WHERE ol.id = p_order_line
$$;
--> statement-breakpoint

-- The order's fulfilment state (`fulfilmentState()`), as in 20261007042008_fulfilment_unsent_closures.sql, with "has a parcel" read from parcels that are not
-- undone: an order whose only parcel was undone is `unsent` again.
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
    SELECT EXISTS (SELECT 1 FROM commerce.shipments sh JOIN o ON sh.store_id = o.store_id AND sh.order_id = o.id WHERE sh.undone_at IS NULL) AS shipped
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

-- A parcel's line (`shipment_lines_rules()`, replaced whole): as in 20261007042008_fulfilment_unsent_closures.sql, with the units already in parcels counted
-- from parcels that are not undone (an undone parcel's units are to send again), and no line added to an undone parcel.
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
  SELECT s.store_id, s.order_id, s.undone_at INTO v_ship FROM commerce.shipments s WHERE s.id = NEW.shipment_id;
  IF v_line IS NULL OR v_ship IS NULL OR v_line.store_id <> NEW.store_id OR v_ship.store_id <> NEW.store_id OR v_line.order_id <> v_ship.order_id THEN
    RAISE EXCEPTION 'shipment_line.order: a parcel holds lines of its own order only' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ship.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'shipment_line.undone: an undone parcel takes no lines' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.orders o WHERE o.id = v_ship.order_id AND o.copied_from IS NOT NULL) THEN
    RAISE EXCEPTION 'copied_order: an order copied from another store is history and cannot get a row in %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF v_line.delivery <> 'physical' OR v_line.variant_id IS NULL THEN
    RAISE EXCEPTION 'shipment_line.not_physical: only goods that are shipped go in a parcel' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(sl.quantity), 0)::integer INTO v_sent
    FROM commerce.shipment_lines sl JOIN commerce.shipments s ON s.store_id = sl.store_id AND s.id = sl.shipment_id
   WHERE sl.order_line_id = NEW.order_line_id AND s.undone_at IS NULL;
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

-- A change (D174 edit) is refused for an order with a parcel that is not undone: an undone parcel was not sent.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.order_edits_rules()'::regprocedure);
  IF position('s.undone_at IS NULL' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'IF EXISTS (SELECT 1 FROM commerce.shipments s WHERE s.store_id = NEW.store_id AND s.order_id = NEW.order_id) THEN',
    E'IF EXISTS (SELECT 1 FROM commerce.shipments s WHERE s.store_id = NEW.store_id AND s.order_id = NEW.order_id AND s.undone_at IS NULL) THEN'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'order_edits_rules: the parcel test was not found, so an undone parcel would still block a change'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- An order moving back from `fulfilled` to `paid` (an undone parcel) is not a payment: its bookings are not confirmed again.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.order_bookings_follow()'::regprocedure);
  IF position('OLD.status IS DISTINCT FROM ''fulfilled''' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  IF NEW.status = ''paid'' THEN\n',
    E'  IF NEW.status = ''paid'' AND OLD.status IS DISTINCT FROM ''fulfilled'' THEN\n'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'order_bookings_follow: the paid test was not found, so an undone parcel would confirm bookings again'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- (Anchored on a statement, never a comment: production's function copies keep no comments.)
-- Anonymising an order replaces an undo reason (staff's own words, which can hold a name) with the marker, as it does a refund's reason.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  IF position('undo_reason' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  UPDATE commerce.refunds r SET reason = ''[removed]''',
    E'  UPDATE commerce.shipments SET undo_reason = ''[removed]''\n'
    || E'   WHERE store_id = p_store AND order_id = p_order AND undo_reason IS NOT NULL AND undo_reason <> ''[removed]'';\n'
    || E'  UPDATE commerce.refunds r SET reason = ''[removed]'''
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'anonymise_order: the free-text step was not found, so an undo reason would be kept'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Undoing a parcel
-- ---------------------------------------------------------------------------

-- Takes "sent" back for one parcel (`undoShipment()` is the only caller). Under the order's row lock: the parcel is the store's and not undone, the order is
-- paid or sent, not a copy, has no change waiting for payment, and no return or withdrawal was made after the parcel was recorded (its units may be these
-- goods: the return is settled first). Then the parcel is undone, a `fulfilled` order with units to send again is `paid` once more, a recorded receipt is
-- cleared (goods that were not sent were not received) and the history says so (`order.shipment_undone`, with the reason only in `data.note`, which
-- anonymising removes). The carrier's booking is not cancelled and nobody is emailed: the caller says so. Returns what the caller tells staff.
CREATE FUNCTION commerce.undo_shipment(p_store uuid, p_shipment uuid, p_account uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_order record;
  v_ship record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lines jsonb;
  v_units integer;
  v_left integer;
  v_reopened boolean := false;
BEGIN
  SELECT s.order_id INTO v_order_id FROM commerce.shipments s WHERE s.store_id = p_store AND s.id = p_shipment;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'shipment_undo.not_found: no such parcel in this store' USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.id, o.status::text AS status, o.copied_from IS NOT NULL AS copied, o.delivered_at INTO v_order
    FROM commerce.orders o WHERE o.store_id = p_store AND o.id = v_order_id FOR UPDATE;
  SELECT s.* INTO v_ship FROM commerce.shipments s WHERE s.store_id = p_store AND s.id = p_shipment FOR UPDATE;
  IF v_order.copied THEN
    RAISE EXCEPTION 'shipment_undo.copied: a copied order is history' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ship.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'shipment_undo.already_undone: this parcel was undone already' USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.status NOT IN ('paid', 'fulfilled') THEN
    RAISE EXCEPTION 'shipment_undo.status: only a parcel of a paid or sent order is undone (the order is %)', v_order.status USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM commerce.order_edits e WHERE e.store_id = p_store AND e.order_id = v_order_id AND e.status = 'awaiting_payment') THEN
    RAISE EXCEPTION 'shipment_undo.edit_pending: a change to this order waits for the customer''s payment' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
       SELECT 1 FROM commerce.returns r
        WHERE r.store_id = p_store AND r.order_id = v_order_id AND r.status::text NOT IN ('declined', 'cancelled') AND r.created_at >= v_ship.created_at
     ) OR EXISTS (
       SELECT 1 FROM commerce.withdrawal_requests w
        WHERE w.store_id = p_store AND w.order_id = v_order_id AND w.status = 'confirmed' AND w.confirmed_at >= v_ship.created_at
     ) THEN
    RAISE EXCEPTION 'shipment_undo.return: a return or withdrawal was made after this parcel was recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(coalesce(v_reason, '')) > 200 THEN
    RAISE EXCEPTION 'shipment_undo.reason_too_long: the reason is at most 200 characters' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('lineId', sl.order_line_id, 'sku', ol.sku, 'title', ol.title, 'quantity', sl.quantity) ORDER BY ol.title, ol.sku, ol.id), '[]'::jsonb),
         coalesce(sum(sl.quantity), 0)::integer
    INTO v_lines, v_units
    FROM commerce.shipment_lines sl
    JOIN commerce.order_lines ol ON ol.store_id = sl.store_id AND ol.id = sl.order_line_id
   WHERE sl.store_id = p_store AND sl.shipment_id = p_shipment;

  PERFORM set_config('kaizen.shipment_undo', p_shipment::text, true);
  UPDATE commerce.shipments SET undone_at = now(), undone_by = p_account, undo_reason = v_reason WHERE store_id = p_store AND id = p_shipment;
  PERFORM set_config('kaizen.shipment_undo', '', true);

  IF v_order.status = 'fulfilled' AND commerce.order_fulfilment(v_order_id) IS DISTINCT FROM 'sent' THEN
    UPDATE commerce.orders SET status = 'paid' WHERE store_id = p_store AND id = v_order_id;
    v_reopened := true;
  END IF;
  IF v_order.delivered_at IS NOT NULL THEN
    UPDATE commerce.orders SET delivered_at = NULL WHERE store_id = p_store AND id = v_order_id;
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, v_order_id, 'order.delivery_reopened', jsonb_build_object('was', v_order.delivered_at, 'undone', p_shipment), 'system');
  END IF;
  SELECT coalesce(sum(commerce.line_to_send(ol.id)), 0)::integer INTO v_left
    FROM commerce.order_lines ol WHERE ol.store_id = p_store AND ol.order_id = v_order_id;

  INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
  VALUES (p_store, v_order_id, 'order.shipment_undone',
          jsonb_strip_nulls(jsonb_build_object(
            'shipment', p_shipment, 'carrier', v_ship.carrier, 'tracking', v_ship.tracking_number, 'carrierId', v_ship.carrier_id,
            'legacy', v_ship.legacy, 'units', v_units, 'lines', v_lines, 'left', v_left, 'reopened', v_reopened, 'note', v_reason
          )),
          'staff');

  RETURN jsonb_build_object(
    'orderId', v_order_id, 'units', v_units, 'left', v_left, 'reopened', v_reopened, 'deliveredWas', v_order.delivered_at,
    'carrier', v_ship.carrier, 'carrierId', v_ship.carrier_id, 'consignment', v_ship.consignment_number, 'tracking', v_ship.tracking_number,
    'legacy', v_ship.legacy
  );
END;
$$;
