-- A book's budget (D505): row-level security, as every commerce table (the server reads and writes it through its own connection; no
-- policy lets a client reach it). The owner's own plan, changed at will; nothing in it is posted.

ALTER TABLE "commerce"."ledger_budgets" ENABLE ROW LEVEL SECURITY;
