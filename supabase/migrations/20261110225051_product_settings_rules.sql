-- The store's product settings (D540): server code only, through `db()`; no policies, so the Data API reads nothing.
ALTER TABLE "commerce"."product_settings" ENABLE ROW LEVEL SECURITY;
