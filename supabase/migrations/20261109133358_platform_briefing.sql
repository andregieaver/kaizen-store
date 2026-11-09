CREATE TABLE "commerce"."platform_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric" text NOT NULL,
	"month" date NOT NULL,
	"currency" char(3),
	"target_value" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_targets_metric" CHECK ("commerce"."platform_targets"."metric" in ('mrr', 'sales', 'paying', 'new_stores')),
	CONSTRAINT "platform_targets_month" CHECK (extract(day from "commerce"."platform_targets"."month") = 1),
	CONSTRAINT "platform_targets_currency" CHECK (("commerce"."platform_targets"."metric" in ('mrr', 'sales')) = ("commerce"."platform_targets"."currency" is not null)),
	CONSTRAINT "platform_targets_value" CHECK ("commerce"."platform_targets"."target_value" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "briefing" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "briefing_last_period" text;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "briefing_offer_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_targets" ADD CONSTRAINT "platform_targets_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_targets_key" ON "commerce"."platform_targets" USING btree ("metric","month",coalesce("currency", ''));--> statement-breakpoint
CREATE INDEX "platform_targets_created_by_idx" ON "commerce"."platform_targets" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_briefing" CHECK ("commerce"."platform_settings"."briefing" in ('off', 'daily', 'weekly'));