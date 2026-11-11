ALTER TABLE "commerce"."stores" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "closed_at" timestamp with time zone;