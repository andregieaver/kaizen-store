CREATE TABLE "commerce"."platform_integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"subject_id" uuid,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_integration_deliveries_provider" CHECK ("commerce"."platform_integration_deliveries"."provider" in ('zapier', 'make', 'slack')),
	CONSTRAINT "platform_integration_deliveries_status" CHECK ("commerce"."platform_integration_deliveries"."status" in ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."platform_integrations" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_url_encrypted" text NOT NULL,
	"webhook_hint" text NOT NULL,
	"events" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "platform_integrations_provider" CHECK ("commerce"."platform_integrations"."provider" in ('zapier', 'make', 'slack'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_integrations" ADD CONSTRAINT "platform_integrations_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_integration_deliveries_due_idx" ON "commerce"."platform_integration_deliveries" USING btree ("next_attempt_at") WHERE "commerce"."platform_integration_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "platform_integration_deliveries_provider_idx" ON "commerce"."platform_integration_deliveries" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "platform_integration_deliveries_subject_idx" ON "commerce"."platform_integration_deliveries" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "platform_integrations_updated_by_idx" ON "commerce"."platform_integrations" USING btree ("updated_by");