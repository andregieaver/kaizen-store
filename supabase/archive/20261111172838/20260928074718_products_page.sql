ALTER TABLE "commerce"."stores" ADD COLUMN "products_page_id" uuid;--> statement-breakpoint
CREATE INDEX "stores_products_page_idx" ON "commerce"."stores" USING btree ("id","products_page_id");