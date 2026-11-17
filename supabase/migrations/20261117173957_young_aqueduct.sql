CREATE TABLE "commerce"."autopilot_tests" (
	"store_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"account_id" uuid,
	"goal" text NOT NULL,
	"days" integer NOT NULL,
	"outcome" text,
	"approval_id" uuid,
	"conversation_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_tests_store_id_experiment_id_pk" PRIMARY KEY("store_id","experiment_id"),
	CONSTRAINT "autopilot_tests_goal" CHECK ("commerce"."autopilot_tests"."goal" in ('orders', 'cart', 'checkout')),
	CONSTRAINT "autopilot_tests_days" CHECK ("commerce"."autopilot_tests"."days" between 1 and 90),
	CONSTRAINT "autopilot_tests_outcome" CHECK ("commerce"."autopilot_tests"."outcome" is null or "commerce"."autopilot_tests"."outcome" in ('applied', 'asked', 'kept', 'left')),
	CONSTRAINT "autopilot_tests_decided" CHECK (("commerce"."autopilot_tests"."outcome" is null) = ("commerce"."autopilot_tests"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" DROP CONSTRAINT "assistant_notices_kind";--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_approval_id_assistant_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "commerce"."assistant_approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_experiment_fk" FOREIGN KEY ("store_id","experiment_id") REFERENCES "commerce"."experiments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_tests_open_idx" ON "commerce"."autopilot_tests" USING btree ("created_at") WHERE "commerce"."autopilot_tests"."outcome" is null;--> statement-breakpoint
CREATE INDEX "autopilot_tests_store_idx" ON "commerce"."autopilot_tests" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_tests_page_idx" ON "commerce"."autopilot_tests" USING btree ("store_id","page_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_account_idx" ON "commerce"."autopilot_tests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_approval_idx" ON "commerce"."autopilot_tests" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_conversation_idx" ON "commerce"."autopilot_tests" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_kind" CHECK ("commerce"."assistant_notices"."kind" in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready', 'life_handoff', 'test_answered', 'test_decided'));