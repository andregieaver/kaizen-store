CREATE TABLE "commerce"."customs_settings" (
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"mode" text DEFAULT 'dap' NOT NULL,
	"vat_scheme" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_settings_store_id_market_code_pk" PRIMARY KEY("store_id","market_code"),
	CONSTRAINT "customs_settings_mode" CHECK ("commerce"."customs_settings"."mode" in ('dap', 'ddp'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."duty_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination" text NOT NULL,
	"hs_prefix" text DEFAULT '' NOT NULL,
	"origin" text,
	"applies_to" text DEFAULT 'any' NOT NULL,
	"duty_rate_bps" integer,
	"per_item_minor" bigint,
	"threshold_minor" bigint,
	"vat_threshold_minor" bigint,
	"threshold_currency" char(3),
	"threshold_per" text DEFAULT 'consignment' NOT NULL,
	"import_vat_bps" integer,
	"shipping_in_value" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"checked_on" date NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "duty_rates_destination" CHECK ("commerce"."duty_rates"."destination" ~ '^[A-Z]{2}$'),
	CONSTRAINT "duty_rates_prefix" CHECK ("commerce"."duty_rates"."hs_prefix" ~ '^[0-9]{0,10}$'),
	CONSTRAINT "duty_rates_origin" CHECK ("commerce"."duty_rates"."origin" is null or "commerce"."duty_rates"."origin" ~ '^[A-Z]{2}$'),
	CONSTRAINT "duty_rates_applies_to" CHECK ("commerce"."duty_rates"."applies_to" in ('any', 'scheme', 'no_scheme')),
	CONSTRAINT "duty_rates_rate" CHECK ("commerce"."duty_rates"."duty_rate_bps" is null or "commerce"."duty_rates"."duty_rate_bps" between 0 and 100000),
	CONSTRAINT "duty_rates_import_vat" CHECK ("commerce"."duty_rates"."import_vat_bps" is null or "commerce"."duty_rates"."import_vat_bps" between 0 and 10000),
	CONSTRAINT "duty_rates_threshold_per" CHECK ("commerce"."duty_rates"."threshold_per" in ('consignment', 'item')),
	CONSTRAINT "duty_rates_amounts" CHECK (("commerce"."duty_rates"."threshold_minor" is null or "commerce"."duty_rates"."threshold_minor" >= 0) and ("commerce"."duty_rates"."vat_threshold_minor" is null or "commerce"."duty_rates"."vat_threshold_minor" >= 0) and ("commerce"."duty_rates"."per_item_minor" is null or "commerce"."duty_rates"."per_item_minor" >= 0)),
	CONSTRAINT "duty_rates_currency" CHECK (("commerce"."duty_rates"."threshold_minor" is null and "commerce"."duty_rates"."vat_threshold_minor" is null and "commerce"."duty_rates"."per_item_minor" is null) or ("commerce"."duty_rates"."threshold_currency" is not null and "commerce"."duty_rates"."threshold_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "duty_rates_heading_row" CHECK ("commerce"."duty_rates"."hs_prefix" = '' or ("commerce"."duty_rates"."duty_rate_bps" is not null and "commerce"."duty_rates"."threshold_minor" is null and "commerce"."duty_rates"."vat_threshold_minor" is null and "commerce"."duty_rates"."per_item_minor" is null)),
	CONSTRAINT "duty_rates_base_origin" CHECK ("commerce"."duty_rates"."hs_prefix" <> '' or "commerce"."duty_rates"."origin" is null),
	CONSTRAINT "duty_rates_source" CHECK ("commerce"."duty_rates"."source" ~ '^https://' and length("commerce"."duty_rates"."source") <= 400),
	CONSTRAINT "duty_rates_period" CHECK ("commerce"."duty_rates"."valid_from" is null or "commerce"."duty_rates"."valid_to" is null or "commerce"."duty_rates"."valid_to" >= "commerce"."duty_rates"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "duties_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "customs" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."customs_settings" ADD CONSTRAINT "customs_settings_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."duty_rates" ADD CONSTRAINT "duty_rates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duty_rates_destination_idx" ON "commerce"."duty_rates" USING btree ("destination","hs_prefix");--> statement-breakpoint
CREATE INDEX "duty_rates_updated_by_idx" ON "commerce"."duty_rates" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_duties_non_negative" CHECK ("commerce"."orders"."duties_minor" >= 0);