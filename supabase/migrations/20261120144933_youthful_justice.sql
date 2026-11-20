CREATE TABLE "commerce"."platform_price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"size_id" uuid,
	"bundle_id" uuid,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"from_minor" bigint NOT NULL,
	"to_minor" bigint NOT NULL,
	"anchor_minor" bigint NOT NULL,
	"reasons" text NOT NULL,
	"decided" text NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_price_changes_one_target" CHECK (num_nonnulls("commerce"."platform_price_changes"."plan_id", "commerce"."platform_price_changes"."size_id", "commerce"."platform_price_changes"."bundle_id") = 1),
	CONSTRAINT "platform_price_changes_interval" CHECK ("commerce"."platform_price_changes"."interval" in ('month', 'year')),
	CONSTRAINT "platform_price_changes_decided" CHECK ("commerce"."platform_price_changes"."decided" in ('auto', 'approved')),
	CONSTRAINT "platform_price_changes_amounts" CHECK ("commerce"."platform_price_changes"."from_minor" >= 0 and "commerce"."platform_price_changes"."to_minor" >= 0 and "commerce"."platform_price_changes"."anchor_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_price_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "price_tuning" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "price_tuning_range_percent" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_price_changes" ADD CONSTRAINT "platform_price_changes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_price_changes" ADD CONSTRAINT "platform_price_changes_size_id_extension_sizes_id_fk" FOREIGN KEY ("size_id") REFERENCES "commerce"."extension_sizes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_price_changes" ADD CONSTRAINT "platform_price_changes_bundle_id_extension_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "commerce"."extension_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_price_changes" ADD CONSTRAINT "platform_price_changes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_price_changes_plan_idx" ON "commerce"."platform_price_changes" USING btree ("plan_id","currency","interval","created_at");--> statement-breakpoint
CREATE INDEX "platform_price_changes_size_idx" ON "commerce"."platform_price_changes" USING btree ("size_id","currency","interval","created_at");--> statement-breakpoint
CREATE INDEX "platform_price_changes_bundle_idx" ON "commerce"."platform_price_changes" USING btree ("bundle_id","currency","interval","created_at");--> statement-breakpoint
CREATE INDEX "platform_price_changes_account_idx" ON "commerce"."platform_price_changes" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_price_tuning" CHECK ("commerce"."platform_settings"."price_tuning" in ('off', 'propose', 'auto'));--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_price_tuning_range" CHECK ("commerce"."platform_settings"."price_tuning_range_percent" between 1 and 50);