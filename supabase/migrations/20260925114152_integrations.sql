CREATE TABLE "commerce"."integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
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
	CONSTRAINT "integration_deliveries_status" CHECK ("commerce"."integration_deliveries"."status" in ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_integrations" (
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_url_encrypted" text NOT NULL,
	"webhook_hint" text NOT NULL,
	"events" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "store_integrations_store_id_provider_pk" PRIMARY KEY("store_id","provider"),
	CONSTRAINT "store_integrations_provider" CHECK ("commerce"."store_integrations"."provider" in ('zapier', 'make'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."integration_deliveries" ADD CONSTRAINT "integration_deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_integrations" ADD CONSTRAINT "store_integrations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_integrations" ADD CONSTRAINT "store_integrations_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_deliveries_due_idx" ON "commerce"."integration_deliveries" USING btree ("next_attempt_at") WHERE "commerce"."integration_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "integration_deliveries_store_idx" ON "commerce"."integration_deliveries" USING btree ("store_id","provider","created_at");--> statement-breakpoint
CREATE INDEX "store_integrations_updated_by_idx" ON "commerce"."store_integrations" USING btree ("updated_by");