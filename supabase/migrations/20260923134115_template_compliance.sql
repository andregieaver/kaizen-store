CREATE TYPE "commerce"."producer_scheme" AS ENUM('packaging', 'electrical_equipment', 'batteries', 'textiles', 'furniture', 'tyres');--> statement-breakpoint
ALTER TYPE "commerce"."withdrawal_exclusion" ADD VALUE 'price_fluctuation';--> statement-breakpoint
ALTER TYPE "commerce"."withdrawal_exclusion" ADD VALUE 'alcohol_future_delivery';--> statement-breakpoint
ALTER TYPE "commerce"."withdrawal_exclusion" ADD VALUE 'periodicals';--> statement-breakpoint
ALTER TYPE "commerce"."withdrawal_exclusion" ADD VALUE 'digital_content';--> statement-breakpoint
CREATE TABLE "commerce"."producer_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" char(2) NOT NULL,
	"scheme" "commerce"."producer_scheme" NOT NULL,
	"registration_number" text NOT NULL,
	"authority" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producer_registrations_valid_range" CHECK ("commerce"."producer_registrations"."valid_to" is null or "commerce"."producer_registrations"."valid_to" >= "commerce"."producer_registrations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_schemes" (
	"product_id" uuid NOT NULL,
	"scheme" "commerce"."producer_scheme" NOT NULL,
	CONSTRAINT "product_schemes_product_id_scheme_pk" PRIMARY KEY("product_id","scheme")
);
--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."producer_registrations" ADD CONSTRAINT "producer_registrations_market_code_markets_code_fk" FOREIGN KEY ("market_code") REFERENCES "commerce"."markets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_schemes" ADD CONSTRAINT "product_schemes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "producer_registrations_market_scheme_idx" ON "commerce"."producer_registrations" USING btree ("market_code","scheme");