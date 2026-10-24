CREATE TABLE "commerce"."ad_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"token" text NOT NULL,
	"token_hint" text NOT NULL,
	"data_level" text DEFAULT 'standard' NOT NULL,
	"test_code" text,
	"on" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_connections_store_platform" UNIQUE("store_id","platform"),
	CONSTRAINT "ad_connections_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "ad_connections_platform" CHECK ("commerce"."ad_connections"."platform" in ('meta', 'ga4', 'tiktok', 'pinterest')),
	CONSTRAINT "ad_connections_level" CHECK ("commerce"."ad_connections"."data_level" in ('standard', 'enhanced')),
	CONSTRAINT "ad_connections_account" CHECK (char_length("commerce"."ad_connections"."account_id") between 4 and 40),
	CONSTRAINT "ad_connections_test_code" CHECK ("commerce"."ad_connections"."test_code" is null or char_length("commerce"."ad_connections"."test_code") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "commerce"."ad_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"event" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_conversions_once" UNIQUE("store_id","order_id","platform","event"),
	CONSTRAINT "ad_conversions_platform" CHECK ("commerce"."ad_conversions"."platform" in ('meta', 'ga4', 'tiktok', 'pinterest')),
	CONSTRAINT "ad_conversions_event" CHECK ("commerce"."ad_conversions"."event" in ('begin_checkout', 'purchase')),
	CONSTRAINT "ad_conversions_status" CHECK ("commerce"."ad_conversions"."status" in ('pending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "ad_conversions_answer" CHECK ("commerce"."ad_conversions"."answer" is null or char_length("commerce"."ad_conversions"."answer") <= 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "ad_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "ad_signals" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "ad_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "ad_signals" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."ad_connections" ADD CONSTRAINT "ad_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ad_conversions" ADD CONSTRAINT "ad_conversions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ad_conversions" ADD CONSTRAINT "ad_conversions_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_conversions_due_idx" ON "commerce"."ad_conversions" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "ad_conversions_store_idx" ON "commerce"."ad_conversions" USING btree ("store_id","created_at");