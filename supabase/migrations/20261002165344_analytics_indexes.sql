-- Store analytics (D152, docs/analytics.md): indexes for the reads that walk a store's paid orders, measured on a store of 60 000
-- paid orders (120 000 lines, 3 years): the customers report, which reads every paid order once, took a fifth less with the first two,
-- the others a few per cent each; the third and fourth keep the reads of a period's refunds and of the orders that had stock put back
-- from scanning the store's whole refunds and events. Drizzle cannot express a partial or covering index, so they are here only (as the
-- rules are): `db:check` compares the schema with the migrations' snapshots, which these do not change.

-- The captured payments, which are what makes an order paid, with what the reports add up of them (Kaizen's fee, the currency):
-- an index-only scan answers "is it paid" and gives the fee without touching the payments' pages.
CREATE INDEX IF NOT EXISTS payments_captured_idx ON commerce.payments (store_id, order_id) INCLUDE (kaizen_fee_minor, currency) WHERE status = 'captured';
--> statement-breakpoint

-- What a store's lines cost and how they are delivered, per order: the cost of goods, whether a cost is missing and whether an order
-- ships goods are summed from the index alone.
CREATE INDEX IF NOT EXISTS order_lines_analytics_idx ON commerce.order_lines (store_id, order_id) INCLUDE (quantity, unit_cost_minor, variant_id, delivery);
--> statement-breakpoint

-- Refunds are dated by their own `created_at` (a refund counts in the period it was made, not its order's).
CREATE INDEX IF NOT EXISTS refunds_store_created_idx ON commerce.refunds (store_id, created_at);
--> statement-breakpoint

-- The events that put stock back (an order has several events; these are few): the stock reports read them for the year's paid orders.
CREATE INDEX IF NOT EXISTS order_events_restock_idx ON commerce.order_events (store_id, order_id) WHERE type IN ('order.refunded', 'order.restocked');
