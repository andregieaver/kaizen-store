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
CREATE TABLE "commerce"."unanswered_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"lang" text NOT NULL,
	"key" text NOT NULL,
	"question" text NOT NULL,
	"asked" integer DEFAULT 1 NOT NULL,
	"handed_over" integer DEFAULT 0 NOT NULL,
	"conversations" uuid[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"document_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unanswered_questions_key" UNIQUE NULLS NOT DISTINCT("store_id","lang","key"),
	CONSTRAINT "unanswered_questions_lang" CHECK ("commerce"."unanswered_questions"."lang" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "unanswered_questions_key_length" CHECK (char_length("commerce"."unanswered_questions"."key") between 1 and 300),
	CONSTRAINT "unanswered_questions_question" CHECK (char_length("commerce"."unanswered_questions"."question") between 1 and 300),
	CONSTRAINT "unanswered_questions_asked" CHECK ("commerce"."unanswered_questions"."asked" >= 1 and "commerce"."unanswered_questions"."handed_over" between 0 and "commerce"."unanswered_questions"."asked"),
	CONSTRAINT "unanswered_questions_conversations" CHECK (cardinality("commerce"."unanswered_questions"."conversations") between 1 and 5),
	CONSTRAINT "unanswered_questions_status" CHECK ("commerce"."unanswered_questions"."status" in ('open', 'answered', 'dismissed')),
	CONSTRAINT "unanswered_questions_decided" CHECK (("commerce"."unanswered_questions"."status" = 'open') = ("commerce"."unanswered_questions"."decided_at" is null)),
	CONSTRAINT "unanswered_questions_seen" CHECK ("commerce"."unanswered_questions"."last_at" >= "commerce"."unanswered_questions"."first_at")
);
--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" DROP CONSTRAINT "assistant_notices_kind";--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_approval_id_assistant_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "commerce"."assistant_approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "commerce"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_experiment_fk" FOREIGN KEY ("store_id","experiment_id") REFERENCES "commerce"."experiments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_tests" ADD CONSTRAINT "autopilot_tests_page_fk" FOREIGN KEY ("store_id","page_id") REFERENCES "commerce"."pages"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "commerce"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_tests_open_idx" ON "commerce"."autopilot_tests" USING btree ("created_at") WHERE "commerce"."autopilot_tests"."outcome" is null;--> statement-breakpoint
CREATE INDEX "autopilot_tests_store_idx" ON "commerce"."autopilot_tests" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_tests_page_idx" ON "commerce"."autopilot_tests" USING btree ("store_id","page_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_account_idx" ON "commerce"."autopilot_tests" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_approval_idx" ON "commerce"."autopilot_tests" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "autopilot_tests_conversation_idx" ON "commerce"."autopilot_tests" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "unanswered_questions_store_idx" ON "commerce"."unanswered_questions" USING btree ("store_id","status","asked");--> statement-breakpoint
CREATE INDEX "unanswered_questions_last_idx" ON "commerce"."unanswered_questions" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "unanswered_questions_document_idx" ON "commerce"."unanswered_questions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "unanswered_questions_decided_by_idx" ON "commerce"."unanswered_questions" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "commerce"."assistant_notices" ADD CONSTRAINT "assistant_notices_kind" CHECK ("commerce"."assistant_notices"."kind" in ('page_built', 'follow_up', 'plan_question', 'plan_done', 'approval_waiting', 'report_ready', 'life_handoff', 'test_answered', 'test_decided'));--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings', 'contracts', 'form_responses', 'unanswered_questions'));