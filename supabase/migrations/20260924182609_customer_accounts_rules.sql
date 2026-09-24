-- My account (decision D28): like every commerce table, row-level security on, no policies.
ALTER TABLE commerce.customer_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.customer_codes ENABLE ROW LEVEL SECURITY;
