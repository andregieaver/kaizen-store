CREATE TABLE "commerce"."organisation_billing" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid,
	"price_id" uuid,
	"mode" "commerce"."payment_mode",
	"subscription_id" text,
	"status" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"sale_fee_bps_override" integer,
	"platform_discount_id" uuid,
	"discount_applied_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"customer_account" text,
	"moved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "organisation_billing_subscription_key" UNIQUE("mode","subscription_id"),
	CONSTRAINT "organisation_billing_fee_range" CHECK ("commerce"."organisation_billing"."sale_fee_bps_override" is null or "commerce"."organisation_billing"."sale_fee_bps_override" between 0 and 2000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_price_id_plan_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "commerce"."plan_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_platform_discount_id_platform_discount_codes_id_fk" FOREIGN KEY ("platform_discount_id") REFERENCES "commerce"."platform_discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_billing_plan_idx" ON "commerce"."organisation_billing" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "organisation_billing_price_idx" ON "commerce"."organisation_billing" USING btree ("price_id");--> statement-breakpoint
CREATE INDEX "organisation_billing_platform_discount_idx" ON "commerce"."organisation_billing" USING btree ("platform_discount_id");--> statement-breakpoint
CREATE INDEX "organisation_billing_updated_by_idx" ON "commerce"."organisation_billing" USING btree ("updated_by");