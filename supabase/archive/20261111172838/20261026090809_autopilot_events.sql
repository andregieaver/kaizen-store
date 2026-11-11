CREATE TABLE "commerce"."autopilot_event_checks" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"alerts_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."autopilot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_until" timestamp with time zone,
	"account_id" uuid,
	"conversation_id" uuid,
	"plan_id" uuid,
	"started" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "autopilot_events_ref_key" UNIQUE("store_id","kind","ref"),
	CONSTRAINT "autopilot_events_kind" CHECK ("commerce"."autopilot_events"."kind" in ('support_waiting', 'test_ended', 'alert')),
	CONSTRAINT "autopilot_events_status" CHECK ("commerce"."autopilot_events"."status" in ('pending', 'running', 'done', 'skipped', 'failed')),
	CONSTRAINT "autopilot_events_ref" CHECK (length("commerce"."autopilot_events"."ref") between 1 and 200),
	CONSTRAINT "autopilot_events_facts" CHECK (jsonb_typeof("commerce"."autopilot_events"."facts") = 'object'),
	CONSTRAINT "autopilot_events_outcome" CHECK ("commerce"."autopilot_events"."outcome" is null or length("commerce"."autopilot_events"."outcome") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_event_checks" ADD CONSTRAINT "autopilot_event_checks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_events" ADD CONSTRAINT "autopilot_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_events" ADD CONSTRAINT "autopilot_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_events" ADD CONSTRAINT "autopilot_events_plan_id_assistant_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."assistant_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_events" ADD CONSTRAINT "autopilot_events_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_events_pending_idx" ON "commerce"."autopilot_events" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "autopilot_events_store_idx" ON "commerce"."autopilot_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_events_account_idx" ON "commerce"."autopilot_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "autopilot_events_conversation_idx" ON "commerce"."autopilot_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "autopilot_events_plan_idx" ON "commerce"."autopilot_events" USING btree ("plan_id");