ALTER TABLE "commerce"."order_lines" ADD COLUMN "preorder_until" date;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "preorder_until" date;