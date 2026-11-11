ALTER TABLE "commerce"."domain_purchases" DROP CONSTRAINT "domain_purchases_kind";--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "auth_code_box" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_kind" CHECK ("commerce"."domain_purchases"."kind" in ('register', 'renew', 'transfer'));--> statement-breakpoint
-- Zones made before this were bought here, on Vercel's nameservers from the start.
UPDATE "commerce"."dns_zones" SET "arrived_at" = "created_at" WHERE "arrived_at" IS NULL;
