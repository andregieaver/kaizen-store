-- The search cache (D74, D75). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.search_cache ENABLE ROW LEVEL SECURITY;
