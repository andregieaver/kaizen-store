ALTER TABLE "commerce"."social_posts" ADD COLUMN "scene_media_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "scene_tries" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_scene_media_id_media_id_fk" FOREIGN KEY ("scene_media_id") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_scene_idx" ON "commerce"."social_posts" USING btree ("scene_media_id");