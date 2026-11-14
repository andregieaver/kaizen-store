ALTER TABLE "commerce"."assistant_conversations" DROP CONSTRAINT "assistant_conversations_source";--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD COLUMN "paused_for" text;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD COLUMN "challenge" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_source" CHECK ("commerce"."assistant_conversations"."source" in ('admin', 'kaizen-life', 'mcp', 'autopilot'));--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_paused_for" CHECK ("commerce"."assistant_plans"."paused_for" is null or "commerce"."assistant_plans"."paused_for" = 'budget');--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD CONSTRAINT "autopilot_settings_challenge" CHECK ("commerce"."autopilot_settings"."challenge" is null or jsonb_typeof("commerce"."autopilot_settings"."challenge") = 'object');