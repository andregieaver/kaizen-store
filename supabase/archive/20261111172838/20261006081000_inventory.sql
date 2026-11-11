CREATE TABLE "commerce"."inventory_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."inventory_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"on_hand_after" integer NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"actor_account_id" uuid,
	"order_id" uuid,
	"return_id" uuid,
	"job_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_delta" CHECK ("commerce"."inventory_movements"."delta" <> 0),
	CONSTRAINT "inventory_movements_reason" CHECK ("commerce"."inventory_movements"."reason" in ('received', 'correction', 'count', 'damaged', 'lost', 'promotion', 'sale', 'order_restock', 'return_restock', 'opening', 'system')),
	CONSTRAINT "inventory_movements_source" CHECK ("commerce"."inventory_movements"."source" in ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout', 'ai_manager', 'copy', 'system')),
	CONSTRAINT "inventory_movements_note" CHECK ("commerce"."inventory_movements"."note" is null or length("commerce"."inventory_movements"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "commerce"."stock_alerts" (
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"state" text NOT NULL,
	"crossed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"stock_at_crossing" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_alerts_store_id_variant_id_pk" PRIMARY KEY("store_id","variant_id"),
	CONSTRAINT "stock_alerts_state" CHECK ("commerce"."stock_alerts"."state" in ('off', 'ok', 'low')),
	CONSTRAINT "stock_alerts_crossing" CHECK (("commerce"."stock_alerts"."state" = 'low') = ("commerce"."stock_alerts"."crossed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" DROP CONSTRAINT "data_job_items_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_export_no_input";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_import_no_files";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_levels" DROP CONSTRAINT "inventory_levels_on_hand_non_negative";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "backorder_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "backorder_days" integer;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "stock_policy" text DEFAULT 'deny' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "backorder_days" integer;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."inventory_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_return_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "commerce"."returns"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stock_alerts" ADD CONSTRAINT "stock_alerts_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_idx" ON "commerce"."inventory_movements" USING btree ("store_id","variant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_movements_created_idx" ON "commerce"."inventory_movements" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_movements_order_idx" ON "commerce"."inventory_movements" USING btree ("store_id","order_id") WHERE "commerce"."inventory_movements"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "inventory_movements_location_idx" ON "commerce"."inventory_movements" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_return_idx" ON "commerce"."inventory_movements" USING btree ("store_id","return_id") WHERE "commerce"."inventory_movements"."return_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_alerts_low_idx" ON "commerce"."stock_alerts" USING btree ("store_id","crossed_at") WHERE "commerce"."stock_alerts"."state" = 'low';--> statement-breakpoint
CREATE UNIQUE INDEX "data_jobs_one_active_inventory_import_idx" ON "commerce"."data_jobs" USING btree ("store_id") WHERE "commerce"."data_jobs"."kind" = 'inventory_import' and "commerce"."data_jobs"."status" in ('uploaded', 'checking', 'checked', 'queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_active_name_key" ON "commerce"."inventory_locations" USING btree ("store_id",lower("name")) WHERE "commerce"."inventory_locations"."active";--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" ADD CONSTRAINT "data_job_items_kind" CHECK ("commerce"."data_job_items"."kind" in ('product', 'redirect', 'stock', 'file'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_kind" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'product_export', 'order_export', 'customer_export', 'redirect_import', 'redirect_export', 'inventory_import', 'inventory_export'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_export_no_input" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'redirect_import', 'inventory_import') or ("commerce"."data_jobs"."input_path" is null and "commerce"."data_jobs"."input_sha256" is null and "commerce"."data_jobs"."format" is distinct from 'shopify'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_import_no_files" CHECK ("commerce"."data_jobs"."kind" not in ('product_import', 'redirect_import', 'inventory_import') or "commerce"."data_jobs"."files" = '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD CONSTRAINT "inventory_locations_priority" CHECK ("commerce"."inventory_locations"."priority" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD CONSTRAINT "inventory_locations_name" CHECK (length("commerce"."inventory_locations"."name") between 1 and 60);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_backorder_quantity" CHECK ("commerce"."order_lines"."backorder_quantity" between 0 and "commerce"."order_lines"."quantity");--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_backorder_days" CHECK ("commerce"."order_lines"."backorder_days" between 1 and 90);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_backorder_stated" CHECK ("commerce"."order_lines"."backorder_quantity" = 0 or "commerce"."order_lines"."backorder_days" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_stock_policy" CHECK ("commerce"."product_variants"."stock_policy" in ('deny', 'continue'));--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_stock_policy_goods" CHECK ("commerce"."product_variants"."stock_policy" = 'deny' or "commerce"."product_variants"."delivery" = 'physical');--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_backorder_days" CHECK ("commerce"."product_variants"."backorder_days" between 1 and 90);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_backorder_days_policy" CHECK (("commerce"."product_variants"."stock_policy" = 'continue') = ("commerce"."product_variants"."backorder_days" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_low_stock_threshold" CHECK ("commerce"."product_variants"."low_stock_threshold" is null or ("commerce"."product_variants"."low_stock_threshold" between 0 and 1000000 and "commerce"."product_variants"."delivery" = 'physical'));