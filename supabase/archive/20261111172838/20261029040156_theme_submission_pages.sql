ALTER TABLE "commerce"."theme_submissions" ADD COLUMN "pages" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD COLUMN "content_starter_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."theme_submissions" ADD CONSTRAINT "theme_submissions_content_starter_id_store_starters_id_fk" FOREIGN KEY ("content_starter_id") REFERENCES "commerce"."store_starters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "theme_submissions_content_starter_idx" ON "commerce"."theme_submissions" USING btree ("content_starter_id");