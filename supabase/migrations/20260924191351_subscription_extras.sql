ALTER TABLE "commerce"."selling_plans" ADD COLUMN "trial_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."selling_plans" ADD COLUMN "signup_fee" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."selling_plans" ADD COLUMN "min_cycles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD COLUMN "min_cycles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD COLUMN "cancel_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."subscriptions" ADD COLUMN "reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."selling_plans" ADD CONSTRAINT "selling_plans_trial_days" CHECK ("commerce"."selling_plans"."trial_days" between 0 and 90);--> statement-breakpoint
ALTER TABLE "commerce"."selling_plans" ADD CONSTRAINT "selling_plans_min_cycles" CHECK ("commerce"."selling_plans"."min_cycles" between 0 and 24);