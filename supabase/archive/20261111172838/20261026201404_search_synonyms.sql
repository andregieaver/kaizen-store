CREATE TABLE "commerce"."search_synonyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"kind" text NOT NULL,
	"words" text[] NOT NULL,
	"means" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_synonyms_kind" CHECK ("commerce"."search_synonyms"."kind" in ('both', 'one_way')),
	CONSTRAINT "search_synonyms_locale" CHECK (length("commerce"."search_synonyms"."locale") between 2 and 20),
	CONSTRAINT "search_synonyms_words" CHECK (case when "commerce"."search_synonyms"."kind" = 'both' then cardinality("commerce"."search_synonyms"."words") between 2 and 20 and cardinality("commerce"."search_synonyms"."means") = 0
        else cardinality("commerce"."search_synonyms"."words") between 1 and 20 and cardinality("commerce"."search_synonyms"."means") between 1 and 20 end)
);
--> statement-breakpoint
ALTER TABLE "commerce"."search_synonyms" ADD CONSTRAINT "search_synonyms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_synonyms_store_idx" ON "commerce"."search_synonyms" USING btree ("store_id","locale");