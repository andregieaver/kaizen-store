-- Stores' custom domains (P8). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.store_domains ENABLE ROW LEVEL SECURITY;
