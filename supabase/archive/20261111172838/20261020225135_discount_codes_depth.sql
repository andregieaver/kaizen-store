CREATE TABLE "commerce"."discount_code_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"code" text NOT NULL,
	"batch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_code_items_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "discount_code_items_store_code_key" UNIQUE("store_id","code"),
	CONSTRAINT "discount_code_items_batch" CHECK ("commerce"."discount_code_items"."batch" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "term_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "min_quantity" integer;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "tier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "customer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "unique_codes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "discount_code_item_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."discount_code_items" ADD CONSTRAINT "discount_code_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."discount_code_items" ADD CONSTRAINT "discount_code_items_discount_fk" FOREIGN KEY ("store_id","discount_id") REFERENCES "commerce"."discount_codes"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_code_items_discount_idx" ON "commerce"."discount_code_items" USING btree ("store_id","discount_id","batch");--> statement-breakpoint
CREATE INDEX "orders_discount_code_item_idx" ON "commerce"."orders" USING btree ("store_id","discount_code_item_id") WHERE "commerce"."orders"."discount_code_item_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_min_quantity" CHECK ("commerce"."discount_codes"."min_quantity" is null or "commerce"."discount_codes"."min_quantity" between 1 and 1000);--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_term_ids" CHECK (jsonb_typeof("commerce"."discount_codes"."term_ids") = 'array');--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_tier_ids" CHECK (jsonb_typeof("commerce"."discount_codes"."tier_ids") = 'array');--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_customer_ids" CHECK (jsonb_typeof("commerce"."discount_codes"."customer_ids") = 'array' and jsonb_array_length("commerce"."discount_codes"."customer_ids") <= 100);