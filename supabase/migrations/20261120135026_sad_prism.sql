ALTER TABLE "commerce"."flows" ADD COLUMN "guard_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD COLUMN "guard_counts" jsonb;