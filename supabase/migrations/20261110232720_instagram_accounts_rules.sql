-- Instagram accounts for feeds (D543): server code only, through `db()`; no policies, so the Data API reads nothing (it holds a token).
ALTER TABLE "commerce"."instagram_accounts" ENABLE ROW LEVEL SECURITY;
