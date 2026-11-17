-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D727).
ALTER TABLE commerce.sending_domains ENABLE ROW LEVEL SECURITY;
