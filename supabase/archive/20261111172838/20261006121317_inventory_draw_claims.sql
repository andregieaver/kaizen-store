-- The draw respects what checkouts in progress were promised (wave 3, D172, review of `docs/wave-3-inventory.md` 3.5).
--
-- Before this file a checkout's hold on a variant that keeps selling on backorder held nothing: whoever paid first drew the units, so
-- a shopper who had been told "in stock" could be given the backorder note after paying while a later checkout took the stock.
-- Now a reservation says how much of it is beyond stock (`inventory_reservations.backorder_quantity`, written by placeOrder()), and
-- the draw gives an order its own physical claim whatever the order of payment:
--   (1) at each location where the order holds units: its physical part (`quantity - backorder_quantity`), plus any of its
--       backordered part that the stock now covers once the claims of the other live checkouts are counted (first come, first served:
--       an earlier checkout counts in full, a later one by its physical part); the rest of the hold is drawn as BACKORDERED units;
--   (2) then, for what no live hold covers (a hold that expired before payment, a renewal), the stock at any active location that no
--       other live checkout holds, in rank order;
--   (3) then the remainder: backordered at the first location that stocks the variant for a `continue` variant, short for `deny`.
-- The units drawn beyond the order's claim are the BACKORDERED units written to its lines (replacing the figure from placement, which
-- only ever goes DOWN here for a live hold), so what the order says after payment is what the shopper was told when it was placed.
-- A `deny` variant never goes below zero (a hold's units are drawn only where they are on hand).
--
-- It replaces the definition of 20261006081019_inventory_rules.sql, which is why this is a file of its own after the column exists:
-- old code running while the files are applied never meets a function that names a column that is not there yet.

CREATE OR REPLACE FUNCTION commerce.draw_order_stock(p_order_id uuid)
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
  v_phys integer;
  v_before integer;
  v_claimed integer;
  v_extra integer;
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

    -- (1) Where the items were held for this order: its own claim first.
    FOR v_hold IN
      SELECT loc.id AS location_id, sum(r.quantity)::integer AS quantity, sum(r.backorder_quantity)::integer AS backordered,
             min(r.created_at) AS held_since
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
      -- The physical claim the checkout made when it started: what no later checkout paying first can take.
      v_phys := v_hold.quantity - v_hold.backordered;
      IF v_hold.backordered > 0 THEN
        -- Units that came in (or a checkout that let go) since: the backordered part is covered as far as the stock, less the claims of
        -- the other live checkouts here (an earlier one in full, a later one by its physical part) and this order's own claim, reaches.
        SELECT coalesce(sum(CASE WHEN r.created_at <= v_hold.held_since THEN r.quantity ELSE r.quantity - r.backorder_quantity END), 0)::integer
          INTO v_claimed
          FROM commerce.inventory_reservations r
         WHERE r.store_id = v_order.store_id AND r.variant_id = v_var.variant_id AND r.location_id = v_hold.location_id
           AND r.order_id IS DISTINCT FROM p_order_id AND r.released_at IS NULL AND r.expires_at > now();
        v_phys := v_phys + least(v_hold.backordered, greatest(v_before - v_claimed - v_phys, 0));
      END IF;
      v_take := least(v_phys, v_left);
      -- Only what is really there, unless the variant keeps selling past zero: a hold does not create stock.
      IF v_var.stock_policy <> 'continue' THEN
        v_take := least(v_take, greatest(v_before, 0));
      END IF;
      -- The rest of the hold is what the shopper was told is on backorder: drawn below the shelf, and written to the lines as such.
      -- One change of the level (so one movement) for the whole hold at this location.
      v_extra := 0;
      IF v_var.stock_policy = 'continue' AND v_hold.quantity > v_phys THEN
        v_extra := least(v_hold.quantity - v_phys, v_left - v_take);
      END IF;
      IF v_take + v_extra > 0 THEN
        UPDATE commerce.inventory_levels SET on_hand = on_hand - (v_take + v_extra), updated_at = now()
         WHERE store_id = v_order.store_id AND variant_id = v_var.variant_id AND location_id = v_hold.location_id;
        v_back := v_back + v_extra;
        v_left := v_left - v_take - v_extra;
      END IF;
    END LOOP;

    -- (2) Then the stock no other live checkout holds, anywhere (a hold that expired before payment, a renewal), in rank order.
    FOR v_level IN
      SELECT l.location_id, l.on_hand
        FROM commerce.inventory_levels l
        JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active
       WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.on_hand > 0
       ORDER BY loc.priority, loc.created_at, loc.id
    LOOP
      EXIT WHEN v_left = 0;
      SELECT coalesce(sum(r.quantity), 0)::integer INTO v_claimed
        FROM commerce.inventory_reservations r
       WHERE r.store_id = v_order.store_id AND r.variant_id = v_var.variant_id AND r.location_id = v_level.location_id
         AND r.order_id IS DISTINCT FROM p_order_id AND r.released_at IS NULL AND r.expires_at > now();
      v_take := least(greatest(v_level.on_hand - v_claimed, 0), v_left);
      CONTINUE WHEN v_take = 0;
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
          PERFORM 1 FROM commerce.inventory_levels l
           WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.location_id = v_home FOR UPDATE;
          UPDATE commerce.inventory_levels SET on_hand = on_hand - v_left, updated_at = now()
           WHERE store_id = v_order.store_id AND variant_id = v_var.variant_id AND location_id = v_home;
          -- Beyond what any checkout had claimed: all of it is backordered.
          v_back := v_back + v_left;
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
           SET backorder_quantity = v_alloc, backorder_days = CASE WHEN v_alloc > 0 THEN coalesce(backorder_days, v_var.backorder_days) ELSE backorder_days END
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
