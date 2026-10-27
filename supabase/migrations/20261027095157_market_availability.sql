CREATE TABLE "commerce"."market_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"market_code" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_availability_key" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","market_code")
);
--> statement-breakpoint
ALTER TABLE "commerce"."market_availability" ADD CONSTRAINT "market_availability_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."market_availability" ADD CONSTRAINT "market_availability_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."market_availability" ADD CONSTRAINT "market_availability_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_availability_product_idx" ON "commerce"."market_availability" USING btree ("store_id","product_id","market_code");