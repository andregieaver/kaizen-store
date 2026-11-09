-- Kaizena Flow's own conversions sent to ad platforms (C2, D523): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."platform_ad_conversions" ENABLE ROW LEVEL SECURITY;
