-- Kaizena Flow's own payouts (D508): row-level security, as every commerce table (the server reads and writes it through its own
-- connection; no policy lets a client reach it).

ALTER TABLE "commerce"."platform_payouts" ENABLE ROW LEVEL SECURITY;
