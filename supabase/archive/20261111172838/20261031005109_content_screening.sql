CREATE TABLE "commerce"."content_screened" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"screened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" DROP CONSTRAINT "content_reports_sender";--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD COLUMN "source" text DEFAULT 'notice' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD COLUMN "ai_reading" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "content_screening" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."content_screened" ADD CONSTRAINT "content_screened_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_screened" ADD CONSTRAINT "content_screened_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_screened_store_idx" ON "commerce"."content_screened" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD CONSTRAINT "content_reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reports_product_idx" ON "commerce"."content_reports" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD CONSTRAINT "content_reports_source" CHECK ("commerce"."content_reports"."source" in ('notice', 'screening'));--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD CONSTRAINT "content_reports_sender" CHECK ("commerce"."content_reports"."source" = 'screening' or "commerce"."content_reports"."category" = 'minors' or "commerce"."content_reports"."status" <> 'received' or ("commerce"."content_reports"."reporter_name" is not null and "commerce"."content_reports"."reporter_email" is not null));--> statement-breakpoint
-- Written only by src/server/content-screening.ts, never through the Data API.
ALTER TABLE "commerce"."content_screened" ENABLE ROW LEVEL SECURITY;
