-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection (D767).
ALTER TABLE commerce.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.flow_run_steps ENABLE ROW LEVEL SECURITY;
