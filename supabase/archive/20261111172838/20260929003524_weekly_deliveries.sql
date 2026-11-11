CREATE TABLE "commerce"."delivery_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"name" text NOT NULL,
	"delivery_weekday" integer NOT NULL,
	"cutoff_days" integer DEFAULT 2 NOT NULL,
	"cutoff_time" text DEFAULT '23:59' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_schedules_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "delivery_schedules_name" CHECK (length(trim("commerce"."delivery_schedules"."name")) between 1 and 80),
	CONSTRAINT "delivery_schedules_weekday" CHECK ("commerce"."delivery_schedules"."delivery_weekday" between 1 and 7),
	CONSTRAINT "delivery_schedules_cutoff_days" CHECK ("commerce"."delivery_schedules"."cutoff_days" between 1 and 7),
	CONSTRAINT "delivery_schedules_cutoff_time" CHECK ("commerce"."delivery_schedules"."cutoff_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."standing_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"standing_order_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"outcome" text NOT NULL,
	"order_id" uuid,
	"left_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_deliveries_list_day_key" UNIQUE("standing_order_id","delivery_date"),
	CONSTRAINT "standing_deliveries_outcome" CHECK ("commerce"."standing_deliveries"."outcome" in ('ordered', 'skipped', 'paused', 'empty', 'unavailable')),
	CONSTRAINT "standing_deliveries_order" CHECK (("commerce"."standing_deliveries"."outcome" = 'ordered') = ("commerce"."standing_deliveries"."order_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."standing_order_lines" (
	"store_id" uuid NOT NULL,
	"standing_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_order_lines_standing_order_id_variant_id_pk" PRIMARY KEY("standing_order_id","variant_id"),
	CONSTRAINT "standing_order_lines_quantity" CHECK ("commerce"."standing_order_lines"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "commerce"."standing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_account" text,
	"mode" text,
	"stripe_customer" text,
	"payment_method" text,
	"card_label" text DEFAULT '' NOT NULL,
	"setup_session" text,
	"consent_at" timestamp with time zone,
	"skip_dates" date[] DEFAULT '{}'::date[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "standing_orders_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "standing_orders_status" CHECK ("commerce"."standing_orders"."status" in ('setup', 'active', 'paused', 'cancelled')),
	CONSTRAINT "standing_orders_mode" CHECK ("commerce"."standing_orders"."mode" is null or "commerce"."standing_orders"."mode" in ('test', 'live')),
	CONSTRAINT "standing_orders_card" CHECK ("commerce"."standing_orders"."status" in ('setup', 'cancelled') or "commerce"."standing_orders"."payment_method" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_modules";--> statement-breakpoint
ALTER TABLE "commerce"."delivery_schedules" ADD CONSTRAINT "delivery_schedules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."delivery_schedules" ADD CONSTRAINT "delivery_schedules_market_fk" FOREIGN KEY ("store_id","market_code","currency") REFERENCES "commerce"."markets"("store_id","code","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_deliveries" ADD CONSTRAINT "standing_deliveries_list_fk" FOREIGN KEY ("store_id","standing_order_id") REFERENCES "commerce"."standing_orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_deliveries" ADD CONSTRAINT "standing_deliveries_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_order_lines" ADD CONSTRAINT "standing_order_lines_list_fk" FOREIGN KEY ("store_id","standing_order_id") REFERENCES "commerce"."standing_orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_order_lines" ADD CONSTRAINT "standing_order_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_orders" ADD CONSTRAINT "standing_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_orders" ADD CONSTRAINT "standing_orders_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."standing_orders" ADD CONSTRAINT "standing_orders_schedule_fk" FOREIGN KEY ("store_id","schedule_id") REFERENCES "commerce"."delivery_schedules"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_schedules_market_idx" ON "commerce"."delivery_schedules" USING btree ("store_id","market_code","currency");--> statement-breakpoint
CREATE INDEX "standing_deliveries_store_list_idx" ON "commerce"."standing_deliveries" USING btree ("store_id","standing_order_id","delivery_date");--> statement-breakpoint
CREATE UNIQUE INDEX "standing_deliveries_order_idx" ON "commerce"."standing_deliveries" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "standing_order_lines_store_list_idx" ON "commerce"."standing_order_lines" USING btree ("store_id","standing_order_id");--> statement-breakpoint
CREATE INDEX "standing_order_lines_variant_idx" ON "commerce"."standing_order_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "standing_orders_one_open" ON "commerce"."standing_orders" USING btree ("store_id","customer_id") WHERE "commerce"."standing_orders"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "standing_orders_customer_idx" ON "commerce"."standing_orders" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "standing_orders_schedule_idx" ON "commerce"."standing_orders" USING btree ("store_id","schedule_id","status");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_modules" CHECK ("commerce"."stores"."modules" <@ array['bookings', 'deliveries']::text[]);