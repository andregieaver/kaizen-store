CREATE TABLE "commerce"."contact_policies" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"per_week" smallint DEFAULT 3 NOT NULL,
	"spacing_hours" smallint DEFAULT 20 NOT NULL,
	"quiet_hours" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_policies_per_week" CHECK ("commerce"."contact_policies"."per_week" between 1 and 14),
	CONSTRAINT "contact_policies_spacing" CHECK ("commerce"."contact_policies"."spacing_hours" between 0 and 72)
);
--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" DROP CONSTRAINT "broadcast_recipients_skip";--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD COLUMN "suppressed_reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."contact_policies" ADD CONSTRAINT "contact_policies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_suppressed_reason" CHECK ("commerce"."automation_sends"."suppressed_reason" is null or "commerce"."automation_sends"."suppressed_reason" in ('cap', 'spacing'));--> statement-breakpoint
ALTER TABLE "commerce"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_skip" CHECK ("commerce"."broadcast_recipients"."skip_reason" is null or "commerce"."broadcast_recipients"."skip_reason" in ('unsubscribed', 'stopped', 'cap', 'spacing'));