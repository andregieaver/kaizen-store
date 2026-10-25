CREATE TABLE "commerce"."assistant_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"title" text NOT NULL,
	"vision" text DEFAULT '' NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_goals_status" CHECK ("commerce"."assistant_goals"."status" in ('active', 'met', 'dropped')),
	CONSTRAINT "assistant_goals_title" CHECK (length("commerce"."assistant_goals"."title") between 1 and 120),
	CONSTRAINT "assistant_goals_vision" CHECK (length("commerce"."assistant_goals"."vision") <= 2000),
	CONSTRAINT "assistant_goals_targets" CHECK (jsonb_typeof("commerce"."assistant_goals"."targets") = 'array' and jsonb_array_length("commerce"."assistant_goals"."targets") <= 5)
);
--> statement-breakpoint
CREATE TABLE "commerce"."assistant_plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"store_id" uuid,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"after_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"done_check" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"question" jsonb,
	"answer" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"not_before" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_plan_steps_kind" CHECK ("commerce"."assistant_plan_steps"."kind" in ('tool', 'task', 'question', 'wait')),
	CONSTRAINT "assistant_plan_steps_status" CHECK ("commerce"."assistant_plan_steps"."status" in ('pending', 'running', 'waiting', 'asking', 'done', 'skipped', 'cancelled')),
	CONSTRAINT "assistant_plan_steps_key" CHECK ("commerce"."assistant_plan_steps"."key" ~ '^[a-z0-9_]{1,20}$'),
	CONSTRAINT "assistant_plan_steps_title" CHECK (length("commerce"."assistant_plan_steps"."title") between 1 and 120),
	CONSTRAINT "assistant_plan_steps_tries" CHECK ("commerce"."assistant_plan_steps"."tries" >= 0),
	CONSTRAINT "assistant_plan_steps_position" CHECK ("commerce"."assistant_plan_steps"."position" between 0 and 29),
	CONSTRAINT "assistant_plan_steps_answer" CHECK ("commerce"."assistant_plan_steps"."answer" is null or length("commerce"."assistant_plan_steps"."answer") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."assistant_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"goal_id" uuid,
	"account_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pause_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_plans_status" CHECK ("commerce"."assistant_plans"."status" in ('draft', 'running', 'paused', 'done', 'stopped')),
	CONSTRAINT "assistant_plans_title" CHECK (length("commerce"."assistant_plans"."title") between 1 and 120),
	CONSTRAINT "assistant_plans_summary" CHECK (length("commerce"."assistant_plans"."summary") <= 2000),
	CONSTRAINT "assistant_plans_version" CHECK ("commerce"."assistant_plans"."version" >= 1),
	CONSTRAINT "assistant_plans_pause_reason" CHECK ("commerce"."assistant_plans"."pause_reason" is null or length("commerce"."assistant_plans"."pause_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" DROP CONSTRAINT "assistant_approvals_category";--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD COLUMN "plan_step_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD COLUMN "acted_by" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_goals" ADD CONSTRAINT "assistant_goals_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_goals" ADD CONSTRAINT "assistant_goals_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plan_steps" ADD CONSTRAINT "assistant_plan_steps_plan_id_assistant_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."assistant_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plan_steps" ADD CONSTRAINT "assistant_plan_steps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plan_steps" ADD CONSTRAINT "assistant_plan_steps_answered_by_accounts_id_fk" FOREIGN KEY ("answered_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_goal_id_assistant_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "commerce"."assistant_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."assistant_plans" ADD CONSTRAINT "assistant_plans_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_goals_store_idx" ON "commerce"."assistant_goals" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "assistant_goals_created_by_idx" ON "commerce"."assistant_goals" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_plan_steps_key_idx" ON "commerce"."assistant_plan_steps" USING btree ("plan_id","key");--> statement-breakpoint
CREATE INDEX "assistant_plan_steps_store_idx" ON "commerce"."assistant_plan_steps" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "assistant_plan_steps_answered_by_idx" ON "commerce"."assistant_plan_steps" USING btree ("answered_by");--> statement-breakpoint
CREATE INDEX "assistant_plans_store_idx" ON "commerce"."assistant_plans" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "assistant_plans_account_idx" ON "commerce"."assistant_plans" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "assistant_plans_goal_idx" ON "commerce"."assistant_plans" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "assistant_plans_conversation_idx" ON "commerce"."assistant_plans" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_plan_step_fk" FOREIGN KEY ("plan_step_id") REFERENCES "commerce"."assistant_plan_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_approvals_plan_step_idx" ON "commerce"."assistant_approvals" USING btree ("plan_step_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_approvals" ADD CONSTRAINT "assistant_approvals_category" CHECK ("commerce"."assistant_approvals"."category" in ('send', 'public', 'spend', 'domain', 'access', 'plan'));--> statement-breakpoint
ALTER TABLE "commerce"."audit_log" ADD CONSTRAINT "audit_log_acted_by" CHECK ("commerce"."audit_log"."acted_by" in ('person', 'ai_manager', 'autopilot'));