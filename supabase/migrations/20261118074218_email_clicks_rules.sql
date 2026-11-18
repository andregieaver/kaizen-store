-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D754).
ALTER TABLE commerce.email_clicks ENABLE ROW LEVEL SECURITY;
