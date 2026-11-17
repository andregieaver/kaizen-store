-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D730).
ALTER TABLE commerce.sending_pauses ENABLE ROW LEVEL SECURITY;
