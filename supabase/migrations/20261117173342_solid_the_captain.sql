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
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "commerce"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."unanswered_questions" ADD CONSTRAINT "unanswered_questions_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unanswered_questions_store_idx" ON "commerce"."unanswered_questions" USING btree ("store_id","status","asked");--> statement-breakpoint
CREATE INDEX "unanswered_questions_last_idx" ON "commerce"."unanswered_questions" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "unanswered_questions_document_idx" ON "commerce"."unanswered_questions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "unanswered_questions_decided_by_idx" ON "commerce"."unanswered_questions" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings', 'contracts', 'form_responses', 'unanswered_questions'));