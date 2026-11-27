-- Whether buying skips the cart page (D915): the store's setting (Settings > Checkout), and a category's, tag's or product's own over it.
ALTER TABLE "commerce"."products" ADD COLUMN "skip_cart" boolean;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "skip_cart" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "skip_cart" boolean;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_skip_cart" CHECK ("commerce"."terms"."skip_cart" is null or "commerce"."terms"."content_type" = 'product');