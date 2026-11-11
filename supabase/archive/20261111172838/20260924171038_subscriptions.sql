CREATE TYPE "commerce"."plan_interval" AS ENUM('week', 'month', 'year');--> statement-breakpoint
CREATE TYPE "commerce"."subscription_status" AS ENUM('pending', 'active', 'past_due', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "commerce"."selling_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"interval" "commerce"."plan_interval" NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selling_plans_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "selling_plans_interval_count" CHECK (("commerce"."selling_plans"."interval" = 'week' and "commerce"."selling_plans"."interval_count" between 1 and 52)
        or ("commerce"."selling_plans"."interval" = 'month' and "commerce"."selling_plans"."interval_count" between 1 and 12)
        or ("commerce"."selling_plans"."interval" = 'year' and "commerce"."selling_plans"."interval_count" between 1 and 3)),
	CONSTRAINT "selling_plans_discount_percent" CHECK ("commerce"."selling_plans"."discount_percent" between 0 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."subscription_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"variant_id" uuid,
	"selling_plan_id" uuid,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_rate" numeric(6, 4) NOT NULL,
	"tax_code" text NOT NULL,
	"delivery" "commerce"."delivery" DEFAULT 'physical' NOT NULL,
	CONSTRAINT "subscription_lines_quantity_positive" CHECK ("commerce"."subscription_lines"."quantity" > 0),
	CONSTRAINT "subscription_lines_total_adds_up" CHECK ("commerce"."subscription_lines"."total_minor" = "commerce"."subscription_lines"."unit_price_minor" * "commerce"."subscription_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "commerce"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "commerce"."subscription_status" DEFAULT 'pending' NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"locale" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval" "commerce"."plan_interval" NOT NULL,
	"interval_count" integer NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"first_order_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_reference" text,
	"provider_account" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"manage_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_manage_token_unique" UNIQUE("manage_token"),
	CONSTRAINT "subscriptions_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "subscriptions_store_reference_key" UNIQUE("store_id","provider","provider_reference"),
	CONSTRAINT "subscriptions_interval_count_positive" CHECK ("commerce"."subscriptions"."interval_count" > 0),
	CONSTRAINT "subscriptions_total_adds_up" CHECK ("commerce"."subscriptions"."total_minor" = "commerce"."subscriptions"."subtotal_minor" + "commerce"."subscriptions"."shipping_minor"),
	CONSTRAINT "subscriptions_amounts_non_negative" CHECK ("commerce"."subscriptions"."subtotal_minor" >= 0 and "commerce"."subscriptions"."shipping_minor" >= 0 and "commerce"."subscriptions"."tax_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" DROP CONSTRAINT "cart_lines_cart_variant_key";--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "selling_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "selling_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "plan_interval" "commerce"."plan_interval";--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "plan_interval_count" integer;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "subscription_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."selling_plans" ADD CONSTRAINT "selling_plans_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription_lines" ADD CONSTRAINT "subscription_lines_subscription_fk" FOREIGN KEY ("store_id","subscription_id") REFERENCES "commerce"."subscriptions"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription_lines" ADD CONSTRAINT "subscription_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription_lines" ADD CONSTRAINT "subscription_lines_selling_plan_fk" FOREIGN KEY ("store_id","selling_plan_id") REFERENCES "commerce"."selling_plans"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD CONSTRAINT "subscriptions_first_order_fk" FOREIGN KEY ("store_id","first_order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "selling_plans_product_idx" ON "commerce"."selling_plans" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE INDEX "subscription_lines_subscription_idx" ON "commerce"."subscription_lines" USING btree ("store_id","subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_lines_variant_idx" ON "commerce"."subscription_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "subscription_lines_selling_plan_idx" ON "commerce"."subscription_lines" USING btree ("store_id","selling_plan_id");--> statement-breakpoint
CREATE INDEX "subscriptions_first_order_idx" ON "commerce"."subscriptions" USING btree ("store_id","first_order_id");--> statement-breakpoint
CREATE INDEX "subscriptions_store_status_idx" ON "commerce"."subscriptions" USING btree ("store_id","status");--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_selling_plan_fk" FOREIGN KEY ("store_id","selling_plan_id") REFERENCES "commerce"."selling_plans"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_selling_plan_fk" FOREIGN KEY ("store_id","selling_plan_id") REFERENCES "commerce"."selling_plans"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_lines_selling_plan_idx" ON "commerce"."cart_lines" USING btree ("store_id","selling_plan_id");--> statement-breakpoint
CREATE INDEX "order_lines_selling_plan_idx" ON "commerce"."order_lines" USING btree ("store_id","selling_plan_id");--> statement-breakpoint
CREATE INDEX "orders_subscription_idx" ON "commerce"."orders" USING btree ("store_id","subscription_id");--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_variant_plan_key" UNIQUE NULLS NOT DISTINCT("cart_id","variant_id","selling_plan_id");