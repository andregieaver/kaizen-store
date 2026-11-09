CREATE TABLE "commerce"."platform_ad_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"event" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_ad_conversions_once" UNIQUE("request_id","platform","event"),
	CONSTRAINT "platform_ad_conversions_platform" CHECK ("commerce"."platform_ad_conversions"."platform" in ('meta', 'ga4', 'tiktok', 'pinterest')),
	CONSTRAINT "platform_ad_conversions_event" CHECK ("commerce"."platform_ad_conversions"."event" in ('sign_up', 'plan_paid')),
	CONSTRAINT "platform_ad_conversions_status" CHECK ("commerce"."platform_ad_conversions"."status" in ('pending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "platform_ad_conversions_answer" CHECK ("commerce"."platform_ad_conversions"."answer" is null or char_length("commerce"."platform_ad_conversions"."answer") <= 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "ad_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "ad_signals" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."platform_ad_conversions" ADD CONSTRAINT "platform_ad_conversions_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "commerce"."access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_ad_conversions_due_idx" ON "commerce"."platform_ad_conversions" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "platform_ad_conversions_created_idx" ON "commerce"."platform_ad_conversions" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_ad_signals" CHECK ("commerce"."access_requests"."ad_signals" is null or ("commerce"."access_requests"."ad_consent_at" is not null and jsonb_typeof("commerce"."access_requests"."ad_signals") = 'object' and length("commerce"."access_requests"."ad_signals"::text) <= 2000));