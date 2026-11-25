CREATE TABLE "commerce"."social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"ref" text NOT NULL,
	"product_id" uuid,
	"topic" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"locale" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"caption" text NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"link" text NOT NULL,
	"price_line" text,
	"copied_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "social_posts_channel" CHECK ("commerce"."social_posts"."channel" in ('instagram', 'facebook', 'pinterest', 'tiktok', 'linkedin')),
	CONSTRAINT "social_posts_ref" CHECK ("commerce"."social_posts"."ref" ~ '^[a-z0-9]{12}$'),
	CONSTRAINT "social_posts_texts" CHECK (char_length("commerce"."social_posts"."caption") between 1 and 3000 and char_length("commerce"."social_posts"."title") <= 100 and char_length("commerce"."social_posts"."topic") <= 500 and char_length("commerce"."social_posts"."campaign") <= 80 and cardinality("commerce"."social_posts"."hashtags") <= 30)
);
--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "commerce"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."social_posts" ADD CONSTRAINT "social_posts_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_ref_idx" ON "commerce"."social_posts" USING btree ("store_id","ref","channel");--> statement-breakpoint
CREATE INDEX "social_posts_list_idx" ON "commerce"."social_posts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "social_posts_product_idx" ON "commerce"."social_posts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "social_posts_created_by_idx" ON "commerce"."social_posts" USING btree ("created_by");