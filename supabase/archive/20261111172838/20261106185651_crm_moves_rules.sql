-- Moving in from Pipedrive (S7 of docs/own-books-and-sales.md, D477): the rules the database keeps.
--   Row-level security, as every commerce table.
--   A store's move and its links go with the store.

ALTER TABLE "commerce"."crm_moves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."crm_move_links" ENABLE ROW LEVEL SECURITY;
