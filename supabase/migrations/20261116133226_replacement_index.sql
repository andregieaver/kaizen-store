-- kaizen:no-transaction
-- One replacement that is not cancelled per order (B3, D679), built concurrently on the hot orders table (D569); then the constraints the
-- previous file added not valid are checked against the old rows, which lets writes through.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "orders_replacement_live_key" ON "commerce"."orders" USING btree ("store_id","replaces_order_id") WHERE "replaces_order_id" is not null and "status" <> 'cancelled';
--> statement-breakpoint
ALTER TABLE "commerce"."orders" VALIDATE CONSTRAINT "orders_replaces_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."orders" VALIDATE CONSTRAINT "orders_source_replacement";
--> statement-breakpoint
ALTER TABLE "commerce"."orders" VALIDATE CONSTRAINT "orders_source";
--> statement-breakpoint
ALTER TABLE "commerce"."orders" VALIDATE CONSTRAINT "orders_source_draft";
