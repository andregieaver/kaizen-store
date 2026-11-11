CREATE TABLE "commerce"."bulk_edit_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"action" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"undo_of" uuid,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "bulk_edit_batches_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "bulk_edit_batches_action" CHECK ("commerce"."bulk_edit_batches"."action" in ('status', 'archive', 'unarchive', 'terms_add', 'terms_remove', 'price', 'stock', 'grid', 'undo')),
	CONSTRAINT "bulk_edit_batches_undo" CHECK (("commerce"."bulk_edit_batches"."action" = 'undo') = ("commerce"."bulk_edit_batches"."undo_of" is not null)),
	CONSTRAINT "bulk_edit_batches_json" CHECK (jsonb_typeof("commerce"."bulk_edit_batches"."params") = 'object' and jsonb_typeof("commerce"."bulk_edit_batches"."counts") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."bulk_edit_items" (
	"store_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"outcome" text NOT NULL,
	"reason" text,
	CONSTRAINT "bulk_edit_items_batch_id_seq_pk" PRIMARY KEY("batch_id","seq"),
	CONSTRAINT "bulk_edit_items_seq" CHECK ("commerce"."bulk_edit_items"."seq" >= 0),
	CONSTRAINT "bulk_edit_items_outcome" CHECK ("commerce"."bulk_edit_items"."outcome" in ('changed', 'unchanged', 'failed', 'undone')),
	CONSTRAINT "bulk_edit_items_field" CHECK ("commerce"."bulk_edit_items"."field" in ('status', 'archived', 'terms', 'stock', 'cost', 'sku') or "commerce"."bulk_edit_items"."field" ~ '^price:[A-Z]{2}$'),
	CONSTRAINT "bulk_edit_items_failed_reason" CHECK ("commerce"."bulk_edit_items"."outcome" <> 'failed' or length(trim(coalesce("commerce"."bulk_edit_items"."reason", ''))) > 0),
	CONSTRAINT "bulk_edit_items_reason" CHECK ("commerce"."bulk_edit_items"."reason" is null or length("commerce"."bulk_edit_items"."reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."data_job_assets" (
	"store_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"library_url" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_job_assets_job_id_source_url_pk" PRIMARY KEY("job_id","source_url"),
	CONSTRAINT "data_job_assets_result" CHECK ("commerce"."data_job_assets"."library_url" is not null or "commerce"."data_job_assets"."reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "commerce"."data_job_items" (
	"store_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"rows" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"outcome" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_job_items_job_id_seq_pk" PRIMARY KEY("job_id","seq"),
	CONSTRAINT "data_job_items_seq" CHECK ("commerce"."data_job_items"."seq" >= 0),
	CONSTRAINT "data_job_items_kind" CHECK ("commerce"."data_job_items"."kind" in ('product', 'file')),
	CONSTRAINT "data_job_items_outcome" CHECK ("commerce"."data_job_items"."outcome" in ('created', 'updated', 'unchanged', 'skipped', 'drafted', 'failed', 'checked')),
	CONSTRAINT "data_job_items_json" CHECK (jsonb_typeof("commerce"."data_job_items"."messages") = 'array' and jsonb_typeof("commerce"."data_job_items"."changes") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."data_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"phase" text,
	"format" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"input_path" text,
	"input_name" text,
	"input_bytes" integer,
	"input_sha256" text,
	"rows_total" integer,
	"rows_done" integer,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problem" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "data_jobs_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "data_jobs_kind" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'product_export', 'order_export', 'customer_export')),
	CONSTRAINT "data_jobs_status" CHECK ("commerce"."data_jobs"."status" in ('uploaded', 'checking', 'checked', 'queued', 'running', 'done', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "data_jobs_phase" CHECK ("commerce"."data_jobs"."phase" is null or "commerce"."data_jobs"."phase" in ('check', 'apply', 'write', 'assemble')),
	CONSTRAINT "data_jobs_format" CHECK ("commerce"."data_jobs"."format" is null or "commerce"."data_jobs"."format" in ('kaizen', 'shopify')),
	CONSTRAINT "data_jobs_rows" CHECK ("commerce"."data_jobs"."rows_total" is null or "commerce"."data_jobs"."rows_total" >= 0),
	CONSTRAINT "data_jobs_rows_done" CHECK ("commerce"."data_jobs"."rows_done" is null or ("commerce"."data_jobs"."rows_done" >= 0 and ("commerce"."data_jobs"."rows_total" is null or "commerce"."data_jobs"."rows_done" <= "commerce"."data_jobs"."rows_total"))),
	CONSTRAINT "data_jobs_input_bytes" CHECK ("commerce"."data_jobs"."input_bytes" is null or "commerce"."data_jobs"."input_bytes" between 0 and 15728640),
	CONSTRAINT "data_jobs_input_sha256" CHECK ("commerce"."data_jobs"."input_sha256" is null or "commerce"."data_jobs"."input_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "data_jobs_attempts" CHECK ("commerce"."data_jobs"."attempts" >= 0),
	CONSTRAINT "data_jobs_json" CHECK (jsonb_typeof("commerce"."data_jobs"."options") = 'object' and jsonb_typeof("commerce"."data_jobs"."counts") = 'object' and jsonb_typeof("commerce"."data_jobs"."cursor") = 'object' and jsonb_typeof("commerce"."data_jobs"."files") = 'array'),
	CONSTRAINT "data_jobs_export_no_input" CHECK ("commerce"."data_jobs"."kind" = 'product_import' or ("commerce"."data_jobs"."input_path" is null and "commerce"."data_jobs"."input_sha256" is null and "commerce"."data_jobs"."format" is distinct from 'shopify')),
	CONSTRAINT "data_jobs_import_no_files" CHECK ("commerce"."data_jobs"."kind" <> 'product_import' or "commerce"."data_jobs"."files" = '[]'::jsonb),
	CONSTRAINT "data_jobs_finished" CHECK ("commerce"."data_jobs"."status" not in ('done', 'failed', 'cancelled', 'expired') or "commerce"."data_jobs"."finished_at" is not null),
	CONSTRAINT "data_jobs_problem" CHECK ("commerce"."data_jobs"."problem" is null or length("commerce"."data_jobs"."problem") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."bulk_edit_batches" ADD CONSTRAINT "bulk_edit_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bulk_edit_batches" ADD CONSTRAINT "bulk_edit_batches_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bulk_edit_batches" ADD CONSTRAINT "bulk_edit_batches_undo_of_fk" FOREIGN KEY ("store_id","undo_of") REFERENCES "commerce"."bulk_edit_batches"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bulk_edit_items" ADD CONSTRAINT "bulk_edit_items_batch_fk" FOREIGN KEY ("store_id","batch_id") REFERENCES "commerce"."bulk_edit_batches"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."data_job_assets" ADD CONSTRAINT "data_job_assets_job_fk" FOREIGN KEY ("store_id","job_id") REFERENCES "commerce"."data_jobs"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" ADD CONSTRAINT "data_job_items_job_fk" FOREIGN KEY ("store_id","job_id") REFERENCES "commerce"."data_jobs"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_edit_batches_store_idx" ON "commerce"."bulk_edit_batches" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bulk_edit_batches_requested_by_idx" ON "commerce"."bulk_edit_batches" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_edit_batches_one_undo_idx" ON "commerce"."bulk_edit_batches" USING btree ("store_id","undo_of") WHERE "commerce"."bulk_edit_batches"."undo_of" is not null;--> statement-breakpoint
CREATE INDEX "bulk_edit_items_batch_idx" ON "commerce"."bulk_edit_items" USING btree ("store_id","batch_id");--> statement-breakpoint
CREATE INDEX "bulk_edit_items_product_idx" ON "commerce"."bulk_edit_items" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "data_job_assets_job_idx" ON "commerce"."data_job_assets" USING btree ("store_id","job_id");--> statement-breakpoint
CREATE INDEX "data_job_items_job_idx" ON "commerce"."data_job_items" USING btree ("store_id","job_id","outcome");--> statement-breakpoint
CREATE INDEX "data_jobs_store_kind_idx" ON "commerce"."data_jobs" USING btree ("store_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_jobs_requested_by_idx" ON "commerce"."data_jobs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "data_jobs_open_idx" ON "commerce"."data_jobs" USING btree ("status","claimed_until");--> statement-breakpoint
CREATE INDEX "data_jobs_expires_idx" ON "commerce"."data_jobs" USING btree ("expires_at") WHERE "commerce"."data_jobs"."purged_at" is null and "commerce"."data_jobs"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "data_jobs_one_active_import_idx" ON "commerce"."data_jobs" USING btree ("store_id") WHERE "commerce"."data_jobs"."kind" = 'product_import' and "commerce"."data_jobs"."status" in ('uploaded', 'checking', 'checked', 'queued', 'running');