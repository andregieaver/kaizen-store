-- Plans and store billing (decision D18): rules the schema file cannot express.

-- A store's price must belong to its plan.
ALTER TABLE commerce.plan_prices ADD CONSTRAINT plan_prices_id_plan_key UNIQUE (id, plan_id);
--> statement-breakpoint
ALTER TABLE commerce.store_billing
  ADD CONSTRAINT store_billing_price_plan_fk FOREIGN KEY (price_id, plan_id)
  REFERENCES commerce.plan_prices (id, plan_id);
--> statement-breakpoint

-- Plan prices are in currencies Kaizen sells in.
ALTER TABLE commerce.plan_prices
  ADD CONSTRAINT plan_prices_currency_format CHECK (currency ~ '^[A-Z]{3}$');
--> statement-breakpoint

-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.plan_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.stripe_sync ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.store_billing ENABLE ROW LEVEL SECURITY;
