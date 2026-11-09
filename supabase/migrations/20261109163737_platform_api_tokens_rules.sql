-- Kaizena Flow's own API's tokens (C4 step 4, D517): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."platform_api_tokens" ENABLE ROW LEVEL SECURITY;
