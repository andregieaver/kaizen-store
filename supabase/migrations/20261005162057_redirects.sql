CREATE TABLE "commerce"."not_found_hits" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"path" text,
	"hits" integer DEFAULT 0 NOT NULL,
	"crawler_hits" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "not_found_hits_key" UNIQUE NULLS NOT DISTINCT("store_id","day","path"),
	CONSTRAINT "not_found_hits_counts" CHECK ("commerce"."not_found_hits"."hits" >= 0 and "commerce"."not_found_hits"."crawler_hits" between 0 and "commerce"."not_found_hits"."hits"),
	CONSTRAINT "not_found_hits_path" CHECK ("commerce"."not_found_hits"."path" is null or (length("commerce"."not_found_hits"."path") <= 200 and "commerce"."not_found_hits"."path" ~ '^/'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."not_found_ignored" (
	"store_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "not_found_ignored_store_id_path_pk" PRIMARY KEY("store_id","path"),
	CONSTRAINT "not_found_ignored_path" CHECK (length("commerce"."not_found_ignored"."path") <= 200 and "commerce"."not_found_ignored"."path" ~ '^/')
);
--> statement-breakpoint
CREATE TABLE "commerce"."redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"target" text,
	"product_id" uuid,
	"term_id" uuid,
	"origin" text NOT NULL,
	"hits" bigint DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "redirects_store_source_key" UNIQUE("store_id","source"),
	CONSTRAINT "redirects_kind" CHECK ("commerce"."redirects"."kind" in ('manual', 'product', 'category', 'tag')),
	CONSTRAINT "redirects_origin" CHECK ("commerce"."redirects"."origin" in ('editor', 'import', 'report', 'assistant', 'system')),
	CONSTRAINT "redirects_kind_columns" CHECK (("commerce"."redirects"."kind" = 'manual' and "commerce"."redirects"."target" is not null and "commerce"."redirects"."product_id" is null and "commerce"."redirects"."term_id" is null)
        or ("commerce"."redirects"."kind" = 'product' and "commerce"."redirects"."target" is null and "commerce"."redirects"."product_id" is not null and "commerce"."redirects"."term_id" is null)
        or ("commerce"."redirects"."kind" in ('category', 'tag') and "commerce"."redirects"."target" is null and "commerce"."redirects"."product_id" is null and "commerce"."redirects"."term_id" is not null)),
	CONSTRAINT "redirects_origin_kind" CHECK (("commerce"."redirects"."kind" = 'manual') = ("commerce"."redirects"."origin" <> 'system')),
	CONSTRAINT "redirects_source_shape" CHECK ("commerce"."redirects"."source" ~ '^/[^[:space:][:cntrl:]?#]+$' and strpos("commerce"."redirects"."source", chr(92)) = 0 and "commerce"."redirects"."source" !~ '//' and "commerce"."redirects"."source" !~ '/$' and "commerce"."redirects"."source" !~ '[A-Z]' and length("commerce"."redirects"."source") <= 500),
	CONSTRAINT "redirects_target_shape" CHECK ("commerce"."redirects"."target" is null or ("commerce"."redirects"."target" ~ '^/[^[:space:][:cntrl:]]*$' and strpos("commerce"."redirects"."target", chr(92)) = 0 and "commerce"."redirects"."target" !~ '^//' and length("commerce"."redirects"."target") <= 2000)),
	CONSTRAINT "redirects_hits" CHECK ("commerce"."redirects"."hits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" DROP CONSTRAINT "data_job_items_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_kind";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_export_no_input";--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" DROP CONSTRAINT "data_jobs_import_no_files";--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "first_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."not_found_hits" ADD CONSTRAINT "not_found_hits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."not_found_ignored" ADD CONSTRAINT "not_found_ignored_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."not_found_ignored" ADD CONSTRAINT "not_found_ignored_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "commerce"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."redirects" ADD CONSTRAINT "redirects_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "not_found_hits_day_idx" ON "commerce"."not_found_hits" USING btree ("day");--> statement-breakpoint
CREATE INDEX "not_found_ignored_created_by_idx" ON "commerce"."not_found_ignored" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "redirects_store_kind_idx" ON "commerce"."redirects" USING btree ("store_id","kind");--> statement-breakpoint
CREATE INDEX "redirects_product_idx" ON "commerce"."redirects" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "redirects_term_idx" ON "commerce"."redirects" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "redirects_created_by_idx" ON "commerce"."redirects" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "data_jobs_one_active_redirect_import_idx" ON "commerce"."data_jobs" USING btree ("store_id") WHERE "commerce"."data_jobs"."kind" = 'redirect_import' and "commerce"."data_jobs"."status" in ('uploaded', 'checking', 'checked', 'queued', 'running');--> statement-breakpoint
ALTER TABLE "commerce"."data_job_items" ADD CONSTRAINT "data_job_items_kind" CHECK ("commerce"."data_job_items"."kind" in ('product', 'redirect', 'file'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_kind" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'product_export', 'order_export', 'customer_export', 'redirect_import', 'redirect_export'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_export_no_input" CHECK ("commerce"."data_jobs"."kind" in ('product_import', 'redirect_import') or ("commerce"."data_jobs"."input_path" is null and "commerce"."data_jobs"."input_sha256" is null and "commerce"."data_jobs"."format" is distinct from 'shopify'));--> statement-breakpoint
ALTER TABLE "commerce"."data_jobs" ADD CONSTRAINT "data_jobs_import_no_files" CHECK ("commerce"."data_jobs"."kind" not in ('product_import', 'redirect_import') or "commerce"."data_jobs"."files" = '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_seo_object" CHECK (jsonb_typeof("commerce"."terms"."seo") = 'object');