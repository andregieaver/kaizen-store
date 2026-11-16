CREATE TABLE "commerce"."recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"device" text NOT NULL,
	"width" smallint,
	"height" smallint,
	"entry_page" text NOT NULL,
	"pages" text[] DEFAULT '{}'::text[] NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"dead_clicks" integer DEFAULT 0 NOT NULL,
	"rage_clicks" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"mask" text NOT NULL,
	"seqs" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"segments" smallint DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"seal_tries" smallint DEFAULT 0 NOT NULL,
	"viewed_at" timestamp with time zone,
	CONSTRAINT "recordings_duration" CHECK ("commerce"."recordings"."duration_ms" between 0 and 3600000),
	CONSTRAINT "recordings_device" CHECK ("commerce"."recordings"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "recordings_entry_page" CHECK (char_length("commerce"."recordings"."entry_page") between 1 and 300),
	CONSTRAINT "recordings_pages" CHECK (cardinality("commerce"."recordings"."pages") <= 50),
	CONSTRAINT "recordings_tags" CHECK (cardinality("commerce"."recordings"."tags") <= 5),
	CONSTRAINT "recordings_mask" CHECK ("commerce"."recordings"."mask" in ('balanced', 'strict')),
	CONSTRAINT "recordings_seqs" CHECK (cardinality("commerce"."recordings"."seqs") <= 200),
	CONSTRAINT "recordings_segments" CHECK ("commerce"."recordings"."segments" between 0 and 200),
	CONSTRAINT "recordings_bytes" CHECK ("commerce"."recordings"."bytes" between 0 and 4194304),
	CONSTRAINT "recordings_counts" CHECK ("commerce"."recordings"."clicks" >= 0 and "commerce"."recordings"."dead_clicks" >= 0 and "commerce"."recordings"."rage_clicks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" DROP CONSTRAINT "limit_overrides_known";--> statement-breakpoint
ALTER TABLE "commerce"."plan_limits" DROP CONSTRAINT "plan_limits_known";--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."store_usage_daily" DROP CONSTRAINT "store_usage_daily_metric";--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "recordings_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."recordings" ADD CONSTRAINT "recordings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recordings_store_started_idx" ON "commerce"."recordings" USING btree ("store_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recordings_started_idx" ON "commerce"."recordings" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "recordings_unsealed_idx" ON "commerce"."recordings" USING btree ("last_at") WHERE not "commerce"."recordings"."sealed";--> statement-breakpoint
ALTER TABLE "commerce"."limit_overrides" ADD CONSTRAINT "limit_overrides_known" CHECK ("commerce"."limit_overrides"."key" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'marketing_emails_month', 'ai_cost_month_micros', 'requests_month', 'egress_bytes_month', 'recordings_month', 'stores_owned'));--> statement-breakpoint
ALTER TABLE "commerce"."plan_limits" ADD CONSTRAINT "plan_limits_known" CHECK ("commerce"."plan_limits"."key" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'marketing_emails_month', 'ai_cost_month_micros', 'requests_month', 'egress_bytes_month', 'recordings_month', 'stores_owned'));--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels', 'sandboxes', 'recordings'));--> statement-breakpoint
ALTER TABLE "commerce"."store_usage_daily" ADD CONSTRAINT "store_usage_daily_metric" CHECK ("commerce"."store_usage_daily"."metric" in ('storage_bytes', 'products', 'staff_seats', 'custom_domains', 'requests', 'egress_bytes', 'server_errors', 'emails', 'marketing_emails', 'ai_cost_micros', 'recordings'));