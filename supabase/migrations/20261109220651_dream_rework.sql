ALTER TABLE "commerce"."dream_runs" DROP CONSTRAINT "dream_runs_status";--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD COLUMN "kind" text DEFAULT 'build' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD CONSTRAINT "dream_runs_kind" CHECK ("commerce"."dream_runs"."kind" in ('build', 'rework'));--> statement-breakpoint
ALTER TABLE "commerce"."dream_runs" ADD CONSTRAINT "dream_runs_status" CHECK ("commerce"."dream_runs"."status" in ('running', 'asking', 'ready', 'open', 'applied', 'failed', 'stopped'));