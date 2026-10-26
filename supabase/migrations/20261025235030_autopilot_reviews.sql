CREATE TABLE "commerce"."autopilot_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"goal_id" uuid NOT NULL,
	"account_id" uuid,
	"conversation_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"claimed_until" timestamp with time zone,
	"plan_id" uuid,
	"started" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "autopilot_reviews_status" CHECK ("commerce"."autopilot_reviews"."status" in ('running', 'done', 'skipped', 'failed')),
	CONSTRAINT "autopilot_reviews_outcome" CHECK ("commerce"."autopilot_reviews"."outcome" is null or length("commerce"."autopilot_reviews"."outcome") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD COLUMN "planning" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reviews" ADD CONSTRAINT "autopilot_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reviews" ADD CONSTRAINT "autopilot_reviews_goal_id_assistant_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "commerce"."assistant_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reviews" ADD CONSTRAINT "autopilot_reviews_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reviews" ADD CONSTRAINT "autopilot_reviews_plan_id_assistant_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."assistant_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reviews" ADD CONSTRAINT "autopilot_reviews_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_reviews_running_idx" ON "commerce"."autopilot_reviews" USING btree ("goal_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "autopilot_reviews_goal_idx" ON "commerce"."autopilot_reviews" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_reviews_store_idx" ON "commerce"."autopilot_reviews" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_reviews_account_idx" ON "commerce"."autopilot_reviews" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "autopilot_reviews_conversation_idx" ON "commerce"."autopilot_reviews" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "autopilot_reviews_plan_idx" ON "commerce"."autopilot_reviews" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD CONSTRAINT "autopilot_settings_planning" CHECK (jsonb_typeof("commerce"."autopilot_settings"."planning") = 'object');