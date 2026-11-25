CREATE TABLE "commerce"."social_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"facts" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_reviews_week_key" UNIQUE("store_id","account_id","week_start"),
	CONSTRAINT "social_reviews_size" CHECK (octet_length("commerce"."social_reviews"."facts"::text) < 20000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."social_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."social_reviews" ADD CONSTRAINT "social_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_reviews" ADD CONSTRAINT "social_reviews_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_reviews_account_idx" ON "commerce"."social_reviews" USING btree ("account_id");