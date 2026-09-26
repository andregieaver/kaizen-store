ALTER TYPE "commerce"."delivery" ADD VALUE 'service';--> statement-breakpoint
ALTER TYPE "commerce"."withdrawal_exclusion" ADD VALUE 'dated_service';--> statement-breakpoint
CREATE TABLE "commerce"."appointment_settings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"step_minutes" integer DEFAULT 15 NOT NULL,
	"min_notice_minutes" integer DEFAULT 60 NOT NULL,
	"max_days_ahead" integer DEFAULT 60 NOT NULL,
	"location_id" uuid,
	CONSTRAINT "appointment_settings_duration" CHECK ("commerce"."appointment_settings"."duration_minutes" between 5 and 720),
	CONSTRAINT "appointment_settings_buffers" CHECK ("commerce"."appointment_settings"."buffer_before_minutes" between 0 and 240 and "commerce"."appointment_settings"."buffer_after_minutes" between 0 and 240),
	CONSTRAINT "appointment_settings_step" CHECK ("commerce"."appointment_settings"."step_minutes" in (5, 10, 15, 20, 30, 60)),
	CONSTRAINT "appointment_settings_notice" CHECK ("commerce"."appointment_settings"."min_notice_minutes" between 0 and 43200),
	CONSTRAINT "appointment_settings_ahead" CHECK ("commerce"."appointment_settings"."max_days_ahead" between 1 and 730)
);
--> statement-breakpoint
CREATE TABLE "commerce"."booking_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text DEFAULT 'staff' NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"hours" jsonb NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_resources_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "booking_resources_kind" CHECK ("commerce"."booking_resources"."kind" in ('staff')),
	CONSTRAINT "booking_resources_capacity" CHECK ("commerce"."booking_resources"."capacity" between 1 and 500),
	CONSTRAINT "booking_resources_name" CHECK (length("commerce"."booking_resources"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "commerce"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_from" timestamp with time zone NOT NULL,
	"blocked_to" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"order_id" uuid,
	"order_line_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "bookings_status" CHECK ("commerce"."bookings"."status" in ('held', 'confirmed', 'cancelled')),
	CONSTRAINT "bookings_times" CHECK ("commerce"."bookings"."starts_at" < "commerce"."bookings"."ends_at"),
	CONSTRAINT "bookings_blocked" CHECK ("commerce"."bookings"."blocked_from" <= "commerce"."bookings"."starts_at" and "commerce"."bookings"."blocked_to" >= "commerce"."bookings"."ends_at"),
	CONSTRAINT "bookings_held_expires" CHECK ("commerce"."bookings"."status" <> 'held' or "commerce"."bookings"."hold_expires_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_resources" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "product_resources_product_id_resource_id_pk" PRIMARY KEY("product_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" DROP CONSTRAINT "cart_lines_cart_variant_plan_key";--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "kind" text DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "modules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "time_zone" text DEFAULT 'Europe/Oslo' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_location_fk" FOREIGN KEY ("store_id","location_id") REFERENCES "commerce"."store_locations"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD CONSTRAINT "booking_resources_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD CONSTRAINT "bookings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD CONSTRAINT "bookings_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD CONSTRAINT "bookings_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD CONSTRAINT "bookings_resource_fk" FOREIGN KEY ("store_id","resource_id") REFERENCES "commerce"."booking_resources"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD CONSTRAINT "bookings_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_resources" ADD CONSTRAINT "product_resources_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_resources" ADD CONSTRAINT "product_resources_resource_fk" FOREIGN KEY ("store_id","resource_id") REFERENCES "commerce"."booking_resources"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_settings_location_idx" ON "commerce"."appointment_settings" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "booking_resources_store_idx" ON "commerce"."booking_resources" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "bookings_resource_time_idx" ON "commerce"."bookings" USING btree ("store_id","resource_id","blocked_from");--> statement-breakpoint
CREATE INDEX "bookings_product_idx" ON "commerce"."bookings" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "bookings_variant_idx" ON "commerce"."bookings" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "bookings_order_idx" ON "commerce"."bookings" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "bookings_store_starts_idx" ON "commerce"."bookings" USING btree ("store_id","starts_at");--> statement-breakpoint
CREATE INDEX "product_resources_resource_idx" ON "commerce"."product_resources" USING btree ("store_id","resource_id");--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_variant_plan_key" UNIQUE NULLS NOT DISTINCT("cart_id","variant_id","selling_plan_id","starts_at");--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_kind" CHECK ("commerce"."products"."kind" in ('goods', 'appointment'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_modules" CHECK ("commerce"."stores"."modules" <@ array['bookings']::text[]);