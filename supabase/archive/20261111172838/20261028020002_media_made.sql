ALTER TABLE "commerce"."ai_providers" ADD COLUMN "image_edit_model" text;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD COLUMN "made_by" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD COLUMN "edited_from" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_edited_from_media_id_fk" FOREIGN KEY ("edited_from") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_edited_from_idx" ON "commerce"."media" USING btree ("edited_from");--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_made_by" CHECK ("commerce"."media"."made_by" in ('person', 'ai_made', 'ai_edited'));--> statement-breakpoint
ALTER TABLE "commerce"."media" ADD CONSTRAINT "media_edited" CHECK (("commerce"."media"."made_by" = 'ai_edited') or "commerce"."media"."edited_from" is null);--> statement-breakpoint
-- Pictures the site's AI made before D349 (D92, D283, D257): `makePicture()` named them `ai-….webp` and kept them with the AI's alt text written as
-- they were stored; an upload has no alt text when it is stored.
UPDATE "commerce"."media" SET "made_by" = 'ai_made'
WHERE "kind" = 'image' AND "file_name" LIKE 'ai-%.webp' AND "alt_source" = 'ai' AND "alt_written_at" IS NOT NULL
  AND abs(extract(epoch FROM ("alt_written_at" - "created_at"))) < 5;
