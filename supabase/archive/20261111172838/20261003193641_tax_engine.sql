CREATE TABLE "commerce"."shipping_vat_rules" (
	"country_code" char(2) PRIMARY KEY NOT NULL,
	"rule" text DEFAULT 'standard' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"checked_on" date,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_vat_rules_rule" CHECK ("commerce"."shipping_vat_rules"."rule" in ('standard', 'follows_goods', 'highest')),
	CONSTRAINT "shipping_vat_rules_source" CHECK (length("commerce"."shipping_vat_rules"."source") <= 400)
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_tax_profile" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"vat_number_check_id" uuid,
	"vat_number_checked_at" timestamp with time zone,
	"vat_number_valid" boolean,
	"dispatch_country" char(2),
	"oss_scheme" text DEFAULT 'none' NOT NULL,
	"oss_member_state" char(2),
	"oss_number" text,
	"oss_registered_on" date,
	"ioss_number" text,
	"ioss_intermediary" text,
	"ioss_markets" text[] DEFAULT '{}'::text[] NOT NULL,
	"ioss_registered_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "store_tax_profile_vat_number" CHECK ("commerce"."store_tax_profile"."vat_number" is null or "commerce"."store_tax_profile"."vat_number" ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$'),
	CONSTRAINT "store_tax_profile_vat_check" CHECK ("commerce"."store_tax_profile"."vat_number" is not null or ("commerce"."store_tax_profile"."vat_number_check_id" is null and "commerce"."store_tax_profile"."vat_number_checked_at" is null and "commerce"."store_tax_profile"."vat_number_valid" is null)),
	CONSTRAINT "store_tax_profile_dispatch" CHECK ("commerce"."store_tax_profile"."dispatch_country" is null or "commerce"."store_tax_profile"."dispatch_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "store_tax_profile_oss_scheme" CHECK ("commerce"."store_tax_profile"."oss_scheme" in ('none', 'union', 'non_union')),
	CONSTRAINT "store_tax_profile_oss_union" CHECK ("commerce"."store_tax_profile"."oss_scheme" <> 'union' or "commerce"."store_tax_profile"."oss_member_state" is not null),
	CONSTRAINT "store_tax_profile_oss_number" CHECK ("commerce"."store_tax_profile"."oss_number" is null or ("commerce"."store_tax_profile"."oss_scheme" = 'non_union' and "commerce"."store_tax_profile"."oss_number" ~ '^EU[0-9]{9}$')),
	CONSTRAINT "store_tax_profile_ioss_number" CHECK ("commerce"."store_tax_profile"."ioss_number" is null or "commerce"."store_tax_profile"."ioss_number" ~ '^IM[0-9]{10}$'),
	CONSTRAINT "store_tax_profile_ioss_intermediary" CHECK ("commerce"."store_tax_profile"."ioss_intermediary" is null or length("commerce"."store_tax_profile"."ioss_intermediary") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "commerce"."vat_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "vat_categories_code" CHECK ("commerce"."vat_categories"."code" ~ '^[a-z][a-z0-9_]{1,30}$'),
	CONSTRAINT "vat_categories_name" CHECK (length("commerce"."vat_categories"."name_en") between 1 and 60),
	CONSTRAINT "vat_categories_description" CHECK (length("commerce"."vat_categories"."description") <= 200),
	CONSTRAINT "vat_categories_built_in" CHECK (not "commerce"."vat_categories"."built_in" or "commerce"."vat_categories"."code" in ('standard', 'exempt', 'accommodation'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."vat_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"cart_id" uuid,
	"number" text NOT NULL,
	"country_prefix" char(2) NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"name" text,
	"address" text,
	"request_identifier" text,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_checks_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "vat_checks_purpose" CHECK ("commerce"."vat_checks"."purpose" in ('buyer', 'seller')),
	CONSTRAINT "vat_checks_status" CHECK ("commerce"."vat_checks"."status" in ('valid', 'invalid', 'unavailable')),
	CONSTRAINT "vat_checks_source" CHECK ("commerce"."vat_checks"."source" in ('vies', 'brreg')),
	CONSTRAINT "vat_checks_number" CHECK ("commerce"."vat_checks"."number" ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$' and left("commerce"."vat_checks"."number", 2) = "commerce"."vat_checks"."country_prefix"),
	CONSTRAINT "vat_checks_error" CHECK ("commerce"."vat_checks"."error" is null or length("commerce"."vat_checks"."error") <= 80)
);
--> statement-breakpoint
-- The three categories every product already has, before the foreign keys that need them. The reduced-rate categories
-- and the rates are in the rules migration after this one.
INSERT INTO "commerce"."vat_categories" ("code", "name_en", "description", "sort", "active", "built_in") VALUES
	('standard', 'Standard rate', 'Most goods and services.', 0, true, true),
	('accommodation', 'Accommodation', 'Hotel rooms, holiday homes and camping: a reduced rate where the country has one.', 10, true, true),
	('exempt', 'Exempt from VAT', 'No VAT, such as health care. Check with your accountant that it applies to you.', 90, true, true);
--> statement-breakpoint
ALTER TABLE "commerce"."products" DROP CONSTRAINT "products_vat_category";
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" DROP CONSTRAINT "vat_rates_category";
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" DROP CONSTRAINT "vat_rates_country_code_category_pk";
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "valid_from" date DEFAULT '2026-01-01' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "valid_to" date;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "source" text DEFAULT 'Kaizen seed, September 2026 (not verified)' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "checked_on" date DEFAULT '2026-09-26' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "note" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "verified_by" uuid;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD COLUMN "created_by" uuid;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ALTER COLUMN "valid_from" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ALTER COLUMN "checked_on" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_country_code_category_valid_from_pk" PRIMARY KEY("country_code","category","valid_from");
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "vat_number" text;
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "vat_check_id" uuid;
--> statement-breakpoint
ALTER TABLE "commerce"."countries" ADD COLUMN "time_zone" text;
--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "vat_relief_minor" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "vat_kind" text DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "vat_relief_minor" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "shipping_tax_rate" numeric(6, 4);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "vat_treatment" jsonb;
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "vat_check_id" uuid;
--> statement-breakpoint
ALTER TABLE "commerce"."shipping_vat_rules" ADD CONSTRAINT "shipping_vat_rules_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."shipping_vat_rules" ADD CONSTRAINT "shipping_vat_rules_verified_by_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."store_tax_profile" ADD CONSTRAINT "store_tax_profile_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."store_tax_profile" ADD CONSTRAINT "store_tax_profile_oss_member_state_countries_code_fk" FOREIGN KEY ("oss_member_state") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."store_tax_profile" ADD CONSTRAINT "store_tax_profile_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."store_tax_profile" ADD CONSTRAINT "store_tax_profile_vat_check_fk" FOREIGN KEY ("store_id","vat_number_check_id") REFERENCES "commerce"."vat_checks"("store_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_categories" ADD CONSTRAINT "vat_categories_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_checks" ADD CONSTRAINT "vat_checks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipping_vat_rules_verified_by_idx" ON "commerce"."shipping_vat_rules" USING btree ("verified_by");
--> statement-breakpoint
CREATE INDEX "store_tax_profile_updated_by_idx" ON "commerce"."store_tax_profile" USING btree ("updated_by");
--> statement-breakpoint
CREATE INDEX "store_tax_profile_oss_member_state_idx" ON "commerce"."store_tax_profile" USING btree ("oss_member_state");
--> statement-breakpoint
CREATE INDEX "store_tax_profile_vat_check_idx" ON "commerce"."store_tax_profile" USING btree ("store_id","vat_number_check_id");
--> statement-breakpoint
CREATE INDEX "vat_categories_updated_by_idx" ON "commerce"."vat_categories" USING btree ("updated_by");
--> statement-breakpoint
CREATE INDEX "vat_checks_number_idx" ON "commerce"."vat_checks" USING btree ("store_id","number","requested_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "vat_checks_cart_idx" ON "commerce"."vat_checks" USING btree ("store_id","cart_id","requested_at");
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_vat_check_fk" FOREIGN KEY ("store_id","vat_check_id") REFERENCES "commerce"."vat_checks"("store_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_vat_check_fk" FOREIGN KEY ("store_id","vat_check_id") REFERENCES "commerce"."vat_checks"("store_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_vat_category_fk" FOREIGN KEY ("vat_category") REFERENCES "commerce"."vat_categories"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_category_vat_categories_code_fk" FOREIGN KEY ("category") REFERENCES "commerce"."vat_categories"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_verified_by_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "carts_vat_check_idx" ON "commerce"."carts" USING btree ("store_id","vat_check_id");
--> statement-breakpoint
CREATE INDEX "orders_vat_check_idx" ON "commerce"."orders" USING btree ("store_id","vat_check_id");
--> statement-breakpoint
CREATE INDEX "products_vat_category_idx" ON "commerce"."products" USING btree ("vat_category");
--> statement-breakpoint
CREATE INDEX "vat_rates_category_idx" ON "commerce"."vat_rates" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "vat_rates_verified_by_idx" ON "commerce"."vat_rates" USING btree ("verified_by");
--> statement-breakpoint
CREATE INDEX "vat_rates_created_by_idx" ON "commerce"."vat_rates" USING btree ("created_by");
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_vat_number" CHECK ("commerce"."carts"."vat_number" is null or "commerce"."carts"."vat_number" ~ '^[A-Z]{2}[0-9A-Z+*.]{2,12}$');
--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_vat_relief" CHECK ("commerce"."order_lines"."vat_relief_minor" between 0 and "commerce"."order_lines"."discount_minor");
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_vat_kind" CHECK ("commerce"."orders"."vat_kind" in ('standard', 'reverse_charge', 'ioss'));
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_vat_relief" CHECK ("commerce"."orders"."vat_relief_minor" between 0 and "commerce"."orders"."discount_minor");
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_vat_kind_relief" CHECK (("commerce"."orders"."vat_kind" = 'reverse_charge' and "commerce"."orders"."tax_minor" = 0 and "commerce"."orders"."vat_relief_minor" > 0) or ("commerce"."orders"."vat_kind" <> 'reverse_charge' and "commerce"."orders"."vat_relief_minor" = 0));
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_shipping_tax_rate" CHECK ("commerce"."orders"."shipping_tax_rate" is null or ("commerce"."orders"."shipping_tax_rate" >= 0 and "commerce"."orders"."shipping_tax_rate" < 1));
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_period" CHECK ("commerce"."vat_rates"."valid_to" is null or "commerce"."vat_rates"."valid_to" > "commerce"."vat_rates"."valid_from");
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_source" CHECK (length("commerce"."vat_rates"."source") between 8 and 400);
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_not_exempt" CHECK ("commerce"."vat_rates"."category" <> 'exempt');
--> statement-breakpoint
ALTER TABLE "commerce"."vat_rates" ADD CONSTRAINT "vat_rates_verified" CHECK (("commerce"."vat_rates"."verified_at" is null) = ("commerce"."vat_rates"."verified_by" is null));
