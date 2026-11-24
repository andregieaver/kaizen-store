CREATE TABLE "commerce"."register_companies" (
	"organisation_number" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"name" text,
	"org_form" text,
	"org_form_name" text,
	"industry_code" text,
	"industry_name" text,
	"employees" integer,
	"founded" date,
	"municipality" text,
	"website" text,
	"red_flag" text,
	"red_flag_on" date,
	"flagged_at" timestamp with time zone,
	"accounts_year" smallint,
	"accounts_currency" char(3),
	"revenue_minor" bigint,
	"operating_result_minor" bigint,
	"profit_minor" bigint,
	"equity_minor" bigint,
	"previous_revenue_minor" bigint,
	"facts_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accounts_checked_at" timestamp with time zone,
	CONSTRAINT "register_companies_number" CHECK ("commerce"."register_companies"."organisation_number" ~ '^[0-9]{9}$'),
	CONSTRAINT "register_companies_status" CHECK ("commerce"."register_companies"."status" in ('company', 'sole_trader', 'not_found')),
	CONSTRAINT "register_companies_red_flag" CHECK ("commerce"."register_companies"."red_flag" is null or "commerce"."register_companies"."red_flag" in ('bankrupt', 'winding_up', 'dissolution', 'deleted')),
	CONSTRAINT "register_companies_only_companies" CHECK ("commerce"."register_companies"."status" = 'company' or ("commerce"."register_companies"."name" is null and "commerce"."register_companies"."municipality" is null and "commerce"."register_companies"."website" is null and "commerce"."register_companies"."red_flag" is null and "commerce"."register_companies"."revenue_minor" is null and "commerce"."register_companies"."employees" is null)),
	CONSTRAINT "register_companies_lengths" CHECK (coalesce(length("commerce"."register_companies"."name"), 0) <= 200 and coalesce(length("commerce"."register_companies"."org_form_name"), 0) <= 100 and coalesce(length("commerce"."register_companies"."industry_name"), 0) <= 200
          and coalesce(length("commerce"."register_companies"."municipality"), 0) <= 100 and coalesce(length("commerce"."register_companies"."website"), 0) <= 253)
);
--> statement-breakpoint
ALTER TABLE "commerce"."register_companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "register_companies_flagged_idx" ON "commerce"."register_companies" USING btree ("flagged_at");