CREATE TABLE "commerce"."tiktok_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"open_id" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"publish" boolean DEFAULT false NOT NULL,
	"problem" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiktok_accounts_store_key" UNIQUE("store_id"),
	CONSTRAINT "tiktok_accounts_names" CHECK (char_length("commerce"."tiktok_accounts"."open_id") <= 200 and char_length("commerce"."tiktok_accounts"."username") <= 100),
	CONSTRAINT "tiktok_accounts_problem" CHECK ("commerce"."tiktok_accounts"."problem" is null or char_length("commerce"."tiktok_accounts"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."tiktok_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tiktok_accounts_connected_by_idx" ON "commerce"."tiktok_accounts" USING btree ("connected_by");