-- Customer registration (decision D32). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.checkout_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every account so far was opened with an emailed code, which proved the address.
UPDATE commerce.customers SET email_verified_at = created_at WHERE email_verified_at IS NULL;
