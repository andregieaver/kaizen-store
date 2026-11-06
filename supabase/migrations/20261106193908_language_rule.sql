-- How a visitor is first shown a store's language and whether the currency goes with it (D474). Every store made before keeps its
-- country's own language (`own`, as it was), so no live store changes; a store made from now on starts with the browser's language.
ALTER TABLE "commerce"."stores" ADD COLUMN "language_rule" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ALTER COLUMN "language_rule" SET DEFAULT 'browser';--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "currency_follows_language" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "language_currencies" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_language_rule" CHECK ("commerce"."stores"."language_rule" in ('own', 'location', 'location-browser', 'browser'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_language_currencies" CHECK (jsonb_typeof("commerce"."stores"."language_currencies") = 'object' and octet_length("commerce"."stores"."language_currencies"::text) <= 2000
        and not jsonb_path_exists("commerce"."stores"."language_currencies", '$.* ? (@.type() != "string" || !(@ like_regex "^([A-Z]{3}|own)$"))'));--> statement-breakpoint
-- A store's copy (D129) keeps how its visitors are shown a language, as it keeps its languages and currencies. A store made from a store
-- template (D175, `clone_starter_setup()`) does not take the template's: it starts with the browser's language, as every new store does.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.oid = 'commerce.duplicate_store'::regproc;
  IF position('s.language_rule' in v_def) = 0 THEN
    v_new := replace(replace(v_def,
      'rates_auto, rates_updated_at, price_decimals, price_words, quantity_picker',
      'rates_auto, rates_updated_at, price_decimals, price_words, quantity_picker, language_rule, currency_follows_language, language_currencies'),
      's.rates_auto, s.rates_updated_at, s.price_decimals, s.price_words, s.quantity_picker',
      's.rates_auto, s.rates_updated_at, s.price_decimals, s.price_words, s.quantity_picker, s.language_rule, s.currency_follows_language, s.language_currencies');
    IF (length(v_new) - length(v_def)) <> length(', language_rule, currency_follows_language, language_currencies')
        + length(', s.language_rule, s.currency_follows_language, s.language_currencies') THEN
      RAISE EXCEPTION 'duplicate_store: the store copy was not found';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
