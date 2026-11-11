CREATE TABLE "commerce"."platform_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"sale_fee_bps" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "platform_settings_single_row" CHECK ("commerce"."platform_settings"."id"),
	CONSTRAINT "platform_settings_sale_fee_range" CHECK ("commerce"."platform_settings"."sale_fee_bps" between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."platform_webhooks" (
	"provider" text NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"kind" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "platform_webhooks_provider_mode_kind_pk" PRIMARY KEY("provider","mode","kind"),
	CONSTRAINT "platform_webhooks_kind" CHECK ("commerce"."platform_webhooks"."kind" in ('snapshot', 'thin'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."stripe_accounts" (
	"store_id" uuid NOT NULL,
	"mode" "commerce"."payment_mode" NOT NULL,
	"account_id" text NOT NULL,
	"card_payments" text DEFAULT 'inactive' NOT NULL,
	"requirements_due" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stripe_accounts_store_id_mode_pk" PRIMARY KEY("store_id","mode"),
	CONSTRAINT "stripe_accounts_account_key" UNIQUE("mode","account_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."payment_providers" ADD COLUMN "order_invoices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "provider_account" text;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_webhooks" ADD CONSTRAINT "platform_webhooks_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stripe_accounts" ADD CONSTRAINT "stripe_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stripe_accounts" ADD CONSTRAINT "stripe_accounts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_updated_by_idx" ON "commerce"."platform_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "platform_webhooks_updated_by_idx" ON "commerce"."platform_webhooks" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "stripe_accounts_created_by_idx" ON "commerce"."stripe_accounts" USING btree ("created_by");