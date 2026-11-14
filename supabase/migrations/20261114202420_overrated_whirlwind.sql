ALTER TABLE "commerce"."assistant_conversations" DROP CONSTRAINT "assistant_conversations_source";--> statement-breakpoint
ALTER TABLE "commerce"."ad_accounts" ADD COLUMN "spend_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."ai_providers" ADD COLUMN "fallback_models" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD COLUMN "paused_for" text;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD COLUMN "challenge" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD COLUMN "escalation" text;--> statement-breakpoint
ALTER TABLE "commerce"."support_settings" ADD COLUMN "email_orders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_conversations" ADD CONSTRAINT "assistant_conversations_source" CHECK ("commerce"."assistant_conversations"."source" in ('admin', 'kaizen-life', 'mcp', 'autopilot'));--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_paused_for" CHECK ("commerce"."assistant_plans"."paused_for" is null or "commerce"."assistant_plans"."paused_for" = 'budget');--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD CONSTRAINT "autopilot_settings_challenge" CHECK ("commerce"."autopilot_settings"."challenge" is null or jsonb_typeof("commerce"."autopilot_settings"."challenge") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."support_conversations" ADD CONSTRAINT "support_conversations_escalation" CHECK ("commerce"."support_conversations"."escalation" is null or "commerce"."support_conversations"."escalation" in ('asked_for_person', 'upset', 'legal', 'safety', 'chargeback', 'privacy', 'abuse', 'could_not_help'));