CREATE TABLE "commerce"."product_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"tile_stock" boolean DEFAULT false NOT NULL,
	"tile_quantity" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."product_settings" ADD CONSTRAINT "product_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;