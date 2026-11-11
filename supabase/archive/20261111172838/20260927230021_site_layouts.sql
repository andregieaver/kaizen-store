ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_type";--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "header_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "footer_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "header_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "footer_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_type" CHECK ("commerce"."pages"."type" in ('page', 'article', 'product_layout', 'header', 'footer'));