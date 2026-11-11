CREATE TABLE "commerce"."docs_index_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"hash" text NOT NULL,
	"rows" integer NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_index_state_one" CHECK ("commerce"."docs_index_state"."id" = 1),
	CONSTRAINT "docs_index_state_rows" CHECK ("commerce"."docs_index_state"."rows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."docs_reads" (
	"path" text NOT NULL,
	"lang" text NOT NULL,
	"day" date NOT NULL,
	"reads" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "docs_reads_path_lang_day_pk" PRIMARY KEY("path","lang","day"),
	CONSTRAINT "docs_reads_path" CHECK ("commerce"."docs_reads"."path" ~ '^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,4}$'),
	CONSTRAINT "docs_reads_lang" CHECK ("commerce"."docs_reads"."lang" in ('en', 'nb')),
	CONSTRAINT "docs_reads_count" CHECK ("commerce"."docs_reads"."reads" >= 1)
);
--> statement-breakpoint
CREATE TABLE "commerce"."docs_search_misses" (
	"query" text NOT NULL,
	"lang" text NOT NULL,
	"misses" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_search_misses_query_lang_pk" PRIMARY KEY("query","lang"),
	CONSTRAINT "docs_search_misses_query" CHECK (char_length("commerce"."docs_search_misses"."query") between 2 and 100),
	CONSTRAINT "docs_search_misses_lang" CHECK ("commerce"."docs_search_misses"."lang" in ('en', 'nb')),
	CONSTRAINT "docs_search_misses_count" CHECK ("commerce"."docs_search_misses"."misses" >= 1)
);
--> statement-breakpoint
CREATE INDEX "docs_reads_day_idx" ON "commerce"."docs_reads" USING btree ("day");--> statement-breakpoint
CREATE INDEX "docs_search_misses_last_idx" ON "commerce"."docs_search_misses" USING btree ("last_at");--> statement-breakpoint
-- The docs' search index (D443): one row per part of an article (its start, and each ## and ### heading with the words below it) and per
-- reference item of unit A's contracts (an Admin API operation, a webhook topic, an MCP tool, an error code, a scope), made by
-- docsIndexRows() and written only by src/server/docs-search.ts when their fingerprint changed (docs_index_state). Found by keyword
-- (`search`, stemmed by the row's language through commerce.search_config(): english or norwegian; the title weighs most, then the
-- headings and the reference item's code, then the words), by the start of a word while typing (`words`, the same unstemmed), by a title,
-- heading or code close to what was typed (`trgm`, pg_trgm's word similarity, for typos), and by meaning (`embedding`, made by the
-- platform's AI with the `space` of the model that made it, as knowledge_chunks'; a row keeps its vector while `text_hash` is unchanged).
-- Not in the Drizzle schema, which cannot name a type of another schema: read and written with SQL.
CREATE TABLE "commerce"."docs_index" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "key" text NOT NULL CONSTRAINT "docs_index_key" UNIQUE CHECK (char_length("key") BETWEEN 3 AND 400),
  "doc" text NOT NULL CHECK (char_length("doc") BETWEEN 3 AND 400),
  "item" text NOT NULL CHECK ("item" IN ('section', 'changelog', 'operation', 'topic', 'tool', 'agent-tool', 'error', 'scope')),
  "track" text NOT NULL CHECK ("track" IN ('owners', 'developers')),
  "kind" text NOT NULL CHECK ("kind" IN ('tutorial', 'how-to', 'concept', 'reference', 'troubleshooting', 'changelog')),
  "lang" text NOT NULL CHECK ("lang" IN ('en', 'nb')),
  "areas" text[] NOT NULL CHECK (cardinality("areas") BETWEEN 1 AND 20),
  "features" text[] NOT NULL DEFAULT '{}',
  "plans" text[] NOT NULL DEFAULT '{}',
  "section" text CHECK ("section" IS NULL OR "section" ~ '^(owners|developers)/[a-z0-9][a-z0-9-]*$'),
  "section_title" text,
  "path" text CHECK ("path" IS NULL OR "path" ~ '^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,4}$'),
  "url" text NOT NULL CHECK ("url" ~ '^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){0,4}(#[a-z0-9][a-z0-9-]*)?$' AND char_length("url") <= 400),
  "title" text NOT NULL CHECK (char_length("title") BETWEEN 1 AND 300),
  "headings" text NOT NULL DEFAULT '',
  "code" text,
  "summary" text NOT NULL,
  "text" text NOT NULL CHECK (char_length("text") <= 4000),
  "position" integer NOT NULL CHECK ("position" >= 0),
  "reading" integer NOT NULL CHECK ("reading" >= 0),
  "checked" date,
  "text_hash" text NOT NULL,
  "search" tsvector GENERATED ALWAYS AS (
    setweight(pg_catalog.to_tsvector(commerce.search_config("lang"), "title"), 'A')
    || setweight(pg_catalog.to_tsvector(commerce.search_config("lang"), "headings" || ' ' || coalesce("code", '')), 'B')
    || setweight(pg_catalog.to_tsvector(commerce.search_config("lang"), "text"), 'C')
  ) STORED,
  "words" tsvector GENERATED ALWAYS AS (
    setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, "title"), 'A')
    || setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, "headings" || ' ' || coalesce("code", '')), 'B')
    || setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, "text"), 'C')
  ) STORED,
  "trgm" text GENERATED ALWAYS AS (lower("title" || ' ' || "headings" || ' ' || coalesce("code", ''))) STORED,
  "space" text CHECK ("space" IS NULL OR char_length("space") BETWEEN 1 AND 400),
  "embedding" extensions.vector,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "docs_index_embedded" CHECK (("space" IS NULL) = ("embedding" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "docs_index_doc_idx" ON "commerce"."docs_index" USING btree ("doc", "position");--> statement-breakpoint
CREATE INDEX "docs_index_search_idx" ON "commerce"."docs_index" USING gin ("search");--> statement-breakpoint
CREATE INDEX "docs_index_words_idx" ON "commerce"."docs_index" USING gin ("words");--> statement-breakpoint
CREATE INDEX "docs_index_trgm_idx" ON "commerce"."docs_index" USING gin ("trgm" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "docs_index_space_idx" ON "commerce"."docs_index" USING btree ("space");--> statement-breakpoint
-- Reached only through server code (D443): the index, its fingerprint, the misses and the reads.
ALTER TABLE "commerce"."docs_index" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."docs_index_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."docs_search_misses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."docs_reads" ENABLE ROW LEVEL SECURITY;