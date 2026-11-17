CREATE TABLE "commerce"."form_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"form_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"contact_email" text,
	"path" text NOT NULL,
	"locale" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"delivery" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_responses_answers" CHECK (jsonb_typeof("commerce"."form_responses"."answers") = 'array' and jsonb_array_length("commerce"."form_responses"."answers") <= 40),
	CONSTRAINT "form_responses_state" CHECK ("commerce"."form_responses"."state" in ('new', 'read', 'archived')),
	CONSTRAINT "form_responses_delivery" CHECK ("commerce"."form_responses"."delivery" in ('sent', 'logged', 'failed', 'inbox')),
	CONSTRAINT "form_responses_contact" CHECK ("commerce"."form_responses"."contact_email" is null or (char_length("commerce"."form_responses"."contact_email") <= 254 and "commerce"."form_responses"."contact_email" = lower("commerce"."form_responses"."contact_email")))
);
--> statement-breakpoint
CREATE TABLE "commerce"."forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"words" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signup" jsonb,
	"keep_months" integer DEFAULT 12 NOT NULL,
	"made_from" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_kind" CHECK ("commerce"."forms"."kind" in ('message', 'signup')),
	CONSTRAINT "forms_name" CHECK (char_length(btrim("commerce"."forms"."name")) between 1 and 80),
	CONSTRAINT "forms_status" CHECK ("commerce"."forms"."status" in ('active', 'archived')),
	CONSTRAINT "forms_questions" CHECK (jsonb_typeof("commerce"."forms"."questions") = 'array' and jsonb_array_length("commerce"."forms"."questions") <= 20),
	CONSTRAINT "forms_words" CHECK (jsonb_typeof("commerce"."forms"."words") = 'object'),
	CONSTRAINT "forms_delivery" CHECK (jsonb_typeof("commerce"."forms"."delivery") = 'object'),
	CONSTRAINT "forms_signup" CHECK (("commerce"."forms"."kind" = 'signup') = ("commerce"."forms"."signup" is not null) and ("commerce"."forms"."signup" is null or jsonb_typeof("commerce"."forms"."signup") = 'object')),
	CONSTRAINT "forms_keep_months" CHECK ("commerce"."forms"."keep_months" between 1 and 36),
	CONSTRAINT "forms_made_from" CHECK ("commerce"."forms"."made_from" is null or char_length("commerce"."forms"."made_from") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."form_responses" ADD CONSTRAINT "form_responses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_responses" ADD CONSTRAINT "form_responses_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "commerce"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."forms" ADD CONSTRAINT "forms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."forms" ADD CONSTRAINT "forms_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."forms" ADD CONSTRAINT "forms_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_form_idx" ON "commerce"."form_responses" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_responses_contact_idx" ON "commerce"."form_responses" USING btree ("store_id","contact_email");--> statement-breakpoint
CREATE INDEX "form_responses_created_idx" ON "commerce"."form_responses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "forms_store_idx" ON "commerce"."forms" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "forms_created_by_idx" ON "commerce"."forms" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "forms_updated_by_idx" ON "commerce"."forms" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings', 'contracts', 'form_responses'));