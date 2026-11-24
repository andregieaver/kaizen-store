CREATE TABLE "commerce"."company_lookup_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"provider" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"account_id" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_lookup_settings_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "company_lookup_settings_provider" CHECK ("commerce"."company_lookup_settings"."provider" in ('leadfeeder')),
	CONSTRAINT "company_lookup_settings_account" CHECK ("commerce"."company_lookup_settings"."account_id" ~ '^[0-9]{1,20}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."company_lookup_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."company_lookups" (
	"key" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"company_id" uuid,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_lookups_key" CHECK ("commerce"."company_lookups"."key" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "company_lookups_outcome" CHECK ("commerce"."company_lookups"."outcome" in ('company', 'none', 'failed') and ("commerce"."company_lookups"."outcome" = 'company') = ("commerce"."company_lookups"."company_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."company_lookups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."company_visits" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"company_id" uuid NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"pages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_visits_store_id_day_company_id_pk" PRIMARY KEY("store_id","day","company_id"),
	CONSTRAINT "company_visits_counts" CHECK ("commerce"."company_visits"."visitors" >= 0 and "commerce"."company_visits"."page_views" >= 0),
	CONSTRAINT "company_visits_pages" CHECK (jsonb_typeof("commerce"."company_visits"."pages") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."company_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."visit_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"legal_form" text,
	"domain" text,
	"country_code" char(2),
	"city" text,
	"industry" text,
	"employees" text,
	"register_id" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_companies_source_key" UNIQUE("source","source_id"),
	CONSTRAINT "visit_companies_source" CHECK ("commerce"."visit_companies"."source" in ('leadfeeder')),
	CONSTRAINT "visit_companies_lengths" CHECK (length("commerce"."visit_companies"."name") between 1 and 200 and length("commerce"."visit_companies"."source_id") between 1 and 100 and coalesce(length("commerce"."visit_companies"."legal_form"), 0) <= 100
        and coalesce(length("commerce"."visit_companies"."domain"), 0) <= 253 and coalesce(length("commerce"."visit_companies"."city"), 0) <= 100 and coalesce(length("commerce"."visit_companies"."industry"), 0) <= 200
        and coalesce(length("commerce"."visit_companies"."employees"), 0) <= 30 and coalesce(length("commerce"."visit_companies"."register_id"), 0) <= 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."visit_companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "company_recognition" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."company_lookup_settings" ADD CONSTRAINT "company_lookup_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_lookup_settings" ADD CONSTRAINT "company_lookup_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_lookups" ADD CONSTRAINT "company_lookups_company_id_visit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "commerce"."visit_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_visits" ADD CONSTRAINT "company_visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."company_visits" ADD CONSTRAINT "company_visits_company_id_visit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "commerce"."visit_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_lookup_settings_updated_by_idx" ON "commerce"."company_lookup_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "company_lookups_day_idx" ON "commerce"."company_lookups" USING btree ("day");--> statement-breakpoint
CREATE INDEX "company_lookups_company_idx" ON "commerce"."company_lookups" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_visits_company_idx" ON "commerce"."company_visits" USING btree ("company_id");