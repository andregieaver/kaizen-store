CREATE TABLE "commerce"."platform_marketing_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_marketing_spend_key" UNIQUE("day","channel","campaign","currency"),
	CONSTRAINT "platform_marketing_spend_channel" CHECK ("commerce"."platform_marketing_spend"."channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'ai_agent', 'other')),
	CONSTRAINT "platform_marketing_spend_campaign" CHECK (length("commerce"."platform_marketing_spend"."campaign") <= 100),
	CONSTRAINT "platform_marketing_spend_amount" CHECK ("commerce"."platform_marketing_spend"."amount_minor" > 0),
	CONSTRAINT "platform_marketing_spend_currency" CHECK ("commerce"."platform_marketing_spend"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "platform_marketing_spend_note" CHECK (length("commerce"."platform_marketing_spend"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "first_channel" text;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "first_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "first_campaign" text;--> statement-breakpoint
ALTER TABLE "commerce"."platform_marketing_spend" ADD CONSTRAINT "platform_marketing_spend_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_marketing_spend_created_by_idx" ON "commerce"."platform_marketing_spend" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_first_channel" CHECK ("commerce"."access_requests"."first_channel" is null or "commerce"."access_requests"."first_channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'ai_agent', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_first_touch" CHECK (length(coalesce("commerce"."access_requests"."first_source", '')) <= 120 and length(coalesce("commerce"."access_requests"."first_campaign", '')) <= 120);