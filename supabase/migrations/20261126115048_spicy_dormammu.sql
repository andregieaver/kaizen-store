CREATE TABLE "commerce"."platform_admin_recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"device" text NOT NULL,
	"width" smallint,
	"height" smallint,
	"entry_screen" text NOT NULL,
	"screens" text[] DEFAULT '{}'::text[] NOT NULL,
	"age_band" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"dead_clicks" integer DEFAULT 0 NOT NULL,
	"rage_clicks" integer DEFAULT 0 NOT NULL,
	"seqs" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"segments" smallint DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_admin_recordings_duration" CHECK ("commerce"."platform_admin_recordings"."duration_ms" between 0 and 3600000),
	CONSTRAINT "platform_admin_recordings_device" CHECK ("commerce"."platform_admin_recordings"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "platform_admin_recordings_entry" CHECK ("commerce"."platform_admin_recordings"."entry_screen" ~ '^(s|a)(/[a-z0-9-]{1,30}){0,2}$'),
	CONSTRAINT "platform_admin_recordings_screens" CHECK (cardinality("commerce"."platform_admin_recordings"."screens") <= 50),
	CONSTRAINT "platform_admin_recordings_age_band" CHECK ("commerce"."platform_admin_recordings"."age_band" in ('week', 'month', 'older')),
	CONSTRAINT "platform_admin_recordings_seqs" CHECK (cardinality("commerce"."platform_admin_recordings"."seqs") <= 200),
	CONSTRAINT "platform_admin_recordings_segments" CHECK ("commerce"."platform_admin_recordings"."segments" between 0 and 200),
	CONSTRAINT "platform_admin_recordings_bytes" CHECK ("commerce"."platform_admin_recordings"."bytes" between 0 and 4194304),
	CONSTRAINT "platform_admin_recordings_counts" CHECK ("commerce"."platform_admin_recordings"."clicks" >= 0 and "commerce"."platform_admin_recordings"."dead_clicks" >= 0 and "commerce"."platform_admin_recordings"."rage_clicks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_admin_recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
CREATE INDEX "platform_admin_recordings_started_idx" ON "commerce"."platform_admin_recordings" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings', 'contracts', 'form_responses', 'unanswered_questions', 'admin_recordings'));