-- Order management (decision D27): like every commerce table, row-level security on, no policies.
ALTER TABLE commerce.shipments ENABLE ROW LEVEL SECURITY;
