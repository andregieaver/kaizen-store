ALTER TABLE "commerce"."experiment_events" DROP CONSTRAINT "experiment_events_goal";--> statement-breakpoint
ALTER TABLE "commerce"."experiments" DROP CONSTRAINT "experiments_goal";--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "stop_guardrail" text;--> statement-breakpoint
ALTER TABLE "commerce"."speed_samples" ADD COLUMN "ab" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."experiment_events" ADD CONSTRAINT "experiment_events_goal" CHECK ("commerce"."experiment_events"."goal" in ('cart', 'checkout', 'click', 'form', 'signup'));--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_stop_guardrail" CHECK ("commerce"."experiments"."stop_guardrail" is null or ("commerce"."experiments"."stop_reason" = 'guardrail' and "commerce"."experiments"."stop_guardrail" in ('orders', 'speed', 'checkout')));--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_goal" CHECK ("commerce"."experiments"."primary_goal" in ('orders', 'revenue', 'cart', 'checkout', 'click', 'form', 'signup'));