ALTER TABLE "commerce"."social_posts" ADD COLUMN "planned_for" date;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_planned_idx" ON "commerce"."social_posts" USING btree ("store_id","planned_for");--> statement-breakpoint
CREATE INDEX "social_posts_approved_by_idx" ON "commerce"."social_posts" USING btree ("approved_by");