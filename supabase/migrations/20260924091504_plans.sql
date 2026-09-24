CREATE TABLE "commerce"."plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_interval" CHECK ("commerce"."plan_prices"."interval" in ('month', 'year')),
	CONSTRAINT "plan_prices_amount" CHECK ("commerce"."plan_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sale_fee_bps" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plans_sale_fee_range" CHECK ("commerce"."plans"."sale_fee_bps" between 0 and 2000),
	CONSTRAINT "plans_name_present" CHECK (length(trim("commerce"."plans"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_billing" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid,
	"price_id" uuid,
	"mode" "commerce"."payment_mode",
	"subscription_id" text,
	"status" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"sale_fee_bps_override" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "store_billing_subscription_key" UNIQUE("mode","subscription_id"),
	CONSTRAINT "store_billing_fee_range" CHECK ("commerce"."store_billing"."sale_fee_bps_override" is null or "commerce"."store_billing"."sale_fee_bps_override" between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."stripe_sync" (
	"mode" "commerce"."payment_mode" NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"stripe_id" text,
	"archived" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_sync_mode_kind_local_id_pk" PRIMARY KEY("mode","kind","local_id"),
	CONSTRAINT "stripe_sync_kind" CHECK ("commerce"."stripe_sync"."kind" in ('product', 'price', 'tax_rate', 'portal'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_webhooks" DROP CONSTRAINT "platform_webhooks_kind";--> statement-breakpoint
ALTER TABLE "commerce"."plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plans" ADD CONSTRAINT "plans_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_price_id_plan_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "commerce"."plan_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_prices_one_active" ON "commerce"."plan_prices" USING btree ("plan_id","currency","interval") WHERE "commerce"."plan_prices"."active";--> statement-breakpoint
CREATE INDEX "plan_prices_plan_idx" ON "commerce"."plan_prices" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plans_updated_by_idx" ON "commerce"."plans" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "store_billing_plan_idx" ON "commerce"."store_billing" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "store_billing_price_idx" ON "commerce"."store_billing" USING btree ("price_id");--> statement-breakpoint
CREATE INDEX "store_billing_updated_by_idx" ON "commerce"."store_billing" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "stripe_sync_stripe_id_idx" ON "commerce"."stripe_sync" USING btree ("mode","stripe_id");--> statement-breakpoint
ALTER TABLE "commerce"."platform_webhooks" ADD CONSTRAINT "platform_webhooks_kind" CHECK ("commerce"."platform_webhooks"."kind" in ('snapshot', 'thin', 'billing'));