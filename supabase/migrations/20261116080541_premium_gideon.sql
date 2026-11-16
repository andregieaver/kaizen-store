ALTER TABLE "commerce"."stores" ADD COLUMN "heatmaps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "recordings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "recording_share" smallint DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "recording_mask" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "recordings_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_recording_share" CHECK ("commerce"."stores"."recording_share" in (10, 25, 50, 100));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_recording_mask" CHECK ("commerce"."stores"."recording_mask" in ('balanced', 'strict'));