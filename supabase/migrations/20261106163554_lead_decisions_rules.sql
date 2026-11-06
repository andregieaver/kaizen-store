-- A leads inbox (S4 of docs/own-books-and-sales.md, D475): the rules the database keeps.
--   Row-level security, as every commerce table.
--   A decision's deal is its own store's; when the deal is deleted the decision stays (the person stays dismissed from the inbox as dealt
--   with) and loses the link (the composite key would otherwise null the store id too).

ALTER TABLE "commerce"."lead_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.lead_decisions DROP CONSTRAINT lead_decisions_deal_fk;
--> statement-breakpoint
ALTER TABLE commerce.lead_decisions ADD CONSTRAINT lead_decisions_deal_fk
  FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals (store_id, id)
  ON DELETE SET NULL (deal_id);
