-- Activities (S3 of docs/own-books-and-sales.md, D468): the rules the database keeps.
--   Row-level security, as every commerce table.
--   An activity's person and company are links that erasure and deletion set null (the composite key would otherwise null the store id
--   too); a deal's activities go with the deal (the generated key cascades).

ALTER TABLE "commerce"."activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE commerce.activities DROP CONSTRAINT activities_customer_fk;
--> statement-breakpoint
ALTER TABLE commerce.activities ADD CONSTRAINT activities_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint
ALTER TABLE commerce.activities DROP CONSTRAINT activities_company_fk;
--> statement-breakpoint
ALTER TABLE commerce.activities ADD CONSTRAINT activities_company_fk
  FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies (store_id, id)
  ON DELETE SET NULL (company_id);
