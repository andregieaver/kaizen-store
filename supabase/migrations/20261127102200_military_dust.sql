CREATE TABLE "commerce"."platform_incident_stores" (
	"incident_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_incident_stores_incident_id_store_id_pk" PRIMARY KEY("incident_id","store_id"),
	CONSTRAINT "platform_incident_stores_occurrences" CHECK ("commerce"."platform_incident_stores"."occurrences" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "auto_approve_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "auto_approve_wait_hours" smallint DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "auto_approve_per_week" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "auto_approve_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_stores" ADD CONSTRAINT "platform_incident_stores_incident_id_platform_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "commerce"."platform_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_incident_stores" ADD CONSTRAINT "platform_incident_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_incident_stores_store_idx" ON "commerce"."platform_incident_stores" USING btree ("store_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_auto_approve_by_accounts_id_fk" FOREIGN KEY ("auto_approve_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_auto_approve_by_idx" ON "commerce"."platform_settings" USING btree ("auto_approve_by");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_auto_approve_wait" CHECK ("commerce"."platform_settings"."auto_approve_wait_hours" in (6, 12, 24, 48));--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_auto_approve_week" CHECK ("commerce"."platform_settings"."auto_approve_per_week" between 1 and 5);