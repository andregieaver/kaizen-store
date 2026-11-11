CREATE TABLE "commerce"."customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customer_notes_email" CHECK ("commerce"."customer_notes"."email" = lower("commerce"."customer_notes"."email") and char_length("commerce"."customer_notes"."email") between 3 and 254),
	CONSTRAINT "customer_notes_body" CHECK (char_length("commerce"."customer_notes"."body") between 1 and 5000 and "commerce"."customer_notes"."body" = btrim("commerce"."customer_notes"."body"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" DROP CONSTRAINT "data_job_items_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_export_no_input";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_import_no_files";--> statement-breakpoint
ALTER TABLE "commerce"."customer_notes" ADD CONSTRAINT "customer_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_notes" ADD CONSTRAINT "customer_notes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_email_idx" ON "commerce"."customer_notes" USING btree ("store_id","email","created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_created_by_idx" ON "commerce"."customer_notes" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "data_jobs_one_active_customer_import_idx" ON "commerce"."data_jobs" USING btree ("store_id") WHERE "commerce"."data_jobs"."kind" = 'customer_import' and "commerce"."data_jobs"."status" in ('uploaded', 'checking', 'checked', 'queued', 'running');--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" ADD CONSTRAINT "data_job_items_kind" CHECK ("commerce"."data_job_items"."kind" in ('product', 'redirect', 'stock', 'customer', 'file'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_kind" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'product_export', 'order_export', 'customer_export', 'redirect_import', 'redirect_export', 'inventory_import', 'inventory_export', 'customer_import'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_export_no_input" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'redirect_import', 'inventory_import', 'customer_import') or ("commerce"."data_jobs"."input_path" is null and "commerce"."data_jobs"."input_sha256" is null and "commerce"."data_jobs"."format" is distinct from 'shopify'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_import_no_files" CHECK ("commerce"."data_jobs"."kind" not in ('product_import', 'redirect_import', 'inventory_import', 'customer_import') or "commerce"."data_jobs"."files" = '[]'::jsonb);
-- Staff notes on customers (wave 10 unit C, D366): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."customer_notes" ENABLE ROW LEVEL SECURITY;
