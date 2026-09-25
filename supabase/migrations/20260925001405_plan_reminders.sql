CREATE TABLE "commerce"."abandoned_plan_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text,
	"price_id" uuid,
	"plan_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"interval" text NOT NULL,
	"token" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_delay_minutes" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abandoned_plan_checkouts_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "abandoned_plan_checkouts_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "commerce"."plan_reminder_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delay_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"platform_discount_id" uuid,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_reminder_steps_delay" CHECK ("commerce"."plan_reminder_steps"."delay_minutes" between 30 and 43200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."accounts" ADD COLUMN "plan_reminders_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "plan_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."abandoned_plan_checkouts" ADD CONSTRAINT "abandoned_plan_checkouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."abandoned_plan_checkouts" ADD CONSTRAINT "abandoned_plan_checkouts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."abandoned_plan_checkouts" ADD CONSTRAINT "abandoned_plan_checkouts_price_id_plan_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "commerce"."plan_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_reminder_steps" ADD CONSTRAINT "plan_reminder_steps_platform_discount_id_platform_discount_codes_id_fk" FOREIGN KEY ("platform_discount_id") REFERENCES "commerce"."platform_discount_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abandoned_plan_checkouts_due_idx" ON "commerce"."abandoned_plan_checkouts" USING btree ("captured_at") WHERE "commerce"."abandoned_plan_checkouts"."recovered_at" is null and "commerce"."abandoned_plan_checkouts"."opted_out_at" is null and "commerce"."abandoned_plan_checkouts"."email" is not null;--> statement-breakpoint
CREATE INDEX "abandoned_plan_checkouts_account_idx" ON "commerce"."abandoned_plan_checkouts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "abandoned_plan_checkouts_price_idx" ON "commerce"."abandoned_plan_checkouts" USING btree ("price_id");--> statement-breakpoint
CREATE INDEX "plan_reminder_steps_delay_idx" ON "commerce"."plan_reminder_steps" USING btree ("delay_minutes");