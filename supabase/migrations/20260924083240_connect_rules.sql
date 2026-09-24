-- Stripe Connect (decision D17): rules the schema file cannot express.

-- Kaizen's settings are a single row, present from the start.
INSERT INTO commerce.platform_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Like every commerce table: row-level security on, no policies (server code
-- connects as the owner; see platform_rules).
ALTER TABLE commerce.platform_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.platform_webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.stripe_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Stripe account ids look like acct_…; anything else is a bug.
ALTER TABLE commerce.stripe_accounts
  ADD CONSTRAINT stripe_accounts_account_id_format CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');
