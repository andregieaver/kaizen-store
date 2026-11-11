ALTER TABLE "commerce"."inventory_locations" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "drop_ships" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "order_email" text;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "ships_from" char(2);--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "order_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "dispatch_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "order_method" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "return_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD COLUMN "order_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_locations" ADD CONSTRAINT "inventory_locations_supplier_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "commerce"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_supplier_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "commerce"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_supplier_key" ON "commerce"."inventory_locations" USING btree ("supplier_id") WHERE "commerce"."inventory_locations"."supplier_id" is not null;--> statement-breakpoint
CREATE INDEX "product_variants_supplier_idx" ON "commerce"."product_variants" USING btree ("store_id","supplier_id") WHERE "commerce"."product_variants"."supplier_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_supplier_goods" CHECK ("commerce"."product_variants"."supplier_id" is null or "commerce"."product_variants"."delivery" = 'physical');--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_drop_ship_set" CHECK (not "commerce"."suppliers"."drop_ships" or ("commerce"."suppliers"."order_email" is not null and "commerce"."suppliers"."ships_from" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_order_email" CHECK ("commerce"."suppliers"."order_email" is null or (length("commerce"."suppliers"."order_email") between 3 and 254 and "commerce"."suppliers"."order_email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'));--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_ships_from" CHECK ("commerce"."suppliers"."ships_from" is null or "commerce"."suppliers"."ships_from" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_order_language" CHECK ("commerce"."suppliers"."order_language" ~ '^[a-z]{2}$');--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_dispatch_days" CHECK ("commerce"."suppliers"."dispatch_days" between 1 and 30);--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_order_method" CHECK ("commerce"."suppliers"."order_method" in ('email', 'connected', 'file'));--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_drop_ship_texts" CHECK (length("commerce"."suppliers"."return_address") <= 500 and length("commerce"."suppliers"."order_note") <= 500);