ALTER TABLE "commerce"."stores" ADD COLUMN "language_rule" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "currency_follows_language" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "language_currencies" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_language_rule" CHECK ("commerce"."stores"."language_rule" in ('own', 'location', 'location-browser', 'browser'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_language_currencies" CHECK (jsonb_typeof("commerce"."stores"."language_currencies") = 'object' and octet_length("commerce"."stores"."language_currencies"::text) <= 2000
        and not jsonb_path_exists("commerce"."stores"."language_currencies", '$.* ? (@.type() != "string" || !(@ like_regex "^([A-Z]{3}|own)$"))'));