ALTER TABLE "commerce"."dns_changes" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD CONSTRAINT "dns_zones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ADD CONSTRAINT "domain_registrants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD CONSTRAINT "domain_registrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_zones_account_idx" ON "commerce"."dns_zones" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "domain_purchases_account_idx" ON "commerce"."domain_purchases" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "domain_registrants_account_idx" ON "commerce"."domain_registrants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "domain_registrations_account_idx" ON "commerce"."domain_registrations" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD CONSTRAINT "dns_zones_holder" CHECK ("commerce"."dns_zones"."store_id" is not null or "commerce"."dns_zones"."account_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_holder" CHECK ("commerce"."domain_purchases"."store_id" is not null or "commerce"."domain_purchases"."account_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ADD CONSTRAINT "domain_registrants_holder" CHECK ("commerce"."domain_registrants"."store_id" is not null or "commerce"."domain_registrants"."account_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD CONSTRAINT "domain_registrations_holder" CHECK ("commerce"."domain_registrations"."store_id" is not null or "commerce"."domain_registrations"."account_id" is not null);--> statement-breakpoint
-- Every domain kept so far is its store's: held by whoever made it, else the store's first owner (D315 decision 1: the owner or their company).
WITH first_owner AS (SELECT DISTINCT ON (m.store_id) m.store_id, m.account_id FROM commerce.store_members m WHERE m.role = 'owner' ORDER BY m.store_id, m.created_at)
UPDATE "commerce"."domain_registrants" r SET account_id = coalesce(r.created_by, o.account_id)
  FROM first_owner o WHERE o.store_id = r.store_id AND r.account_id IS NULL;--> statement-breakpoint
WITH first_owner AS (SELECT DISTINCT ON (m.store_id) m.store_id, m.account_id FROM commerce.store_members m WHERE m.role = 'owner' ORDER BY m.store_id, m.created_at)
UPDATE "commerce"."domain_purchases" p SET account_id = coalesce(p.chosen_by, o.account_id)
  FROM first_owner o WHERE o.store_id = p.store_id AND p.account_id IS NULL;--> statement-breakpoint
WITH first_owner AS (SELECT DISTINCT ON (m.store_id) m.store_id, m.account_id FROM commerce.store_members m WHERE m.role = 'owner' ORDER BY m.store_id, m.created_at)
UPDATE "commerce"."domain_registrations" r SET account_id = coalesce(r.created_by, o.account_id)
  FROM first_owner o WHERE o.store_id = r.store_id AND r.account_id IS NULL;--> statement-breakpoint
WITH first_owner AS (SELECT DISTINCT ON (m.store_id) m.store_id, m.account_id FROM commerce.store_members m WHERE m.role = 'owner' ORDER BY m.store_id, m.created_at)
UPDATE "commerce"."dns_zones" z SET account_id = coalesce(
    (SELECT g.account_id FROM commerce.domain_registrations g WHERE g.apex = z.apex AND g.status <> 'transferred_out' LIMIT 1),
    z.created_by, o.account_id)
  FROM first_owner o WHERE o.store_id = z.store_id AND z.account_id IS NULL;
