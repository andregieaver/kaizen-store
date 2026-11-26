ALTER TABLE "commerce"."facebook_pages" ADD COLUMN "publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD COLUMN "publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "published_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "publish_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD COLUMN "publish_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_published_by_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_published_by_idx" ON "commerce"."social_posts" USING btree ("published_by");--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_published" CHECK (("commerce"."social_posts"."published_at" is null or ("commerce"."social_posts"."published_id" is not null and "commerce"."social_posts"."approved_at" is not null)) and ("commerce"."social_posts"."publish_problem" is null or char_length("commerce"."social_posts"."publish_problem") <= 300) and ("commerce"."social_posts"."published_url" is null or char_length("commerce"."social_posts"."published_url") <= 300));