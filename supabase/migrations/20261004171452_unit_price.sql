ALTER TABLE "commerce"."order_lines" ADD COLUMN "measure_amount" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "measure_unit" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "measure_base" text;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "measure_amount" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "measure_unit" text;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "measure_base" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "sold_by_measure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD COLUMN "requires_unit_price" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_measure_pair" CHECK (("commerce"."order_lines"."measure_amount" is null) = ("commerce"."order_lines"."measure_unit" is null));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_measure_amount" CHECK ("commerce"."order_lines"."measure_amount" > 0 and "commerce"."order_lines"."measure_amount" <= 1000000);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_measure_unit" CHECK ("commerce"."order_lines"."measure_unit" in ('g', 'kg', 'ml', 'cl', 'l', 'cm', 'm', 'm2', 'piece'));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_measure_base" CHECK (("commerce"."order_lines"."measure_amount" is null) = ("commerce"."order_lines"."measure_base" is null) and ("commerce"."order_lines"."measure_base" is null or (
        ("commerce"."order_lines"."measure_unit" in ('g', 'kg') and "commerce"."order_lines"."measure_base" in ('kg', '100g'))
        or ("commerce"."order_lines"."measure_unit" in ('ml', 'cl', 'l') and "commerce"."order_lines"."measure_base" in ('l', '100ml'))
        or ("commerce"."order_lines"."measure_unit" in ('cm', 'm') and "commerce"."order_lines"."measure_base" = 'm')
        or ("commerce"."order_lines"."measure_unit" = 'm2' and "commerce"."order_lines"."measure_base" = 'm2')
        or ("commerce"."order_lines"."measure_unit" = 'piece' and "commerce"."order_lines"."measure_base" = 'piece'))));--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_measure_pair" CHECK (("commerce"."product_variants"."measure_amount" is null) = ("commerce"."product_variants"."measure_unit" is null));--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_measure_amount" CHECK ("commerce"."product_variants"."measure_amount" > 0 and "commerce"."product_variants"."measure_amount" <= 1000000);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_measure_unit" CHECK ("commerce"."product_variants"."measure_unit" in ('g', 'kg', 'ml', 'cl', 'l', 'cm', 'm', 'm2', 'piece'));--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_measure_base" CHECK ("commerce"."product_variants"."measure_base" is null or (
        "commerce"."product_variants"."measure_amount" is not null and (
          ("commerce"."product_variants"."measure_unit" in ('g', 'kg') and "commerce"."product_variants"."measure_base" in ('kg', '100g'))
          or ("commerce"."product_variants"."measure_unit" in ('ml', 'cl', 'l') and "commerce"."product_variants"."measure_base" in ('l', '100ml'))
          or ("commerce"."product_variants"."measure_unit" in ('cm', 'm') and "commerce"."product_variants"."measure_base" = 'm')
          or ("commerce"."product_variants"."measure_unit" = 'm2' and "commerce"."product_variants"."measure_base" = 'm2')
          or ("commerce"."product_variants"."measure_unit" = 'piece' and "commerce"."product_variants"."measure_base" = 'piece'))));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_sold_by_measure_goods" CHECK (not "commerce"."products"."sold_by_measure" or "commerce"."products"."kind" = 'goods');--> statement-breakpoint
ALTER TABLE "commerce"."terms" ADD CONSTRAINT "terms_requires_unit_price" CHECK (not "commerce"."terms"."requires_unit_price" or ("commerce"."terms"."content_type" = 'product' and "commerce"."terms"."kind" = 'category'));