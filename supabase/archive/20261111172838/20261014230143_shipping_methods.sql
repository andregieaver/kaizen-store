CREATE TABLE "commerce"."local_delivery_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"location_id" uuid,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"name" text NOT NULL,
	"names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kind" text NOT NULL,
	"patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"radius_km" numeric(5, 1),
	"amount_minor" bigint NOT NULL,
	"min_basket_minor" bigint,
	"free_over_minor" bigint,
	"info" text DEFAULT '' NOT NULL,
	"info_t" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_delivery_areas_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "local_delivery_areas_name" CHECK (char_length("commerce"."local_delivery_areas"."name") between 1 and 60 and "commerce"."local_delivery_areas"."name" = btrim("commerce"."local_delivery_areas"."name")),
	CONSTRAINT "local_delivery_areas_texts" CHECK (jsonb_typeof("commerce"."local_delivery_areas"."names") = 'object' and jsonb_typeof("commerce"."local_delivery_areas"."info_t") = 'object' and char_length("commerce"."local_delivery_areas"."info") <= 500),
	CONSTRAINT "local_delivery_areas_kind" CHECK (("commerce"."local_delivery_areas"."kind" = 'postal' and cardinality("commerce"."local_delivery_areas"."patterns") between 1 and 1000 and "commerce"."local_delivery_areas"."radius_km" is null)
        or ("commerce"."local_delivery_areas"."kind" = 'radius' and "commerce"."local_delivery_areas"."location_id" is not null and cardinality("commerce"."local_delivery_areas"."patterns") = 0 and "commerce"."local_delivery_areas"."radius_km" between 1 and 160)),
	CONSTRAINT "local_delivery_areas_amounts" CHECK ("commerce"."local_delivery_areas"."amount_minor" >= 0 and ("commerce"."local_delivery_areas"."min_basket_minor" is null or "commerce"."local_delivery_areas"."min_basket_minor" > 0) and ("commerce"."local_delivery_areas"."free_over_minor" is null or "commerce"."local_delivery_areas"."free_over_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "commerce"."pickup_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"ready_in_hours" integer DEFAULT 0 NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"instructions_t" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_options_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "pickup_options_location_key" UNIQUE("store_id","location_id"),
	CONSTRAINT "pickup_options_amount" CHECK ("commerce"."pickup_options"."amount_minor" >= 0),
	CONSTRAINT "pickup_options_ready" CHECK ("commerce"."pickup_options"."ready_in_hours" between 0 and 720),
	CONSTRAINT "pickup_options_instructions" CHECK (char_length("commerce"."pickup_options"."instructions") <= 1000 and jsonb_typeof("commerce"."pickup_options"."instructions_t") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."postal_points" (
	"country" char(2) NOT NULL,
	"postal_code" text NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" smallint,
	CONSTRAINT "postal_points_country_postal_code_pk" PRIMARY KEY("country","postal_code"),
	CONSTRAINT "postal_points_position" CHECK ("commerce"."postal_points"."latitude" between -90 and 90 and "commerce"."postal_points"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipping_method_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"zone_id" uuid,
	"profile_id" uuid,
	"basis" text NOT NULL,
	"min_value" bigint DEFAULT 0 NOT NULL,
	"max_value" bigint,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "shipping_method_rates_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "shipping_method_rates_basis" CHECK ("commerce"."shipping_method_rates"."basis" in ('flat', 'weight', 'value')),
	CONSTRAINT "shipping_method_rates_amount" CHECK ("commerce"."shipping_method_rates"."amount_minor" >= 0),
	CONSTRAINT "shipping_method_rates_range" CHECK ("commerce"."shipping_method_rates"."min_value" >= 0 and ("commerce"."shipping_method_rates"."max_value" is null or "commerce"."shipping_method_rates"."max_value" > "commerce"."shipping_method_rates"."min_value")),
	CONSTRAINT "shipping_method_rates_flat" CHECK ("commerce"."shipping_method_rates"."basis" <> 'flat' or ("commerce"."shipping_method_rates"."min_value" = 0 and "commerce"."shipping_method_rates"."max_value" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"name" text NOT NULL,
	"names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimate_min_days" integer,
	"estimate_max_days" integer,
	"free_over_minor" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "shipping_methods_name" CHECK (char_length("commerce"."shipping_methods"."name") between 1 and 60 and "commerce"."shipping_methods"."name" = btrim("commerce"."shipping_methods"."name")),
	CONSTRAINT "shipping_methods_names" CHECK (jsonb_typeof("commerce"."shipping_methods"."names") = 'object'),
	CONSTRAINT "shipping_methods_estimate" CHECK (("commerce"."shipping_methods"."estimate_min_days" is null) = ("commerce"."shipping_methods"."estimate_max_days" is null) and ("commerce"."shipping_methods"."estimate_min_days" is null or ("commerce"."shipping_methods"."estimate_min_days" between 0 and "commerce"."shipping_methods"."estimate_max_days" and "commerce"."shipping_methods"."estimate_max_days" <= 60))),
	CONSTRAINT "shipping_methods_free_over" CHECK ("commerce"."shipping_methods"."free_over_minor" is null or "commerce"."shipping_methods"."free_over_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipping_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_profiles_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "shipping_profiles_name" CHECK (char_length("commerce"."shipping_profiles"."name") between 1 and 60 and "commerce"."shipping_profiles"."name" = btrim("commerce"."shipping_profiles"."name"))
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipping_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"default_weight_grams" integer DEFAULT 500 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "shipping_settings_default_weight" CHECK ("commerce"."shipping_settings"."default_weight_grams" between 1 and 35000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"name" text NOT NULL,
	"patterns" text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "shipping_zones_name" CHECK (char_length("commerce"."shipping_zones"."name") between 1 and 60 and "commerce"."shipping_zones"."name" = btrim("commerce"."shipping_zones"."name")),
	CONSTRAINT "shipping_zones_patterns_count" CHECK (cardinality("commerce"."shipping_zones"."patterns") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" DROP CONSTRAINT "orders_anonymised";--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "shipping_method_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "pickup_option_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "local_area_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "delivery_postal_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "delivery_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "delivery_method" text DEFAULT 'ship' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "pickup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "ready_for_pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "delivery_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "delivery_mismatch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "shipping_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "method" text DEFAULT 'parcel' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_locations" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "commerce"."store_locations" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "commerce"."local_delivery_areas" ADD CONSTRAINT "local_delivery_areas_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."store_locations"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."local_delivery_areas" ADD CONSTRAINT "local_delivery_areas_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pickup_options" ADD CONSTRAINT "pickup_options_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."store_locations"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pickup_options" ADD CONSTRAINT "pickup_options_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_method_rates" ADD CONSTRAINT "shipping_method_rates_method_fk" FOREIGN KEY ("store_id","method_id") REFERENCES "commerce"."shipping_methods"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_method_rates" ADD CONSTRAINT "shipping_method_rates_zone_fk" FOREIGN KEY ("store_id","zone_id") REFERENCES "commerce"."shipping_zones"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_method_rates" ADD CONSTRAINT "shipping_method_rates_profile_fk" FOREIGN KEY ("store_id","profile_id") REFERENCES "commerce"."shipping_profiles"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_methods" ADD CONSTRAINT "shipping_methods_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_profiles" ADD CONSTRAINT "shipping_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_settings" ADD CONSTRAINT "shipping_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_settings" ADD CONSTRAINT "shipping_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_zones" ADD CONSTRAINT "shipping_zones_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_delivery_areas_market_idx" ON "commerce"."local_delivery_areas" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "local_delivery_areas_location_idx" ON "commerce"."local_delivery_areas" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "pickup_options_market_idx" ON "commerce"."pickup_options" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "shipping_method_rates_group_idx" ON "commerce"."shipping_method_rates" USING btree ("store_id","method_id","zone_id","profile_id");--> statement-breakpoint
CREATE INDEX "shipping_method_rates_zone_idx" ON "commerce"."shipping_method_rates" USING btree ("store_id","zone_id");--> statement-breakpoint
CREATE INDEX "shipping_method_rates_profile_idx" ON "commerce"."shipping_method_rates" USING btree ("store_id","profile_id");--> statement-breakpoint
CREATE INDEX "shipping_methods_market_idx" ON "commerce"."shipping_methods" USING btree ("store_id","market_code","currency","position");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_profiles_name_key" ON "commerce"."shipping_profiles" USING btree ("store_id",lower("name"));--> statement-breakpoint
CREATE INDEX "shipping_settings_updated_by_idx" ON "commerce"."shipping_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "shipping_zones_market_idx" ON "commerce"."shipping_zones" USING btree ("store_id","market_code","position");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_shipping_method_id_shipping_methods_id_fk" FOREIGN KEY ("shipping_method_id") REFERENCES "commerce"."shipping_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_pickup_option_id_pickup_options_id_fk" FOREIGN KEY ("pickup_option_id") REFERENCES "commerce"."pickup_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_local_area_id_local_delivery_areas_id_fk" FOREIGN KEY ("local_area_id") REFERENCES "commerce"."local_delivery_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_shipping_profile_fk" FOREIGN KEY ("store_id","shipping_profile_id") REFERENCES "commerce"."shipping_profiles"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_shipping_method_idx" ON "commerce"."carts" USING btree ("shipping_method_id");--> statement-breakpoint
CREATE INDEX "carts_pickup_option_idx" ON "commerce"."carts" USING btree ("pickup_option_id");--> statement-breakpoint
CREATE INDEX "carts_local_area_idx" ON "commerce"."carts" USING btree ("local_area_id");--> statement-breakpoint
CREATE INDEX "orders_delivery_method_idx" ON "commerce"."orders" USING btree ("store_id","delivery_method","status") WHERE "commerce"."orders"."delivery_method" <> 'ship';--> statement-breakpoint
CREATE INDEX "orders_pickup_location_idx" ON "commerce"."orders" USING btree ("store_id","pickup_location_id") WHERE "commerce"."orders"."pickup_location_id" is not null;--> statement-breakpoint
CREATE INDEX "products_shipping_profile_idx" ON "commerce"."products" USING btree ("store_id","shipping_profile_id");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_one_delivery" CHECK (num_nonnulls("commerce"."carts"."delivery_quote_id", "commerce"."carts"."shipping_method_id", "commerce"."carts"."pickup_option_id", "commerce"."carts"."local_area_id") <= 1);--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_delivery_postal_code" CHECK ("commerce"."carts"."delivery_postal_code" is null or "commerce"."carts"."delivery_postal_code" ~ '^[A-Z0-9-]{3,12}$');--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_delivery_note" CHECK ("commerce"."carts"."delivery_note" is null or ("commerce"."carts"."local_area_id" is not null and char_length("commerce"."carts"."delivery_note") between 1 and 500));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_delivery_method" CHECK ("commerce"."orders"."delivery_method" in ('ship', 'pickup', 'local'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_pickup_location" CHECK (("commerce"."orders"."delivery_method" = 'pickup') = ("commerce"."orders"."pickup_location_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_ready_for_pickup" CHECK ("commerce"."orders"."ready_for_pickup_at" is null or "commerce"."orders"."delivery_method" = 'pickup');--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_delivery_note" CHECK ("commerce"."orders"."delivery_note" is null or ("commerce"."orders"."delivery_method" = 'local' and char_length("commerce"."orders"."delivery_note") between 1 and 500));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_anonymised" CHECK ("commerce"."orders"."anonymised_at" is null or ("commerce"."orders"."email" = '[removed]' and "commerce"."orders"."billing_address" = '{}'::jsonb and "commerce"."orders"."shipping_address" = '{}'::jsonb and "commerce"."orders"."company_name" is null and "commerce"."orders"."organisation_number" is null and not "commerce"."orders"."is_gift" and "commerce"."orders"."gift_to" is null and "commerce"."orders"."gift_from" is null and "commerce"."orders"."gift_message" is null and "commerce"."orders"."delivery_note" is null));--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_method" CHECK ("commerce"."shipments"."method" in ('parcel', 'pickup', 'local'));--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_handover_bare" CHECK ("commerce"."shipments"."method" = 'parcel' or ("commerce"."shipments"."carrier" = '' and "commerce"."shipments"."tracking_number" = '' and "commerce"."shipments"."tracking_url" is null and "commerce"."shipments"."carrier_id" is null and "commerce"."shipments"."consignment_number" is null and "commerce"."shipments"."label_url" is null));--> statement-breakpoint
ALTER TABLE "commerce"."store_locations" ADD CONSTRAINT "store_locations_position" CHECK (("commerce"."store_locations"."latitude" is null) = ("commerce"."store_locations"."longitude" is null) and ("commerce"."store_locations"."latitude" is null or ("commerce"."store_locations"."latitude" between -90 and 90 and "commerce"."store_locations"."longitude" between -180 and 180)));