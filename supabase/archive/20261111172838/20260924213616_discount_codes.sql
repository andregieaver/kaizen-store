CREATE TABLE "commerce"."discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"min_subtotals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"product_ids" jsonb,
	"recurring" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"once_per_customer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "discount_codes_store_code_key" UNIQUE("store_id","code"),
	CONSTRAINT "discount_codes_kind" CHECK ("commerce"."discount_codes"."kind" in ('percent', 'fixed', 'free_shipping')),
	CONSTRAINT "discount_codes_percent" CHECK (("commerce"."discount_codes"."kind" = 'percent' and "commerce"."discount_codes"."percent" between 1 and 100) or ("commerce"."discount_codes"."kind" <> 'percent' and "commerce"."discount_codes"."percent" = 0)),
	CONSTRAINT "discount_codes_recurring" CHECK (not "commerce"."discount_codes"."recurring" or "commerce"."discount_codes"."kind" = 'percent'),
	CONSTRAINT "discount_codes_usage_limit" CHECK ("commerce"."discount_codes"."usage_limit" is null or "commerce"."discount_codes"."usage_limit" > 0),
	CONSTRAINT "discount_codes_dates" CHECK ("commerce"."discount_codes"."starts_at" is null or "commerce"."discount_codes"."ends_at" is null or "commerce"."discount_codes"."starts_at" < "commerce"."discount_codes"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "commerce"."platform_discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"amounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration" text NOT NULL,
	"duration_months" integer,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "platform_discount_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "platform_discount_codes_kind" CHECK ("commerce"."platform_discount_codes"."kind" in ('percent', 'fixed')),
	CONSTRAINT "platform_discount_codes_percent" CHECK (("commerce"."platform_discount_codes"."kind" = 'percent' and "commerce"."platform_discount_codes"."percent" between 1 and 100) or ("commerce"."platform_discount_codes"."kind" = 'fixed' and "commerce"."platform_discount_codes"."percent" = 0)),
	CONSTRAINT "platform_discount_codes_duration" CHECK ("commerce"."platform_discount_codes"."duration" in ('once', 'repeating', 'forever')),
	CONSTRAINT "platform_discount_codes_months" CHECK (("commerce"."platform_discount_codes"."duration" = 'repeating') = ("commerce"."platform_discount_codes"."duration_months" is not null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."stripe_sync" DROP CONSTRAINT "stripe_sync_kind";--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "discount_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "discount_code" text;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD COLUMN "platform_discount_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD COLUMN "discount_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_discount_codes" ADD CONSTRAINT "platform_discount_codes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_discount_codes_created_by_idx" ON "commerce"."platform_discount_codes" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_discount_code_fk" FOREIGN KEY ("store_id","discount_code_id") REFERENCES "commerce"."discount_codes"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_platform_discount_id_platform_discount_codes_id_fk" FOREIGN KEY ("platform_discount_id") REFERENCES "commerce"."platform_discount_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_discount_code_idx" ON "commerce"."orders" USING btree ("store_id","discount_code_id");--> statement-breakpoint
CREATE INDEX "store_billing_platform_discount_idx" ON "commerce"."store_billing" USING btree ("platform_discount_id");--> statement-breakpoint
ALTER TABLE "commerce"."stripe_sync" ADD CONSTRAINT "stripe_sync_kind" CHECK ("commerce"."stripe_sync"."kind" in ('product', 'price', 'tax_rate', 'portal', 'coupon', 'promotion_code'));