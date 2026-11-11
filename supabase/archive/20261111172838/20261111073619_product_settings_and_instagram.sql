CREATE TABLE "commerce"."instagram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posts_fetched_at" timestamp with time zone,
	"problem" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_accounts_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "instagram_accounts_user" CHECK ("commerce"."instagram_accounts"."ig_user_id" ~ '^[0-9]{1,40}$'),
	CONSTRAINT "instagram_accounts_username" CHECK (char_length("commerce"."instagram_accounts"."username") between 1 and 60),
	CONSTRAINT "instagram_accounts_posts" CHECK (jsonb_typeof("commerce"."instagram_accounts"."posts") = 'array' and octet_length("commerce"."instagram_accounts"."posts"::text) < 400000),
	CONSTRAINT "instagram_accounts_problem" CHECK ("commerce"."instagram_accounts"."problem" is null or char_length("commerce"."instagram_accounts"."problem") <= 300)
);
--> statement-breakpoint
CREATE TABLE "commerce"."product_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"tile_stock" boolean DEFAULT false NOT NULL,
	"tile_quantity" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD CONSTRAINT "instagram_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."instagram_accounts" ADD CONSTRAINT "instagram_accounts_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_settings" ADD CONSTRAINT "product_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instagram_accounts_connected_by_idx" ON "commerce"."instagram_accounts" USING btree ("connected_by");