CREATE TABLE "commerce"."wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_product_key" UNIQUE("wishlist_id","product_id"),
	CONSTRAINT "wishlist_items_quantity" CHECK ("commerce"."wishlist_items"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "commerce"."wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"browser_token_hash" text,
	"name" text NOT NULL,
	"keep_after_cart" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "wishlists_owner" CHECK ("commerce"."wishlists"."customer_id" is not null or "commerce"."wishlists"."browser_token_hash" is not null),
	CONSTRAINT "wishlists_name" CHECK (length("commerce"."wishlists"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_fk" FOREIGN KEY ("store_id","wishlist_id") REFERENCES "commerce"."wishlists"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."wishlist_items" ADD CONSTRAINT "wishlist_items_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."wishlists" ADD CONSTRAINT "wishlists_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."wishlists" ADD CONSTRAINT "wishlists_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_items_product_idx" ON "commerce"."wishlist_items" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_variant_idx" ON "commerce"."wishlist_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "wishlists_customer_idx" ON "commerce"."wishlists" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "wishlists_browser_idx" ON "commerce"."wishlists" USING btree ("store_id","browser_token_hash");