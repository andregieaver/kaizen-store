-- The AI manager's memory (D103): what it knows about the person it works
-- for, kept per account, about one store (`store_id`) or everywhere (null).
-- Written when they tell it to remember, learned from conversations and
-- thumbs, found by keyword (`search`) and by meaning (`embedding`, made by
-- the site's AI with the `space` of its model, so vectors of different
-- models are never compared). Not in the Drizzle schema, which cannot name
-- a type in another schema: read and written with SQL.
CREATE TABLE commerce.assistant_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES commerce.accounts (id) ON DELETE CASCADE,
  store_id uuid REFERENCES commerce.stores (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preference', 'fact', 'procedure', 'goal')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  importance smallint NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source text NOT NULL CHECK (source IN ('told', 'learned', 'feedback')),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  last_used_at timestamptz,
  search tsvector GENERATED ALWAYS AS (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, content)) STORED,
  space text CHECK (space IS NULL OR length(space) BETWEEN 1 AND 400),
  embedding extensions.vector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_memories_vector CHECK ((space IS NULL) = (embedding IS NULL))
);
--> statement-breakpoint
CREATE INDEX assistant_memories_owner_idx ON commerce.assistant_memories (account_id, store_id, importance DESC);
--> statement-breakpoint
CREATE INDEX assistant_memories_store_idx ON commerce.assistant_memories (store_id);
--> statement-breakpoint
CREATE INDEX assistant_memories_search_idx ON commerce.assistant_memories USING gin (search);
--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.assistant_memories ENABLE ROW LEVEL SECURITY;
