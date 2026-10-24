ALTER TABLE "commerce"."visits" ADD COLUMN "first_channel" text;--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD COLUMN "first_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD COLUMN "first_campaign" text;--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD COLUMN "first_day" date;--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD CONSTRAINT "visits_first_channel" CHECK ("commerce"."visits"."first_channel" is null or "commerce"."visits"."first_channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD CONSTRAINT "visits_first_lengths" CHECK (length("commerce"."visits"."first_source") <= 100 and length("commerce"."visits"."first_campaign") <= 100);