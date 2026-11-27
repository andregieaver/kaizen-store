CREATE TABLE "commerce"."linkedin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone,
	"author_urn" text,
	"author_name" text DEFAULT '' NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publish" boolean DEFAULT false NOT NULL,
	"problem" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linkedin_accounts_store_key" UNIQUE("store_id"),
	CONSTRAINT "linkedin_accounts_author" CHECK ("commerce"."linkedin_accounts"."author_urn" is null or "commerce"."linkedin_accounts"."author_urn" ~ '^urn:li:(person|organization):[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "linkedin_accounts_names" CHECK (char_length("commerce"."linkedin_accounts"."member_name") <= 200 and char_length("commerce"."linkedin_accounts"."author_name") <= 200),
	CONSTRAINT "linkedin_accounts_choices" CHECK (jsonb_typeof("commerce"."linkedin_accounts"."choices") = 'array' and octet_length("commerce"."linkedin_accounts"."choices"::text) < 20000),
	CONSTRAINT "linkedin_accounts_problem" CHECK ("commerce"."linkedin_accounts"."problem" is null or char_length("commerce"."linkedin_accounts"."problem") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."linkedin_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."linkedin_accounts" ADD CONSTRAINT "linkedin_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."linkedin_accounts" ADD CONSTRAINT "linkedin_accounts_connected_by_accounts_id_fk" FOREIGN KEY ("connected_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linkedin_accounts_connected_by_idx" ON "commerce"."linkedin_accounts" USING btree ("connected_by");