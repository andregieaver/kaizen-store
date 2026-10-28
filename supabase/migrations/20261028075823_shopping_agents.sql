ALTER TABLE "commerce"."marketing_spend" DROP CONSTRAINT "marketing_spend_channel";--> statement-breakpoint
ALTER TABLE "commerce"."visits" DROP CONSTRAINT "visits_channel";--> statement-breakpoint
ALTER TABLE "commerce"."visits" DROP CONSTRAINT "visits_first_channel";--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "commerce"."feed_settings" ADD COLUMN "channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "shopping_agents" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD CONSTRAINT "carts_source" CHECK ("commerce"."carts"."source" is null or "commerce"."carts"."source" in ('agent'));--> statement-breakpoint
ALTER TABLE "commerce"."feed_settings" ADD CONSTRAINT "feed_settings_channels" CHECK ("commerce"."feed_settings"."channels" <@ array['openai']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."marketing_spend" ADD CONSTRAINT "marketing_spend_channel" CHECK ("commerce"."marketing_spend"."channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'ai_agent', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD CONSTRAINT "visits_channel" CHECK ("commerce"."visits"."channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'ai_agent', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."visits" ADD CONSTRAINT "visits_first_channel" CHECK ("commerce"."visits"."first_channel" is null or "commerce"."visits"."first_channel" in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email', 'affiliate', 'referral', 'ai_agent', 'other'));