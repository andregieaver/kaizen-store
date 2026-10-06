-- Inventory with locations, an adjustment history, backorders and low-stock notices (wave 3, D172, docs/wave-3-inventory.md 3.3 to 3.7).
--
-- * Every change of `inventory_levels.on_hand` becomes a row of the append-only `inventory_movements` (a trigger, so every writer is
--   covered: the app, the SQL functions, a migration, a test). Why, by whom and for which order comes from `commerce.stock_context()`,
--   a transaction-local setting; with none, an insert is `opening`/`system` and an update `correction`/`system`, and a context that
--   cannot be read is `system` and never raises, so the trigger never makes a payment fail.
-- * A level goes below zero only for a variant that keeps selling on backorder (`stock_policy = 'continue'`), or when the write raises
--   it; a level for a variant that is not goods is refused. This replaces the dropped check `inventory_levels_on_hand_non_negative`.
-- * The history is append-only (no update; a removal only past 24 months, by the daily job in application code). Copied orders get none.
-- * A store always keeps one active location, and a location holding live checkouts is not deactivated.
-- * `commerce.draw_order_stock()` is the draw `complete_order_payment()` did, moved into a function and extended: ranked locations, rows
--   locked in (variant, location) order, and the units sold beyond stock marked on the order lines. Whoever pays first gets the stock.
-- * `commerce.variant_availability` is the one reader of stock. `commerce.stock_alerts` holds the low-stock state, one row a variant.
-- * `clone_store()`, `duplicate_store()` and the data job rules are patched on their live definitions (as 20261005162123_redirects_copy.sql
--   did): a patch that cannot find its anchor raises, so a definition changed since is never silently skipped.
--
-- The writes of old code during the deploy keep working: the trigger records them as `system`, the new columns have defaults, and the
-- dropped check is replaced by a stricter trigger in this file.

-- The levels are not written while this file runs, so the opening movements below cannot double-count a sale made by old code.
LOCK TABLE commerce.inventory_levels IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The context of a change
-- ---------------------------------------------------------------------------

