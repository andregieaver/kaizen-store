CREATE TABLE "commerce"."kaizen_life_handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid,
	"direction" text NOT NULL,
	"conversation_id" uuid,
	"task" text NOT NULL,
	"from_name" text,
	"status" text DEFAULT 'working' NOT NULL,
	"result" text,
	"link" text,
	"approval_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"reported_at" timestamp with time zone,
	"report_tries" integer DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "kaizen_life_handoffs_direction" CHECK ("commerce"."kaizen_life_handoffs"."direction" in ('to_life', 'from_life')),
	CONSTRAINT "kaizen_life_handoffs_status" CHECK ("commerce"."kaizen_life_handoffs"."status" in ('working', 'waiting_for_you', 'done', 'declined', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "kaizen_life_handoffs_task" CHECK (length("commerce"."kaizen_life_handoffs"."task") between 1 and 4000),
	CONSTRAINT "kaizen_life_handoffs_result" CHECK ("commerce"."kaizen_life_handoffs"."result" is null or length("commerce"."kaizen_life_handoffs"."result") <= 8000),
	CONSTRAINT "kaizen_life_handoffs_from" CHECK ("commerce"."kaizen_life_handoffs"."from_name" is null or length("commerce"."kaizen_life_handoffs"."from_name") <= 200),
	CONSTRAINT "kaizen_life_handoffs_link" CHECK ("commerce"."kaizen_life_handoffs"."link" is null or length("commerce"."kaizen_life_handoffs"."link") <= 2000),
	CONSTRAINT "kaizen_life_handoffs_store" CHECK ("commerce"."kaizen_life_handoffs"."direction" = 'to_life' or "commerce"."kaizen_life_handoffs"."store_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" DROP CONSTRAINT "assistant_notices_kind";--> statement-breakpoint
ALTER TABLE "commerce"."kaizen_life_handoffs" ADD CONSTRAINT "kaizen_life_handoffs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."kaizen_life_handoffs" ADD CONSTRAINT "kaizen_life_handoffs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."kaizen_life_handoffs" ADD CONSTRAINT "kaizen_life_handoffs_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kaizen_life_handoffs_account_idx" ON "commerce"."kaizen_life_handoffs" USING btree ("account_id","direction","created_at");--> statement-breakpoint
CREATE INDEX "kaizen_life_handoffs_open_idx" ON "commerce"."kaizen_life_handoffs" USING btree ("status","updated_at") WHERE "commerce"."kaizen_life_handoffs"."status" in ('working', 'waiting_for_you');--> statement-breakpoint
CREATE INDEX "kaizen_life_handoffs_store_idx" ON "commerce"."kaizen_life_handoffs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "kaizen_life_handoffs_conversation_idx" ON "commerce"."kaizen_life_handoffs" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_kind" CHECK ("commerce"."assistant_notices"."kind" in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready', 'life_handoff'));