CREATE TABLE "commerce"."status_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component" text NOT NULL,
	"ok" boolean NOT NULL,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_checks_component" CHECK ("commerce"."status_checks"."component" in ('website', 'sign_in', 'payments', 'email', 'jobs')),
	CONSTRAINT "status_checks_reason" CHECK ("commerce"."status_checks"."reason" is null or "commerce"."status_checks"."reason" ~ '^[a-z0-9_]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."status_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"body_nb" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_incident_updates_status" CHECK ("commerce"."status_incident_updates"."status" in ('investigating', 'identified', 'monitoring', 'resolved')),
	CONSTRAINT "status_incident_updates_body" CHECK (length(btrim("commerce"."status_incident_updates"."body")) between 1 and 2000 and ("commerce"."status_incident_updates"."body_nb" is null or length("commerce"."status_incident_updates"."body_nb") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "commerce"."status_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_nb" text,
	"impact" text NOT NULL,
	"components" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_incidents_impact" CHECK ("commerce"."status_incidents"."impact" in ('minor', 'major', 'maintenance')),
	CONSTRAINT "status_incidents_status" CHECK ("commerce"."status_incidents"."status" in ('investigating', 'identified', 'monitoring', 'resolved')),
	CONSTRAINT "status_incidents_title" CHECK (length(btrim("commerce"."status_incidents"."title")) between 1 and 120 and ("commerce"."status_incidents"."title_nb" is null or length("commerce"."status_incidents"."title_nb") <= 120)),
	CONSTRAINT "status_incidents_components" CHECK ("commerce"."status_incidents"."components" <@ array['website', 'sign_in', 'payments', 'email', 'jobs']::text[]),
	CONSTRAINT "status_incidents_resolved" CHECK (("commerce"."status_incidents"."status" = 'resolved') = ("commerce"."status_incidents"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."status_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"confirm_hash" text,
	"confirmed_at" timestamp with time zone,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_subscribers_locale" CHECK ("commerce"."status_subscribers"."locale" in ('en', 'nb-NO'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."status_incident_updates" ADD CONSTRAINT "status_incident_updates_incident_id_status_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "commerce"."status_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."status_incident_updates" ADD CONSTRAINT "status_incident_updates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."status_incidents" ADD CONSTRAINT "status_incidents_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_checks_component_idx" ON "commerce"."status_checks" USING btree ("component","checked_at");--> statement-breakpoint
CREATE INDEX "status_incident_updates_incident_idx" ON "commerce"."status_incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "status_incident_updates_created_by_idx" ON "commerce"."status_incident_updates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "status_incidents_started_idx" ON "commerce"."status_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "status_incidents_created_by_idx" ON "commerce"."status_incidents" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_email_idx" ON "commerce"."status_subscribers" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_confirm_idx" ON "commerce"."status_subscribers" USING btree ("confirm_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_unsubscribe_idx" ON "commerce"."status_subscribers" USING btree ("unsubscribe_token");
-- The status page (wave 9 unit G, D360): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."status_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."status_incidents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."status_incident_updates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."status_subscribers" ENABLE ROW LEVEL SECURITY;
