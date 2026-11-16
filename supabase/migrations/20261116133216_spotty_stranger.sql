-- A replacement order for a lost or returned parcel (B3, D679): source 'replacement', naming the order it replaces. The constraints are
-- added not valid on this hot table (D569) and validated, with the unique index built concurrently, in the next file.
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_source";--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_source_draft";--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "replaces_order_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_replaces_fk" FOREIGN KEY ("store_id","replaces_order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source_replacement" CHECK (("commerce"."orders"."source" = 'replacement') = ("commerce"."orders"."replaces_order_id" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source" CHECK ("commerce"."orders"."source" in ('checkout', 'draft', 'exchange', 'replacement')) NOT VALID;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_source_draft" CHECK (("commerce"."orders"."source" = 'draft') = ("commerce"."orders"."draft_id" is not null) and ("commerce"."orders"."source" in ('draft', 'exchange', 'replacement')) = ("commerce"."orders"."made_by" is not null)) NOT VALID;
