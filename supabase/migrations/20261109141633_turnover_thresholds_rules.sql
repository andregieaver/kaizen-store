-- A store's own turnover thresholds (D514): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."turnover_thresholds" ENABLE ROW LEVEL SECURITY;
