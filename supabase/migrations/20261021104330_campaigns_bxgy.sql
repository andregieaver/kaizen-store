ALTER TABLE "commerce"."campaigns" DROP CONSTRAINT "campaigns_kind";--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "buy_min_quantity" integer;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "buy_min_amounts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_term_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_kind" text;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_percent" integer;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "get_amounts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD COLUMN "uses_per_order" integer;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_bxgy" CHECK (coalesce(jsonb_typeof("commerce"."campaigns"."buy_min_amounts") = 'object' and jsonb_typeof("commerce"."campaigns"."get_product_ids") = 'array' and jsonb_typeof("commerce"."campaigns"."get_term_ids") = 'array' and jsonb_typeof("commerce"."campaigns"."get_amounts") = 'object' and (
        ("commerce"."campaigns"."kind" = 'bxgy'
          and (("commerce"."campaigns"."buy_min_quantity" between 1 and 100 and "commerce"."campaigns"."buy_min_amounts" = '{}'::jsonb) or ("commerce"."campaigns"."buy_min_quantity" is null and "commerce"."campaigns"."buy_min_amounts" <> '{}'::jsonb))
          and "commerce"."campaigns"."get_quantity" between 1 and 20
          and (("commerce"."campaigns"."get_kind" = 'free' and "commerce"."campaigns"."get_percent" is null and "commerce"."campaigns"."get_amounts" = '{}'::jsonb)
            or ("commerce"."campaigns"."get_kind" = 'percent' and "commerce"."campaigns"."get_percent" between 1 and 100 and "commerce"."campaigns"."get_amounts" = '{}'::jsonb)
            or ("commerce"."campaigns"."get_kind" = 'amount' and "commerce"."campaigns"."get_percent" is null and "commerce"."campaigns"."get_amounts" <> '{}'::jsonb))
          and ("commerce"."campaigns"."uses_per_order" is null or "commerce"."campaigns"."uses_per_order" between 1 and 100))
        or ("commerce"."campaigns"."kind" <> 'bxgy' and "commerce"."campaigns"."buy_min_quantity" is null and "commerce"."campaigns"."buy_min_amounts" = '{}'::jsonb and "commerce"."campaigns"."get_product_ids" = '[]'::jsonb
          and "commerce"."campaigns"."get_term_ids" = '[]'::jsonb and "commerce"."campaigns"."get_quantity" = 0 and "commerce"."campaigns"."get_kind" is null and "commerce"."campaigns"."get_percent" is null
          and "commerce"."campaigns"."get_amounts" = '{}'::jsonb and "commerce"."campaigns"."uses_per_order" is null)), false));--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_kind" CHECK ("commerce"."campaigns"."kind" in ('percent', 'multi_buy', 'gift', 'amount', 'free_shipping', 'tiered', 'bxgy'));