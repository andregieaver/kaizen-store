ALTER TABLE "commerce"."markets" ADD COLUMN "price_decimals" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "price_words" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "price_decimals" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "price_words" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "quantity_picker" text DEFAULT 'buttons' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."markets" ADD CONSTRAINT "markets_price_decimals" CHECK ("commerce"."markets"."price_decimals" is null or "commerce"."markets"."price_decimals" in ('always', 'hide_whole'));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_price_words" CHECK ("commerce"."products"."price_words" is null or coalesce(
        octet_length("commerce"."products"."price_words"::text) <= 4000
        and ("commerce"."products"."price_words" = '{"mode": "none"}'::jsonb
          or ("commerce"."products"."price_words" ->> 'mode' = 'own' and jsonb_typeof("commerce"."products"."price_words" -> 'words') = 'object'
            and not jsonb_path_exists("commerce"."products"."price_words", '$.words.* ? (@.type() != "object")')
            and not jsonb_path_exists("commerce"."products"."price_words", '$.words.*.* ? (@.type() != "string" || @ like_regex "^.{25}" flag "s" || @ like_regex "[<>]")'))),
        false));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_price_decimals" CHECK ("commerce"."stores"."price_decimals" in ('always', 'hide_whole'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_quantity_picker" CHECK ("commerce"."stores"."quantity_picker" in ('buttons', 'box', 'hidden'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_price_words" CHECK (jsonb_typeof("commerce"."stores"."price_words") = 'object' and octet_length("commerce"."stores"."price_words"::text) <= 4000
        and not jsonb_path_exists("commerce"."stores"."price_words", '$.* ? (@.type() != "object")')
        and not jsonb_path_exists("commerce"."stores"."price_words", '$.*.* ? (@.type() != "string" || @ like_regex "^.{25}" flag "s" || @ like_regex "[<>]")'));