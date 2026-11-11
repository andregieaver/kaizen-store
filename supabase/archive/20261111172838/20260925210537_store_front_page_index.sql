DROP INDEX "commerce"."stores_front_page_idx";--> statement-breakpoint
CREATE INDEX "stores_front_page_idx" ON "commerce"."stores" USING btree ("id","front_page_id");