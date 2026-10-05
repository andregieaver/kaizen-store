-- WordPress connections (D169). Like every commerce table: row-level security on, no policies (the server reaches it through Postgres, never the Data API).
ALTER TABLE commerce.wordpress_connections ENABLE ROW LEVEL SECURITY;
