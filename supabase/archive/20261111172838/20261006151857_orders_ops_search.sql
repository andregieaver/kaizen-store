-- The order list's search and paging stay fast for a store with tens of thousands of orders (wave 3, run 2, D173, docs/wave-3-orders.md 3.5).
--
-- A separate file so it can wait for a quiet hour on a large `orders` table (plain `CREATE INDEX`, a short lock on each table while it builds), and written
-- as `IF NOT EXISTS` so it can be run again. `pg_trgm` lives in the `extensions` schema. The trigram indexes on `orders` are partial on the search's own guard
-- (`restricted_at IS NULL AND anonymised_at IS NULL`, D162: an erased person is not found by email or name), so the planner can use them only for a query
-- that carries the same guard. They add a write to every order and line insert, which is on the payment path: the performance advisor and the placement time
-- are checked after the deploy.

-- Search: the email and the shipping and billing name contain the word.
CREATE INDEX IF NOT EXISTS orders_search_email_idx
  ON commerce.orders USING gin (lower(email) extensions.gin_trgm_ops)
  WHERE restricted_at IS NULL AND anonymised_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_search_ship_name_idx
  ON commerce.orders USING gin (lower(shipping_address ->> 'name') extensions.gin_trgm_ops)
  WHERE restricted_at IS NULL AND anonymised_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_search_bill_name_idx
  ON commerce.orders USING gin (lower(billing_address ->> 'name') extensions.gin_trgm_ops)
  WHERE restricted_at IS NULL AND anonymised_at IS NULL;
--> statement-breakpoint

-- Search: a line's title or SKU contains the word; a shipment's tracking number equals it.
CREATE INDEX IF NOT EXISTS order_lines_search_title_idx
  ON commerce.order_lines USING gin (lower(title) extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_lines_search_sku_idx
  ON commerce.order_lines USING gin (lower(sku) extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shipments_tracking_idx
  ON commerce.shipments (store_id, lower(tracking_number));
--> statement-breakpoint

-- Keyset paging: the default list (not archived), the archived view, and the sort by total.
CREATE INDEX IF NOT EXISTS orders_list_placed_idx
  ON commerce.orders (store_id, placed_at DESC, id DESC)
  WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_list_archived_idx
  ON commerce.orders (store_id, placed_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_list_total_idx
  ON commerce.orders (store_id, total_minor, id);
