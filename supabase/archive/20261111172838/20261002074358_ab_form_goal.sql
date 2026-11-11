ALTER TABLE "commerce"."experiment_events" DROP CONSTRAINT "experiment_events_goal";--> statement-breakpoint
ALTER TABLE "commerce"."experiments" DROP CONSTRAINT "experiments_goal";--> statement-breakpoint
ALTER TABLE "commerce"."experiment_events" ADD CONSTRAINT "experiment_events_goal" CHECK ("commerce"."experiment_events"."goal" in ('cart', 'checkout', 'click', 'form'));--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_goal" CHECK ("commerce"."experiments"."primary_goal" in ('orders', 'revenue', 'cart', 'checkout', 'click', 'form'));