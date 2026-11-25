ALTER TABLE "commerce"."social_posts" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_page_idx" ON "commerce"."social_posts" USING btree ("page_id");