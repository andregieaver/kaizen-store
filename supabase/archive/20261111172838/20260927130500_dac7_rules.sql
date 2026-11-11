-- DAC7 details of hosts (D71). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.host_tax_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.host_tax_details
  ADD CONSTRAINT host_tax_details_countries CHECK (country ~ '^[A-Z]{2}$' AND tin_country ~ '^[A-Z]{2}$');