-- Sets why, by whom and for which order the levels written in this transaction change. Local to the transaction, so a pooled connection
-- never carries it to the next one. `commerce.stock_context_clear()` ends it early (the helper in the app clears it after its block).
CREATE FUNCTION commerce.stock_context(
  p_reason text,
  p_source text,
  p_account uuid DEFAULT NULL,
  p_order uuid DEFAULT NULL,
  p_return uuid DEFAULT NULL,
  p_job uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('kaizen.stock', jsonb_strip_nulls(jsonb_build_object(
    'reason', p_reason, 'source', p_source, 'account', p_account, 'order', p_order,
    'return', p_return, 'job', p_job, 'note', p_note))::text, true);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION commerce.stock_context_clear()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('kaizen.stock', '', true);
END;
$$;
--> statement-breakpoint

-- A uuid out of the context, or null when it is not one.
CREATE FUNCTION commerce.stock_context_uuid(p_context jsonb, p_key text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (p_context ->> p_key)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The low-stock state (3.4): one row a variant with a level set; the table is the one in src/lib/stock-alerts.ts
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.refresh_stock_alert(p_store uuid, p_variant uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_threshold integer;
  v_stock integer;
  v_prev text;
  v_state text;
BEGIN
  -- A failure here never stops a sale or a count: it becomes a warning and the next change refreshes the row.
  BEGIN
    SELECT v.low_stock_threshold INTO v_threshold
      FROM commerce.product_variants v WHERE v.store_id = p_store AND v.id = p_variant;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_threshold IS NULL AND NOT EXISTS (
         SELECT 1 FROM commerce.stock_alerts a WHERE a.store_id = p_store AND a.variant_id = p_variant) THEN
      RETURN;
    END IF;
    -- Lock the row first, then count, so two changes of one variant at two locations both see the other's.
    INSERT INTO commerce.stock_alerts (store_id, variant_id, state) VALUES (p_store, p_variant, 'off')
      ON CONFLICT (store_id, variant_id) DO NOTHING;
    SELECT a.state INTO v_prev FROM commerce.stock_alerts a
     WHERE a.store_id = p_store AND a.variant_id = p_variant FOR UPDATE;
    SELECT coalesce(sum(l.on_hand), 0)::integer INTO v_stock
      FROM commerce.inventory_levels l
      JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active
     WHERE l.store_id = p_store AND l.variant_id = p_variant;
    v_state := CASE WHEN v_threshold IS NULL THEN 'off' WHEN v_stock <= v_threshold THEN 'low' ELSE 'ok' END;
    UPDATE commerce.stock_alerts SET
      state = v_state,
      crossed_at = CASE WHEN v_state <> 'low' THEN NULL WHEN v_prev = 'low' THEN crossed_at ELSE now() END,
      notified_at = CASE WHEN v_state = 'low' AND v_prev = 'ok' THEN NULL
                         WHEN v_state = 'low' AND v_prev = 'off' THEN now()
                         ELSE notified_at END,
      stock_at_crossing = CASE WHEN v_state <> 'low' THEN NULL WHEN v_prev = 'low' THEN stock_at_crossing ELSE v_stock END,
      updated_at = now()
     WHERE store_id = p_store AND variant_id = p_variant;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_stock_alert: % (%)', SQLERRM, SQLSTATE;
  END;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Every change of a level is a movement (3.3.1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.record_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid;
  v_variant uuid;
  v_location uuid;
  v_delta integer;
  v_after integer;
  v_ctx jsonb;
  v_raw text;
  v_reason text;
  v_source text;
  v_note text;
  v_account uuid;
  v_order uuid;
  v_return uuid;
  v_job uuid;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_store := NEW.store_id; v_variant := NEW.variant_id; v_location := NEW.location_id;
    v_after := NEW.on_hand;
    v_delta := NEW.on_hand - CASE WHEN TG_OP = 'UPDATE' THEN OLD.on_hand ELSE 0 END;
  ELSE
    -- The level was removed: what it held leaves with it.
    v_store := OLD.store_id; v_variant := OLD.variant_id; v_location := OLD.location_id;
    v_delta := -OLD.on_hand; v_after := 0;
  END IF;
  -- A write that changes nothing is not a movement.
  IF v_delta = 0 THEN RETURN NULL; END IF;

  -- Why: a context that cannot be read is no context, never an error.
  BEGIN
    v_raw := current_setting('kaizen.stock', true);
    IF v_raw IS NOT NULL AND v_raw <> '' THEN v_ctx := v_raw::jsonb; END IF;
    IF v_ctx IS NOT NULL AND jsonb_typeof(v_ctx) <> 'object' THEN v_ctx := NULL; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ctx := NULL;
  END;
  v_reason := v_ctx ->> 'reason';
  v_source := v_ctx ->> 'source';
  IF v_reason IS NULL OR v_reason NOT IN ('received', 'correction', 'count', 'damaged', 'lost', 'promotion', 'sale',
                                         'order_restock', 'return_restock', 'opening', 'system') THEN
    v_reason := CASE WHEN TG_OP = 'INSERT' THEN 'opening' ELSE 'correction' END;
    v_source := 'system';
  ELSIF v_source IS NULL OR v_source NOT IN ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout',
                                            'ai_manager', 'copy', 'system') THEN
    v_source := 'system';
  END IF;
  v_account := commerce.stock_context_uuid(v_ctx, 'account');
  v_order := commerce.stock_context_uuid(v_ctx, 'order');
  v_return := commerce.stock_context_uuid(v_ctx, 'return');
  v_job := commerce.stock_context_uuid(v_ctx, 'job');
  v_note := left(nullif(btrim(coalesce(v_ctx ->> 'note', '')), ''), 200);

  BEGIN
    INSERT INTO commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source,
                                              actor_account_id, order_id, return_id, job_id, note)
    VALUES (v_store, v_variant, v_location, v_delta, v_after, v_reason, v_source, v_account, v_order, v_return, v_job, v_note);
  EXCEPTION WHEN foreign_key_violation THEN
    -- An order or a return in the context that is not this store's: record the change without it, rather than stop a payment.
    RAISE WARNING 'inventory movement without its context: %', SQLERRM;
    INSERT INTO commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source)
    VALUES (v_store, v_variant, v_location, v_delta, v_after,
            CASE WHEN TG_OP = 'INSERT' THEN 'opening' ELSE 'correction' END, 'system');
  END;

  PERFORM commerce.refresh_stock_alert(v_store, v_variant);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_levels_movement
  AFTER INSERT OR UPDATE OF on_hand OR DELETE ON commerce.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION commerce.record_inventory_movement();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Negative only where allowed (3.3.3). Replaces the dropped check `inventory_levels_on_hand_non_negative`.
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.inventory_levels_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_delivery text;
  v_policy text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.on_hand = OLD.on_hand THEN RETURN NEW; END IF;
  SELECT v.delivery::text, v.stock_policy INTO v_delivery, v_policy
    FROM commerce.product_variants v WHERE v.store_id = NEW.store_id AND v.id = NEW.variant_id;
  -- A new level is for goods only. A level that was made while the variant was goods stays when it becomes a download or a service
  -- (nothing reads it any more) and may still be changed: the rule stops stock being made for what has none, not an old row.
  IF TG_OP = 'INSERT' AND v_delivery IS DISTINCT FROM 'physical' THEN
    RAISE EXCEPTION 'stock.not_goods: only goods that are shipped have a stock level' USING ERRCODE = 'check_violation';
  END IF;
  -- Below zero only by a variant that keeps selling on backorder; a rise is always allowed (a refund or a count on a variant
  -- switched back to "stop selling" while it was negative).
  IF NEW.on_hand < 0 AND v_policy <> 'continue' AND NOT (TG_OP = 'UPDATE' AND NEW.on_hand >= OLD.on_hand) THEN
    RAISE EXCEPTION 'stock.negative: a level goes below zero only for a variant that keeps selling on backorder' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_levels_rules
  BEFORE INSERT OR UPDATE OF on_hand ON commerce.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION commerce.inventory_levels_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The history is append-only (3.3.4); copied orders get none (3.3.5)
-- ---------------------------------------------------------------------------

-- No statement of removal is in this function: it only says yes or no (as guard_audit_log() does). The daily job removes, past 24 months.
-- The NEWEST movement of a level is never removed, however old: it is the baseline the ledger check starts from once the older ones
-- are gone (`on_hand_after - delta` is what the level held before it), so the check keeps telling a real gap from retention.
CREATE FUNCTION commerce.guard_inventory_movements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'commerce.inventory_movements is append-only; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.created_at < now() - interval '24 months' THEN
    IF EXISTS (SELECT 1 FROM commerce.inventory_movements n
                WHERE n.store_id = OLD.store_id AND n.variant_id = OLD.variant_id AND n.location_id = OLD.location_id AND n.id > OLD.id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'commerce.inventory_movements keeps the newest movement of a level, the baseline of the ledger; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE EXCEPTION 'commerce.inventory_movements is append-only for 24 months; % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_movements_guard
  BEFORE UPDATE OR DELETE ON commerce.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION commerce.guard_inventory_movements();
--> statement-breakpoint

CREATE TRIGGER inventory_movements_refuse_copied_order
  BEFORE INSERT ON commerce.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();
--> statement-breakpoint

ALTER TABLE commerce.inventory_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.stock_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The movements of a variant at a location explain its level: the pairs where they do not, for a store. What the movements still kept
-- explain is the level before the OLDEST of them (`on_hand_after - delta`, which is 0 while the opening movement is there and the
-- level the clean-up left when it is not) plus what they add up to. So the 24-month clean-up never makes a whole history look broken,
-- and a level written in a way no trigger saw still does. `moved` is that figure.
CREATE FUNCTION commerce.inventory_ledger_check(p_store uuid)
RETURNS TABLE (variant_id uuid, location_id uuid, on_hand integer, moved bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(l.variant_id, m.variant_id), coalesce(l.location_id, m.location_id),
         coalesce(l.on_hand, 0), (coalesce(m.baseline, 0) + coalesce(m.total, 0))::bigint
    FROM (SELECT il.variant_id, il.location_id, il.on_hand
            FROM commerce.inventory_levels il WHERE il.store_id = p_store) l
    FULL JOIN (SELECT im.variant_id, im.location_id, sum(im.delta) AS total,
                      (array_agg(im.on_hand_after - im.delta ORDER BY im.id))[1] AS baseline
                 FROM commerce.inventory_movements im WHERE im.store_id = p_store
                GROUP BY im.variant_id, im.location_id) m
      ON m.variant_id = l.variant_id AND m.location_id = l.location_id
   WHERE coalesce(l.on_hand, 0) <> coalesce(m.baseline, 0) + coalesce(m.total, 0);
$$;
--> statement-breakpoint

-- The opening movements: what each level holds now that no movement explains (the levels are locked while this file runs).
INSERT INTO commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source)
SELECT l.store_id, l.variant_id, l.location_id, l.on_hand - coalesce(m.total, 0), l.on_hand, 'opening', 'system'
  FROM commerce.inventory_levels l
  LEFT JOIN (SELECT im.variant_id, im.location_id, sum(im.delta) AS total
               FROM commerce.inventory_movements im GROUP BY im.variant_id, im.location_id) m
    ON m.variant_id = l.variant_id AND m.location_id = l.location_id
 WHERE l.on_hand <> coalesce(m.total, 0);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Locations (3.3.6): one active location always, none deactivated while checkouts hold stock there
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.inventory_locations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    -- Two deactivations at once cannot both pass: the store's row is locked first (a lock that does not block references to it).
    PERFORM 1 FROM commerce.stores s WHERE s.id = NEW.store_id FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM commerce.inventory_locations o
                    WHERE o.store_id = NEW.store_id AND o.active AND o.id <> NEW.id) THEN
      RAISE EXCEPTION 'location.last_active: a store keeps at least one active stock location' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM commerce.inventory_reservations r
                WHERE r.store_id = NEW.store_id AND r.location_id = NEW.id AND r.released_at IS NULL AND r.expires_at > now()) THEN
      RAISE EXCEPTION 'location.held: checkouts in progress hold stock at this location' USING ERRCODE = 'check_violation';
    END IF;
    NEW.deactivated_at := coalesce(NEW.deactivated_at, now());
  ELSIF NOT OLD.active AND NEW.active THEN
    NEW.deactivated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_locations_guard
  BEFORE UPDATE OF active ON commerce.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION commerce.inventory_locations_guard();
