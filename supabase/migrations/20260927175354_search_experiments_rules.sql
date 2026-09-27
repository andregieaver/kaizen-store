-- Search tests (D77). At most one runs at a time.
CREATE UNIQUE INDEX search_experiments_one_running ON commerce.search_experiments ((true)) WHERE ended_at IS NULL;

-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.search_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.search_clicks ENABLE ROW LEVEL SECURITY;
