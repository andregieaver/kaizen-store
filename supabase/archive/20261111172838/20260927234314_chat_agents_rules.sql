-- The chat agent's knowledge (D81): a site's published pages and articles
-- and its knowledge base's documents, in passages of a few paragraphs. A
-- passage is found by keyword (`search`, stemmed by its locale's language,
-- `simple` for documents in any) and by meaning (`embedding`, made by the
-- site's AI, D73, with the `space` of the model that made it, so vectors of
-- different models are never compared). `version` is what its source was
-- when it was cut (a page's publishing time, a document's update), so a
-- source is cut again only when it changes. Not in the Drizzle schema,
-- which cannot name a type in another schema: read and written with SQL.
CREATE TABLE commerce.knowledge_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid REFERENCES commerce.stores (id) ON DELETE CASCADE,
  document_id uuid REFERENCES commerce.knowledge_documents (id) ON DELETE CASCADE,
  page_id uuid REFERENCES commerce.pages (id) ON DELETE CASCADE,
  locale text,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL CHECK (length(title) <= 300),
  -- Where the passage is on the site, from the country's root (`/about`); null for documents.
  path text CHECK (path IS NULL OR path ~ '^/'),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  version text NOT NULL,
  search tsvector GENERATED ALWAYS AS (
    setweight(pg_catalog.to_tsvector(commerce.search_config(coalesce(locale, '')), title), 'A')
    || setweight(pg_catalog.to_tsvector(commerce.search_config(coalesce(locale, '')), body), 'C')
  ) STORED,
  space text CHECK (space IS NULL OR length(space) BETWEEN 1 AND 400),
  embedding extensions.vector,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_chunks_source CHECK ((document_id IS NULL) <> (page_id IS NULL)),
  CONSTRAINT knowledge_chunks_embedded CHECK ((space IS NULL) = (embedding IS NULL))
);
--> statement-breakpoint
CREATE INDEX knowledge_chunks_store_idx ON commerce.knowledge_chunks (store_id, space);
--> statement-breakpoint
CREATE INDEX knowledge_chunks_document_idx ON commerce.knowledge_chunks (document_id);
--> statement-breakpoint
CREATE INDEX knowledge_chunks_page_idx ON commerce.knowledge_chunks (page_id, locale);
--> statement-breakpoint
CREATE INDEX knowledge_chunks_search_idx ON commerce.knowledge_chunks USING gin (search);
--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.knowledge_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.chat_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.knowledge_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.chat_usage ENABLE ROW LEVEL SECURITY;
