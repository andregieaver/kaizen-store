-- Emails (decision D26): like every commerce table, row-level security on, no policies.
ALTER TABLE commerce.email_messages ENABLE ROW LEVEL SECURITY;
