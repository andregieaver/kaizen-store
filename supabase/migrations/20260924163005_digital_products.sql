CREATE TYPE "commerce"."delivery" AS ENUM('physical', 'digital');--> statement-breakpoint
CREATE TABLE "commerce"."order_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"token" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"max_downloads" integer,
	"expires_at" timestamp with time zone,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_downloads_token_unique" UNIQUE("token"),
	CONSTRAINT "order_downloads_order_file_key" UNIQUE("order_id","file_id"),
	CONSTRAINT "order_downloads_count_non_negative" CHECK ("commerce"."order_downloads"."downloads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_files_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "product_files_path_key" UNIQUE("path"),
	CONSTRAINT "product_files_size_positive" CHECK ("commerce"."product_files"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "delivery" "commerce"."delivery" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "digital_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "delivery" "commerce"."delivery" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "delivery" "commerce"."delivery" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "download_limit" integer;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "download_days" integer;--> statement-breakpoint
ALTER TABLE "commerce"."order_downloads" ADD CONSTRAINT "order_downloads_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_downloads" ADD CONSTRAINT "order_downloads_file_fk" FOREIGN KEY ("store_id","file_id") REFERENCES "commerce"."product_files"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_files" ADD CONSTRAINT "product_files_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_downloads_order_idx" ON "commerce"."order_downloads" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_downloads_file_idx" ON "commerce"."order_downloads" USING btree ("store_id","file_id");--> statement-breakpoint
CREATE INDEX "product_files_product_idx" ON "commerce"."product_files" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE INDEX "product_files_variant_idx" ON "commerce"."product_files" USING btree ("store_id","variant_id");--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_download_limit_positive" CHECK ("commerce"."products"."download_limit" > 0);--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_download_days_positive" CHECK ("commerce"."products"."download_days" > 0);