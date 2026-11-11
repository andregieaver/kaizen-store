CREATE TABLE "commerce"."price_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"from_quantity" integer NOT NULL,
	"percent" integer,
	"amounts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_breaks_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "price_breaks_step_key" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","from_quantity"),
	CONSTRAINT "price_breaks_from" CHECK ("commerce"."price_breaks"."from_quantity" between 2 and 9999),
	CONSTRAINT "price_breaks_percent" CHECK ("commerce"."price_breaks"."percent" between 1 and 99),
	CONSTRAINT "price_breaks_one" CHECK (("commerce"."price_breaks"."percent" is null) <> ("commerce"."price_breaks"."amounts" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."price_breaks" ADD CONSTRAINT "price_breaks_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."price_breaks" ADD CONSTRAINT "price_breaks_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_breaks_product_idx" ON "commerce"."price_breaks" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "price_breaks_variant_idx" ON "commerce"."price_breaks" USING btree ("store_id","variant_id");