ALTER TABLE "commerce"."access_requests" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "origin" text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "domain_dns_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "stripe_customer_test" text;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "stripe_customer_live" text;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD COLUMN "holding" text DEFAULT 'parked' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD COLUMN "holding_redirect" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "buyer" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "vat_kind" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "consent_text" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "review" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "review_outcome" text;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "domains_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD CONSTRAINT "accounts_origin" CHECK ("commerce"."accounts"."origin" in ('store', 'domain'));--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD CONSTRAINT "dns_zones_holding" CHECK ("commerce"."dns_zones"."holding" in ('parked', 'redirect', 'off') and ("commerce"."dns_zones"."holding" <> 'redirect' or "commerce"."dns_zones"."holding_redirect" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_buyer" CHECK ("commerce"."domain_purchases"."buyer" is null or "commerce"."domain_purchases"."buyer" in ('consumer', 'business'));--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_vat_kind" CHECK ("commerce"."domain_purchases"."vat_kind" is null or "commerce"."domain_purchases"."vat_kind" in ('mva', 'reverse_charge', 'outside_scope'));--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_review" CHECK ("commerce"."domain_purchases"."review" is null or "commerce"."domain_purchases"."review" in ('name', 'risk'));--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_review_outcome" CHECK ("commerce"."domain_purchases"."review_outcome" is null or "commerce"."domain_purchases"."review_outcome" in ('approved', 'refused'));