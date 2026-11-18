-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D764).
ALTER TABLE commerce.contact_policies ENABLE ROW LEVEL SECURITY;
