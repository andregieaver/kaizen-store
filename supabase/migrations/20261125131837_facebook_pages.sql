CREATE TABLE "commerce"."facebook_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" text,
	"page_name" text DEFAULT '' NOT NULL,
	"page_token_encrypted" text,
	"user_token_encrypted" text,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"insights" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"problem" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_pages_store_key" UNIQUE("store_id"),
	CONSTRAINT "facebook_pages_page" CHECK ("commerce"."facebook_pages"."page_id" is null or "commerce"."facebook_pages"."page_id" ~ '^[0-9]{1,40}$'),
	CONSTRAINT "facebook_pages_name" CHECK (char_length("commerce"."facebook_pages"."page_name") <= 100),
	CONSTRAINT "facebook_pages_chosen" CHECK ("commerce"."facebook_pages"."page_id" is null or "commerce"."facebook_pages"."page_token_encrypted" is not null),
	CONSTRAINT "facebook_pages_choices" CHECK (jsonb_typeof("commerce"."facebook_pages"."choices") = 'array' and octet_length("commerce"."facebook_pages"."choices"::text) < 20000),
	CONSTRAINT "facebook_pages_problem" CHECK ("commerce"."facebook_pages"."problem" is null or char_length("commerce"."facebook_pages"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."facebook_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" DROP CONSTRAINT "social_post_insights_channel";--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" DROP CONSTRAINT "social_post_insights_media";--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."facebook_pages" ADD CONSTRAINT "facebook_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."facebook_pages" ADD CONSTRAINT "facebook_pages_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facebook_pages_connected_by_idx" ON "commerce"."facebook_pages" USING btree ("connected_by");--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_page_id_facebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "commerce"."facebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_page_media_key" UNIQUE("page_id","media_id");--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_owner" CHECK (("commerce"."social_post_insights"."channel" = 'instagram' and "commerce"."social_post_insights"."account_id" is not null and "commerce"."social_post_insights"."page_id" is null) or ("commerce"."social_post_insights"."channel" = 'facebook' and "commerce"."social_post_insights"."page_id" is not null and "commerce"."social_post_insights"."account_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_channel" CHECK ("commerce"."social_post_insights"."channel" in ('instagram', 'facebook'));--> statement-breakpoint
ALTER TABLE "commerce"."social_post_insights" ADD CONSTRAINT "social_post_insights_media" CHECK ("commerce"."social_post_insights"."media_id" ~ '^[0-9]{1,40}(_[0-9]{1,40})?$' and char_length("commerce"."social_post_insights"."caption") <= 300 and char_length("commerce"."social_post_insights"."permalink") <= 300);