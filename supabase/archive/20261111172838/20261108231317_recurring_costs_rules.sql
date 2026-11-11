-- A store's subscriptions (D503): row-level security, as every commerce table (the server reads and writes them through its own
-- connection; no policy lets a client reach them). The register is the owner's own list, changed and ended at will; nothing in it is
-- posted to the books.

ALTER TABLE "commerce"."recurring_costs" ENABLE ROW LEVEL SECURITY;