--> statement-breakpoint

-- Stock that stops (or starts) counting changes the sum a low-stock level is compared with.
CREATE FUNCTION commerce.inventory_locations_refresh_alerts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM commerce.refresh_stock_alert(l.store_id, l.variant_id)
      FROM commerce.inventory_levels l
     WHERE l.store_id = NEW.store_id AND l.location_id = NEW.id
       AND (EXISTS (SELECT 1 FROM commerce.product_variants v
                     WHERE v.store_id = l.store_id AND v.id = l.variant_id AND v.low_stock_threshold IS NOT NULL)
            OR EXISTS (SELECT 1 FROM commerce.stock_alerts a WHERE a.store_id = l.store_id AND a.variant_id = l.variant_id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refreshing stock alerts after a location changed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_locations_alerts
  AFTER UPDATE OF active ON commerce.inventory_locations
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION commerce.inventory_locations_refresh_alerts();
--> statement-breakpoint

CREATE FUNCTION commerce.product_variants_refresh_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.refresh_stock_alert(NEW.store_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER product_variants_alert_changed
  AFTER UPDATE OF low_stock_threshold ON commerce.product_variants
  FOR EACH ROW WHEN (OLD.low_stock_threshold IS DISTINCT FROM NEW.low_stock_threshold)
  EXECUTE FUNCTION commerce.product_variants_refresh_alert();
--> statement-breakpoint

CREATE TRIGGER product_variants_alert_created
  AFTER INSERT ON commerce.product_variants
  FOR EACH ROW WHEN (NEW.low_stock_threshold IS NOT NULL)
  EXECUTE FUNCTION commerce.product_variants_refresh_alert();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- An order line's backorder is the draw's alone (3.1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.order_lines_backorder_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('kaizen.drawing', true) = 'on' THEN
    -- The draw may rewrite the units once the order is paid, and state the days once; the stated days never change.
    IF OLD.backorder_days IS NOT NULL AND NEW.backorder_days IS DISTINCT FROM OLD.backorder_days THEN
      RAISE EXCEPTION 'order_line.backorder_fixed: the delivery time stated on an order line does not change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.backorder_quantity IS DISTINCT FROM OLD.backorder_quantity OR NEW.backorder_days IS DISTINCT FROM OLD.backorder_days THEN
    RAISE EXCEPTION 'order_line.backorder_fixed: the backorder of an order line is set when the order is placed and settled when it is paid' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER order_lines_backorder_frozen
  BEFORE UPDATE OF backorder_quantity, backorder_days ON commerce.order_lines
  FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_backorder_frozen();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The one reader of stock (3.5)
-- ---------------------------------------------------------------------------

-- `in_stock` is what a shopper can buy now: each ACTIVE location's free units counted at no less than zero, then summed. That is the
-- floor `allocate()` and `placeOrder()` use (a location that owes units never takes units away from one that holds stock), so the
-- page, the cart and the order agree. `raw_available` is the signed sum (it can be negative; the Inventory page's figure).
-- `can_buy` is `in_stock > 0` or the variant keeps selling on backorder. A variant with no level has 0 (a download or a service is
-- not stock, and its readers say so by `delivery`).
CREATE VIEW commerce.variant_availability WITH (security_invoker = true) AS
SELECT v.store_id,
       v.id AS variant_id,
       v.delivery::text AS delivery,
       a.free::integer AS in_stock,
       a.available::integer AS raw_available,
       v.stock_policy,
       v.backorder_days,
       (a.free > 0 OR v.stock_policy = 'continue') AS can_buy
  FROM commerce.product_variants v
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(s.available), 0) AS available,
           coalesce(sum(greatest(s.available, 0)), 0) AS free
      FROM commerce.available_stock s
      JOIN commerce.inventory_locations loc ON loc.store_id = s.store_id AND loc.id = s.location_id AND loc.active
     WHERE s.store_id = v.store_id AND s.variant_id = v.id
  ) a;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The draw (3.5): what complete_order_payment() did, moved into a function and extended
-- ---------------------------------------------------------------------------

-- NOTE: replaced by 20261006121317_inventory_draw_claims.sql (a checkout's physical claim survives a later checkout paying first); this
-- is the definition that was live for the seconds between the two files, which a payment never reaches without the column that file needs.
-- Draws an order's physical lines from stock and returns the units that were short (a `deny` variant with too little left; the
-- caller writes `stock.short`). For each variant, in variant order, the level rows are locked in location order, then the units come
--   (1) from the locations where the order's own live reservations are, in rank order (`priority`, `created_at`, `id`), no more than
--       is there for a `deny` variant;
--   (2) from any active location with stock, in rank order (a hold that expired before payment);
--   (3) for a `continue` variant the remainder at the first active location with a level row for it (else the first active location),
--       taking `on_hand` below zero; for a `deny` variant the remainder is short.
-- The units drawn beyond what was on hand are the BACKORDERED units: they are written to the order's lines of the variant (lines that
-- were paid for first, then a free gift, in id order), replacing the figure from placement: whoever pays first gets the stock.
CREATE FUNCTION commerce.draw_order_stock(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_order commerce.orders%ROWTYPE;
  v_var record;
  v_hold record;
  v_level record;
  v_line record;
  v_prev_stock text;
  v_prev_drawing text;
  v_left integer;
  v_take integer;
  v_before integer;
  v_back integer;
  v_alloc integer;
  v_home uuid;
  v_short integer := 0;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_order FROM commerce.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown order %', p_order_id;
  END IF;

  v_prev_stock := current_setting('kaizen.stock', true);
  v_prev_drawing := current_setting('kaizen.drawing', true);
  PERFORM commerce.stock_context('sale', 'order', NULL, p_order_id, NULL, NULL, NULL);
  PERFORM set_config('kaizen.drawing', 'on', true);

  FOR v_var IN
    SELECT ol.variant_id, sum(ol.quantity)::integer AS quantity, v.stock_policy, v.backorder_days
      FROM commerce.order_lines ol
      JOIN commerce.product_variants v ON v.store_id = ol.store_id AND v.id = ol.variant_id
     WHERE ol.order_id = p_order_id AND ol.variant_id IS NOT NULL AND ol.delivery = 'physical'
     GROUP BY ol.variant_id, v.stock_policy, v.backorder_days
     ORDER BY ol.variant_id
  LOOP
    -- Every writer locks a variant's level rows in location order, so two payments cannot deadlock.
    PERFORM 1 FROM commerce.inventory_levels l
     WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id
     ORDER BY l.location_id FOR UPDATE;
    v_left := v_var.quantity;
    v_back := 0;

    -- (1) Where the items were held for this order.
    FOR v_hold IN
      SELECT loc.id AS location_id, sum(r.quantity)::integer AS quantity
        FROM commerce.inventory_reservations r
        JOIN commerce.inventory_locations loc ON loc.store_id = r.store_id AND loc.id = r.location_id
       WHERE r.order_id = p_order_id AND r.variant_id = v_var.variant_id AND r.released_at IS NULL
       GROUP BY loc.id, loc.priority, loc.created_at
       ORDER BY loc.priority, loc.created_at, loc.id
    LOOP
      EXIT WHEN v_left = 0;
      SELECT l.on_hand INTO v_before FROM commerce.inventory_levels l
       WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.location_id = v_hold.location_id;
      CONTINUE WHEN NOT FOUND;
      v_take := least(v_hold.quantity, v_left);
      -- Only what is really there, unless the variant keeps selling past zero: a hold does not create stock.
      IF v_var.stock_policy <> 'continue' THEN
        v_take := least(v_take, greatest(v_before, 0));
      END IF;
      IF v_take > 0 THEN
        UPDATE commerce.inventory_levels SET on_hand = on_hand - v_take, updated_at = now()
         WHERE store_id = v_order.store_id AND variant_id = v_var.variant_id AND location_id = v_hold.location_id;
        v_back := v_back + greatest(v_take - greatest(v_before, 0), 0);
        v_left := v_left - v_take;
      END IF;
    END LOOP;

    -- (2) Then anywhere stock is left (a hold that expired before payment), in rank order.
    FOR v_level IN
      SELECT l.location_id, l.on_hand
        FROM commerce.inventory_levels l
        JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active
       WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.on_hand > 0
       ORDER BY loc.priority, loc.created_at, loc.id
    LOOP
      EXIT WHEN v_left = 0;
      v_take := least(v_level.on_hand, v_left);
      UPDATE commerce.inventory_levels SET on_hand = on_hand - v_take, updated_at = now()
       WHERE store_id = v_order.store_id AND variant_id = v_var.variant_id AND location_id = v_level.location_id;
      v_left := v_left - v_take;
    END LOOP;

    -- (3) The remainder: backordered at the first location that stocks the variant, or short.
    IF v_left > 0 THEN
      IF v_var.stock_policy = 'continue' THEN
        SELECT loc.id INTO v_home
          FROM commerce.inventory_locations loc
          JOIN commerce.inventory_levels l ON l.store_id = loc.store_id AND l.location_id = loc.id AND l.variant_id = v_var.variant_id
         WHERE loc.store_id = v_order.store_id AND loc.active
         ORDER BY loc.priority, loc.created_at, loc.id LIMIT 1;
        IF v_home IS NULL THEN
          SELECT loc.id INTO v_home FROM commerce.inventory_locations loc
           WHERE loc.store_id = v_order.store_id AND loc.active
           ORDER BY loc.priority, loc.created_at, loc.id LIMIT 1;
          IF v_home IS NOT NULL THEN
            INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
            VALUES (v_order.store_id, v_var.variant_id, v_home, 0)
            ON CONFLICT (variant_id, location_id) DO NOTHING;
          END IF;
        END IF;
        IF v_home IS NULL THEN
          v_short := v_short + v_left;
        ELSE
          SELECT l.on_hand INTO v_before FROM commerce.inventory_levels l
           WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.location_id = v_home FOR UPDATE;
          UPDATE commerce.inventory_levels SET on_hand = on_hand - v_left, updated_at = now()
           WHERE store_id = v_order.store_id AND variant_id = v_var.variant_id AND location_id = v_home;
          v_back := v_back + greatest(v_left - greatest(v_before, 0), 0);
        END IF;
      ELSE
        v_short := v_short + v_left;
      END IF;
    END IF;

    -- The backordered units go to the variant's lines: paid lines first, then a gift, in id order.
    IF v_back > 0 THEN
      FOR v_line IN
        SELECT ol.id, ol.quantity, ol.sku FROM commerce.order_lines ol
         WHERE ol.order_id = p_order_id AND ol.variant_id = v_var.variant_id AND ol.delivery = 'physical'
         ORDER BY ol.gift, ol.id
      LOOP
        v_alloc := least(v_line.quantity, v_back);
        UPDATE commerce.order_lines
           SET backorder_quantity = v_alloc, backorder_days = coalesce(backorder_days, v_var.backorder_days)
         WHERE id = v_line.id;
        IF v_alloc > 0 THEN
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('sku', v_line.sku, 'quantity', v_alloc));
        END IF;
        v_back := v_back - v_alloc;
      END LOOP;
    ELSE
      UPDATE commerce.order_lines SET backorder_quantity = 0
       WHERE order_id = p_order_id AND variant_id = v_var.variant_id AND backorder_quantity <> 0;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (v_order.store_id, p_order_id, 'stock.backordered', jsonb_build_object('lines', v_lines), 'system');
  END IF;

  PERFORM set_config('kaizen.stock', coalesce(v_prev_stock, ''), true);
  PERFORM set_config('kaizen.drawing', coalesce(v_prev_drawing, ''), true);
  RETURN v_short;
END;
$$;
--> statement-breakpoint

-- complete_order_payment() draws through it. The live definition is patched (as 20261004125337_order_invoices_rules.sql patched this function),
-- so its last statement, the invoice, and everything a later migration changed are kept; the old loop is replaced by one call.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_from text := E'  FOR v_line IN\n    SELECT variant_id, sum(quantity)::int AS quantity';
  v_to text := E'    v_short := v_short + v_left;\n  END LOOP;\n';
  v_start integer;
  v_stop integer;
BEGIN
  v_def := pg_get_functiondef('commerce.complete_order_payment(uuid, text)'::regprocedure);
  IF position('commerce.draw_order_stock' IN v_def) > 0 THEN RETURN; END IF;
  v_start := position(v_from IN v_def);
  v_stop := position(v_to IN v_def);
  IF v_start = 0 OR v_stop = 0 OR v_stop < v_start THEN
    RAISE EXCEPTION 'complete_order_payment: the stock draw was not found, so it is not moved to draw_order_stock()';
  END IF;
  v_new := substr(v_def, 1, v_start - 1) || E'  v_short := commerce.draw_order_stock(p_order_id);\n' || substr(v_def, v_stop + length(v_to));
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The job pipeline learns the stock file kinds (D165's rules, widened as 20261005162105_redirects_rules.sql widened them)
-- ---------------------------------------------------------------------------

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.data_jobs_rules()'::regprocedure);
  IF position('inventory_import' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'');',
    E'v_import boolean := NEW.kind IN (''product_import'', ''redirect_import'', ''inventory_import'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'data_jobs_rules: the import kinds were not found, so the stock import is not an import'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.start_export_job(uuid, text, uuid, jsonb, integer)'::regprocedure);
  IF position('inventory_export' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'IF p_kind NOT IN (''product_export'', ''order_export'', ''customer_export'', ''redirect_export'') THEN',
    E'IF p_kind NOT IN (''product_export'', ''order_export'', ''customer_export'', ''redirect_export'', ''inventory_export'') THEN');
  IF v_new = v_def THEN RAISE EXCEPTION 'start_export_job: the export kinds were not found, so the stock export cannot start'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'kind NOT IN (''product_import'', ''redirect_import'') AND status IN (''queued'', ''running'')',
    E'kind NOT IN (''product_import'', ''redirect_import'', ''inventory_import'') AND status IN (''queued'', ''running'')');
  IF v_new = v_def THEN RAISE EXCEPTION 'start_export_job: the active-export count was not found, so a stock import would count as an export'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Copying a store keeps the policy, the delivery time, the warning level and the rank of its locations (3.7)
-- ---------------------------------------------------------------------------

-- A copy starts with its own opening movements (written by the level inserts, with the context `opening`/`copy`), never a negative
-- level (what is owed on orders is not copied), and no level for a variant that is not goods (the level trigger refuses one).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('stock_policy' IN v_def) > 0 THEN RETURN; END IF;

  v_new := replace(v_def,
    E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active\n',
    E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, priority)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, priority\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the location insert was not found, so the rank is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'    measure_amount, measure_unit, measure_base\n  )\n  SELECT commerce.clone_id(v_store, v.id)',
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold\n  )\n  SELECT commerce.clone_id(v_store, v.id)');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the variant columns were not found, so the stock policy is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'         v.measure_amount, v.measure_unit, v.measure_base\n    FROM commerce.product_variants v\n    JOIN commerce.products p ON p.id = v.product_id',
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold\n    FROM commerce.product_variants v\n    JOIN commerce.products p ON p.id = v.product_id');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the variant values were not found, so the stock policy is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)\n  SELECT v_store, commerce.clone_id(v_store, l.variant_id), commerce.clone_id(v_store, l.location_id), l.on_hand\n    FROM commerce.inventory_levels l\n   WHERE l.store_id = p_template_id\n     AND EXISTS (\n       SELECT 1 FROM commerce.product_variants v\n        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, l.variant_id)\n     );\n',
    E'  PERFORM commerce.stock_context(''opening'', ''copy'', NULL, NULL, NULL, NULL, NULL);\n  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)\n  SELECT v_store, commerce.clone_id(v_store, l.variant_id), commerce.clone_id(v_store, l.location_id), greatest(l.on_hand, 0)\n    FROM commerce.inventory_levels l\n   WHERE l.store_id = p_template_id\n     AND EXISTS (\n       SELECT 1 FROM commerce.product_variants v\n        WHERE v.store_id = v_store AND v.id = commerce.clone_id(v_store, l.variant_id) AND v.delivery = ''physical''\n     );\n  PERFORM commerce.stock_context_clear();\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: the level insert was not found, so its movements are not recorded as a copy'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('stock_policy' IN v_def) > 0 THEN RETURN; END IF;

  v_new := replace(v_def,
    E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at\n',
    E'INSERT INTO commerce.inventory_locations (id, store_id, name, country, active, created_at, priority)\n  SELECT commerce.clone_id(v_store, id), v_store, name, country, active, created_at, priority\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the location insert was not found, so the rank is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'    measure_amount, measure_unit, measure_base\n  )\n  SELECT m.new_id, v_store',
    E'    measure_amount, measure_unit, measure_base, stock_policy, backorder_days, low_stock_threshold\n  )\n  SELECT m.new_id, v_store');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the variant columns were not found, so the stock policy is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'         v.measure_amount, v.measure_unit, v.measure_base\n    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id',
    E'         v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days, v.low_stock_threshold\n    FROM commerce.product_variants v JOIN pg_temp._copy_ids m ON m.old_id = v.id');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the variant values were not found, so the stock policy is not copied'; END IF;
  v_def := v_new;

  v_new := replace(v_def,
    E'  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)\n  SELECT v_store, m.new_id, commerce.clone_id(v_store, l.location_id), l.on_hand\n    FROM commerce.inventory_levels l JOIN pg_temp._copy_ids m ON m.old_id = l.variant_id\n   WHERE l.store_id = p_source AND m.new_id IS NOT NULL;\n',
    E'  PERFORM commerce.stock_context(''opening'', ''copy'', NULL, NULL, NULL, NULL, NULL);\n  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand)\n  SELECT v_store, m.new_id, commerce.clone_id(v_store, l.location_id), greatest(l.on_hand, 0)\n    FROM commerce.inventory_levels l JOIN pg_temp._copy_ids m ON m.old_id = l.variant_id\n    JOIN commerce.product_variants sv ON sv.store_id = l.store_id AND sv.id = l.variant_id AND sv.delivery = ''physical''\n   WHERE l.store_id = p_source AND m.new_id IS NOT NULL;\n  PERFORM commerce.stock_context_clear();\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: the level insert was not found, so its movements are not recorded as a copy'; END IF;
  EXECUTE v_new;
END
$patch$;
