CREATE TABLE "commerce"."analytics_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"payment_fee_bps" integer DEFAULT 0 NOT NULL,
	"payment_fee_fixed_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_cost_minor" bigint DEFAULT 0 NOT NULL,
	"fixed_costs_monthly_minor" bigint DEFAULT 0 NOT NULL,
	"ltv_lifespan_years" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_settings_fee_bps" CHECK ("commerce"."analytics_settings"."payment_fee_bps" between 0 and 10000),
	CONSTRAINT "analytics_settings_amounts" CHECK ("commerce"."analytics_settings"."payment_fee_fixed_minor" >= 0 and "commerce"."analytics_settings"."shipping_cost_minor" >= 0 and "commerce"."analytics_settings"."fixed_costs_monthly_minor" >= 0),
	CONSTRAINT "analytics_settings_lifespan" CHECK ("commerce"."analytics_settings"."ltv_lifespan_years" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "commerce"."analytics_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"month" date NOT NULL,
	"revenue_target_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_targets_month_key" UNIQUE("store_id","month"),
	CONSTRAINT "analytics_targets_first_of_month" CHECK ("commerce"."analytics_targets"."month" = date_trunc('month', "commerce"."analytics_targets"."month"::timestamp)::date),
	CONSTRAINT "analytics_targets_amount" CHECK ("commerce"."analytics_targets"."revenue_target_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."marketing_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_spend_key" UNIQUE("store_id","day","channel","campaign"),
	CONSTRAINT "marketing_spend_channel" CHECK ("commerce"."marketing_spend"."channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'other')),
	CONSTRAINT "marketing_spend_campaign" CHECK (length("commerce"."marketing_spend"."campaign") <= 100),
	CONSTRAINT "marketing_spend_amount" CHECK ("commerce"."marketing_spend"."amount_minor" > 0),
	CONSTRAINT "marketing_spend_note" CHECK (length("commerce"."marketing_spend"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_views" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"product_id" uuid NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_views_store_id_day_product_id_pk" PRIMARY KEY("store_id","day","product_id"),
	CONSTRAINT "product_views_views" CHECK ("commerce"."product_views"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"market_code" char(2),
	"device" text NOT NULL,
	"channel" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"landing_path" text NOT NULL,
	"page_views" integer DEFAULT 1 NOT NULL,
	"product_views" integer DEFAULT 0 NOT NULL,
	"checkout_at" timestamp with time zone,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_day_visitor_key" UNIQUE("store_id","day","visitor"),
	CONSTRAINT "visits_visitor" CHECK ("commerce"."visits"."visitor" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "visits_device" CHECK ("commerce"."visits"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "visits_channel" CHECK ("commerce"."visits"."channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'other')),
	CONSTRAINT "visits_text_lengths" CHECK (length("commerce"."visits"."source") <= 100 and length("commerce"."visits"."campaign") <= 100 and length("commerce"."visits"."landing_path") <= 300),
	CONSTRAINT "visits_counts" CHECK ("commerce"."visits"."page_views" >= 0 and "commerce"."visits"."product_views" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "unit_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "visit_counting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_settings" ADD CONSTRAINT "analytics_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_spend" ADD CONSTRAINT "marketing_spend_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_views" ADD CONSTRAINT "product_views_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_views" ADD CONSTRAINT "product_views_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD CONSTRAINT "visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_store_day_idx" ON "commerce"."visits" USING btree ("store_id","day");--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "commerce"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_visit_idx" ON "commerce"."carts" USING btree ("visit_id");--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_unit_cost" CHECK ("commerce"."order_lines"."unit_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."product_variants" ADD CONSTRAINT "product_variants_cost_minor" CHECK ("commerce"."product_variants"."cost_minor" >= 0);