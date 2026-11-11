CREATE TABLE "commerce"."company_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" uuid,
	"customer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "company_invites_status" CHECK ("commerce"."company_invites"."status" in ('pending', 'accepted', 'revoked', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."customer_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"organisation_number" text DEFAULT '' NOT NULL,
	"tier_id" uuid,
	"employee_share_percent" integer DEFAULT 100 NOT NULL,
	"max_members" integer DEFAULT 25 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_companies_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customer_companies_share" CHECK ("commerce"."customer_companies"."employee_share_percent" between 0 and 100),
	CONSTRAINT "customer_companies_max" CHECK ("commerce"."customer_companies"."max_members" between 1 and 1000),
	CONSTRAINT "customer_companies_name" CHECK (length("commerce"."customer_companies"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "commerce"."customer_sign_in_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sign_in_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "commerce"."customer_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"percent" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tiers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customer_tiers_percent" CHECK ("commerce"."customer_tiers"."percent" between 1 and 100),
	CONSTRAINT "customer_tiers_name" CHECK (length("commerce"."customer_tiers"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "tier_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "company_role" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "member_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "member_discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "member_label" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "member_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "commerce"."company_invites" ADD CONSTRAINT "company_invites_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD CONSTRAINT "customer_companies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD CONSTRAINT "customer_companies_tier_fk" FOREIGN KEY ("store_id","tier_id") REFERENCES "commerce"."customer_tiers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_sign_in_links" ADD CONSTRAINT "customer_sign_in_links_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_tiers" ADD CONSTRAINT "customer_tiers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_invites_company_idx" ON "commerce"."company_invites" USING btree ("store_id","company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_invites_one_pending_idx" ON "commerce"."company_invites" USING btree ("company_id",lower("email")) WHERE "commerce"."company_invites"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "customer_companies_store_name_idx" ON "commerce"."customer_companies" USING btree ("store_id",lower("name"));--> statement-breakpoint
CREATE INDEX "customer_sign_in_links_customer_idx" ON "commerce"."customer_sign_in_links" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tiers_store_name_idx" ON "commerce"."customer_tiers" USING btree ("store_id",lower("name"));--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_tier_fk" FOREIGN KEY ("store_id","tier_id") REFERENCES "commerce"."customer_tiers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_tier_idx" ON "commerce"."customers" USING btree ("store_id","tier_id");--> statement-breakpoint
CREATE INDEX "customers_company_idx" ON "commerce"."customers" USING btree ("store_id","company_id");--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD CONSTRAINT "customers_company_role" CHECK (("commerce"."customers"."company_id" is null and "commerce"."customers"."company_role" is null) or ("commerce"."customers"."company_id" is not null and "commerce"."customers"."company_role" is not null and "commerce"."customers"."company_role" in ('owner', 'employee')));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_member_discount" CHECK ("commerce"."order_lines"."member_discount_minor" between 0 and "commerce"."order_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_member_discount" CHECK ("commerce"."orders"."member_discount_minor" between 0 and "commerce"."orders"."discount_minor");--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.customer_tiers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.customer_companies ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.company_invites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commerce.customer_sign_in_links ENABLE ROW LEVEL SECURITY;
