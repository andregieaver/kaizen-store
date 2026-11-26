CREATE TABLE "commerce"."pinterest_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"board_id" text,
	"board_name" text DEFAULT '' NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publish" boolean DEFAULT false NOT NULL,
	"problem" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pinterest_accounts_store_key" UNIQUE("store_id"),
	CONSTRAINT "pinterest_accounts_board" CHECK ("commerce"."pinterest_accounts"."board_id" is null or "commerce"."pinterest_accounts"."board_id" ~ '^[0-9]{1,40}$'),
	CONSTRAINT "pinterest_accounts_names" CHECK (char_length("commerce"."pinterest_accounts"."username") <= 100 and char_length("commerce"."pinterest_accounts"."board_name") <= 180),
	CONSTRAINT "pinterest_accounts_choices" CHECK (jsonb_typeof("commerce"."pinterest_accounts"."choices") = 'array' and octet_length("commerce"."pinterest_accounts"."choices"::text) < 30000),
	CONSTRAINT "pinterest_accounts_problem" CHECK ("commerce"."pinterest_accounts"."problem" is null or char_length("commerce"."pinterest_accounts"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."pinterest_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."pinterest_accounts" ADD CONSTRAINT "pinterest_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."pinterest_accounts" ADD CONSTRAINT "pinterest_accounts_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pinterest_accounts_connected_by_idx" ON "commerce"."pinterest_accounts" USING btree ("connected_by");