ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_type";--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "product_layout_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "product_layout_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "product_layout_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_product_layout_store" CHECK ("commerce"."pages"."type" <> 'product_layout' or "commerce"."pages"."store_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_type" CHECK ("commerce"."pages"."type" in ('page', 'article', 'product_layout'));--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_product_layout" CHECK ("commerce"."terms"."product_layout_id" is null or "commerce"."terms"."content_type" = 'product');