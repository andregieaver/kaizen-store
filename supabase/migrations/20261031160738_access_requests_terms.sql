ALTER TABLE "commerce"."access_requests" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "terms_version" text;