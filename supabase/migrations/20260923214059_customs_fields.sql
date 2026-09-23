ALTER TABLE "commerce"."product_variants" ADD COLUMN "hs_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "origin_country" char(2);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_hs_code_digits" CHECK ("commerce"."product_variants"."hs_code" ~ '^[0-9]{6,10}$');