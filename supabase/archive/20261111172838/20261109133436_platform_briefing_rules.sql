-- The platform's own targets (C2, D513): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."platform_targets" ENABLE ROW LEVEL SECURITY;
