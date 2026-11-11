ALTER TABLE "commerce"."dns_zones" ADD COLUMN "leaving_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."dns_zones" ADD COLUMN "moved_to" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."domain_registrations" ADD COLUMN "transfer_started_at" timestamp with time zone;