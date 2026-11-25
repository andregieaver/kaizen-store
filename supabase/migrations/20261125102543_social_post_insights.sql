CREATE TABLE "commerce"."social_post_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid,
	"channel" text DEFAULT 'instagram' NOT NULL,
	"media_id" text NOT NULL,
	"kind" text NOT NULL,
	"media_type" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"permalink" text DEFAULT '' NOT NULL,
	"reach" integer,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"saves" integer,
	"shares" integer,
	"interactions" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_post_insights_media_key" UNIQUE("account_id","media_id"),
	CONSTRAINT "social_post_insights_channel" CHECK ("commerce"."social_post_insights"."channel" in ('instagram')),
	CONSTRAINT "social_post_insights_kind" CHECK ("commerce"."social_post_insights"."kind" in ('feed', 'reel', 'story')),
	CONSTRAINT "social_post_insights_media" CHECK ("commerce"."social_post_insights"."media_id" ~ '^[0-9]{1,40}$' and char_length("commerce"."social_post_insights"."caption") <= 300 and char_length("commerce"."social_post_insights"."permalink") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD COLUMN "insights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD COLUMN "insights_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD COLUMN "insights_problem" text;--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_account_id_instagram_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."instagram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_post_insights_list_idx" ON "commerce"."social_post_insights" USING btree ("store_id","posted_at");--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD CONSTRAINT "instagram_accounts_insights_problem" CHECK ("commerce"."instagram_accounts"."insights_problem" is null or char_length("commerce"."instagram_accounts"."insights_problem") <= 300);