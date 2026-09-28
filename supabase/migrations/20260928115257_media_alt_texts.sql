ALTER TABLE "commerce"."media" ADD COLUMN "alt_translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD COLUMN "alt_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD COLUMN "alt_written_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD COLUMN "alt_tried_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_thumbnail_url_idx" ON "commerce"."media" USING btree ("thumbnail_url");--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_alt_translations" CHECK (jsonb_typeof("commerce"."media"."alt_translations") = 'object');--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_alt_source" CHECK ("commerce"."media"."alt_source" in ('ai', 'staff'));