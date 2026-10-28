CREATE TABLE "commerce"."storefront_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"market" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "storefront_tokens_name" CHECK (length(btrim("commerce"."storefront_tokens"."name")) between 1 and 60),
	CONSTRAINT "storefront_tokens_token" CHECK ("commerce"."storefront_tokens"."token" ~ '^kfs_[A-Za-z0-9_-]{32,48}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."storefront_tokens" ADD CONSTRAINT "storefront_tokens_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."storefront_tokens" ADD CONSTRAINT "storefront_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_tokens_store_idx" ON "commerce"."storefront_tokens" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "storefront_tokens_created_by_idx" ON "commerce"."storefront_tokens" USING btree ("created_by");
-- Storefront API tokens (wave 9 unit I, D362): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."storefront_tokens" ENABLE ROW LEVEL SECURITY;
