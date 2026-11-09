-- Kaizena Flow's own payout lines (D509): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."platform_payout_lines" ENABLE ROW LEVEL SECURITY;
