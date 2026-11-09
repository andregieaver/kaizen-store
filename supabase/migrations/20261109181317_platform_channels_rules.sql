-- What Kaizena Flow spent on marketing (C2, D522): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."platform_marketing_spend" ENABLE ROW LEVEL SECURITY;
