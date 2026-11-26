ALTER TABLE "commerce"."social_posts" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "scheduled_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "publish_tries" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "next_try_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_scheduled_by_accounts_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_scheduled_by_idx" ON "commerce"."social_posts" USING btree ("scheduled_by");--> statement-breakpoint
CREATE INDEX "social_posts_due_idx" ON "commerce"."social_posts" USING btree ("scheduled_for") WHERE "commerce"."social_posts"."scheduled_for" is not null and "commerce"."social_posts"."published_at" is null;