ALTER TABLE "commerce"."platform_settings" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_translations" ADD COLUMN "seo_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_translations" ADD COLUMN "seo_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;