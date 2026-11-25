CREATE TABLE "commerce"."platform_autopilot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid,
	"sent_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"session" text,
	"summary" text,
	"claimed" integer DEFAULT 0 NOT NULL,
	"fixed" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_autopilot_runs_reason" CHECK ("commerce"."platform_autopilot_runs"."reason" in ('nightly', 'work', 'approve', 'idea', 'run_now', 'manual')),
	CONSTRAINT "platform_autopilot_runs_texts" CHECK (char_length(coalesce("commerce"."platform_autopilot_runs"."summary", '')) <= 2000 and char_length(coalesce("commerce"."platform_autopilot_runs"."session", '')) <= 300),
	CONSTRAINT "platform_autopilot_runs_counts" CHECK ("commerce"."platform_autopilot_runs"."claimed" >= 0 and "commerce"."platform_autopilot_runs"."fixed" >= 0 and "commerce"."platform_autopilot_runs"."proposed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_autopilot_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."platform_incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid,
	"session" text,
	"from_status" text,
	"to_status" text,
	"note" text,
	CONSTRAINT "platform_incident_events_note" CHECK (char_length(coalesce("commerce"."platform_incident_events"."note", '')) <= 2000 and char_length(coalesce("commerce"."platform_incident_events"."session", '')) <= 300),
	CONSTRAINT "platform_incident_events_something" CHECK ("commerce"."platform_incident_events"."to_status" is not null or "commerce"."platform_incident_events"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commerce"."platform_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"about_store_id" uuid,
	"status" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"fix_commit" text,
	"fix_note" text,
	"fixed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_incidents_kind" CHECK ("commerce"."platform_incidents"."kind" in ('error', 'warning', 'enhancement')),
	CONSTRAINT "platform_incidents_source" CHECK ("commerce"."platform_incidents"."source" in ('runtime', 'cron', 'watchdog', 'status', 'ci', 'advisor', 'nightly', 'platform_ai', 'owner')),
	CONSTRAINT "platform_incidents_status" CHECK ("commerce"."platform_incidents"."status" in ('open', 'proposed', 'approved', 'claimed', 'fixed', 'needs_owner', 'done', 'dismissed', 'wont_fix')),
	CONSTRAINT "platform_incidents_status_kind" CHECK (case when "commerce"."platform_incidents"."kind" = 'enhancement' then "commerce"."platform_incidents"."status" not in ('open') else "commerce"."platform_incidents"."status" not in ('proposed', 'approved', 'dismissed') end),
	CONSTRAINT "platform_incidents_source_kind" CHECK ("commerce"."platform_incidents"."source" not in ('nightly', 'platform_ai', 'owner') or "commerce"."platform_incidents"."kind" = 'enhancement'),
	CONSTRAINT "platform_incidents_texts" CHECK (char_length("commerce"."platform_incidents"."fingerprint") between 1 and 200 and char_length("commerce"."platform_incidents"."title") between 1 and 200 and char_length(coalesce("commerce"."platform_incidents"."fix_note", '')) <= 2000 and char_length(coalesce("commerce"."platform_incidents"."claimed_by", '')) <= 300),
	CONSTRAINT "platform_incidents_json" CHECK (jsonb_typeof("commerce"."platform_incidents"."facts") = 'object' and jsonb_typeof("commerce"."platform_incidents"."evidence") = 'object' and octet_length("commerce"."platform_incidents"."facts"::text) <= 8000 and octet_length("commerce"."platform_incidents"."evidence"::text) <= 8000),
	CONSTRAINT "platform_incidents_counts" CHECK ("commerce"."platform_incidents"."occurrences" >= 1 and "commerce"."platform_incidents"."reopened_count" >= 0),
	CONSTRAINT "platform_incidents_claim" CHECK ("commerce"."platform_incidents"."status" <> 'claimed' or ("commerce"."platform_incidents"."claimed_by" is not null and "commerce"."platform_incidents"."claim_expires_at" is not null)),
	CONSTRAINT "platform_incidents_fixed" CHECK ("commerce"."platform_incidents"."status" <> 'fixed' or ("commerce"."platform_incidents"."fix_commit" is not null and "commerce"."platform_incidents"."fixed_at" is not null)),
	CONSTRAINT "platform_incidents_commit" CHECK ("commerce"."platform_incidents"."fix_commit" is null or "commerce"."platform_incidents"."fix_commit" ~ '^[0-9a-f]{7,40}$'),
	CONSTRAINT "platform_incidents_done" CHECK ("commerce"."platform_incidents"."status" <> 'done' or "commerce"."platform_incidents"."done_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "autopilot_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "autopilot_gap_hours" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "incident_digest_last_day" date;--> statement-breakpoint
ALTER TABLE "commerce"."platform_autopilot_runs" ADD CONSTRAINT "platform_autopilot_runs_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_events" ADD CONSTRAINT "platform_incident_events_incident_id_platform_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "commerce"."platform_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_events" ADD CONSTRAINT "platform_incident_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incidents" ADD CONSTRAINT "platform_incidents_about_store_id_stores_id_fk" FOREIGN KEY ("about_store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incidents" ADD CONSTRAINT "platform_incidents_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_autopilot_runs_requested_idx" ON "commerce"."platform_autopilot_runs" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "platform_autopilot_runs_requested_by_idx" ON "commerce"."platform_autopilot_runs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "platform_incident_events_incident_idx" ON "commerce"."platform_incident_events" USING btree ("incident_id","at");--> statement-breakpoint
CREATE INDEX "platform_incident_events_account_idx" ON "commerce"."platform_incident_events" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_incidents_fingerprint_key" ON "commerce"."platform_incidents" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "platform_incidents_status_idx" ON "commerce"."platform_incidents" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "platform_incidents_store_idx" ON "commerce"."platform_incidents" USING btree ("about_store_id");--> statement-breakpoint
CREATE INDEX "platform_incidents_decided_by_idx" ON "commerce"."platform_incidents" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_autopilot_gap" CHECK ("commerce"."platform_settings"."autopilot_gap_hours" in (1, 2, 4, 8, 12, 24));