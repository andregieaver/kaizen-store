-- Paying hosts (D71). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.host_stripe_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.host_commissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.host_stripe_accounts
  ADD CONSTRAINT host_stripe_accounts_account_id_format CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');
--> statement-breakpoint

-- Every connected Stripe account a store's payments can be on: its own, and
-- its hosts'. Payments name the account they were made on; this says which
-- store (and host) and mode it is, for webhooks, refunds and order pages.
CREATE VIEW commerce.connected_accounts WITH (security_invoker = true) AS
  SELECT store_id, mode, account_id, NULL::uuid AS host_id, card_payments FROM commerce.stripe_accounts
  UNION ALL
  SELECT store_id, mode, account_id, host_id, card_payments FROM commerce.host_stripe_accounts;
