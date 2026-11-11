CREATE TABLE "commerce"."css_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"css" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD COLUMN "base" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."site_staging_pages" ADD COLUMN "copied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."css_versions" ADD CONSTRAINT "css_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."css_versions" ADD CONSTRAINT "css_versions_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "css_versions_store_idx" ON "commerce"."css_versions" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "css_versions_created_by_idx" ON "commerce"."css_versions" USING btree ("created_by");