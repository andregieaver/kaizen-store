ALTER TABLE "commerce"."stores" ADD COLUMN "front_page_id" uuid;--> statement-breakpoint
CREATE INDEX "stores_front_page_idx" ON "commerce"."stores" USING btree ("front_page_id","id");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_id_key" UNIQUE("store_id","id");