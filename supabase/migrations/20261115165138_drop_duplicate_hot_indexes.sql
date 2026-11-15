-- kaizen:no-transaction
-- Four indexes on hot tables that duplicate another index of the same table (bloat review step 0.26): dropped concurrently (D569).
-- orders_retention_idx and orders_invoice_candidates_idx have the key of orders_store_placed_idx; order_lines_order_idx is led by
-- order_lines_analytics_idx; visits_store_day_idx is led by the unique visits_day_visitor_key.
DROP INDEX CONCURRENTLY IF EXISTS commerce.orders_retention_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS commerce.orders_invoice_candidates_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS commerce.order_lines_order_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS commerce.visits_store_day_idx;
