ALTER TABLE "commerce"."design_edits" DROP CONSTRAINT "design_edits_place";--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "picture_media_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "commerce"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_picture_media_id_media_id_fk" FOREIGN KEY ("picture_media_id") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_edits_post_idx" ON "commerce"."design_edits" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_posts_picture_idx" ON "commerce"."social_posts" USING btree ("picture_media_id");--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_post" CHECK ("commerce"."design_edits"."place" = 'post' or "commerce"."design_edits"."post_id" is null);--> statement-breakpoint
ALTER TABLE "commerce"."design_edits" ADD CONSTRAINT "design_edits_place" CHECK ("commerce"."design_edits"."place" in ('library', 'field', 'post'));