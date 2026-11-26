ALTER TABLE "commerce"."autopilot_settings" ADD COLUMN "social" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "rules_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "held_at" timestamp with time zone;