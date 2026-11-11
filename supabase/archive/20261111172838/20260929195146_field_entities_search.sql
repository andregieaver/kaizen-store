CREATE TABLE "commerce"."field_search" (
	"store_id" uuid NOT NULL,
	"entity" text DEFAULT 'product' NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"body" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (commerce.product_search_doc(locale, '', body)) STORED,
	CONSTRAINT "field_search_store_id_entity_entity_id_locale_pk" PRIMARY KEY("store_id","entity","entity_id","locale"),
	CONSTRAINT "field_search_entity" CHECK ("commerce"."field_search"."entity" in ('product'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."field_values" DROP CONSTRAINT "field_values_entity";--> statement-breakpoint
ALTER TABLE "commerce"."field_search" ADD CONSTRAINT "field_search_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_search_search_idx" ON "commerce"."field_search" USING gin ("search");--> statement-breakpoint
ALTER TABLE "commerce"."field_values" ADD CONSTRAINT "field_values_entity" CHECK ("commerce"."field_values"."entity" in ('product', 'page', 'article', 'variant', 'term'));