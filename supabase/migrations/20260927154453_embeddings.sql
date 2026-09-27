-- Search by meaning (Phase 2, S2, D74). pgvector in the extensions schema,
-- as Supabase advises: name its type and operators with the schema
-- (extensions.vector, OPERATOR(extensions.<=>)).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- A product translation's vector, made by the store's AI (D73) from its
-- title, categories and tags, and description. `space` names the model
-- that made it (embeddingSpace()), so vectors of different models are never
-- compared; `content_hash` is the md5 of what was embedded, so a vector is
-- made again only when the text or the model changes. The vector has no
-- fixed length because models differ. Not in the Drizzle schema, which
-- cannot name a type in another schema: read and written with SQL only.
CREATE TABLE commerce.product_embeddings (
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  locale text NOT NULL,
  space text NOT NULL CHECK (length(space) BETWEEN 1 AND 400),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{32}$'),
  embedding extensions.vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, locale),
  -- Goes with its translation (and so with its product and store).
  CONSTRAINT product_embeddings_translation_fk FOREIGN KEY (product_id, locale)
    REFERENCES commerce.product_translations (product_id, locale) ON DELETE CASCADE,
  CONSTRAINT product_embeddings_product_fk FOREIGN KEY (store_id, product_id)
    REFERENCES commerce.products (store_id, id) ON DELETE CASCADE
);

-- A search compares the query with every vector of the store's current
-- model: stores' catalogues are small enough for an exact scan, which,
-- unlike an approximate index across all stores, never misses a store's
-- own products. Add an HNSW index per model when a store outgrows it.
CREATE INDEX product_embeddings_store_idx ON commerce.product_embeddings (store_id, space);

-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.product_embeddings ENABLE ROW LEVEL SECURITY;
