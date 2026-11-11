CREATE TABLE "commerce"."ecb_reference_rates" (
	"rate_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" text DEFAULT 'ecb' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ecb_reference_rates_rate_date_currency_pk" PRIMARY KEY("rate_date","currency"),
	CONSTRAINT "ecb_reference_rates_rate" CHECK ("commerce"."ecb_reference_rates"."rate" > 0),
	CONSTRAINT "ecb_reference_rates_source" CHECK ("commerce"."ecb_reference_rates"."source" in ('ecb')),
	CONSTRAINT "ecb_reference_rates_currency" CHECK ("commerce"."ecb_reference_rates"."currency" ~ '^[A-Z]{3}$' and "commerce"."ecb_reference_rates"."currency" <> 'EUR')
);
--> statement-breakpoint
CREATE TABLE "commerce"."tax_rate_overrides" (
	"store_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rate_overrides_store_id_currency_rate_date_pk" PRIMARY KEY("store_id","currency","rate_date"),
	CONSTRAINT "tax_rate_overrides_rate" CHECK ("commerce"."tax_rate_overrides"."rate" > 0),
	CONSTRAINT "tax_rate_overrides_currency" CHECK ("commerce"."tax_rate_overrides"."currency" ~ '^[A-Z]{3}$' and "commerce"."tax_rate_overrides"."currency" <> 'EUR'),
	CONSTRAINT "tax_rate_overrides_reason" CHECK (length(btrim("commerce"."tax_rate_overrides"."reason")) between 10 and 300),
	CONSTRAINT "tax_rate_overrides_date" CHECK ("commerce"."tax_rate_overrides"."rate_date" >= date '2021-07-01')
);
--> statement-breakpoint
CREATE TABLE "commerce"."tax_report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"report" text NOT NULL,
	"scheme" text,
	"period_key" text NOT NULL,
	"mode" text,
	"rows" integer NOT NULL,
	"totals" jsonb NOT NULL,
	"exported_by" uuid NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_report_exports_report" CHECK ("commerce"."tax_report_exports"."report" in ('vat', 'oss', 'oss_detail', 'ioss', 'ioss_detail', 'reconciliation')),
	CONSTRAINT "tax_report_exports_scheme" CHECK ("commerce"."tax_report_exports"."scheme" is null or "commerce"."tax_report_exports"."scheme" in ('union', 'non_union', 'ioss')),
	CONSTRAINT "tax_report_exports_mode" CHECK ("commerce"."tax_report_exports"."mode" is null or "commerce"."tax_report_exports"."mode" in ('books', 'filing')),
	CONSTRAINT "tax_report_exports_rows" CHECK ("commerce"."tax_report_exports"."rows" >= 0),
	CONSTRAINT "tax_report_exports_totals" CHECK (jsonb_typeof("commerce"."tax_report_exports"."totals") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."tax_rate_overrides" ADD CONSTRAINT "tax_rate_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tax_rate_overrides" ADD CONSTRAINT "tax_rate_overrides_set_by_accounts_id_fk" FOREIGN KEY ("set_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tax_report_exports" ADD CONSTRAINT "tax_report_exports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tax_report_exports" ADD CONSTRAINT "tax_report_exports_exported_by_accounts_id_fk" FOREIGN KEY ("exported_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rate_overrides_set_by_idx" ON "commerce"."tax_rate_overrides" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "tax_report_exports_period_idx" ON "commerce"."tax_report_exports" USING btree ("store_id","report","period_key","exported_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tax_report_exports_exported_by_idx" ON "commerce"."tax_report_exports" USING btree ("exported_by");--> statement-breakpoint
CREATE INDEX "invoices_supply_idx" ON "commerce"."invoices" USING btree ("store_id","supply_date");