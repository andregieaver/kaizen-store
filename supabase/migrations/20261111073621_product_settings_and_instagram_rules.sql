-- The store's product settings (D556) and Instagram accounts for feeds (D559): server code only, through `db()`; no policies, so the Data
-- API reads nothing (the second holds a token).
ALTER TABLE "commerce"."product_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ENABLE ROW LEVEL SECURITY;
