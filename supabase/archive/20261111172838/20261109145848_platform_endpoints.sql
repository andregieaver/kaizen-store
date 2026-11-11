CREATE TABLE "commerce"."platform_webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url_encrypted" text NOT NULL,
	"hint" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"topics" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failing_since" timestamp with time zone,
	"disabled_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_webhook_endpoints_name" CHECK (char_length("commerce"."platform_webhook_endpoints"."name") between 1 and 80),
	CONSTRAINT "platform_webhook_endpoints_topics" CHECK (cardinality("commerce"."platform_webhook_endpoints"."topics") between 1 and 40),
	CONSTRAINT "platform_webhook_endpoints_disabled" CHECK ("commerce"."platform_webhook_endpoints"."disabled_reason" is null or "commerce"."platform_webhook_endpoints"."disabled_reason" in ('failing', 'owner'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" DROP CONSTRAINT "platform_integration_deliveries_provider";--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."platform_webhook_endpoints" ADD CONSTRAINT "platform_webhook_endpoints_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_webhook_endpoints_created_by_idx" ON "commerce"."platform_webhook_endpoints" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" ADD CONSTRAINT "platform_deliveries_endpoint_fk" FOREIGN KEY ("endpoint_id") REFERENCES "commerce"."platform_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_integration_deliveries_endpoint_idx" ON "commerce"."platform_integration_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" ADD CONSTRAINT "platform_integration_deliveries_endpoint" CHECK (("commerce"."platform_integration_deliveries"."provider" = 'webhook') = ("commerce"."platform_integration_deliveries"."endpoint_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."platform_integration_deliveries" ADD CONSTRAINT "platform_integration_deliveries_provider" CHECK ("commerce"."platform_integration_deliveries"."provider" in ('zapier', 'make', 'slack', 'webhook'));