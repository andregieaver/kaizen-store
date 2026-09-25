CREATE TABLE "commerce"."wishlist_cart_adds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"wishlist_id" uuid,
	"wishlist_name" text NOT NULL,
	"customer_id" uuid,
	"cart_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"title" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"unit_price_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_cart_adds_quantity" CHECK ("commerce"."wishlist_cart_adds"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."wishlist_cart_adds" ADD CONSTRAINT "wishlist_cart_adds_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_store_created_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_cart_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_wishlist_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","wishlist_id");--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_customer_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_product_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "wishlist_cart_adds_variant_idx" ON "commerce"."wishlist_cart_adds" USING btree ("store_id","variant_id");