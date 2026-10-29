ALTER TABLE "commerce"."order_settings" ADD COLUMN "stock_routing" text DEFAULT 'rank' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_settings" ADD CONSTRAINT "order_settings_stock_routing" CHECK ("commerce"."order_settings"."stock_routing" in ('rank', 'nearest'));--> statement-breakpoint

-- Paying an order (D383): stock no checkout holds, and a backordered remainder, are drawn only from locations that fulfil online orders
-- (`fulfils_online`). A checkout's own hold is drawn where it was made, as before.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.draw_order_stock'::regproc);
  IF position('fulfils_online' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    E'        JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active\n       WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.on_hand > 0',
    E'        JOIN commerce.inventory_locations loc ON loc.store_id = l.store_id AND loc.id = l.location_id AND loc.active AND loc.fulfils_online\n       WHERE l.store_id = v_order.store_id AND l.variant_id = v_var.variant_id AND l.on_hand > 0');
  IF v_new = v_def THEN RAISE EXCEPTION 'draw_order_stock: the free stock''s locations were not found'; END IF;
  v_def := v_new;
  v_new := replace(v_def, E'WHERE loc.store_id = v_order.store_id AND loc.active\n', E'WHERE loc.store_id = v_order.store_id AND loc.active AND loc.fulfils_online\n');
  IF v_new = v_def THEN RAISE EXCEPTION 'draw_order_stock: the backorder''s locations were not found'; END IF;
  EXECUTE v_new;
END
$patch$;
