CREATE TABLE "commerce"."ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"time_zone" text NOT NULL,
	"token" text NOT NULL,
	"token_hint" text NOT NULL,
	"monthly_limit_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_accounts_store_platform" UNIQUE("store_id","platform"),
	CONSTRAINT "ad_accounts_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "ad_accounts_platform" CHECK ("commerce"."ad_accounts"."platform" in ('meta')),
	CONSTRAINT "ad_accounts_account" CHECK ("commerce"."ad_accounts"."account_id" ~ '^[0-9]{5,20}$'),
	CONSTRAINT "ad_accounts_name" CHECK (char_length("commerce"."ad_accounts"."name") between 1 and 200),
	CONSTRAINT "ad_accounts_time_zone" CHECK (char_length("commerce"."ad_accounts"."time_zone") between 1 and 64),
	CONSTRAINT "ad_accounts_limit" CHECK ("commerce"."ad_accounts"."monthly_limit_minor" is null or "commerce"."ad_accounts"."monthly_limit_minor" between 0 and 100000000000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ad_accounts" ADD CONSTRAINT "ad_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;