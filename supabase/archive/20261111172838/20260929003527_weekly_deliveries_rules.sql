-- Weekly deliveries (D102). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.delivery_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.standing_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.standing_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.standing_deliveries ENABLE ROW LEVEL SECURITY;
