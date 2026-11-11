CREATE TABLE "commerce"."search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"query" text NOT NULL,
	"results" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_queries_query" CHECK (length("commerce"."search_queries"."query") between 1 and 100),
	CONSTRAINT "search_queries_results" CHECK ("commerce"."search_queries"."results" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."pages" DROP CONSTRAINT "pages_store_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."product_translations" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (commerce.product_search_doc(locale, title, description)) STORED;--> statement-breakpoint
ALTER TABLE "commerce"."search_queries" ADD CONSTRAINT "search_queries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_queries_store_idx" ON "commerce"."search_queries" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "search_queries_created_idx" ON "commerce"."search_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_translations_search_idx" ON "commerce"."product_translations" USING gin ("search");--> statement-breakpoint
ALTER TABLE "commerce"."pages" ADD CONSTRAINT "pages_store_slug_not_reserved" CHECK ("commerce"."pages"."store_id" is null or "commerce"."pages"."type" <> 'page' or "commerce"."pages"."slug" not in ('account', 'blog', 'cart', 'category', 'checkout', 'cookies', 'download', 'order', 'p', 'search', 'subscription', 'tag', 'unsubscribe', 'wishlist'));