ALTER TABLE "commerce"."assistant_notices" DROP CONSTRAINT "assistant_notices_kind";--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD COLUMN "learning" text;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_kind" CHECK ("commerce"."assistant_notices"."kind" in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready', 'life_handoff', 'test_answered'));--> statement-breakpoint
ALTER TABLE "commerce"."experiments" ADD CONSTRAINT "experiments_learning" CHECK ("commerce"."experiments"."learning" is null or length("commerce"."experiments"."learning") between 1 and 280);