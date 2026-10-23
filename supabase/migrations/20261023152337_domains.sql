CREATE TABLE "commerce"."dns_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"source" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"undo_of" uuid,
	"actor_id" uuid,
	"automatic" boolean DEFAULT false NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dns_changes_source" CHECK ("commerce"."dns_changes"."source" in ('editor', 'ai_manager', 'recipe', 'kaizena', 'undo', 'import')),
	CONSTRAINT "dns_changes_summary" CHECK (length("commerce"."dns_changes"."summary") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."dns_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"apex" text NOT NULL,
	"host" text DEFAULT 'vercel' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"left_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dns_zones_host" CHECK ("commerce"."dns_zones"."host" in ('vercel')),
	CONSTRAINT "dns_zones_status" CHECK ("commerce"."dns_zones"."status" in ('active', 'leaving', 'left'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."domain_pricing" (
	"currency" char(3) PRIMARY KEY NOT NULL,
	"margin_bps" integer DEFAULT 2500 NOT NULL,
	"minimum_minor" bigint NOT NULL,
	"round_minor" bigint DEFAULT 100 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_pricing_currency" CHECK ("commerce"."domain_pricing"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "domain_pricing_margin" CHECK ("commerce"."domain_pricing"."margin_bps" between 0 and 50000),
	CONSTRAINT "domain_pricing_minimum" CHECK ("commerce"."domain_pricing"."minimum_minor" >= 0),
	CONSTRAINT "domain_pricing_round" CHECK ("commerce"."domain_pricing"."round_minor" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."domain_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"registration_id" uuid,
	"registrant_id" uuid,
	"apex" text NOT NULL,
	"kind" text NOT NULL,
	"years" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"registrar" text NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"cost_currency" char(3) NOT NULL,
	"connect" boolean DEFAULT true NOT NULL,
	"mode" text,
	"stripe_invoice_id" text,
	"invoice_number" text,
	"invoice_url" text,
	"collection" text,
	"registrar_order_id" text,
	"problem" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"chosen_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoiced_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_purchases_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "domain_purchases_kind" CHECK ("commerce"."domain_purchases"."kind" in ('register', 'renew')),
	CONSTRAINT "domain_purchases_status" CHECK ("commerce"."domain_purchases"."status" in ('quoted', 'invoiced', 'paid', 'registering', 'done', 'failed', 'refunded', 'void')),
	CONSTRAINT "domain_purchases_years" CHECK ("commerce"."domain_purchases"."years" between 1 and 10),
	CONSTRAINT "domain_purchases_amount" CHECK ("commerce"."domain_purchases"."amount_minor" > 0),
	CONSTRAINT "domain_purchases_currency" CHECK ("commerce"."domain_purchases"."currency" ~ '^[A-Z]{3}$' and "commerce"."domain_purchases"."cost_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "domain_purchases_registrar" CHECK ("commerce"."domain_purchases"."registrar" in ('vercel')),
	CONSTRAINT "domain_purchases_mode" CHECK ("commerce"."domain_purchases"."mode" is null or "commerce"."domain_purchases"."mode" in ('test', 'live')),
	CONSTRAINT "domain_purchases_collection" CHECK ("commerce"."domain_purchases"."collection" is null or "commerce"."domain_purchases"."collection" in ('card', 'invoice')),
	CONSTRAINT "domain_purchases_problem" CHECK ("commerce"."domain_purchases"."problem" is null or length("commerce"."domain_purchases"."problem") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."domain_registrants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"company_name" text,
	"org_number" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address1" text NOT NULL,
	"address2" text,
	"city" text NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"postal_code" text NOT NULL,
	"country" char(2) NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_registrants_kind" CHECK ("commerce"."domain_registrants"."kind" in ('person', 'company')),
	CONSTRAINT "domain_registrants_company" CHECK ("commerce"."domain_registrants"."kind" = 'person' or "commerce"."domain_registrants"."company_name" is not null),
	CONSTRAINT "domain_registrants_country" CHECK ("commerce"."domain_registrants"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "domain_registrants_lengths" CHECK (length("commerce"."domain_registrants"."first_name") between 1 and 100 and length("commerce"."domain_registrants"."last_name") between 1 and 100 and length("commerce"."domain_registrants"."email") between 3 and 254
        and length("commerce"."domain_registrants"."phone") between 4 and 20 and length("commerce"."domain_registrants"."address1") between 1 and 200 and length("commerce"."domain_registrants"."city") between 1 and 100
        and length("commerce"."domain_registrants"."postal_code") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "commerce"."domain_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"apex" text NOT NULL,
	"registrar" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"registrant_id" uuid,
	"registered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"renew" boolean DEFAULT true NOT NULL,
	"registrar_renews" boolean DEFAULT true NOT NULL,
	"contact_verified" boolean,
	"contact_checked_at" timestamp with time zone,
	"transferred_out_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_registrations_registrar" CHECK ("commerce"."domain_registrations"."registrar" in ('vercel')),
	CONSTRAINT "domain_registrations_status" CHECK ("commerce"."domain_registrations"."status" in ('active', 'expired', 'transferring_out', 'transferred_out')),
	CONSTRAINT "domain_registrations_apex" CHECK ("commerce"."domain_registrations"."apex" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "domain_dns_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dns_changes" ADD CONSTRAINT "dns_changes_zone_id_dns_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "commerce"."dns_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dns_changes" ADD CONSTRAINT "dns_changes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dns_changes" ADD CONSTRAINT "dns_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD CONSTRAINT "dns_zones_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD CONSTRAINT "dns_zones_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_pricing" ADD CONSTRAINT "domain_pricing_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_registration_id_domain_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "commerce"."domain_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_registrant_id_domain_registrants_id_fk" FOREIGN KEY ("registrant_id") REFERENCES "commerce"."domain_registrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ADD CONSTRAINT "domain_purchases_chosen_by_accounts_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ADD CONSTRAINT "domain_registrants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ADD CONSTRAINT "domain_registrants_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD CONSTRAINT "domain_registrations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD CONSTRAINT "domain_registrations_registrant_id_domain_registrants_id_fk" FOREIGN KEY ("registrant_id") REFERENCES "commerce"."domain_registrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD CONSTRAINT "domain_registrations_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_changes_zone_idx" ON "commerce"."dns_changes" USING btree ("zone_id","created_at");--> statement-breakpoint
CREATE INDEX "dns_changes_store_idx" ON "commerce"."dns_changes" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "dns_changes_undo_of_idx" ON "commerce"."dns_changes" USING btree ("undo_of");--> statement-breakpoint
CREATE INDEX "dns_changes_actor_idx" ON "commerce"."dns_changes" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dns_zones_live_idx" ON "commerce"."dns_zones" USING btree ("apex") WHERE "commerce"."dns_zones"."status" <> 'left';--> statement-breakpoint
CREATE INDEX "dns_zones_store_idx" ON "commerce"."dns_zones" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "dns_zones_created_by_idx" ON "commerce"."dns_zones" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "domain_pricing_updated_by_idx" ON "commerce"."domain_pricing" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_purchases_open_idx" ON "commerce"."domain_purchases" USING btree ("apex","kind") WHERE "commerce"."domain_purchases"."status" in ('quoted', 'invoiced', 'paid', 'registering');--> statement-breakpoint
CREATE INDEX "domain_purchases_store_idx" ON "commerce"."domain_purchases" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_purchases_work_idx" ON "commerce"."domain_purchases" USING btree ("status","next_try_at") WHERE "commerce"."domain_purchases"."status" in ('quoted', 'paid', 'registering', 'failed');--> statement-breakpoint
CREATE INDEX "domain_purchases_registration_idx" ON "commerce"."domain_purchases" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "domain_purchases_registrant_idx" ON "commerce"."domain_purchases" USING btree ("registrant_id");--> statement-breakpoint
CREATE INDEX "domain_purchases_chosen_by_idx" ON "commerce"."domain_purchases" USING btree ("chosen_by");--> statement-breakpoint
CREATE INDEX "domain_registrants_store_idx" ON "commerce"."domain_registrants" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "domain_registrants_created_by_idx" ON "commerce"."domain_registrants" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_registrations_live_idx" ON "commerce"."domain_registrations" USING btree ("apex") WHERE "commerce"."domain_registrations"."status" <> 'transferred_out';--> statement-breakpoint
CREATE INDEX "domain_registrations_store_idx" ON "commerce"."domain_registrations" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "domain_registrations_expiry_idx" ON "commerce"."domain_registrations" USING btree ("expires_at") WHERE "commerce"."domain_registrations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "domain_registrations_registrant_idx" ON "commerce"."domain_registrations" USING btree ("registrant_id");--> statement-breakpoint
CREATE INDEX "domain_registrations_created_by_idx" ON "commerce"."domain_registrations" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."domain_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."domain_pricing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."dns_changes" ENABLE ROW LEVEL SECURITY;
