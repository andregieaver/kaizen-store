CREATE TABLE "commerce"."platform_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_api_tokens_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "platform_api_tokens_name" CHECK (char_length("commerce"."platform_api_tokens"."name") between 1 and 80),
	CONSTRAINT "platform_api_tokens_scopes" CHECK (cardinality("commerce"."platform_api_tokens"."scopes") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_api_tokens" ADD CONSTRAINT "platform_api_tokens_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_api_tokens_created_by_idx" ON "commerce"."platform_api_tokens" USING btree ("created_by");