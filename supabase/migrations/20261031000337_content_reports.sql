CREATE TABLE "commerce"."content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"explanation" text NOT NULL,
	"reporter_name" text,
	"reporter_email" text,
	"good_faith" boolean NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"decision" text,
	"action_taken" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"ai_used" boolean DEFAULT false NOT NULL,
	"ai_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_category" CHECK ("commerce"."content_reports"."category" in ('unsafe_product', 'counterfeit_ip', 'illegal_goods', 'consumer_fraud', 'hate_violence', 'privacy', 'minors', 'other')),
	CONSTRAINT "content_reports_status" CHECK ("commerce"."content_reports"."status" in ('received', 'actioned', 'no_action')),
	CONSTRAINT "content_reports_explanation" CHECK (char_length("commerce"."content_reports"."explanation") between 1 and 5000),
	CONSTRAINT "content_reports_url" CHECK ("commerce"."content_reports"."url" ~ '^https?://' and char_length("commerce"."content_reports"."url") <= 2000),
	CONSTRAINT "content_reports_good_faith" CHECK ("commerce"."content_reports"."good_faith"),
	CONSTRAINT "content_reports_sender" CHECK ("commerce"."content_reports"."category" = 'minors' or "commerce"."content_reports"."status" <> 'received' or ("commerce"."content_reports"."reporter_name" is not null and "commerce"."content_reports"."reporter_email" is not null)),
	CONSTRAINT "content_reports_decided" CHECK (("commerce"."content_reports"."status" = 'received') = ("commerce"."content_reports"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD CONSTRAINT "content_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."content_reports" ADD CONSTRAINT "content_reports_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reports_status_idx" ON "commerce"."content_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_store_idx" ON "commerce"."content_reports" USING btree ("store_id");--> statement-breakpoint
-- Written only by src/server/content-reports.ts, never through the Data API.
ALTER TABLE "commerce"."content_reports" ENABLE ROW LEVEL SECURITY;
