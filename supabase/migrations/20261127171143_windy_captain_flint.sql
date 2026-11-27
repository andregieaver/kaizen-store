-- Whether a price of nothing shows as Free (D913): the store's setting, and a category's, tag's or product's own over it.
ALTER TABLE "commerce"."product_settings" ADD COLUMN "zero_free" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "zero_free" boolean;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "zero_free" boolean;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_zero_free" CHECK ("commerce"."terms"."zero_free" is null or "commerce"."terms"."content_type" = 'product');