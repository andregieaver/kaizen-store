ALTER TABLE "commerce"."product_terms" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "image_thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "texts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."product_terms" ADD CONSTRAINT "product_terms_position" CHECK ("commerce"."product_terms"."position" is null or "commerce"."product_terms"."position" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_texts_object" CHECK (jsonb_typeof("commerce"."terms"."texts") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_description_doc" CHECK ("commerce"."terms"."description" is null or jsonb_typeof("commerce"."terms"."description") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_page_parts" CHECK (("commerce"."terms"."description" is null and "commerce"."terms"."image_url" is null and "commerce"."terms"."texts" = '{}'::jsonb) or ("commerce"."terms"."content_type" = 'product' and "commerce"."terms"."store_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_image_pair" CHECK ("commerce"."terms"."image_thumbnail_url" is null or "commerce"."terms"."image_url" is not null);