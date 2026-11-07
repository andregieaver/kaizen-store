-- Bank statements and their lines in a store's books (B4 route 1, D486): row-level security, as every commerce table. The server reads and
-- writes them through its own connection; no policy lets a client reach them.

ALTER TABLE "commerce"."bank_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."bank_lines" ENABLE ROW LEVEL SECURITY;
